const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const axios = require('axios');
require('dotenv').config();

const authPath = process.env.WHATSAPP_AUTH_PATH || '.wwebjs_auth';
const historyPath = path.join(authPath, 'conversation-history.json');
const MAX_HISTORY = 5;
const MAX_CHATS = 100;
const config = {
  apiKey: process.env.HF_TOKEN || process.env.HF_API_KEY,
  model: process.env.HF_MODEL || 'Qwen/Qwen3.8-27B:novita',
  endpoint: `${(process.env.HF_BASE_URL || 'https://router.huggingface.co/v1').replace(/\/$/, '')}/chat/completions`,
  dashboardApiKey: process.env.DASHBOARD_API_KEY || '',
  allowedOrigin: process.env.DASHBOARD_ORIGIN || '',
  port: Number(process.env.PORT || 3000)
};
const SYSTEM_PROMPT = process.env.QWEN_SYSTEM_PROMPT ||
  'You are a helpful WhatsApp assistant. Keep answers clear and concise.';

let status = 'starting';
let qrDataUrl = null;
let lastError = null;
const conversationHistory = loadHistory();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: authPath }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

function loadHistory() {
  try {
    const stored = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    return new Map(Object.entries(stored));
  } catch {
    return new Map();
  }
}

function saveHistory() {
  try {
    fs.mkdirSync(authPath, { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(Object.fromEntries(conversationHistory), null, 2));
  } catch (error) {
    console.error('Could not save conversation history:', error.message);
  }
}

function addHistory(chatId, role, content) {
  const history = conversationHistory.get(chatId) || [];
  history.push({ role, content, at: new Date().toISOString() });
  if (history.length > MAX_HISTORY * 2) history.splice(0, history.length - MAX_HISTORY * 2);
  conversationHistory.set(chatId, history);
  if (conversationHistory.size > MAX_CHATS) conversationHistory.delete(conversationHistory.keys().next().value);
  saveHistory();
  return history;
}

function safeChatId(chatId) {
  return typeof chatId === 'string' && !chatId.includes('@g.us') && !chatId.includes('@broadcast');
}

function publicStatus() {
  return {
    status,
    connected: status === 'ready',
    qrAvailable: Boolean(qrDataUrl),
    model: config.model,
    chats: conversationHistory.size,
    lastError
  };
}

function apiAuth(req, res, next) {
  if (!config.dashboardApiKey) {
    return res.status(503).json({ error: 'DASHBOARD_API_KEY is not configured.' });
  }
  const provided = req.get('x-api-key') || '';
  const expected = Buffer.from(config.dashboardApiKey);
  const received = Buffer.from(provided);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }
  next();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  if (config.allowedOrigin) res.setHeader('Access-Control-Allow-Origin', config.allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, ...publicStatus() }));
app.get('/api/status', apiAuth, (_req, res) => res.json(publicStatus()));
app.get('/api/qr', apiAuth, (_req, res) => res.json({ qr: qrDataUrl, status }));
app.get('/api/conversations', apiAuth, (_req, res) => {
  const conversations = [...conversationHistory.entries()].map(([chatId, messages]) => ({
    chatId,
    messages
  }));
  res.json({ conversations });
});
app.post('/api/messages', apiAuth, async (req, res) => {
  const { chatId, message } = req.body || {};
  if (!safeChatId(chatId) || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'chatId must be a direct WhatsApp chat and message must not be empty.' });
  }
  if (status !== 'ready') return res.status(409).json({ error: 'WhatsApp is not connected.' });
  try {
    const sent = await client.sendMessage(chatId, message.trim());
    addHistory(chatId, 'assistant', message.trim());
    res.status(201).json({ id: sent.id._serialized, chatId, message: message.trim() });
  } catch (error) {
    console.error('API send error:', error.message);
    res.status(502).json({ error: 'WhatsApp could not send the message.' });
  }
});

app.listen(config.port, () => {
  console.log(`Dashboard API listening on port ${config.port}`);
});

client.on('qr', async (qr) => {
  status = 'awaiting_qr';
  lastError = null;
  qrcodeTerminal.generate(qr, { small: true });
  try {
    qrDataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
  } catch (error) {
    lastError = 'Could not generate the QR image.';
    console.error(lastError, error.message);
  }
});

client.on('ready', () => {
  status = 'ready';
  qrDataUrl = null;
  lastError = null;
  console.log('WhatsApp bot is ready.');
});

client.on('message', async (message) => {
  if (!safeChatId(message.from) || !message.body.trim()) return;
  console.log(`Message from ${message.from}: ${message.body}`);
  try {
    await client.sendPresenceAvailable();
    await message.react('⏳');
    const response = await getQwenResponse(message.body, message.from);
    await message.reply(response);
    await message.react('✅');
  } catch (error) {
    lastError = error.message;
    console.error('Error processing message:', error.message);
    await message.reply('Sorry, I encountered an error. Please try again.').catch(() => undefined);
  }
});

async function getQwenResponse(userMessage, chatId) {
  if (!config.apiKey) return 'Qwen is not configured. Set HF_TOKEN in the service environment variables.';
  const history = addHistory(chatId, 'user', userMessage);
  try {
    const response = await axios.post(config.endpoint, {
      model: config.model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map(({ role, content }) => ({ role, content }))],
      temperature: 0.7,
      max_tokens: 500
    }, {
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });
    const aiMessage = response.data?.choices?.[0]?.message?.content?.trim();
    if (!aiMessage) throw new Error('Qwen returned an empty response.');
    addHistory(chatId, 'assistant', aiMessage);
    return aiMessage;
  } catch (error) {
    const history = conversationHistory.get(chatId) || [];
    if (history.at(-1)?.role === 'user') history.pop();
    saveHistory();
    console.error('Hugging Face API error:', error.response?.data || error.message);
    throw error;
  }
}

client.on('disconnected', (reason) => {
  status = 'disconnected';
  lastError = reason || 'WhatsApp disconnected.';
  console.log('WhatsApp bot disconnected:', reason);
});

client.initialize();
console.log('WhatsApp Qwen bot starting...');

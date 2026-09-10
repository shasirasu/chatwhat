const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const axios = require('axios');
require('dotenv').config();

// Ensure whatsapp-web.js patch is applied
try {
  require('./scripts/patch-wwebjs');
} catch (e) {
  console.warn('[patch] Could not run patch-wwebjs:', e.message);
}

const { Client, LocalAuth } = require('whatsapp-web.js');

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
let lastEvent = 'Starting WhatsApp Web client...';
let qrCount = 0;
const conversationHistory = loadHistory();

function getExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: authPath }),
  authTimeoutMs: 120000,
  takeoverOnConflict: true,
  qrMaxRetries: 0,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  puppeteer: {
    headless: true,
    executablePath: getExecutablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
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
    ok: true,
    status,
    connected: status === 'ready',
    qrAvailable: Boolean(qrDataUrl),
    qr: qrDataUrl,
    model: config.model,
    chats: conversationHistory.size,
    lastError,
    lastEvent,
    botInfo: client.info ? {
      wid: client.info.wid ? client.info.wid._serialized : null,
      pushname: client.info.pushname || null
    } : null
  };
}

function apiAuth(req, res, next) {
  if (!config.dashboardApiKey) {
    return next();
  }
  const provided = req.get('x-api-key') || req.query.apiKey || '';
  const expected = Buffer.from(config.dashboardApiKey);
  const received = Buffer.from(provided);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }
  next();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  if (config.allowedOrigin) res.setHeader('Access-Control-Allow-Origin', config.allowedOrigin);
  else res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve web UI
app.use(express.static(path.join(__dirname, 'public')));

// Public Health & Status
app.get('/health', (_req, res) => res.json(publicStatus()));
app.get('/api/status', (_req, res) => res.json(publicStatus()));
app.get('/api/qr', (_req, res) => res.json({
  qr: qrDataUrl,
  status,
  connected: status === 'ready',
  lastError,
  lastEvent
}));

// Conversations (Read)
app.get('/api/conversations', (_req, res) => {
  const conversations = [...conversationHistory.entries()].map(([chatId, messages]) => ({
    chatId,
    messages
  }));
  res.json({ conversations });
});

// Clear conversation history
app.post('/api/conversations/clear', apiAuth, (_req, res) => {
  conversationHistory.clear();
  saveHistory();
  res.json({ ok: true, message: 'Conversation history cleared.' });
});

// Send message via API / Web Dashboard
app.post('/api/messages', apiAuth, async (req, res) => {
  let { chatId, message } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message must not be empty.' });
  }
  if (!chatId || typeof chatId !== 'string') {
    return res.status(400).json({ error: 'chatId is required (e.g. 1234567890@c.us or 1234567890).' });
  }

  // Format chatId if raw phone number given
  chatId = chatId.trim();
  if (!chatId.includes('@')) {
    chatId = `${chatId.replace(/[^0-9]/g, '')}@c.us`;
  }

  if (!safeChatId(chatId)) {
    return res.status(400).json({ error: 'Only direct WhatsApp numbers (@c.us) are supported.' });
  }
  if (status !== 'ready') {
    return res.status(409).json({ error: 'WhatsApp is not connected yet. Please scan the QR code first.' });
  }

  try {
    const sent = await client.sendMessage(chatId, message.trim());
    addHistory(chatId, 'assistant', message.trim());
    res.status(201).json({ id: sent.id._serialized, chatId, message: message.trim() });
  } catch (error) {
    console.error('API send error:', error.message);
    res.status(502).json({ error: `WhatsApp could not send message: ${error.message}` });
  }
});

// Restart / Reinit Engine
app.post('/api/reinit', async (req, res) => {
  try {
    status = 'starting';
    qrDataUrl = null;
    lastError = null;
    lastEvent = 'Restarting WhatsApp Web client...';
    try { await client.destroy(); } catch (e) {}
    client.initialize().catch(err => {
      console.error('Reinit failed:', err.message);
      lastError = err.message;
      status = 'init_failed';
      lastEvent = `Init failed: ${err.message}`;
    });
    res.json({ ok: true, message: 'WhatsApp Web client restarting.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Relink / Logout
app.post('/api/logout', apiAuth, async (req, res) => {
  try {
    status = 'logging_out';
    lastEvent = 'Logging out of WhatsApp...';
    await client.logout().catch(() => {});
    qrDataUrl = null;
    status = 'starting';
    lastEvent = 'Generating new QR code...';
    await client.initialize();
    res.json({ ok: true, message: 'Logged out. Generating fresh QR code.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fallback to index.html for all other requests
app.use((req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Web UI not found. Please verify public/index.html exists.');
  }
});

app.listen(config.port, () => {
  console.log(`=========================================`);
  console.log(`🤖 WhatsApp AI Bot Server`);
  console.log(`🌐 Web UI: http://localhost:${config.port}`);
  console.log(`📡 Health: http://localhost:${config.port}/health`);
  console.log(`=========================================`);
});

client.on('qr', async (qr) => {
  status = 'awaiting_qr';
  lastError = null;
  qrCount++;
  lastEvent = `QR code ready (update #${qrCount}). Scan it from WhatsApp Linked devices.`;
  try {
    qrDataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
    console.log(`📲 WhatsApp QR Code #${qrCount} is ready!`);
    console.log(`👉 Open http://localhost:${config.port} in your browser to scan it.`);
  } catch (error) {
    lastError = 'Could not generate QR image.';
    console.error(lastError, error.message);
  }
});

client.on('change_state', (state) => {
  console.log(`WhatsApp state changed: ${state}`);
  lastEvent = `WhatsApp State: ${state}`;
});

client.on('ready', () => {
  status = 'ready';
  qrDataUrl = null;
  lastError = null;
  const info = client.info ? `(User: ${client.info.pushname || client.info.wid.user})` : '';
  lastEvent = `WhatsApp linked and ready to reply. ${info}`;
  console.log(`✅ WhatsApp bot is READY and connected! ${info}`);
});

client.on('authenticated', () => {
  status = 'authenticating';
  lastEvent = 'QR scanned! Finishing WhatsApp authentication...';
  console.log('🔄 QR code scanned, authenticating session...');
});

client.on('auth_failure', (message) => {
  status = 'auth_failed';
  qrDataUrl = null;
  lastError = message || 'WhatsApp authentication failed.';
  lastEvent = 'Sign-in failed. Refresh the webpage to get a new QR code.';
  console.error('❌ WhatsApp authentication failed:', message);
});

client.on('loading_screen', (percent, message) => {
  if (status !== 'ready') {
    status = 'loading';
    lastEvent = `${message || 'Loading WhatsApp'} (${percent}%)`;
    console.log(`⏳ Loading: ${percent}% - ${message || ''}`);
  }
});

client.on('message', async (message) => {
  if (!safeChatId(message.from) || !message.body.trim()) return;
  console.log(`📩 Incoming message from ${message.from}: ${message.body}`);
  try {
    await client.sendPresenceAvailable();
    await message.react('⏳');
    const response = await getQwenResponse(message.body, message.from);
    await message.reply(response);
    await message.react('✅');
    console.log(`🤖 Replied to ${message.from}`);
  } catch (error) {
    lastError = error.message;
    console.error('Error processing message:', error.message);
    await message.reply('Sorry, I encountered an error while thinking. Please try again.').catch(() => undefined);
  }
});

async function getQwenResponse(userMessage, chatId) {
  if (!config.apiKey) return 'Qwen is not configured. Set HF_TOKEN in your environment variables.';
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
  lastEvent = 'WhatsApp disconnected. Restart the service or relink to reconnect.';
  console.log('⚠️ WhatsApp bot disconnected:', reason);
});

client.initialize().catch((err) => {
  console.error('❌ Failed to initialize WhatsApp client:', err.message);
  lastError = err.message;
  status = 'init_failed';
  lastEvent = `Initialization failed: ${err.message}`;
});

console.log('WhatsApp Qwen bot starting...');

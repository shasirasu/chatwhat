const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
require('dotenv').config();

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.WHATSAPP_AUTH_PATH || '.wwebjs_auth'
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

// Hugging Face Inference Providers exposes Qwen through an OpenAI-compatible API.
const config = {
  apiKey: process.env.HF_TOKEN || process.env.HF_API_KEY,
  model: process.env.HF_MODEL || 'Qwen/Qwen3.8-27B:novita',
  endpoint: `${(process.env.HF_BASE_URL || 'https://router.huggingface.co/v1').replace(/\/$/, '')}/chat/completions`
};

const conversationHistory = new Map();
const MAX_HISTORY = 5;
const SYSTEM_PROMPT = process.env.QWEN_SYSTEM_PROMPT ||
  'You are a helpful WhatsApp assistant. Keep answers clear and concise.';

client.on('qr', (qr) => {
  console.log('📱 Scan this QR code with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp bot is ready!');
});

client.on('message', async (message) => {
  console.log(`📨 Message from ${message.from}: ${message.body}`);

  // Do not answer group chats, WhatsApp Status updates, or other broadcasts.
  if (
    message.from.includes('@g.us') ||
    message.from.includes('@broadcast') ||
    !message.body.trim()
  ) return;

  try {
    await client.sendPresenceAvailable();
    await message.react('⏳');
    const response = await getQwenResponse(message.body, message.from);
    await message.reply(response);
    await message.react('✅');
  } catch (error) {
    console.error('Error processing message:', error.message);
    await message.reply('❌ Sorry, I encountered an error. Please try again.');
    await message.react('❌');
  }
});

async function getQwenResponse(userMessage, chatId) {
  if (!config.apiKey) {
    return '❌ Qwen is not configured. Set HF_TOKEN in your .env file.';
  }

  const history = conversationHistory.get(chatId) || [];
  history.push({ role: 'user', content: userMessage });
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, history.length - MAX_HISTORY * 2);
  }

  try {
    const response = await axios.post(
      config.endpoint,
      {
        model: config.model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const aiMessage = response.data?.choices?.[0]?.message?.content?.trim();
    if (!aiMessage) throw new Error('Qwen returned an empty response.');

    history.push({ role: 'assistant', content: aiMessage });
    conversationHistory.set(chatId, history);
    return aiMessage;
  } catch (error) {
    // Do not retain a message that did not receive a model reply.
    history.pop();
    console.error('Hugging Face API error:', error.response?.data || error.message);
    throw error;
  }
}

client.on('disconnected', () => {
  console.log('❌ WhatsApp bot disconnected');
});

client.initialize();
console.log('🚀 WhatsApp Qwen (Hugging Face) bot starting...');

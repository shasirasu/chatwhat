FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV WHATSAPP_AUTH_PATH=/app/.wwebjs_auth

COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
RUN npm ci --omit=dev && node scripts/patch-wwebjs.js

COPY whatsapp-ai-bot.js ./
COPY public/ ./public/

VOLUME ["/app/.wwebjs_auth"]

EXPOSE 3000

CMD ["npm", "start"]

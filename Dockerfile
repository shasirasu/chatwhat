FROM node:20-bookworm-slim

WORKDIR /app

# Chromium is required by whatsapp-web.js. The no-sandbox launch flags are
# configured in whatsapp-ai-bot.js for managed container platforms.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV WHATSAPP_AUTH_PATH=/app/.wwebjs_auth

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY whatsapp-ai-bot.js ./

# Attach a persistent cloud volume here. Do not bake .env into the image.
VOLUME ["/app/.wwebjs_auth"]

CMD ["npm", "start"]

FROM node:20-bookworm-slim AS dashboard-build

WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

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
RUN npm ci --omit=dev
COPY whatsapp-ai-bot.js ./
COPY --from=dashboard-build /web/dist ./public

VOLUME ["/app/.wwebjs_auth"]

CMD ["npm", "start"]

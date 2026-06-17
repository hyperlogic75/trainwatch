# ─── Build Stage ─────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Runtime Stage ───────────────────────────────────────────
FROM node:20-slim AS runner

# Playwright Chromium 의존성
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 런타임 의존성만 복사
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# Playwright Chromium 설치
RUN npx playwright install chromium

# 비루트 유저로 실행 (보안)
RUN groupadd -r trainwatch && useradd -r -g trainwatch trainwatch
USER trainwatch

EXPOSE 3000
CMD ["npm", "start"]

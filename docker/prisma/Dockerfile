FROM node:24-alpine

WORKDIR /app

# ต้อง copy schema/config ก่อน npm ci เพราะ postinstall ของโปรเจกต์เรียก prisma generate
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# ค่า build-time นี้ใช้ให้ prisma.config.ts โหลดได้เท่านั้น
# ตอนรันจริง docker-compose จะส่ง DATABASE_URL ที่ชี้ไปยัง service postgres
ENV DATABASE_URL=postgresql://lottery:lottery_dev_only@postgres:5432/lottery?schema=public

RUN npm ci

CMD ["npx", "prisma", "migrate", "deploy"]

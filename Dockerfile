# ---- مرحله build (ساخت Next و Prisma Client) ----
FROM node:22-alpine AS builder
WORKDIR /app

# فقط package ها برای نصب dependency
COPY package.json package-lock.json ./
RUN npm ci

# بقیه سورس
COPY . .

# اگر .env داری و می‌خوای Prisma توی build ببینه (برای بعضی دستورها)
# (اختیاری، ولی ضرری نداره)
# COPY .env .env

# اینجا Prisma Client رو می‌سازیم (خیلی مهم: قبل از next build)
RUN npx prisma generate

# حالا Next.js رو build می‌کنیم
RUN npm run build

# ---- مرحله runner (اجرای production) ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# فقط چیزهای لازم برای ران شدن
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.mjs ./next.config.mjs

EXPOSE 3000

CMD ["npm", "start"]

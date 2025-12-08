// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // این همون DATABASE_URL هست که قبلاً تو .env گذاشتی
    url: env('DATABASE_URL'),
  },
});

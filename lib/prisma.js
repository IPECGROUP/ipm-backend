// lib/prisma.js
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

// یک Pool از pg می‌سازیم
const pool = new pg.Pool({
  connectionString,
});

// آداپتر Prisma برای Postgres
const adapter = new PrismaPg(pool);

// جلوگیری از ساخت چندباره PrismaClient در dev
const globalForPrisma = globalThis;

const prismaClient =
  globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prismaClient;
}

export const prisma = prismaClient;

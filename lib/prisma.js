// lib/prisma.js
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import fs from "node:fs";

function resolveConnectionString(raw) {
  const source = String(raw || "").trim();
  if (!source) return "";

  try {
    const url = new URL(source);
    const runningInDocker = fs.existsSync("/.dockerenv");
    if (!runningInDocker && url.hostname === "host.docker.internal") {
      url.hostname = "localhost";
      return url.toString();
    }
  } catch {
    return source;
  }

  return source;
}

const connectionString = resolveConnectionString(process.env.DATABASE_URL);

if (!connectionString) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

const globalForPrisma = globalThis;

// pg Pool singleton (برای اینکه تو dev/Hot reload زیاد ساخته نشه)
const pool =
  globalForPrisma.__pgPool ||
  new pg.Pool({
    connectionString,
  }); // pg ESM pattern :contentReference[oaicite:1]{index=1}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__pgPool = pool;
}

// Prisma adapter singleton
const adapter =
  globalForPrisma.__prismaAdapter || new PrismaPg(pool); // PrismaPg can take a pool 

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prismaAdapter = adapter;
}

// PrismaClient singleton
export const prisma =
  globalForPrisma.__prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

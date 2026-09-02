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

const globalForPrisma = globalThis;

// pg Pool singleton (برای اینکه تو dev/Hot reload زیاد ساخته نشه)
const pool = connectionString
  ? (globalForPrisma.__pgPool || new pg.Pool({ connectionString }))
  : null;

if (pool && process.env.NODE_ENV !== "production") {
  globalForPrisma.__pgPool = pool;
}

// Prisma adapter singleton
const adapter = pool
  ? (globalForPrisma.__prismaAdapter || new PrismaPg(pool))
  : null;

if (adapter && process.env.NODE_ENV !== "production") {
  globalForPrisma.__prismaAdapter = adapter;
}

// PrismaClient singleton
export const prisma = adapter
  ? (globalForPrisma.__prisma || new PrismaClient({ adapter }))
  : new Proxy({}, {
      get() {
        throw new Error("DATABASE_URL is not set in environment variables");
      },
    });

if (adapter && process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

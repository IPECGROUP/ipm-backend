import { prisma } from "./prisma";

let schemaPromise;

async function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS user_session_activity_logs (
        session_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        logged_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        logged_out_at TIMESTAMPTZ NULL
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS user_session_activity_logs_user_time_idx ON user_session_activity_logs (user_id, logged_in_at DESC)`);
  })().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

export async function logSessionStart(sessionId, userId) {
  try {
    await ensureSchema();
    await prisma.$executeRaw`INSERT INTO user_session_activity_logs (session_id, user_id) VALUES (${String(sessionId)}, ${Number(userId)}) ON CONFLICT (session_id) DO NOTHING`;
  } catch (error) { console.error("session_activity_start_failed", error); }
}

export async function logSessionEnd(sessionId) {
  if (!sessionId) return;
  try {
    await ensureSchema();
    await prisma.$executeRaw`UPDATE user_session_activity_logs SET logged_out_at = COALESCE(logged_out_at, NOW()) WHERE session_id = ${String(sessionId)}`;
  } catch (error) { console.error("session_activity_end_failed", error); }
}

export async function readSessionActivityLogs() {
  await ensureSchema();
  return prisma.$queryRaw`
    SELECT l.session_id, l.logged_in_at, l.logged_out_at, u.name, u.username
    FROM user_session_activity_logs l
    INNER JOIN "User" u ON u.id = l.user_id
    ORDER BY l.logged_in_at DESC
    LIMIT 200
  `;
}

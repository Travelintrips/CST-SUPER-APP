import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runOauthStateMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_states (
        token       TEXT PRIMARY KEY,
        return_to   TEXT NOT NULL DEFAULT '/',
        expires_at  BIGINT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states (expires_at)
    `);
    logger.info("OAuth state migration: ok (oauth_states table ready)");
  } catch (err) {
    logger.warn({ err }, "OAuth state migration failed — will use in-memory fallback");
  }
}

// In-memory fallback for oauth states when DB is unavailable
const _memStates = new Map<string, { returnTo: string; expiresAt: number }>();

export async function saveOauthState(token: string, returnTo: string): Promise<void> {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  try {
    await db.execute(sql`
      INSERT INTO oauth_states (token, return_to, expires_at)
      VALUES (${token}, ${returnTo}, ${expiresAt})
      ON CONFLICT (token) DO NOTHING
    `);
    // Clean expired states while we're here (best-effort)
    db.execute(sql`DELETE FROM oauth_states WHERE expires_at < ${Date.now()}`).catch(() => {});
  } catch {
    // DB unavailable — store in memory
    _memStates.set(token, { returnTo, expiresAt });
  }
}

export async function consumeOauthState(token: string): Promise<string | null> {
  // Check memory first
  const memEntry = _memStates.get(token);
  if (memEntry) {
    _memStates.delete(token);
    if (memEntry.expiresAt > Date.now()) return memEntry.returnTo;
    return null;
  }

  try {
    const result = await db.execute(sql`
      DELETE FROM oauth_states
      WHERE token = ${token} AND expires_at > ${Date.now()}
      RETURNING return_to
    `);
    const row = (result as unknown as { rows: Array<{ return_to: string }> }).rows?.[0]
      ?? (result as unknown as Array<{ return_to: string }>)[0];
    return row?.return_to ?? null;
  } catch {
    return null;
  }
}

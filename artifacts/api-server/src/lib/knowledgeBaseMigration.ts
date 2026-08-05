import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Idempotent migration untuk tabel chatbot_knowledge_base.
 * Aman dijalankan berkali-kali.
 */
export async function runKnowledgeBaseMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chatbot_knowledge_base (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT 'umum',
        content     TEXT NOT NULL,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("Knowledge base migration: selesai (chatbot_knowledge_base table ready)");
  } catch (err) {
    logger.error({ err }, "Knowledge base migration gagal");
  }
}

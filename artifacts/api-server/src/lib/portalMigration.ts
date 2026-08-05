import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Idempotent migration untuk fitur admin portal.
 * Aman dijalankan berkali-kali — hanya menambahkan kolom/tabel yang belum ada.
 */
export async function runPortalMigration(): Promise<void> {
  try {
    // Tambah kolom role ke portal_customers jika belum ada (tabel mungkin belum exist)
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portal_customers') THEN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'portal_customers' AND column_name = 'role'
          ) THEN
            ALTER TABLE portal_customers ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';
          END IF;
        END IF;
      END $$
    `);

    // Buat tabel portal_content jika belum ada
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_content (
        id         SERIAL PRIMARY KEY,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Add locale column if not exists (added for multi-locale CMS support)
    await db.execute(sql`
      ALTER TABLE portal_content
        ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'id-ID'
    `);
    // Drop the old single-column unique index on key if it exists,
    // then create the composite unique index on (key, locale).
    // pg will no-op if portal_content_key_unique doesn't exist, so we guard it.
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'portal_content'
            AND indexname = 'portal_content_key_unique'
        ) THEN
          ALTER TABLE portal_content DROP CONSTRAINT IF EXISTS portal_content_key_unique;
          DROP INDEX IF EXISTS portal_content_key_unique;
        END IF;
      END $$
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS portal_content_key_locale_unique
        ON portal_content (key, locale)
    `);

    // Auto-promote semua email yang ada di PORTAL_ADMIN_EMAILS
    const adminEmails = (process.env.PORTAL_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    for (const email of adminEmails) {
      await db.execute(sql`
        UPDATE portal_customers
           SET role = 'admin'
         WHERE LOWER(email) = ${email}
           AND role <> 'admin'
      `);
    }

    // Buat tabel quote_requests jika belum ada
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quote_requests (
        id                         SERIAL PRIMARY KEY,
        name                       TEXT NOT NULL,
        email                      TEXT,
        whatsapp                   TEXT NOT NULL,
        service                    TEXT NOT NULL,
        origin                     TEXT NOT NULL,
        destination                TEXT NOT NULL,
        weight                     TEXT,
        length                     TEXT,
        width                      TEXT,
        height                     TEXT,
        incoterms                  TEXT,
        insurance                  BOOLEAN DEFAULT FALSE,
        express                    BOOLEAN DEFAULT FALSE,
        estimated_total            NUMERIC(14,2),
        estimated_cbm              NUMERIC(10,4),
        estimated_chargeable_weight NUMERIC(10,2),
        status                     TEXT NOT NULL DEFAULT 'new',
        notes                      TEXT,
        handled_by                 TEXT,
        created_at                 TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Buat tabel media_assets jika belum ada
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS media_assets (
        id            SERIAL PRIMARY KEY,
        original_name TEXT NOT NULL,
        content_type  TEXT NOT NULL,
        size_bytes    INTEGER,
        url           TEXT NOT NULL,
        object_path   TEXT NOT NULL,
        uploaded_by   TEXT,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Buat tabel wa_otp_codes jika belum ada
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wa_otp_codes (
        id          SERIAL PRIMARY KEY,
        phone       TEXT NOT NULL,
        code_hash   TEXT NOT NULL,
        purpose     TEXT NOT NULL DEFAULT 'register',
        attempts    INTEGER NOT NULL DEFAULT 0,
        verified    BOOLEAN NOT NULL DEFAULT FALSE,
        verify_token TEXT,
        expires_at  TIMESTAMP NOT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS wa_otp_phone_idx ON wa_otp_codes (phone)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS wa_otp_token_idx ON wa_otp_codes (verify_token)
    `);

    // Buat tabel trusted_devices jika belum ada
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trusted_devices (
        id           SERIAL PRIMARY KEY,
        phone        TEXT NOT NULL,
        device_token TEXT NOT NULL UNIQUE,
        expires_at   TIMESTAMP NOT NULL,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Add avatar_url column to portal_customers if not exists
    await db.execute(sql`
      ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);

    logger.info("Portal migration: selesai (role column + portal_content table + admin email promotion + quote_requests + media_assets + wa_otp_codes + trusted_devices + avatar_url)");
  } catch (err) {
    logger.error({ err }, "Portal migration gagal");
  }
}

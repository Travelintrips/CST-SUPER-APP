import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Idempotent migration untuk fitur admin portal.
 * Aman dijalankan berkali-kali — hanya menambahkan kolom/tabel yang belum ada.
 */
export async function runPortalMigration(): Promise<void> {
  try {
    // Keep the account-state columns in a small, independent statement. The
    // legacy portal migration also creates several large tables and can be
    // interrupted by startup connection contention; account administration
    // must not depend on that unrelated work completing first.
    await db.execute(sql`
      ALTER TABLE portal_customers
        ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS customer_type TEXT,
        ADD COLUMN IF NOT EXISTS sanction_reason TEXT,
        ADD COLUMN IF NOT EXISTS sanction_until TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS status_changed_by TEXT
    `);

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
          ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
          ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS sanction_reason TEXT;
          ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS sanction_until TIMESTAMPTZ;
          ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
          ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS status_changed_by TEXT;
        END IF;
      END $$
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS portal_customers_account_status_idx
        ON portal_customers (account_status)
    `);
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'portal_customers' AND column_name = 'customer_type'
        ) THEN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'portal_customers_customer_type_check'
          ) THEN
            ALTER TABLE portal_customers
              ADD CONSTRAINT portal_customers_customer_type_check
              CHECK (customer_type IS NULL OR customer_type IN ('individual', 'company'));
          END IF;
        END IF;
      END $$;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS portal_customers_customer_type_idx
        ON portal_customers (customer_type)
    `);

    // A pending company request never grants access by itself. Admin approval
    // must map it to a canonical companies row and create membership.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_company_requests (
        id SERIAL PRIMARY KEY,
        portal_customer_id INTEGER NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
        requested_company_name TEXT NOT NULL,
        requested_registration_number TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        matched_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        review_note TEXT,
        reviewed_by INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT portal_company_requests_status_check
          CHECK (status IN ('pending', 'approved', 'rejected'))
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS pcr_customer_idx
        ON portal_company_requests (portal_customer_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS pcr_status_idx
        ON portal_company_requests (status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS pcr_company_idx
        ON portal_company_requests (matched_company_id)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS pcr_customer_pending_name_unique
        ON portal_company_requests (portal_customer_id, lower(requested_company_name))
        WHERE status = 'pending'
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_session_revocations (
        token_hash  TEXT PRIMARY KEY,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS portal_session_revocations_expiry_idx
        ON portal_session_revocations (expires_at)
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

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_email_otp_codes (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS portal_email_otp_email_idx
        ON portal_email_otp_codes (email)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS portal_email_otp_created_idx
        ON portal_email_otp_codes (created_at)
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

    // Durable provider identities. portal_customers remains the canonical
    // account; this table prevents duplicate profiles across login methods.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_auth_identities (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS portal_auth_identity_provider_subject_unique
        ON portal_auth_identities (provider, subject)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS portal_auth_identity_customer_provider_unique
        ON portal_auth_identities (customer_id, provider)
    `);
    // Backfill only deterministic legacy Google identities. Conflicts are
    // intentionally ignored so a malformed legacy duplicate cannot merge users.
    await db.execute(sql`
      INSERT INTO portal_auth_identities (customer_id, provider, subject)
      SELECT pc.id, 'google', pc.oauth_id
      FROM portal_customers pc
      WHERE pc.oauth_provider = 'google'
        AND pc.oauth_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

    logger.info("Portal migration: selesai (role + account status + portal_content + admin email promotion + quote_requests + media_assets + wa_otp_codes + trusted_devices + avatar_url + auth identities)");
  } catch (err) {
    logger.error({ err }, "Portal migration gagal");
  }
}

/**
 * Additive repair for provider identity linking. This must remain a separate
 * startup stage because existing databases may already have completed the
 * legacy portal migration marker.
 */
export async function runPortalAuthIdentityMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portal_auth_identities (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS portal_auth_identity_provider_subject_unique
      ON portal_auth_identities (provider, subject)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS portal_auth_identity_customer_provider_unique
      ON portal_auth_identities (customer_id, provider)
  `);
  await db.execute(sql`
    INSERT INTO portal_auth_identities (customer_id, provider, subject)
    SELECT pc.id, 'google', pc.oauth_id
    FROM portal_customers pc
    WHERE pc.oauth_provider = 'google'
      AND pc.oauth_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
}

/**
 * Additive repair for the separate email OTP challenge store. Keeping this
 * independent prevents the legacy reset-token migration marker from hiding it.
 */
export async function runPortalEmailOtpMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portal_email_otp_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS portal_email_otp_email_idx
      ON portal_email_otp_codes (email)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS portal_email_otp_created_idx
      ON portal_email_otp_codes (created_at)
  `);
}

/**
 * Additive repair for the canonical customer-organization contract.
 *
 * Keep this separate from runPortalMigration: older environments may already
 * have the portal stage marker while missing this newer table.
 */
export async function runPortalCustomerOrganizationMigration(): Promise<void> {
  // The legacy portal marker may already be complete on databases created
  // before customer organization support was introduced. Keep the canonical
  // customer type contract in this independent stage as well, so organization
  // reads/writes do not depend on replaying that older marker.
  await db.execute(sql`
    ALTER TABLE IF EXISTS portal_customers
      ADD COLUMN IF NOT EXISTS customer_type TEXT
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'portal_customers'
          AND column_name = 'customer_type'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'portal_customers_customer_type_check'
      ) THEN
        ALTER TABLE portal_customers
          ADD CONSTRAINT portal_customers_customer_type_check
          CHECK (customer_type IS NULL OR customer_type IN ('individual', 'company'));
      END IF;
    END $$;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS portal_customers_customer_type_idx
      ON portal_customers (customer_type)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portal_company_requests (
      id SERIAL PRIMARY KEY,
      portal_customer_id INTEGER NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
      requested_company_name TEXT NOT NULL,
      requested_registration_number TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      matched_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      review_note TEXT,
      reviewed_by INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT portal_company_requests_status_check
        CHECK (status IN ('pending', 'approved', 'rejected'))
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pcr_customer_idx
      ON portal_company_requests (portal_customer_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pcr_status_idx
      ON portal_company_requests (status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pcr_company_idx
      ON portal_company_requests (matched_company_id)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pcr_customer_pending_name_unique
      ON portal_company_requests (portal_customer_id, lower(requested_company_name))
      WHERE status = 'pending'
  `);
  logger.info("Portal customer organization migration: selesai");
}

/**
 * Additive repair for databases whose portal/customer-organization markers
 * predate the customer_type contract. This has its own startup marker so a
 * completed legacy stage cannot skip the repair.
 */
export async function runPortalCustomerOrganizationContractMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE IF EXISTS portal_customers
      ADD COLUMN IF NOT EXISTS customer_type TEXT
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'portal_customers'
          AND column_name = 'customer_type'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'portal_customers_customer_type_check'
      ) THEN
        ALTER TABLE portal_customers
          ADD CONSTRAINT portal_customers_customer_type_check
          CHECK (customer_type IS NULL OR customer_type IN ('individual', 'company'));
      END IF;
    END $$;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS portal_customers_customer_type_idx
      ON portal_customers (customer_type)
  `);
  logger.info("Portal customer organization contract migration: selesai");
}

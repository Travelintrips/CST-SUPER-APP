-- App Config Table — Penyimpanan konfigurasi & secrets di Supabase
-- Scope: CREATE TABLE + seed semua key names.
-- Nilai diisi oleh admin melalui Supabase UI atau API.

CREATE TABLE IF NOT EXISTS "app_config" (
  "key"          TEXT PRIMARY KEY,
  "value"        TEXT,
  "is_secret"    BOOLEAN NOT NULL DEFAULT false,
  "description"  TEXT,
  "environment"  TEXT NOT NULL DEFAULT 'all',
  "updated_at"   TIMESTAMP NOT NULL DEFAULT now(),
  "updated_by"   TEXT
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "app_config_env_idx" ON "app_config" ("environment");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_config_is_secret_idx" ON "app_config" ("is_secret");
--> statement-breakpoint

-- ── Seed: semua key names (nilai NULL — diisi admin) ─────────────────────────
INSERT INTO "app_config" ("key", "is_secret", "description", "environment") VALUES
  -- Secrets (sensitif)
  ('FONNTE_TOKEN',                  true,  'Token API Fonnte untuk WhatsApp',                         'all'),
  ('GOOGLE_SERVICE_ACCOUNT_JSON',   true,  'JSON service account Google (Sheets, Storage, dll)',       'all'),
  ('OPENAI_API_KEY',                true,  'API Key OpenAI',                                           'all'),
  ('PAYLABS_PRIVATE_KEY',           true,  'Private key Paylabs untuk signing request pembayaran',     'all'),
  ('SESSION_SECRET',                true,  'Secret untuk signing session cookie',                      'all'),
  ('WATI_API_TOKEN',                true,  'Token API WATI untuk WhatsApp Business',                   'all'),

  -- Auth & Admin
  ('ADMIN_EMAIL',                   false, 'Email admin utama',                                        'all'),
  ('ADMIN_EMAILS',                  false, 'Daftar email admin (comma-separated)',                     'all'),
  ('ADMIN_EMAIL_DOMAINS',           false, 'Domain email yang diizinkan mendaftar sebagai admin',      'all'),
  ('ADMIN_WA_PHONES',               false, 'Nomor WA admin untuk notifikasi (comma-separated)',        'all'),
  ('PORTAL_ADMIN_EMAILS',           false, 'Email admin portal pelanggan',                             'all'),
  ('PORTAL_ADMIN_KEY',              true,  'Secret key untuk operasi admin portal',                    'all'),
  ('PORTAL_JWT_SECRET',             true,  'JWT secret untuk token portal pelanggan',                  'all'),
  ('CASHIER_TOKEN_SECRET',          true,  'Secret untuk token kasir',                                 'all'),
  ('DRIVER_JWT_SECRET',             true,  'JWT secret untuk token driver',                            'all'),

  -- Google / OAuth
  ('GOOGLE_CLIENT_ID',              false, 'OAuth2 Client ID Google',                                  'all'),
  ('GOOGLE_CLIENT_SECRET',          true,  'OAuth2 Client Secret Google',                              'all'),
  ('GOOGLE_REDIRECT_BASE_URL',      false, 'Base URL redirect setelah OAuth Google',                   'all'),
  ('GOOGLE_SHEET_ID_BANK_MUTATIONS',false, 'ID Google Sheet untuk mutasi bank',                        'all'),

  -- Paylabs
  ('PAYLABS_MERCHANT_ID',           false, 'Merchant ID Paylabs (production)',                         'production'),
  ('PAYLABS_MERCHANT_ID_SANDBOX',   false, 'Merchant ID Paylabs (sandbox)',                            'development'),
  ('PAYLABS_PUBLIC_KEY',            false, 'Public key Paylabs (production)',                          'production'),
  ('PAYLABS_PUBLIC_KEY_SANDBOX',    false, 'Public key Paylabs (sandbox)',                             'development'),

  -- WATI / Fonnte WhatsApp
  ('WATI_BASE_URL',                 false, 'Base URL WATI API',                                        'all'),
  ('FONNTE_ADMIN_WA',               false, 'Nomor WA admin Fonnte untuk broadcast',                    'all'),

  -- SMTP / Email
  ('SMTP_FROM',                     false, 'Alamat email pengirim (from address)',                      'all'),
  ('SMTP_PASS',                     true,  'Password SMTP untuk email',                                'all'),

  -- VAPID (Web Push)
  ('VAPID_EMAIL',                   false, 'Email kontak VAPID untuk web push',                        'all'),
  ('VAPID_PRIVATE_KEY',             true,  'Private key VAPID',                                        'all'),
  ('VAPID_PUBLIC_KEY',              false, 'Public key VAPID',                                         'all'),

  -- AI Integrations
  ('AI_INTEGRATIONS_OPENAI_API_KEY',true,  'API Key OpenAI khusus modul AI integrations',              'all'),
  ('AI_INTEGRATIONS_OPENAI_BASE_URL',false,'Base URL OpenAI untuk AI integrations (bisa custom proxy)','all'),

  -- Object Storage
  ('DEFAULT_OBJECT_STORAGE_BUCKET_ID', false, 'ID bucket object storage default',                      'all'),
  ('PRIVATE_OBJECT_DIR',            false, 'Direktori/prefix untuk objek privat di storage',           'all'),
  ('PUBLIC_OBJECT_SEARCH_PATHS',    false, 'Path pencarian objek publik di storage',                   'all'),

  -- Supabase (production)
  ('SUPABASE_URL',                  false, 'URL project Supabase (production)',                        'production'),
  ('SUPABASE_ANON_KEY',             true,  'Anon/public key Supabase (production)',                    'production'),
  ('SUPABASE_SERVICE_ROLE_KEY',     true,  'Service role key Supabase (production)',                   'production'),
  ('SUPABASE_DATABASE_URL',         true,  'Connection string database Supabase (production)',          'production'),
  ('SUPABASE_STORAGE_BUCKET',       false, 'Nama bucket storage Supabase (production)',                'production'),
  ('SUPABASE_MIGRATION_URL',        true,  'Connection string Supabase untuk menjalankan migrasi',     'all'),
  ('VITE_SUPABASE_URL',             false, 'URL Supabase untuk frontend/Vite (production)',            'production'),
  ('VITE_SUPABASE_ANON_KEY',        true,  'Anon key Supabase untuk frontend/Vite (production)',       'production'),

  -- Supabase (development / sandbox)
  ('SUPABASE_URL_DEV',              false, 'URL project Supabase (development)',                       'development'),
  ('SUPABASE_ANON_KEY_DEV',         true,  'Anon/public key Supabase (development)',                   'development'),
  ('SUPABASE_SERVICE_ROLE_KEY_DEV', true,  'Service role key Supabase (development)',                  'development'),
  ('SUPABASE_DATABASE_URL_DEV',     true,  'Connection string database Supabase (development)',         'development'),
  ('SUPABASE_STORAGE_BUCKET_DEV',   false, 'Nama bucket storage Supabase (development)',               'development'),
  ('VITE_SUPABASE_URL_DEV',         false, 'URL Supabase untuk frontend/Vite (development)',           'development'),
  ('VITE_SUPABASE_ANON_KEY_DEV',    true,  'Anon key Supabase untuk frontend/Vite (development)',      'development')

ON CONFLICT ("key") DO NOTHING;

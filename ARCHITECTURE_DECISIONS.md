# ARCHITECTURE DECISIONS

> Architecture Decision Records (ADR) — CST Super App
>
> Setiap keputusan arsitektur di sini adalah **FINAL dan ACCEPTED**.
> Tidak boleh di-reverse tanpa proses ADR baru dengan approval eksplisit.

---

## ADR-0001 — Development dan Production Dipisahkan Secara Permanen

**Status:** ACCEPTED
**Tanggal:** 2026-08-03
**Deciders:** Engineering Lead

### Konteks

Sistem ini menangani transaksi keuangan riil (accounting, bank reconciliation,
payroll, logistics billing). Kesalahan antara environment bisa mengakibatkan:
- Data keuangan production terkontaminasi
- Secret production bocor ke developer
- Transaksi riil dibuat dari kode development

### Keputusan

Development dan Production environment dipisahkan secara **permanen dan absolut**:

```
┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│       DEVELOPMENT               │    │        PRODUCTION               │
│                                 │    │                                 │
│  APP_ENV = development          │    │  APP_ENV = production           │
│  Startup: dev.mjs               │    │  Startup: production.mjs        │
│  DB: SUPABASE_DATABASE_URL_DEV  │    │  DB: SUPABASE_DATABASE_URL      │
│  Secrets: GCP (_DEV keys)       │    │  Secrets: GCP (prod keys)       │
│  Replit Secrets: bootstrap only │    │  Replit Secrets: bootstrap only │
└─────────────────────────────────┘    └─────────────────────────────────┘
              ↑                                       ↑
              │          TIDAK ADA JALUR              │
              └──────── YANG MENGHUBUNGKAN ───────────┘
```

### Konsekuensi

**Positif:**
- Tidak mungkin mutasi data production dari dev context
- Secret production tidak pernah ada di dev environment
- Startup failure di dev tidak mempengaruhi production
- Developer bebas eksperimen tanpa risiko

**Negatif (yang diterima):**
- Dua startup script yang harus di-maintain secara terpisah
- Dua set config yang harus di-sync secara manual
- Sedikit code duplication yang diizinkan demi isolation

### Aturan Implementasi

1. `dev.mjs` — HANYA untuk development, JANGAN hapus, JANGAN gabung
2. `production.mjs` — HANYA untuk production, JANGAN hapus, JANGAN gabung
3. `load-secrets.mjs` — baca `APP_ENV`, routing ke key yang sesuai
4. `envGuard` di `src/index.ts` — hard-block jika prod DB dipakai di dev

### Pelanggaran yang Pernah Terjadi

AI agent sebelumnya telah mencoba:
- Menghapus `APP_ENV` dan mengganti dengan `NODE_ENV` saja
- Membuat satu startup yang menerima `--env` flag
- Menyederhanakan `load-secrets.mjs` dengan menghapus `_DEV` branching
- Menyarankan `SUPABASE_DATABASE_URL` sebagai satu-satunya env var

**Semua ini adalah pelanggaran ADR ini.**

---

## ADR-0002 — Accounting Bersifat Immutable (Append-Only)

**Status:** ACCEPTED
**Tanggal:** 2026-08-03
**Deciders:** Finance Lead, Engineering Lead

### Konteks

Sistem accounting mengikuti prinsip double-entry bookkeeping. Journal entry yang
sudah diposting adalah bukti keuangan resmi yang tidak boleh diubah — sama seperti
dokumen yang sudah ditandatangani.

### Keputusan

`accounting_entries` dan `accounting_entry_lines` adalah **append-only**:

```
Status lifecycle yang diizinkan:
  draft → pending_approval → posted
  posted → [reversal entry dibuat sebagai entry BARU]
  posted → VOID [dengan audit trail, entry lama TIDAK dihapus]
```

### Yang DIIZINKAN

- Membuat entry baru
- Reversal: buat entry baru dengan amount negatif, link ke original
- Void: set `is_voided = true`, buat reversal entry, **entry asli tetap ada**

### Yang DILARANG

```sql
-- ❌ DILARANG
UPDATE accounting_entries SET amount = 999 WHERE id = 1;
DELETE FROM accounting_entries WHERE id = 1;
UPDATE accounting_entry_lines SET debit = 500 WHERE id = 1;
```

### Implementasi Penjaga

- Database trigger `trg_block_lines_mutation` — blokir UPDATE/DELETE pada lines yang sudah `posted`
- Application-level: `_postEntryCore` tidak pernah UPDATE entry existing
- Unique constraint `accounting_entries_source_uniq(source, source_id)` — cegah duplicate

### Konsekuensi

**Positif:**
- Audit trail lengkap dan tidak bisa dimanipulasi
- Regulasi compliance (PSAK, perpajakan)
- Forensic accounting bisa trace setiap perubahan

**Negatif (yang diterima):**
- Butuh reversal workflow (lebih kompleks dari DELETE)
- Storage lebih besar karena history tidak pernah dihapus

---

## ADR-0003 — Universal Journal Reuse (No Duplicate Journal)

**Status:** ACCEPTED
**Tanggal:** 2026-08-03
**Deciders:** Engineering Lead

### Konteks

Bank reconciliation approval bisa terjadi untuk transaksi yang sudah memiliki
journal (contoh: sport center payment yang sudah diposting otomatis). Membuat
journal baru dalam kasus ini menyebabkan double-counting cash movement.

### Keputusan

Sebelum membuat journal baru, sistem WAJIB mengecek apakah journal sudah ada:

```typescript
// Pseudo-code: wajib diimplementasikan di semua posting paths
async function safePostJournal(source: string, sourceId: number) {
  // Step 1: Always check existing first
  const existing = await db.query(
    `SELECT id FROM accounting_entries WHERE source = $1 AND source_id = $2 LIMIT 1`,
    [source, sourceId]
  );

  if (existing.rows[0]) {
    // REUSE — link ke journal existing, JANGAN buat baru
    return { entryId: existing.rows[0].id, reused: true };
  }

  // Step 2: Only create if truly new
  return createNewJournal(source, sourceId, ...);
}
```

### Lookup Order untuk Bank Reconciliation

1. Jika kandidat adalah `sport_payment`:
   - Cari via `accounting_payments WHERE source_type='sport_center' AND source_doc_id = sport_payment_id`
   - Atau via `accounting_entries WHERE source='sport_center_booking' AND source_id = booking_id`
2. Jika kandidat adalah `accounting_payment`:
   - Cari via `accounting_payments WHERE id = accounting_payment_id`
3. Jika tidak ditemukan: buat journal baru dengan `source='bank_reconciliation'`

### Known Bug (per 2026-08-03)

Implementasi di `unifiedMatchingEngine.ts` L774–783 menggunakan JOIN yang salah:
```sql
-- ❌ SALAH — kolom accounting_payment_id tidak ada di sport_payments
JOIN accounting_payments ap ON ap.id = sp.accounting_payment_id
```
Lihat `SPORT_CENTER_DOUBLE_JOURNAL_ROOT_CAUSE.md` untuk detail lengkap.

### Konsekuensi

**Positif:**
- Tidak ada double journal untuk satu transaksi
- Bank reconciliation tidak mengacaukan ledger

**Negatif (yang diterima):**
- Lookup tambahan sebelum setiap posting
- Lebih kompleks dari "selalu buat baru"

---

## ADR-0004 — AI Governance: Human Approval Required

**Status:** ACCEPTED
**Tanggal:** 2026-08-03
**Deciders:** Finance Lead

### Konteks

AI digunakan untuk mempercepat klasifikasi transaksi, prediksi COA, dan deteksi
anomali. Namun AI salah dalam edge case — dan kesalahan dalam posting keuangan
berdampak langsung ke neraca perusahaan.

### Keputusan

AI beroperasi **hanya sebagai advisor**, bukan decision maker:

```
AI Role:          RECOMMEND → DETECT → SUGGEST → PREDICT
Human Role:       REVIEW   → APPROVE → POST
```

### Matrix Approval

| Aksi | AI boleh? | Human required? |
|---|---|---|
| Suggest COA mapping | ✅ | Harus di-review |
| Auto-approve journal | ❌ | Wajib human |
| Auto-post journal | ❌ | Wajib human |
| Create COA baru | ❌ | Maker + Checker |
| Flag anomali | ✅ | Human investigasi |
| Void journal | ❌ | Wajib human |
| Change COA assignment | ❌ | Maker + Checker |

### Status: MANUAL_REVIEW_REQUIRED

Jika AI tidak yakin (confidence < threshold), status WAJIB:
```
MANUAL_REVIEW_REQUIRED
```
Bukan:
- AUTO_APPROVED
- PENDING_POSTING
- POSTED

### Konsekuensi

**Positif:**
- Tidak ada financial error yang disebabkan AI tanpa manusia tahu
- Audit trail selalu mencantumkan siapa yang approve
- Compliance dengan segregation of duties

**Negatif (yang diterima):**
- Workflow lebih lambat (butuh human intervention)
- Tidak bisa full auto-reconcile tanpa review queue

---

---

## ADR-0005 — Single-Credential GCP Bootstrap Architecture

**Status:** ACCEPTED
**Tanggal:** 2026-08-07
**Deciders:** Engineering Lead

### Konteks

Setiap kali repository di-import dari GitHub ke Replit baru, developer harus
memasukkan puluhan secret secara manual. Ini lambat, rawan kesalahan, dan menciptakan
risiko bahwa developer salah memasukkan secret production ke Replit development.

### Keputusan

GCP Secret Manager bootstrap architecture diupgrade dari **tiga Replit Secrets** ke
**satu Replit Secret**:

```
BEFORE (legacy):
  GCP_PROJECT_ID + GCP_SECRET_ID + GCP_SECRET_MANAGER_BOOTSTRAP_JSON
  Single GCP bundle with mixed *_DEV / prod keys
  Client-side key selection based on APP_ENV

AFTER (new mode):
  GCP_SECRET_MANAGER_BOOTSTRAP_JSON only
  project_id extracted from bootstrap JSON (no GCP_PROJECT_ID needed)
  Separate GCP bundles per environment:
    cst-super-app-development  →  APP_ENV=development
    cst-super-app-production   →  APP_ENV=production
  Bundle APP_ENV field cross-verified at startup (fail-closed on mismatch)
```

### Aturan Implementasi

1. `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` is the **only** allowed Replit Secret for bootstrap
2. `project_id` is extracted from the bootstrap SA JSON — `GCP_PROJECT_ID` is deprecated
3. Bundle name is derived as `{prefix}-{APP_ENV}` (default prefix: `cst-super-app`)
4. Each bundle MUST contain an `APP_ENV` field — loader cross-verifies it
5. `APP_ENV` in process.env is NEVER overwritten by the bundle payload
6. `APP_ENV` must be exactly `development` or `production` — startup fails otherwise
7. `NODE_ENV` must NOT be used as fallback for APP_ENV in secret bundle selection
8. Backward compat: if `GCP_PROJECT_ID` + `GCP_SECRET_ID` present → legacy mode (deprecated, logs warning)

### Fail-Closed Conditions (startup aborted)

- APP_ENV missing or invalid
- Bootstrap JSON missing, invalid, or missing required SA fields
- GCP access denied
- Bundle not found
- Bundle payload.APP_ENV mismatches runtime APP_ENV
- Required secrets (SESSION_SECRET, SUPABASE_DATABASE_URL) missing after load

### Konsekuensi

**Positif:**
- Fresh GitHub import: one secret to add (was 3+)
- Cross-environment contamination is impossible (separate bundles + APP_ENV verification)
- Secret rotation via GCP Console only — no code or Replit changes
- `--validate` mode for dry-run verification without starting app

**Negatif (yang diterima):**
- One-time GCP setup: create two new secret bundles
- Existing environments must migrate from single-bundle to two-bundle structure
- Legacy mode continues to work during migration (backward compat)

### Pelanggaran yang TIDAK Boleh Terjadi

- ❌ Adding `GCP_PROJECT_ID` or `GCP_SECRET_ID` back as required Replit Secrets
- ❌ Merging dev and prod bundles back into one
- ❌ Removing APP_ENV cross-verification from the loader
- ❌ Using NODE_ENV to select the GCP bundle
- ❌ Defaulting to production bundle when APP_ENV is missing

---

## ADR Log

| ADR | Judul | Status | Tanggal |
|---|---|---|---|
| ADR-0001 | Dev/Prod Separation | ACCEPTED | 2026-08-03 |
| ADR-0002 | Accounting Immutability | ACCEPTED | 2026-08-03 |
| ADR-0003 | Universal Journal Reuse | ACCEPTED | 2026-08-03 |
| ADR-0004 | AI Governance: Human Approval | ACCEPTED | 2026-08-03 |
| ADR-0005 | Single-Credential GCP Bootstrap | ACCEPTED | 2026-08-07 |

---

*Untuk mengajukan ADR baru: buat PR dengan format di atas, status awal PROPOSED.*
*ADR yang sudah ACCEPTED tidak boleh diubah — buat ADR baru yang supersede.*

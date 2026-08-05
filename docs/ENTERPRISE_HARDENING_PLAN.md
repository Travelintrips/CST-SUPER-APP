# Enterprise Hardening & Scalability Plan — BizPortal ERP

**Tanggal:** 27 Mei 2026 | **Status:** Audit + Implementation Plan
**Scope:** Stability, Security, Scalability, Maintainability

---

## 1. OBSERVABILITY & MONITORING

### Current State (Audit Findings)

**Yang sudah ada:**
- `pino` + `pino-http` untuk structured request logging dengan JSON output di production
- `X-Response-Time` header via custom `recordResponseTime` middleware
- Global Express error handler di `app.ts` — catch semua unhandled error, log stack trace
- `notification_logs` table — track semua WA sent/failed/deduped
- `storage_audit_log` table — track upload, presigned URL issued, actor, IP
- `activity_logs` table — technical audit trail per order
- `/healthz` health check endpoint
- WA notification history page di BizPortal (`wa-notification-history.tsx`)
- SSE disconnect: heartbeat 30s + try-catch write yang auto-remove dead connection
- Driver app: SSE reconnect otomatis setelah 6 detik

**Yang belum ada / gap:**
- **Tidak ada correlation ID** yang konsisten di semua request — hanya beberapa route payment yang generate `requestId` manual via `crypto.randomUUID()`
- **Tidak ada APM eksternal** — tidak ada Sentry, Datadog, atau NewRelic
- **Tidak ada SSE connection count monitoring** — tidak tahu berapa banyak koneksi aktif saat ini
- **Tidak ada alert otomatis** jika error rate spike
- **Tidak ada anomaly detection** untuk order lifecycle (order stuck di satu status terlalu lama)
- **Log WA failure** sudah ada di DB, tapi tidak ada alert ke admin jika terjadi failure berulang

### Rekomendasi Log Structure

Standarkan semua log menggunakan format berikut:

```json
{
  "level": "info|warn|error",
  "time": "ISO8601",
  "reqId": "uuid-v4",
  "correlationId": "uuid-v4 (sama untuk semua log dalam satu flow)",
  "service": "api-server",
  "module": "vendorMiniForm|logisticOrders|fonnte|...",
  "userId": "user-id atau null",
  "companyId": "company-id",
  "orderId": "order-id jika relevan",
  "action": "create_order|send_wa|upload_file|...",
  "durationMs": 123,
  "msg": "Human readable message"
}
```

### Rekomendasi Implementation

**Priority 1 — Correlation ID Middleware (LOW effort, HIGH value):**
```typescript
// artifacts/api-server/src/middlewares/correlationId.ts
import { randomUUID } from "crypto";
app.use((req, res, next) => {
  const id = req.headers["x-correlation-id"] as string || randomUUID();
  req.correlationId = id;
  res.setHeader("X-Correlation-ID", id);
  next();
});
```
Inject `correlationId` ke semua pino child loggers.

**Priority 2 — SSE Connection Metrics:**
Tambahkan endpoint `GET /api/internal/metrics` (protected admin) yang return:
```json
{
  "sse": { "admin": 12, "portal": 45, "driver": 8 },
  "uptime": 86400,
  "memory": { "rss": "156MB", "heap": "89MB" }
}
```

**Priority 3 — Order Anomaly Alert:**
Cron job (jalankan setiap jam via `setInterval`) yang detect:
- Order di status `New Order` lebih dari 24 jam → kirim WA ke admin
- VMF link tidak ada submission setelah 48 jam → alert
- Customer approval pending lebih dari 72 jam → alert

**Priority 4 — External APM (Opsional, Phase 2):**
Integrasikan Sentry (`@sentry/node`) untuk error tracking dengan minimal config:
```typescript
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
```

### Alert Strategy

| Alert | Trigger | Channel |
|-------|---------|---------|
| WA send failure > 3x berturut | DB `notification_logs` check | WA ke admin group |
| API error rate > 5% dalam 5 menit | pino log count | WA ke admin group |
| SSE connections = 0 saat jam kerja | `/metrics` endpoint | — |
| Order stuck > 24 jam | Cron check | WA ke admin group |
| Storage upload error berulang | `storage_audit_log` | Log saja |

---

## 2. QUEUE / BACKGROUND JOB SYSTEM

### Current State (Audit Findings)

**Fire-and-forget (in-process, tidak durable):**
- WA sending via `sendWhatsApp()` → dipanggil tanpa `await` + `.catch()` di logisticOrders.ts
- Push notification → fire-and-forget
- Sebagian `logActivity` dan `logOrderUpdate`

**Blocking (synchronous, dalam request handler):**
- **OCR/POD Scan** — `await openai.chat.completions.create(...)` di `podOcr.ts`: 5–15 detik, memblokir worker
- **SO Creation** — `await createSalesOrderFromVmfApproval()` di approval handler
- **Timeline logging** — `await logOrderUpdate()` di banyak titik di `vendorMiniForm.ts` (lines 1163, 1182, 1421, 1982, 2065)
- **Attachment upload** — `await` upload ke object storage sebelum response

**Tidak ada job queue** — tidak ada BullMQ, Redis-backed queue, atau worker process.
**Risk utama**: Server restart = semua in-flight fire-and-forget tasks hilang tanpa trace.

### Audit Matrix: Sync vs Queue

| Operation | Status Sekarang | Harus Antrian? | Alasan |
|-----------|-----------------|----------------|--------|
| WA notification send | Fire-and-forget in-process | **YA** | Tidak durable, tidak bisa retry |
| Push notification send | Fire-and-forget in-process | **YA** | Sama seperti WA |
| OCR / POD scan (OpenAI) | Blocking sync (5–15 detik) | **YA — URGENT** | Blokir worker, user timeout |
| SO creation dari approval | Blocking sync | Opsional | Latency kecil, user butuh konfirmasi |
| Timeline logging (`logOrderUpdate`) | Blocking sync (repeated) | **YA** | N sequential DB roundtrips tidak perlu |
| Activity logging (`logActivity`) | Mixed | YA (batch) | Low priority DB write |
| Attachment upload ke storage | Blocking sync | **Gunakan presigned URL** | Offload ke client langsung |
| Bulk import | Tidak ada fitur | YA saat dibuat | Berpotensi besar |
| Heavy recalculation (harga, margin) | Sync inline | Opsional | Jarang dipanggil |

### Rekomendasi: Lightweight In-Process Queue

Karena tidak ada Redis di environment saat ini, gunakan **in-process queue dengan BullMQ + SQLite** atau lebih simpel: **p-queue** untuk concurrency control + persistent retry table di PostgreSQL.

**Pendekatan realistis tanpa infrastruktur baru:**

```typescript
// artifacts/api-server/src/lib/jobQueue.ts
// DB-backed simple job queue menggunakan tabel jobs
// Schema:
// jobs(id, type, payload JSONB, status, attempts, max_attempts, next_run_at, error, created_at)

async function enqueue(type: string, payload: object, opts?: { maxAttempts?: number }) {
  await db.insert(jobsTable).values({ type, payload, status: "pending", maxAttempts: opts?.maxAttempts ?? 3 });
}

// Worker loop: poll setiap 5 detik
setInterval(async () => {
  const jobs = await db.select().from(jobsTable).where(eq(jobsTable.status, "pending")).limit(10);
  for (const job of jobs) {
    await processJob(job); // dispatch ke handler berdasarkan job.type
  }
}, 5000);
```

**Dead Letter Strategy:**
- Job yang gagal > `max_attempts`: update status ke `"dead_letter"`, log error
- Admin dapat melihat dead letter jobs di BizPortal → Settings → Job Queue
- Manual retry tersedia via admin action

**Implementasi Bertahap:**
1. Phase 1: Queue OCR saja (paling critical) — return `{ jobId }` segera, poll `/api/pod-ocr/status/:jobId`
2. Phase 2: Queue WA notifications (durability)
3. Phase 3: Queue semua logging (batch write setiap 10 detik)

---

## 3. PERFORMANCE & SCALABILITY

### N+1 Query Audit

| File | Issue | Severity | Fix |
|------|-------|----------|-----|
| `logisticOrders.ts` GET `/` | Loop raw SQL untuk fetch RFQ info per order | 🔴 HIGH | `LEFT JOIN` atau subquery dalam satu query |
| `logisticOrders.ts` GET `/track/:orderNumber` | 5 sequential `await`: order → items → driver job → driver logs → driver photos | 🟡 MEDIUM | `Promise.all([...])` paralel |
| `trading.ts` GET `/stocks` | Fetch semua stocks + semua suppliers terpisah, in-memory map | 🟡 MEDIUM | `leftJoin(suppliers, ...)` |
| `vendorMiniForm.ts` `buildOrderDataFromRowWithItems` | Dipanggil dalam loop (N queries untuk N orders) | 🔴 HIGH | Batch fetch semua items lalu group by orderId |
| `trading.ts` POST `/suppliers/:id/catalog` | 3 sequential queries (check exist, check dup, fetch category) | 🟢 LOW | Consolidate ke satu transaction |

### Missing Pagination

| Endpoint | Status | Fix |
|----------|--------|-----|
| `GET /trading/stocks` | ❌ Tidak ada limit | Tambah `?page=1&limit=50` |
| `GET /trading/suppliers` | ❌ Tidak ada limit | Tambah `?page=1&limit=50` |
| `GET /logistic/orders` (internal) | ❌ Tidak ada limit | Tambah `LIMIT/OFFSET` |
| `GET /logistic/vendors` | ❌ Tidak ada limit | Tambah `LIMIT/OFFSET` |
| `logistics.tsx` frontend | ⚠️ `limit: 500` hardcoded | Ganti dengan infinite scroll atau paginated load |

### Missing DB Indexes

| Tabel | Kolom | Query Pattern | Index yang Dibutuhkan |
|-------|-------|---------------|----------------------|
| `logistic_orders` | `customer_name`, `company_name` | `ilike '%search%'` | `GIN` index atau `pg_trgm` trigram |
| `logistic_orders` | `status` | `WHERE status = ...` | B-tree (cek apakah sudah ada) |
| `vendor_mini_form_links` | `token` | `WHERE token = ...` | Unique (sudah ada) |
| `notification_logs` | `order_id`, `created_at` | List per order + time sort | Composite `(order_id, created_at DESC)` |
| `activity_logs` | `order_id`, `created_at` | Timeline per order | Composite `(order_id, created_at DESC)` |
| `order_updates` | `order_id`, `created_at` | Timeline display | Composite `(order_id, created_at DESC)` |
| `short_links` | `code` | Lookup by code | Unique (perlu verifikasi) |

**SQL untuk menambah indexes yang missing:**
```sql
-- Trigram search untuk order name/company
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY idx_logistic_orders_customer_name_trgm
  ON logistic_orders USING gin (customer_name gin_trgm_ops);

-- Composite indexes untuk timeline queries
CREATE INDEX CONCURRENTLY idx_activity_logs_order_time
  ON activity_logs (order_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_order_updates_order_time
  ON order_updates (order_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_notification_logs_order_time
  ON notification_logs (order_id, created_at DESC);
```

### SSE Scalability

**Current:** Semua koneksi disimpan di memory `Set` / `Map` di satu proses.

| Skenario | Kapasitas Estimasi | Risk |
|----------|-------------------|------|
| Single server (current) | ~200–500 koneksi | 🟢 OK untuk skala saat ini |
| Multi-server / load balancer | 0 — event tidak cross-node | 🔴 FATAL |
| Server restart | Semua koneksi drop | 🟡 Auto-reconnect in ~2-5s |

**Rekomendasi:** Saat ini single-server — tidak ada masalah. Jika scale-out dibutuhkan nanti, replace `sseManager` dengan Redis Pub/Sub pattern.

### React Re-render Optimization

| Komponen | Issue | Fix |
|----------|-------|-----|
| `logistics-portal-orders.tsx` | 20+ `useState`, filter logic di render cycle | `useMemo` untuk filtered data |
| `logistics-portal-orders.tsx` | `setOnNewOrder` invalidate entire list per event | Debounce atau invalidate specific query key |
| `logistics.tsx` | Filter & sort inline setiap render | `useMemo(() => filtered, [orders, filters])` |
| `logistics.tsx` | Polling 30s/1m/5m yang redundan dengan SSE | Hapus polling jika SSE aktif, polling sebagai fallback saja |

---

## 4. API STANDARDIZATION

### Current Inconsistencies

**Success response — 3 pola berbeda:**
```typescript
// Pola A: Raw object (paling umum)
res.json(rows);

// Pola B: { ok: true, ... }  (logisticRfq.ts, whatsapp.ts)
res.json({ ok: true, data: result });

// Pola C: { success: true, ... } (vendorMiniForm.ts, companies.ts)
res.json({ success: true, id: newId });
```

**Error response — 2 pola berbeda:**
```typescript
// Pola A: { error: "..." }  (vendorMiniForm.ts, auth.ts)
res.status(400).json({ error: "Token invalid" });

// Pola B: { message: "..." }  (logisticOrders.ts, logisticRfq.ts)
res.status(400).json({ message: "Not found" });
```

### Standar yang Direkomendasikan

```typescript
// SUCCESS
interface ApiSuccess<T> {
  data: T;
  meta?: { total?: number; page?: number; limit?: number; };
}

// ERROR
interface ApiError {
  error: {
    code: string;   // "VALIDATION_ERROR", "NOT_FOUND", "UNAUTHORIZED", dll.
    message: string;
    details?: unknown;  // Zod errors, field-level errors
  };
}

// Contoh implementasi helper:
function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ data });
}
function fail(res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, details } });
}
```

### HTTP Status Code Standard

| Situasi | Status Code | Contoh |
|---------|-------------|--------|
| GET sukses | 200 | List orders |
| POST create sukses | 201 | Create order |
| Update/action sukses | 200 | Approve form |
| Tidak ada body | 204 | Delete |
| Validasi gagal | 400 | Zod parse error |
| Token tidak valid / tidak ada session | 401 | |
| Session valid tapi bukan admin | 403 | |
| Resource tidak ditemukan | 404 | |
| Conflict state | 409 | Submit form sudah locked |
| Link expired | 410 | Token kadaluarsa |
| Rate limit | 429 | |
| Internal error | 500 | |

### Duplicate Endpoint Logic

| Duplikasi | File | Rekomendasi |
|-----------|------|-------------|
| `inventoryMain.ts` + `inventoryStock.ts` | Dua implementasi warehouse/rack management | Merge ke satu file, hapus yang lama |
| `toPublicOrder()` PII stripping | Diimplementasi lokal di beberapa route | Pindah ke `lib/orderUtils.ts` shared helper |
| Markup calculation `price * (1 + markup)` | `logisticRfq.ts`, `adminAction.ts`, `customerQuoteFlow.ts` | Extract ke `lib/pricing.ts` |
| Token validation (vendor/customer) | `vendorResponse.ts` + `vendorMiniForm.ts` terpisah | Extract ke `lib/tokenAuth.ts` |
| `deriveServiceType()` | Backend + 2 lokasi di frontend customer-portal | Pindah ke `lib/api-zod` sebagai shared util |

---

## 5. DOMAIN MODEL CLEANUP

### Status Enum Inconsistency

**Masalah utama:** Logistics domain menggunakan `text()` bebas, sementara Trading/Accounting menggunakan `pgEnum` yang ketat. Ini menyebabkan "ghost statuses" yang tidak terdeteksi compiler.

**Order Status — Saat Ini (campur aduk):**
```
"New Order"          // PascalCase dengan spasi
"Under Review"       // PascalCase dengan spasi
"admin_review"       // snake_case (berbeda dari atas)
"rfq_blasted"        // snake_case
"Customer Approved"  // PascalCase
"customer_approved"  // snake_case (duplikat semantik!)
"Done"               // PascalCase
"Completed"          // PascalCase
"Confirmed"          // PascalCase
```

**Proposal Standarisasi — Order Status (snake_case enum):**
```typescript
export const logisticOrderStatusEnum = pgEnum("logistic_order_status", [
  "new",               // ganti dari "New Order"
  "under_review",      // ganti dari "Under Review" / "admin_review"
  "rfq_blasted",       // tetap
  "customer_quoted",   // tetap
  "customer_approved", // tetap
  "vendor_confirmed",  // ganti dari "Confirmed"
  "in_progress",       // tetap
  "completed",         // ganti dari "Done" / "Completed"
  "cancelled",
]);
```

**Approval Status — Standar:**
```typescript
// Gunakan konsisten di logistic, purchase, customer approval
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending", "approved", "rejected", "expired", "revised",
]);
```

**VMF Link Status:**
```typescript
export const vmfLinkStatusEnum = pgEnum("vmf_link_status", [
  "active", "submitted", "selected", "rejected", "expired",
]);
```

**Service Type — Standar:**
```typescript
export const serviceTypeEnum = pgEnum("service_type", [
  "trucking",
  "sea_freight",   // ganti dari "freight_sea"
  "air_freight",   // ganti dari "freight_air"
  "custom_clearance", // ganti dari "ppjk"
  "warehousing",
  "handling",
  "product",
  "other",
]);
```

> ⚠️ **Catatan:** Standarisasi enum di atas membutuhkan migration yang hati-hati. Karena ini adalah perubahan breaking pada kolom text → enum, lakukan dengan strategi:
> 1. Tambah kolom enum baru (nullable)
> 2. Backfill data dari kolom lama
> 3. Switch aplikasi ke kolom baru
> 4. Drop kolom lama
> **Jangan lakukan di satu migration — pisah 4 langkah di atas.**

### Duplikasi Logic Bisnis

| Logic | Lokasi Duplikat | Target |
|-------|----------------|--------|
| `deriveServiceType()` | `orderNotification.ts` + `vendor-job.tsx` + `admin-review.tsx` | Pindah ke `lib/api-zod/src/serviceType.ts` |
| Markup calculation | 3 route files | `lib/api-zod/src/pricing.ts` |
| Token validation flow | `vendorResponse.ts` + `vendorMiniForm.ts` | `artifacts/api-server/src/lib/tokenAuth.ts` |
| Status transition validation | `logisticRfq.ts` + `adminAction.ts` + `customerQuoteFlow.ts` | State machine helper |

---

## 6. FEATURE FLAG SYSTEM

### Rekomendasi: DB-Backed Feature Flags

Buat tabel `feature_flags` sederhana:
```sql
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN DEFAULT true,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);
```

Seed default flags:
```sql
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('sse_price_sync',        true,  'Real-time SSE updates for price and order changes'),
  ('auto_so_creation',      true,  'Automatically create Sales Order when customer approves'),
  ('advanced_wa_rendering', true,  'Conditional blocks in WA templates'),
  ('ocr_module',            true,  'AI-powered document scanning (POD OCR)'),
  ('ai_assistant',          false, 'AI quotation assistant (future)'),
  ('vmf_advanced_mode',     true,  'Advanced vendor mini form with multi-service'),
  ('public_order_creation', true,  'Allow public (unauthenticated) order creation'),
  ('push_notifications',    true,  'Web push notifications via VAPID'),
  ('bulk_import',           false, 'Bulk product/order import (future)');
```

**Cara pakai di backend:**
```typescript
// lib: getFlag(key: string): Promise<boolean>
const sseEnabled = await getFlag("sse_price_sync");
if (!sseEnabled) return res.status(503).json({ message: "SSE disabled" });
```

**Admin UI:** Tambah halaman `Settings → Feature Flags` di BizPortal dengan toggle per flag.
**Cache:** Cache flag values 60 detik di memory untuk menghindari DB hit per request.

---

## 7. BACKUP & DISASTER RECOVERY

### Current State

| Item | Status | Gap |
|------|--------|-----|
| DB backup | ❌ Tidak ada otomatis | Tidak ada pg_dump scheduled |
| Storage backup | ⚠️ Replit Object Storage persistent | Tapi tidak ada cross-region backup |
| Code backup | ✅ Git (origin/main) | Belum ada release tag |
| Config backup | ✅ Replit Secrets | Terdokumentasi di checklist |
| Restore testing | ❌ Belum pernah ditest | Tidak tahu apakah backup bisa restore |

### RPO & RTO Targets

| Metric | Target | Keterangan |
|--------|--------|------------|
| **RPO** (Recovery Point Objective) | 24 jam | Data tidak boleh hilang lebih dari 1 hari |
| **RTO** (Recovery Time Objective) | 2 jam | Sistem harus kembali online dalam 2 jam |

### DR Plan

**Backup DB — Implementasi (harus dilakukan sebelum go-live):**
```bash
#!/bin/bash
# scripts/backup-db.sh — jalankan via cron setiap malam pukul 02:00
TIMESTAMP=$(date +%Y%m%d_%H%M)
BACKUP_FILE="backup_${TIMESTAMP}.sql.gz"

pg_dump "$SUPABASE_PG_URL" \
  --no-owner --no-acl \
  | gzip > "/tmp/${BACKUP_FILE}"

# Upload ke Replit Object Storage
# (atau SFTP/S3 bucket eksternal)
echo "Backup selesai: ${BACKUP_FILE}"
```

**Tabel kritis yang wajib backup:**
```
logistic_orders, logistic_order_items, logistic_order_rfqs,
vendor_mini_form_links, vendor_mini_form_submissions,
customer_approvals, sales_documents, sales_document_items,
suppliers, products, whatsapp_template_configs,
activity_logs, order_updates, notification_logs,
users, companies, sessions
```

**Emergency Recovery Steps:**

```
1. Server down / crash:
   → Restart workflow "API Server" di Replit
   → Cek log untuk error
   → Jika build corrupt: git checkout <last-stable-commit> && node build.mjs

2. DB tidak bisa connect:
   → Cek SUPABASE_PG_URL di Replit Secrets
   → Test: psql "$SUPABASE_PG_URL" -c "SELECT 1"
   → Jika Supabase down: tunggu atau restore ke PG instance lain

3. Data corrupt / accidental delete:
   → Restore dari pg_dump backup terakhir
   → pg_restore --data-only --table=logistic_orders backup.sql
   → Verifikasi data dengan admin

4. Storage file hilang:
   → Cek Replit Object Storage dashboard
   → File Replit Object Storage tidak hilang saat deploy — persistent
   → Jika policy salah: update env PUBLIC_OBJECT_SEARCH_PATHS

5. WA berhenti:
   → Cek FONNTE_TOKEN validity
   → Cek notification_logs untuk error message dari Fonnte API
   → Fallback: kirim WA manual dari BizPortal
```

---

## 8. FUTURE MODULE READINESS

### Kesiapan Arsitektur Saat Ini

| Modul Future | Kesiapan | Gap | Effort |
|-------------|----------|-----|--------|
| **OCR Document Parsing** | 🟢 80% | Sudah ada `podOcr.ts` + OpenAI integration. Gap: perlu async queue | LOW |
| **AI Quotation Assistant** | 🟡 40% | OpenAI tersedia, `chatbot_knowledge_base` table sudah ada. Gap: context management, prompt engineering | MEDIUM |
| **Vendor Auto Matching** | 🟡 30% | Data supplier + service type ada. Gap: scoring engine, ML/rule-based matcher | MEDIUM |
| **Full Accounting Integration** | 🟢 70% | Sudah ada `sales_documents`, journal entry, Chart of Accounts. Gap: AR aging, AP tracking, reporting | MEDIUM |
| **Multi-Company** | 🟢 85% | `company_id` sudah di semua tabel + holding structure. Gap: tenant isolation di beberapa query | LOW |
| **Mobile App** | 🟢 75% | `cst-driver` Expo app sudah ada, SSE driver channel sudah ada. Gap: customer mobile app | MEDIUM |
| **Customer Tracking Realtime** | 🟢 80% | SSE portal channel sudah ada, `order_track` endpoint public. Gap: map integration, driver location push | LOW |
| **Warehouse/TPS Integration** | 🟡 30% | `warehouse.ts` + `inventoryStock.ts` ada tapi belum mature. Gap: TPS-specific schema, API integration | HIGH |
| **Customs Integration** | 🟡 20% | Service type "custom_clearance" ada. Gap: EDI/XML format, Bea Cukai API | HIGH |

---

## A. HARDENING MATRIX

| Area | Status Sekarang | Risk | Rekomendasi | Prioritas |
|------|----------------|------|-------------|-----------|
| Structured logging | ✅ Pino + pino-http | — | Tambah correlation ID | P2 |
| Request ID / Correlation ID | ⚠️ Parsial (hanya payments) | MEDIUM | Global middleware | P2 |
| Error tracking (APM) | ❌ Hanya DB log internal | HIGH | Sentry integration | P3 |
| WA failure tracking | ✅ `notification_logs` table | — | Tambah alert otomatis | P2 |
| SSE disconnect monitoring | ✅ Heartbeat + auto-remove | — | Expose `/metrics` endpoint | P3 |
| Upload/storage monitoring | ✅ `storage_audit_log` | — | — | OK |
| Order lifecycle anomaly | ❌ Tidak ada | HIGH | Cron-based anomaly alert | P2 |
| OCR async queue | ❌ Blocking sync | HIGH | In-process DB queue | P1 |
| WA notification durability | ⚠️ Fire-and-forget | MEDIUM | DB-backed queue | P2 |
| Timeline logging efficiency | ⚠️ Sequential blocking | MEDIUM | Batch async logging | P2 |
| DB connection pool | ✅ pg pool | — | — | OK |
| N+1 queries | 🔴 Beberapa titik | HIGH | JOIN + batch fetch | P1 |
| List pagination | ❌ Beberapa endpoint | HIGH | Add LIMIT/OFFSET | P1 |
| DB indexes (search) | ⚠️ Trigram belum ada | MEDIUM | pg_trgm index | P2 |
| SSE scalability (multi-node) | ⚠️ In-memory only | LOW (single node) | Redis pubsub saat scale-out | P3 |
| React re-render optimization | ⚠️ Beberapa halaman berat | MEDIUM | useMemo + debounce | P2 |
| API response standardization | ❌ 3 pola berbeda | MEDIUM | Pilih satu pola, migrate bertahap | P2 |
| Error format standardization | ❌ `error` vs `message` | MEDIUM | Standarkan ke `{ error: { code, message } }` | P2 |
| Duplicate endpoint logic | 🔴 Beberapa | MEDIUM | Extract ke shared utils | P2 |
| Order status enum | ❌ Text bebas (mixed case) | HIGH | pgEnum migration | P2 |
| Service type enum | ❌ Text bebas | MEDIUM | pgEnum migration | P2 |
| Feature flags | ❌ Tidak ada | MEDIUM | DB-backed flags | P2 |
| DB backup scheduled | ❌ Tidak ada | **CRITICAL** | pg_dump cron harian | P1 |
| Restore testing | ❌ Belum pernah | HIGH | Test restore sebelum go-live | P1 |

---

## B. SCALABILITY RISK

| Bottleneck | Impact | Estimated Threshold | Solusi |
|-----------|--------|---------------------|--------|
| OCR blocking request thread | 1 OCR call = 5–15 detik worker busy | >3 concurrent OCR = timeout cascade | Async queue, return jobId |
| Order list tanpa pagination | Memory + DB scan besar | >10.000 orders = query timeout | LIMIT/OFFSET wajib |
| Supplier/stock list tanpa pagination | Payload besar ke frontend | >5.000 suppliers = browser lag | Pagination + virtual scroll |
| N+1 di order tracking | Latency tinggi per request | >500 RPM = noticeable | JOIN query |
| SSE in-memory pool | OK untuk single node | Tidak skala horizontal | Redis pubsub untuk multi-node |
| WA fire-and-forget | Task hilang saat restart | Setiap deploy = potential lost notifications | DB queue |
| `logistics.tsx` `limit: 500` | 500 records setiap load | >500 shipments = browser hang | Infinite scroll / pagination |
| `ilike` search tanpa index | Full table scan | >100k rows = query > 5 detik | pg_trgm index |
| Frontend chunk 4.6MB BizPortal | First load lambat | 4G mobile: ~15 detik load | Code splitting lazy load |

---

## C. ARCHITECTURE DEBT

| Debt | Lokasi | Severity | Cleanup |
|------|--------|----------|---------|
| `inventoryMain.ts` + `inventoryStock.ts` overlap | `routes/` | 🔴 HIGH | Merge ke satu file |
| `deriveServiceType()` di 3 tempat | backend + 2 frontend | 🔴 HIGH | Shared util di `api-zod` |
| Markup calculation duplikat | 3 route files | 🟡 MEDIUM | `lib/pricing.ts` |
| Token validation duplikat | `vendorResponse.ts` + `vendorMiniForm.ts` | 🟡 MEDIUM | `lib/tokenAuth.ts` |
| Mixed status string casing | Semua logistic routes | 🔴 HIGH | pgEnum migration |
| API response 3 format berbeda | Semua routes | 🟡 MEDIUM | Standardize bertahap |
| Manual `typeof` check di auth.ts | `routes/auth.ts` | 🟢 LOW | Replace dengan Zod |
| Polling + SSE redundan di logistics.tsx | Frontend | 🟢 LOW | Hapus polling jika SSE aktif |

---

## D. FUTURE READINESS SCORE

| Dimensi | Score | Catatan |
|---------|-------|---------|
| **AI Readiness** | 7/10 | OpenAI terintegrasi, OCR sudah jalan, knowledge base table ada. Kurang: async queue, context management |
| **ERP Readiness** | 6/10 | Sales, Purchase, Accounting, Logistics sudah ada. Kurang: mature reporting, AP/AR aging, inventory yang solid |
| **Multi-Company Readiness** | 8/10 | `company_id` konsisten di semua tabel, holding structure ada. Minor gap di beberapa query isolation |
| **Mobile Readiness** | 7/10 | Driver Expo app mature, SSE driver channel ada, push notification ada. Kurang: customer mobile app |
| **Scalability Readiness** | 4/10 | Single-node OK, tapi banyak bottleneck jika traffic naik 10x: pagination, N+1, OCR blocking |
| **Security Readiness** | 7/10 | Auth layers baik, rate limiting ada, audit log ada. Kurang: correlation ID, APM, enum safety |
| **Maintainability** | 5/10 | Banyak code duplication, mixed API response format, status string tidak type-safe |

---

## E. IMPLEMENTATION ROADMAP

### Phase 1 — Stability (Minggu 1–2) 🔴 Critical

**Tujuan:** Sistem stabil, tidak ada data loss, tidak ada blocking error di production.

| Task | Effort | Owner |
|------|--------|-------|
| Tambah `LIMIT/OFFSET` pagination di semua list endpoint tanpa pagination | 1 hari | Dev |
| Fix N+1 di `logisticOrders.ts` GET `/` (JOIN atau Promise.all) | 1 hari | Dev |
| Async queue sederhana untuk OCR (return jobId, poll status) | 2 hari | Dev |
| Setup pg_dump backup harian + test restore | 0.5 hari | Ops |
| Test restore dari backup (wajib sebelum go-live) | 0.5 hari | Ops |
| Tambah pg_trgm index untuk search `ilike` | 0.5 hari | Dev |
| Git tag `v1.0.0` | 5 menit | Dev |

### Phase 2 — Hardening (Minggu 3–5) 🟡 High Priority

**Tujuan:** Sistem lebih observable, code lebih maintainable, tidak ada technical debt kritis.

| Task | Effort | Owner |
|------|--------|-------|
| Global correlation ID middleware | 0.5 hari | Dev |
| SSE `/metrics` endpoint (connection count, memory) | 0.5 hari | Dev |
| Order anomaly alert cron (order stuck > 24 jam) | 1 hari | Dev |
| WA notification DB-backed queue (durability + retry) | 2 hari | Dev |
| Batch async timeline logging | 1 hari | Dev |
| Merge `inventoryMain.ts` + `inventoryStock.ts` | 1 hari | Dev |
| Extract `deriveServiceType` ke shared util | 0.5 hari | Dev |
| Extract markup calculation ke `lib/pricing.ts` | 0.5 hari | Dev |
| Standardisasi API error format (pilih satu, migrate bertahap) | 2 hari | Dev |
| DB-backed feature flags system | 1 hari | Dev |
| `useMemo` untuk filtered data di logistics pages | 1 hari | Dev |
| Composite DB indexes untuk activity_logs, order_updates | 0.5 hari | Dev |

### Phase 3 — Scalability & Future-Proofing (Bulan 2) 🟢 Medium Priority

**Tujuan:** Arsitektur siap untuk pertumbuhan 10x, domain model bersih.

| Task | Effort | Owner |
|------|--------|-------|
| pgEnum migration untuk logistic_order status (strategi 4 langkah) | 3 hari | Dev |
| pgEnum migration untuk service_type | 2 hari | Dev |
| Frontend BizPortal code splitting (lazy load per route) | 2 hari | Dev |
| Sentry APM integration | 1 hari | Dev |
| API response standardization full (wrap semua dalam `{ data }`) | 3 hari | Dev |
| AI Quotation Assistant PoC (jika approved) | 5 hari | Dev |
| Redis pubsub untuk SSE (jika scale-out dibutuhkan) | 3 hari | Dev |

---

## F. FINAL ENTERPRISE READINESS SCORE

| Dimensi | Score Sekarang | Target Phase 2 | Target Phase 3 |
|---------|----------------|----------------|----------------|
| **Stability** | 6/10 | 8/10 | 9/10 |
| **Security** | 7/10 | 8/10 | 9/10 |
| **Scalability** | 4/10 | 6/10 | 8/10 |
| **Maintainability** | 5/10 | 7/10 | 8/10 |
| **Observability** | 5/10 | 8/10 | 9/10 |
| **Enterprise Readiness** | **5.4/10** | **7.4/10** | **8.6/10** |

### Ringkasan Eksekutif

Sistem **sudah production-ready untuk skala saat ini** — semua fitur core berjalan, security dasar ada, monitoring parsial ada. Namun ada **3 risiko kritis** yang harus diselesaikan sebelum traffic naik signifikan:

1. 🔴 **Tidak ada DB backup terjadwal** — data loss permanen jika DB bermasalah
2. 🔴 **OCR blocking request thread** — bisa cascade timeout saat concurrent usage
3. 🔴 **List endpoints tanpa pagination** — query timeout saat data bertambah

Setelah Phase 1 selesai, sistem naik ke **enterprise-grade 7+/10** dan aman untuk pertumbuhan.

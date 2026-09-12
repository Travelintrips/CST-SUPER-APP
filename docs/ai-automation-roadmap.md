# BUSINESS AUTOMATION & AI LAYER — ARCHITECTURE AUDIT & ROADMAP
> Generated: 2026-05-27 | Scope: BizPortal ERP + Customer Portal + Driver App

---

## EXECUTIVE SUMMARY

Sistem ini sudah memiliki **fondasi AI dan automation yang sangat kuat** dibandingkan ERP sejenis. OpenAI GPT-4o sudah terintegrasi via Replit AI proxy, WhatsApp multi-channel notification sudah berjalan, OCR sudah ada untuk 3 kategori dokumen, dan double-entry accounting sudah fully implemented. Gap utama ada di: **structured order classification, queue system untuk background processing, vendor scoring engine, dan analytics layer yang lebih queryable.**

---

## 1. AUDIT: AI QUOTATION ASSISTANT

### Current State
| Komponen | Status | Detail |
|---|---|---|
| AI baca request customer | ✅ **Ada** | `aiOrderIntake.ts` — parsing email & WA inbound dengan GPT-4o-mini |
| AI pahami shipment type | ⚠️ **Parsial** | Ekstrak origin/dest/mode/weight, tapi classification string-based, tidak terstruktur |
| AI pilih service relevan | ⚠️ **Parsial** | `aiAgent.ts` search products via function calling, tapi tanpa scoring/filtering berdasarkan route |
| AI buat draft quotation | ✅ **Ada** | `aiOrderIntake.ts` create draft di `sales_documents` otomatis |
| AI hitung estimasi harga | ⚠️ **Parsial** | `vendor_rates` + `margin_rules` ada, tapi AI tidak otomatis query rate table |
| AI rekomendasikan vendor | ❌ **Belum** | Tidak ada vendor scoring/matching engine — admin masih manual pilih |
| AI buat summary order untuk admin | ✅ **Ada** | WA notification otomatis ke admin group saat order masuk |

### Recommendation

**Data Source yang dibutuhkan:**
- `logistic_orders` → order context
- `vendor_rates` → pricing per route/mode
- `vendor_performance` → historical score
- `vendor_catalog_items` → service catalog
- `margin_rules` → markup calculation
- `suppliers` → vendor profile & supported modes

**AI Workflow yang direkomendasikan:**
```
Customer Request (WA/Email/Portal)
  → [AI Intake] Extract: origin, dest, mode, weight, cargo type, incoterm
  → [Classification] Detect: shipment_type, transport_mode, dangerous_goods
  → [Rate Lookup] Query: vendor_rates WHERE mode+route match
  → [Vendor Filter] Filter: suppliers.supportedModes, isActive, serviceType
  → [Scoring] Score: performance + price + ETA
  → [Draft] Create: logistic_order + draft quotation in sales_documents
  → [Human Review] Admin approval UI dengan pre-filled data
  → [Send] Customer quote via portal/email/WA
```

**Human Approval Flow:**
- AI generates draft → status = `ai_draft`
- Admin review di BizPortal → approve/edit/reject
- Admin approve → trigger `customerQuoteFlow` send ke customer
- Customer approve → auto-create SO

---

## 2. AUDIT: OCR DOCUMENT PARSING

### Current State
| Dokumen | Status | Detail |
|---|---|---|
| Invoice / Purchase | ✅ **Ada** | Group `sales` — ekstrak partyName, lines, totalAmount, docDate |
| Bill of Lading (B/L) | ✅ **Ada** | Group `freight` — ekstrak vessel, voyage, containerNo, portOfLoading |
| Air Waybill (MAWB/HAWB) | ✅ **Ada** | Group `freight` — ekstrak awbNumber, grossWeight, destination |
| Packing List | ⚠️ **Parsial** | Masuk group `sales` sebagai line items, tapi tidak ada field dedicated |
| Customs Doc (PIB/PEB/NPE) | ✅ **Ada** | Group `customs` — ekstrak nomorAju, beaMasuk, nilaiPabean |
| Proof of Delivery | ✅ **Ada** | Dedicated `podOcr.ts` dengan async job + verification status |

### Architecture Recommendation

**Upload Flow (Current — OK):**
```
Client → multer (memory) → Base64/PDF parse → GPT-4o Vision → JSON extraction
```

**Upload Flow (Recommended — add queue):**
```
Client upload → Object Storage (persist file) → Job Queue (Redis/DB-backed)
  → Worker: GPT-4o Vision OCR → Confidence Score
  → If score < threshold → Flag for human review
  → Store in: ocr_jobs table (status, result, confidence, version)
  → Webhook / polling → Frontend display
```

**Gap yang perlu diisi:**
1. **Processing Queue** — `scanDocument.ts` saat ini synchronous (blocking). File besar bisa timeout.
2. **Confidence Score** — `podOcr.ts` punya `verificationStatus` (verified/low_confidence/mismatch), tapi `scanDocument.ts` tidak.
3. **Document Versioning** — tidak ada dedicated table. `media_assets` + `pod_ocr_results` parsial.
4. **Human Validation UI** — tidak ada review screen untuk OCR hasil yang confidence-nya rendah.
5. **Extraction Mapping** — packing list butuh field: `marks_numbers`, `quantity_per_sku`, `net_weight_per_line`.

**Schema yang perlu ditambah:**
```sql
ocr_jobs (id, company_id, document_type, file_url, status, result_json, 
          confidence_score, reviewed_by, reviewed_at, version, created_at)
```

---

## 3. AUDIT: VENDOR AUTO MATCHING

### Current State
| Kriteria | Data Tersedia | Kualitas |
|---|---|---|
| Harga (price) | ✅ `vendor_rates`, `vendor_catalog_items`, `vendor_offers` | Baik — per route/mode |
| ETA / Speed | ⚠️ `suppliers.eta` (text), `logistic_order_quotes.estimated_days` | Lemah — eta di suppliers hanya text field |
| Historical Success | ✅ `vendor_performance` table | Baik — ontime%, success rate, cancel rate |
| Route matching | ✅ `vendor_rates.origin_keyword + dest_keyword` | Cukup — keyword-based, bukan geospatial |
| Service type | ✅ `suppliers.supportedModes`, `vendor_catalog_items.kategori` | Baik |
| Response speed | ✅ `vendor_performance.averageResponseMinutes` | Baik |

### Scoring Formula yang Direkomendasikan

```typescript
VendorScore = (
  priceScore      * 0.35 +  // Normalized: cheapest = 100
  etaScore        * 0.25 +  // Normalized: fastest = 100
  successScore    * 0.20 +  // vendor_performance.orderSuccessRate
  responseScore   * 0.10 +  // vendor_performance.averageResponseMinutes (inversed)
  routeScore      * 0.10    // exact route match bonus
)
```

**Matching Logic:**
```
Input: origin, destination, transport_mode, weight, cargo_type
Step 1: Filter suppliers WHERE isActive AND mode IN supportedModes
Step 2: Filter vendor_rates WHERE origin_keyword ILIKE '%origin%' AND dest_keyword ILIKE '%dest%'
Step 3: Calculate priceScore from vendor_rates.base_rate (+ weight factor)
Step 4: Join vendor_performance for historical scores
Step 5: Sort by composite score DESC
Step 6: Return top 3 vendors dengan score breakdown
```

**Gap:**
- Tidak ada `vendor_scoring_history` untuk audit trail
- `suppliers.eta` masih text → harus dikonversi ke integer (days)
- Tidak ada penalti vendor yang sering cancel/reject RFQ

---

## 4. AUDIT: AI ORDER CLASSIFICATION

### Current State
| Klasifikasi | Status | Cara Penyimpanan |
|---|---|---|
| Import / Export / Domestic | ⚠️ **Parsial** | `shipmentType` string (e.g., "Freight Forwarding — Impor Sea Freight (LCL)") — tidak terstruktur |
| Trucking / Freight / Customs | ⚠️ **Parsial** | `transportMode` + category di items — parsial terstruktur |
| Dangerous Goods | ❌ **Belum** | Frontend ada pilihan "DG/Non DG" tapi masuk `notes` atau JSONB, tidak ada dedicated column |
| Special Cargo | ❌ **Belum** | Tidak ada field — masuk notes |
| Required Documents | ⚠️ **Parsial** | DG trigger MSDS/SDS/COA di UI, tapi tidak ada document_requirements table |

### Recommendation

Tambah kolom terstruktur ke `logistic_orders`:
```sql
direction         TEXT CHECK IN ('import','export','domestic','transit')
service_category  TEXT CHECK IN ('freight','trucking','customs','handling','storage')
is_dangerous_good BOOLEAN DEFAULT false
cargo_special_tag TEXT[]  -- ['oversized','temperature','live_animal','high_value']
required_docs     TEXT[]  -- auto-populated by classification engine
```

**AI Classification Prompt Pattern:**
```
Given order details: [description, cargo, route, incoterm]
Classify:
1. direction: import | export | domestic | transit
2. service_category: freight | trucking | customs | handling | storage
3. is_dangerous_good: true | false (if MSDS mentioned, or chemical/flammable keywords)
4. cargo_special_tag: array dari [oversized, temperature, live_animal, high_value]
5. required_docs: array dari [commercial_invoice, packing_list, bl, awb, pib, peb, msds, coa]
```

---

## 5. AUDIT: SMART WORKFLOW AUTOMATION

### Current State
| Automation | Status | Detail |
|---|---|---|
| Auto assign admin PIC | ❌ **Belum** | `internal_tasks` ada `assigned_to`, tapi assignment manual |
| Auto send vendor RFQ | ✅ **Ada** | `sendVendorWhatsApp` + `vendorResponseToken` + short link |
| Auto reminder vendor | ⚠️ **Parsial** | `vmfGapNotifier` (24 jam) — tapi hanya untuk VMF stalled, bukan scheduled reminder |
| Auto reminder customer | ❌ **Belum** | Tidak ada reminder untuk expired quotation ke customer |
| Auto follow-up quotation expired | ❌ **Belum** | Tidak ada TTL/expiry logic untuk `customer_quote_links` |
| Auto generate checklist | ❌ **Belum** | Tidak ada operational checklist table/generator |
| Auto update status | ⚠️ **Parsial** | Driver app update status, geofence checker ada, tapi tidak ada rule-based auto status |

### Recommendation

**Automation Engine yang dibutuhkan:**

```
WorkflowTrigger (event-based):
├── ON order_created → auto-create internal_task → assign berdasarkan round-robin / workload
├── ON rfq_created → auto-send vendor WA blast (sudah ada ✅)
├── ON rfq_no_response (48h) → auto-resend reminder + escalate ke admin
├── ON customer_quote_sent (72h no response) → auto-reminder WA + email
├── ON quote_expired → auto-notify admin + close link
├── ON order_confirmed → auto-generate operational checklist by service_category
└── ON driver_delivered → auto-trigger POD request + update status
```

**Checklist Template per Service:**
```
service_category = 'customs' → [
  "Terima dokumen dari customer",
  "Validasi nomor HS Code",
  "Input ke sistem Bea Cukai",
  "Monitor SPPB/NPE",
  "Serahkan ke driver/forwarder"
]
```

---

## 6. AUDIT: KPI & ANALYTICS LAYER

### Current State
| KPI | Status | Sumber |
|---|---|---|
| Vendor performance | ✅ **Ada** | `vendor_performance` table + `/analytics-dashboard` |
| Quotation conversion | ⚠️ **Parsial** | Data ada di `customer_quote_responses`, tapi belum ada konversi rate metric |
| Order completion rate | ⚠️ **Parsial** | `vendor_performance.completedOrders` ada, tapi per-order completion time tidak tracked |
| SLA tracking | ⚠️ **Parsial** | `ontime_percentage` di vendor_performance, tapi tidak ada SLA definition per service |
| Customer activity | ❌ **Belum** | Tidak ada customer engagement score / activity log per customer |
| Operational bottleneck | ❌ **Belum** | `response-time-stats` hanya API latency, bukan operational stage duration |

### Recommendation

**Analytics Layer yang perlu ditambah:**

```sql
-- Order lifecycle tracking (stage duration)
order_stage_logs (order_id, stage, entered_at, exited_at, duration_hours, actor)

-- Quotation funnel
quotation_funnel_view:
  total_rfq → vendor_responded → admin_selected → customer_sent → customer_approved

-- SLA definition
sla_configs (service_category, direction, max_response_hours, max_delivery_days, company_id)

-- Customer health score
customer_activity (customer_id, last_order_date, total_orders, total_value, avg_approval_days)
```

---

## 7. AUDIT: AI CHAT / ASSISTANT READINESS

### Current State
| Komponen | Status | Detail |
|---|---|---|
| AI admin assistant | ⚠️ **Parsial** | Tidak ada — hanya customer-facing chatbot |
| AI customer assistant | ✅ **Ada** | `aiAgent.ts` — GPT-4o, function calling, order creation |
| AI vendor assistant | ❌ **Belum** | Vendor interaksi via WA/mini-form, tidak ada AI layer |
| AI internal operational | ❌ **Belum** | Tidak ada internal AI co-pilot untuk admin BizPortal |
| Context availability | ✅ **Baik** | `chatbot_knowledge_base` + order data via function calling |
| Order memory | ✅ **Ada** | `ai_chat_sessions` + `ai_chat_messages` linked ke `logistic_order` |
| Attachment access | ⚠️ **Parsial** | POD upload ada, tapi AI tidak bisa baca attachment dokumen dari chat |
| Permission layer | ✅ **Ada** | Order context limited ke session token — tidak ada cross-customer leak |
| Audit trail | ✅ **Ada** | `ai_chat_messages` + `wa_ai_intake_log` |

### Gap untuk AI Admin Assistant:
- Tidak ada internal BizPortal AI — admin masih manual query data
- Tidak ada AI yang bisa jawab "Berapa revenue bulan ini? Vendor mana paling lambat response?"
- Perlu: RAG (Retrieval Augmented Generation) over accounting + order data untuk internal queries

---

## 8. AUDIT: ERP / ACCOUNTING INTEGRATION READINESS

### Current State
| Fitur | Status | Detail |
|---|---|---|
| Invoice | ✅ **Ada** | `sales_documents` (kind='invoice'), `purchase_documents` (kind='bill') |
| Journal / Double-entry | ✅ **Ada** | `accounting_journals` + `accounting_entries` + `accounting_entry_lines` |
| Payment tracking | ✅ **Ada** | `accounting_payments` (inbound/outbound, payment_number, status) |
| Tax | ✅ **Ada** | `accounting_taxes` per rate/kind, linked ke CoA |
| Reconciliation | ⚠️ **Parsial** | AR/AP aging ada, tapi auto-reconciliation antara payment dan invoice belum ada |
| External accounting | ❌ **Belum** | Tidak ada export ke Accurate/Jurnal.id/Xero/QuickBooks |

### Gap:
- Tidak ada auto-reconciliation engine (match payment → invoice)
- Tidak ada audit log untuk accounting entry changes
- Tidak ada export format untuk sistem akuntansi eksternal

---

## 9. AUDIT: MULTI-COMPANY READINESS

### Current State
| Aspek | Status | Detail |
|---|---|---|
| Multiple company | ✅ **Ada** | `company_id` di semua major tables, `resolveCompanyId` middleware |
| Company isolation | ✅ **Baik** | Staff locked ke company_id mereka, admin bisa override |
| Separate branding | ⚠️ **Parsial** | `portal_content` table per company, tapi customer portal satu domain |
| Separate vendor/customer | ✅ **Ada** | `supplier.companyId`, `users.companyId` — tapi shared supplier pool dimungkinkan |
| Separate storage bucket | ❌ **Belum** | Satu bucket untuk semua, path-based separation (`/private/{company_id}/`) belum enforced |
| Separate pricing | ⚠️ **Parsial** | `margin_rules` ada company context, tapi `vendor_rates` tidak ada `company_id` |

### Gap:
- `vendor_rates` table tidak punya `company_id` → pricing sama untuk semua company
- Object Storage belum di-isolate per company
- Tidak ada per-company subdomain/custom domain support

---

## 10. AUDIT: MOBILE APP READINESS

### Current State
| App | Status | Detail |
|---|---|---|
| Driver App | ✅ **Ada** | Expo React Native — job management, GPS tracking, POD + signature capture |
| Customer tracking app | ⚠️ **Parsial** | Customer portal (web) ada tracking page, tapi belum native mobile app |
| Vendor response app | ⚠️ **Parsial** | Vendor Mini Form (mobile web), tapi bukan native app |
| Admin approval app | ❌ **Belum** | Tidak ada — admin pakai BizPortal desktop |

### Driver App Feature Coverage:
- ✅ Job list & detail
- ✅ Accept / Reject job
- ✅ GPS real-time tracking
- ✅ Status updates (9 stage workflow)
- ✅ POD upload + digital signature
- ⚠️ Push notifications — VAPID configured tapi belum fully tested
- ❌ Offline mode
- ❌ Route navigation integration (Google Maps deep link ada, tapi navigation in-app belum)

---

## OUTPUT A — AI READINESS MATRIX

| Feature | Current Readiness | Missing Component | Recommendation |
|---|---|---|---|
| AI Quotation Draft | 🟡 60% | Rate lookup + vendor scoring | Implement `vendorMatchingService.ts` yang query `vendor_rates` + `vendor_performance` |
| AI Order Classification | 🔴 30% | Structured fields (direction, is_dg, cargo_tag) | Add 4 kolom ke `logistic_orders`, buat classification prompt |
| AI Document OCR | 🟢 75% | Queue system, confidence score for general OCR, versioning | Buat `ocr_jobs` table + async worker |
| AI Vendor Matching | 🔴 25% | Scoring engine, structured ETA, penalty system | Implement scoring formula + `vendor_scoring_history` |
| AI Customer Assistant | 🟢 80% | Attachment reading from chat | Add file attachment support ke `ai_chat_messages` |
| AI Admin Assistant | 🔴 10% | Entire internal AI layer | Build RAG over accounting + order data |
| AI Vendor Assistant | 🔴 5% | Tidak ada | Build vendor-facing AI via WA or portal |
| AI Order Intake (email/WA) | 🟢 85% | Structured classification output | Enhance prompt untuk return structured JSON dengan direction/mode/dg fields |
| AI Workflow Automation | 🟡 40% | Event-based trigger engine, checklist generator | Build `workflow_triggers` table + background processor |
| AI Analytics Query | 🔴 5% | Internal AI query layer | Build admin AI dengan akses ke aggregated data |

---

## OUTPUT B — AUTOMATION OPPORTUNITY

| Process | Current Manual Work | Automation Potential | Priority |
|---|---|---|---|
| Assign PIC ke order baru | Admin manual pilih siapa handle | Auto round-robin / workload-based assignment | 🔴 HIGH |
| Follow-up vendor yang tidak response RFQ | Admin manually WA ulang | Auto reminder T+24h, T+48h, lalu escalate | 🔴 HIGH |
| Follow-up customer yang tidak approve quote | Admin ingat-ingat manual | Auto reminder T+3d, T+7d lalu mark expired | 🔴 HIGH |
| Generate operational checklist | Admin buat manual per order | Template-based auto generate per service_category | 🟡 MEDIUM |
| Input order dari email/WA | Admin copy-paste ke sistem | AI Intake sudah ada → improve classification | 🟢 QUICK WIN |
| Vendor rate comparison | Admin bandingkan manual per vendor | Auto scoring + ranked recommendation | 🔴 HIGH |
| Klasifikasi DG / special cargo | Admin judgment manual | Keyword detection + AI classification | 🟡 MEDIUM |
| Update status order ke customer | Admin manual kirim WA | Trigger-based auto WA per status change (sebagian sudah ada) | 🟢 QUICK WIN |
| Reconcile payment vs invoice | Finance manual matching | Auto-reconcile berdasarkan amount + reference number | 🟡 MEDIUM |
| Generate draft quotation harga | Sales hitung manual | AI hitung dari vendor_rates + margin_rules | 🔴 HIGH |
| Reminder vendor SLA breach | Tidak ada | Auto flag + notify jika delivery > SLA definition | 🟡 MEDIUM |
| Packing list OCR ke line items | Admin ketik ulang | OCR → auto-populate logistic_order_items | 🟢 QUICK WIN |

---

## OUTPUT C — DATA QUALITY AUDIT

### Data yang Sudah Cukup untuk AI:
- ✅ Vendor profile dan pricing (`suppliers`, `vendor_rates`, `vendor_catalog_items`)
- ✅ Order history (`logistic_orders`, `freight_shipments`)
- ✅ Vendor performance history (`vendor_performance`, `vendor_offers`)
- ✅ Accounting data (`sales_documents`, `accounting_entries`, `accounting_payments`)
- ✅ Knowledge base (`chatbot_knowledge_base`)

### Missing Structured Data:
| Field | Current State | Perbaikan yang Dibutuhkan |
|---|---|---|
| `logistic_orders.direction` | Embedded dalam `shipmentType` string | Pisahkan ke dedicated column: `'import'|'export'|'domestic'` |
| `logistic_orders.is_dangerous_good` | Di `notes` atau JSONB | Tambah boolean column |
| `logistic_orders.required_docs` | Tidak ada | Tambah `TEXT[]` column |
| `suppliers.eta` | Free-text ("3-5 hari") | Konversi ke `eta_days_min` dan `eta_days_max` INTEGER |
| `vendor_rates.company_id` | Tidak ada | Tambah untuk per-company pricing |
| Order stage duration | Tidak ada | Tambah `order_stage_logs` table |
| Quotation conversion funnel | Data terpencar | Buat materialized view / analytics table |
| Customer lifetime value | Tidak ada | Hitung dari `sales_documents` + `logistic_orders` per customer |

### Inconsistent Fields:
- `shipmentType` di `logistic_orders` — format tidak konsisten (mix Bahasa Indonesia + English, panjang bervariasi)
- `origin` / `destination` — free-text, tidak normalize ke kode kota/pelabuhan standar
- `transportMode` — beberapa pakai "Sea", "Laut", "FCL Sea", "sea_freight" — perlu enum

### Missing Logs / History:
- Tidak ada log perubahan status order dengan timestamp + actor (siapa yang ubah)
- Tidak ada log perubahan harga di quotation (versi ke-1, ke-2, dst)
- Tidak ada customer interaction log (kapan customer buka quote link, kapan baca WA)

---

## OUTPUT D — ARCHITECTURE GAP

### 1. Queue System
**Status:** ❌ Tidak ada
- `scanDocument.ts` — synchronous, blocking, bisa timeout untuk file besar
- `aiOrderIntake.ts` — runs inline dengan IMAP polling
- `podOcr.ts` — sudah ada async pattern tapi DB-backed polling, bukan true queue
- **Rekomendasi:** Implement DB-backed job queue (`ocr_jobs`, `automation_jobs` tables) dengan worker loop. Redis/BullMQ ideal tapi Replit environment lebih cocok dengan DB-backed approach.

### 2. OCR Processing
**Status:** 🟡 Parsial
- Ada untuk 3 document groups + POD
- Missing: queue, confidence threshold, human review UI, versioning table
- **Rekomendasi:** `ocr_jobs` table + dedicated worker endpoint yang dipanggil secara async

### 3. AI Memory / Context
**Status:** 🟡 Parsial (customer), ❌ tidak ada (admin)
- Customer AI: session memory ada via `ai_chat_messages`, tapi attachment reading belum
- Admin AI: tidak ada. Admin tidak bisa query data via AI
- **Rekomendasi:** Implement internal AI endpoint dengan akses terbatas ke aggregated queries (dashboard data, order summaries, vendor rankings)

### 4. Analytics Layer
**Status:** 🟡 Parsial
- Dashboard & reports ada, tapi data tidak pre-aggregated → tiap request hit raw tables
- Tidak ada `order_stage_logs` untuk measure operational bottleneck
- Tidak ada quotation conversion funnel tracking
- **Rekomendasi:** Tambah materialized/summary tables yang di-refresh periodik: `daily_order_stats`, `vendor_performance_snapshot`, `quotation_funnel_stats`

### 5. Event / Trigger System
**Status:** ❌ Tidak ada
- Tidak ada event bus atau trigger table
- Automation saat ini: hanya `setInterval` schedulers
- **Rekomendasi:** `workflow_events` table (event_type, payload, processed_at) + background processor

### 6. Structured Classification
**Status:** 🔴 Kritis
- Order classification embedded dalam free-text strings
- AI tidak bisa reliably filter/group orders
- **Rekomendasi:** Schema migration tambah 4 kolom ke `logistic_orders`

---

## OUTPUT E — IMPLEMENTATION ROADMAP

### PHASE 1 — Quick Automation (Estimasi: 3–4 minggu)
> Target: Kurangi manual work yang paling sering terjadi. Zero new AI dependency.

| # | Task | Effort | Impact |
|---|---|---|---|
| 1.1 | **Auto reminder vendor RFQ** — Scheduler: T+24h, T+48h WA reminder, lalu escalate ke admin group | S | 🔴 HIGH |
| 1.2 | **Auto reminder customer quote** — Scheduler: T+3d, T+7d WA + email, lalu auto-expired | S | 🔴 HIGH |
| 1.3 | **Quote expiry TTL** — Tambah `expires_at` ke `customer_quote_links`, auto close setelah N hari | S | 🔴 HIGH |
| 1.4 | **Fix order classification fields** — Schema migration: tambah `direction`, `is_dangerous_good`, `cargo_special_tags`, `required_docs` ke `logistic_orders` | M | 🔴 HIGH |
| 1.5 | **Normalize `transportMode`** — Buat enum, update semua existing records | S | 🟡 MEDIUM |
| 1.6 | **Auto assign PIC** — Round-robin assignment ke admin user berdasarkan company_id saat order masuk | M | 🔴 HIGH |
| 1.7 | **Operational checklist generator** — Table `checklist_templates` per service_category, auto-create checklist saat order confirmed | M | 🟡 MEDIUM |
| 1.8 | **`order_stage_logs`** — Catat setiap status change: who, when, from, to | S | 🟡 MEDIUM |
| 1.9 | **`vendor.eta` normalization** — Ubah `eta` text → `eta_days_min` + `eta_days_max` integer | S | 🔴 HIGH (blocking vendor scoring) |

---

### PHASE 2 — AI-Assisted Workflow (Estimasi: 5–7 minggu)
> Target: AI draft quotation, vendor scoring, OCR enhancement, admin AI query.

| # | Task | Effort | Impact |
|---|---|---|---|
| 2.1 | **Vendor Scoring Engine** — `vendorMatchingService.ts`: filter → score (price 35%, eta 25%, success 20%, response 10%, route 10%) → return top 3 | L | 🔴 HIGH |
| 2.2 | **AI Quotation Assistant** — Enhanced `aiOrderIntake`: classify structured fields + auto lookup `vendor_rates` + auto-select best vendor + create draft quotation with line items | L | 🔴 HIGH |
| 2.3 | **OCR Queue System** — `ocr_jobs` table + async worker + confidence score untuk `scanDocument.ts` | M | 🟡 MEDIUM |
| 2.4 | **OCR Human Review UI** — BizPortal screen: list ocr_jobs dengan confidence < threshold → admin correct & approve | M | 🟡 MEDIUM |
| 2.5 | **AI Order Classifier** — Classify `direction`, `is_dangerous_good`, `required_docs` dari free-text order description via GPT prompt | M | 🔴 HIGH |
| 2.6 | **Internal AI Admin Query** — Endpoint `/api/ai-admin` (requireAdmin) — AI dengan akses ke dashboard summary data, bisa jawab "Revenue bulan ini?", "Vendor paling lambat?" | L | 🟡 MEDIUM |
| 2.7 | **Quotation Funnel Analytics** — Track: RFQ → vendor respond → admin select → customer sent → approved. Materialized view + dashboard widget | M | 🟡 MEDIUM |
| 2.8 | **`vendor_rates.company_id`** — Add company isolation ke pricing table, UI untuk per-company pricing | M | 🟡 MEDIUM |
| 2.9 | **Customer Activity Score** — Computed dari order history: recency, frequency, value (RFM model) | M | 🟡 MEDIUM |

---

### PHASE 3 — Semi-Autonomous Operations (Estimasi: 6–10 minggu)
> Target: Sistem bisa handle sebagian besar order cycle dengan minimal human intervention.

| # | Task | Effort | Impact |
|---|---|---|---|
| 3.1 | **Workflow Event Engine** — `workflow_events` table + background processor + rule engine (trigger → condition → action) | XL | 🔴 HIGH |
| 3.2 | **Auto vendor RFQ blast** — Saat order masuk + vendor scoring selesai → auto-blast top 3 vendor tanpa admin trigger manual | L | 🔴 HIGH |
| 3.3 | **AI Vendor Assistant (WA)** — AI layer di WA inbound untuk vendor: parse vendor quote dari natural WA message → auto-fill vendor_offers | L | 🟡 MEDIUM |
| 3.4 | **SLA Breach Detection** — `sla_configs` table + monitor: flag + notify jika delivery approaching/breach SLA | M | 🟡 MEDIUM |
| 3.5 | **Auto Reconciliation** — Match `accounting_payments` ke `sales_documents`/`purchase_documents` berdasarkan amount + reference | L | 🟡 MEDIUM |
| 3.6 | **Multi-company Branding** — Per-company portal subdomain + logo + color scheme | L | 🟡 MEDIUM |
| 3.7 | **Admin Mobile Approval App** — React Native (Expo) admin app: approve quotation, view order, assign PIC, get push notification | XL | 🟡 MEDIUM |
| 3.8 | **Customer Native App** — PWA atau Expo app untuk tracking + order submission | XL | 🟡 MEDIUM |
| 3.9 | **External Accounting Export** — CSV/API export ke format Accurate Online atau Jurnal.id | M | 🔵 LOW |
| 3.10 | **Object Storage Isolation** — Per-company storage path enforcement + separate bucket policy | M | 🔵 LOW |

---

## OUTPUT F — FINAL FUTURE READINESS SCORE

| Dimensi | Score | Keterangan |
|---|---|---|
| **AI Readiness** | 🟡 **62 / 100** | Fondasi ada (GPT-4o integrated, intake, chatbot), tapi admin AI, vendor AI, dan classification engine belum ada |
| **OCR Readiness** | 🟢 **75 / 100** | 3 document groups + POD sudah ada. Gap: queue system, confidence scoring general OCR, versioning |
| **Automation Readiness** | 🟡 **45 / 100** | WA notifications bagus, RFQ blast ada, tapi reminder, PIC assignment, checklist, event engine belum ada |
| **ERP / Accounting Readiness** | 🟢 **80 / 100** | Double-entry complete, AR/AP ada, financial statements ada. Gap: auto-reconcile, external export |
| **Multi-Company Readiness** | 🟡 **65 / 100** | Schema + resolver ada, enforcement cukup baik. Gap: storage isolation, vendor pricing per-company |
| **Mobile Readiness** | 🟡 **55 / 100** | Driver app lengkap dan production-ready. Customer + Vendor hanya mobile web. Admin app belum ada |

### Overall Readiness: 🟡 **64 / 100**

**Kekuatan utama:** OCR multi-document, WA notification engine, double-entry accounting, driver app, AI intake dari email/WA.

**Gap paling kritis untuk di-tackle duluan:**
1. Structured order classification (blocking AI accuracy)
2. Vendor scoring engine (blocking AI quotation)
3. Auto reminder system (highest manual work reduction)
4. OCR async queue (reliability + scalability)

---

*Dokumen ini adalah living document. Update setelah setiap phase selesai diimplementasi.*

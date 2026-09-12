# OPERATIONAL INTELLIGENCE & AUTONOMOUS WORKFLOW — ARCHITECTURE PLAN
> Generated: 2026-05-27 | Builds on: `docs/ai-automation-roadmap.md`
> Scope: BizPortal → AI-Powered Operational Intelligence Platform

---

## EXECUTIVE SUMMARY

Sistem saat ini adalah **operational portal yang sangat capable** dengan fondasi solid: dual-audit trail (`activity_logs` + domain-specific audit logs), event chaining yang mature di route handlers, SSE real-time broadcast, dan notifikasi multi-channel WA+Email. Gap utama untuk naik ke level "Operational Intelligence Platform" ada di tiga lapisan:

1. **Intelligence Layer** — tidak ada anomaly detection, tidak ada proactive alerting engine
2. **Event Architecture** — trigger chain sudah ada tapi decentralized dan hardcoded, tidak ada centralized event bus
3. **Analytics Layer** — data ada tapi tidak pre-aggregated, tidak ada snapshot/warehouse strategy

Sistem ini **siap untuk evolusi bertahap** tanpa rewrite besar. Fondasi database, auth, dan notification sudah cukup kuat untuk menopang 3 phase transformasi.

---

## 1. AUDIT: OPERATIONAL INTELLIGENCE LAYER

### Current Capability vs. Intelligence Gap

| Deteksi | Status Saat Ini | Bagaimana Deteksi Bisa Dibangun |
|---|---|---|
| Bottleneck operasional | 🟡 Parsial | `vmfActivityLogTable` ada stage timestamps → bisa hitung duration per stage |
| Order terlambat | 🟡 Parsial | `logistic_orders.eta` ada, `order_updates` ada — tapi tidak ada scheduled checker yang bandingkan ETA vs now |
| Vendor lambat respon | ✅ Ada Data | `logistic_order_rfqs.response_deadline` + `vendor_performance.averageResponseMinutes` — tinggal build alerter |
| Quotation expired | ⚠️ Logic Ada | `vmfGapNotifier` ada tapi hanya untuk VMF stalled, tidak cover semua quote flow |
| Shipment risk | 🟡 Parsial | Geofence deviation alert ada (Haversine), route deviation WA ke admin sudah jalan |
| Missing document | ❌ Belum | Tidak ada document checklist enforcer — DG docs hanya di UI validation, tidak di backend |
| Margin terlalu kecil | ✅ Ada Data | `margin_rules` table ada, RFQ comparison highlight merah kalau margin < 0 — tapi tidak ada proactive alert |
| Duplicate order | ✅ Ada | 60-second cooldown di `logisticOrders.ts`, unique index di `sales_documents`, rate limiter di ecommerce |

### Recommendation: Intelligence Stack

```
┌─────────────────────────────────────────────────────┐
│                 RULES ENGINE                         │
│  rules_definitions (table)                          │
│  - rule_id, rule_type, condition_json, threshold    │
│  - action_type (alert/notify/escalate/auto_fix)     │
│  - severity (info/warning/critical)                 │
│  - is_active, company_id                            │
└──────────────────┬──────────────────────────────────┘
                   │ feeds
┌──────────────────▼──────────────────────────────────┐
│               ALERTING ENGINE                        │
│  intelligence_alerts (table)                        │
│  - alert_type, entity_type, entity_id               │
│  - severity, message, context_json                  │
│  - status (open/acknowledged/resolved)              │
│  - triggered_at, resolved_at, resolved_by           │
└──────────────────┬──────────────────────────────────┘
                   │ notifies
┌──────────────────▼──────────────────────────────────┐
│    EXISTING: WA + Email + SSE Notification Layer    │
└─────────────────────────────────────────────────────┘
```

**Built-in Rules yang Bisa Langsung Diimplementasi:**
```typescript
const DEFAULT_RULES = [
  { type: 'vendor_slow_response',    threshold: 24,  unit: 'hours',   severity: 'warning'  },
  { type: 'quote_no_response',       threshold: 72,  unit: 'hours',   severity: 'warning'  },
  { type: 'quote_expired',           threshold: 7,   unit: 'days',    severity: 'critical' },
  { type: 'order_eta_breach',        threshold: 0,   unit: 'hours',   severity: 'critical' },
  { type: 'margin_below_minimum',    threshold: 5,   unit: 'percent', severity: 'warning'  },
  { type: 'missing_required_doc',    threshold: 0,   unit: 'count',   severity: 'critical' },
  { type: 'shipment_route_deviation',threshold: 75,  unit: 'km',      severity: 'warning'  },
  { type: 'stage_stalled',           threshold: 48,  unit: 'hours',   severity: 'warning'  },
]
```

---

## 2. AUDIT: SMART DECISION ENGINE

### Current Readiness untuk AI Recommendations

| Rekomendasi | Data Tersedia | Gap | Effort |
|---|---|---|---|
| Vendor terbaik | ✅ `vendor_performance` + `vendor_rates` + `vendor_offers` | Belum ada scoring engine yang menggabungkan semua | M |
| Harga jual (pricing) | ✅ `margin_rules` + `vendor_rates` + historical `logistic_order_quotes` | Belum ada price prediction dari AI, baru rule-based | M |
| SLA recommendation | ⚠️ `vendor_performance.ontimePercentage` + `estimated_days` dari quotes | `suppliers.eta` masih text, belum integer | S |
| Shipment route | ⚠️ `vendor_rates.origin_keyword + dest_keyword` + `shipments` history | Keyword-based, bukan geospatial — tidak bisa optimize route | L |
| Service bundling | ❌ Tidak Ada | Tidak ada historical "services bought together" analysis | L |

### Scoring Architecture

```typescript
// Composite Vendor Score — 5 faktor
interface VendorScore {
  vendorId:        number;

  // Historical Performance (data tersedia di vendor_performance)
  successRate:     number;  // weight: 20% — orderSuccessRate
  ontimeRate:      number;  // weight: 20% — ontimePercentage
  responseSpeed:   number;  // weight: 10% — averageResponseMinutes (inversed, normalized)

  // Ekonomi (data tersedia di vendor_rates + logistic_order_quotes)
  priceScore:      number;  // weight: 30% — cheapest = 100, most expensive = 0
  marginScore:     number;  // weight: 10% — calculated from cost vs margin_rules

  // Route Fit (data tersedia di vendor_rates)
  routeMatch:      number;  // weight: 10% — exact match = 100, keyword partial = 50, none = 0

  composite:       number;  // weighted sum 0–100
  rank:            number;  // 1 = best
  explanation:     string;  // human-readable rationale untuk admin
}

// Pricing Recommendation
interface PriceRecommendation {
  baseRate:        number;  // from vendor_rates or lowest vendor_offers
  suggestedSell:   number;  // baseRate × (1 + margin_rules.marginValue)
  minimumSell:     number;  // baseRate × (1 + margin_rules.minimumMargin)
  competitorRange: string;  // "market estimate: Rp X – Rp Y" (dari historical wins)
  confidence:      'high' | 'medium' | 'low';
}
```

### Customer Preference Layer (Missing — Perlu Dibangun):
```sql
-- Tidak ada saat ini — perlu ditambah
customer_preferences (
  customer_id, preferred_vendor_ids TEXT[],
  preferred_service_category TEXT,
  avg_budget_per_cbm NUMERIC,
  preferred_transport_mode TEXT,
  avg_approval_speed_hours NUMERIC,
  last_analyzed_at TIMESTAMP
)
```

---

## 3. AUTONOMOUS WORKFLOW ROADMAP

### Level 1 — Trigger & Remind (0 AI dependency)

| Feature | Trigger | Action | Data Source | Complexity |
|---|---|---|---|---|
| Auto reminder vendor RFQ | T+24h setelah `rfq_created`, vendor belum response | WA + Email ke vendor, CC admin | `logistic_order_rfqs.response_deadline` | S |
| Auto re-send vendor RFQ | T+48h masih tidak ada response | WA blast ulang + flag di UI | `logistic_order_rfqs` + `vendor_performance` | S |
| Auto reminder customer quote | T+3d setelah `customer_quote_sent` | WA ke customer nomor HP | `customer_quote_links.created_at` | S |
| Auto quotation expiry | T+7d masih belum diapprove | Mark expired + WA final notice + alert admin | `customer_quote_links.expires_at` (perlu tambah) | S |
| Auto follow-up expired | 1 hari setelah expired | WA admin: "Quote XYZ expired, apakah perlu dibuat ulang?" | `customer_quote_links` | S |
| Auto escalation | Vendor tidak response T+72h | Notify admin group WA, flag order sebagai `needs_attention` | `intelligence_alerts` | M |

### Level 2 — AI-Assisted Operations

| Feature | AI Role | Human Role | Dependencies |
|---|---|---|---|
| Auto draft quotation | AI query vendor_rates + scoring, buat draft | Admin review price, approve/edit | Level 1 + Vendor Scoring Engine |
| Auto assign vendor | AI suggest top 1 vendor + justification | Admin 1-click confirm | Vendor Scoring Engine |
| Auto classify order | AI parse description → `direction`, `is_dangerous_good`, `service_category` | Admin correct kalau salah | Structured columns di schema |
| Auto operational checklist | Template engine: service_category × direction → checklist items | Admin tick-off per item | `checklist_templates` table |
| Auto PIC assignment | Round-robin atau load-balancing berdasarkan workload | Admin bisa re-assign | `internal_tasks` + user workload metric |
| Auto populate required docs | Dari classification → list dokumen yang harus ada | Admin upload / konfirmasi | `required_docs` column + `document_types` table |

### Level 3 — AI-Powered Intelligence

| Feature | Architecture | Status |
|---|---|---|
| AI operational assistant (admin) | Internal endpoint `/api/ai-admin` → RAG over order/accounting data | ❌ Belum ada |
| AI customer assistant | `aiAgent.ts` sudah ada — enhance: attachment reading, multi-order context | 🟡 80% |
| AI vendor assistant | WA inbound parsing → extract vendor quote dari natural language | ❌ Belum ada |
| AI anomaly monitoring | Rules engine + ML scoring → proactive alert dashboard | ❌ Belum ada |
| AI margin guard | Real-time: setiap quote masuk, AI check margin vs minimum → alert | 🟡 Logic ada, perlu automation |

### Level 4 — Semi-Autonomous Operations (Future State)

```
Order Masuk (WA/Email/Portal)
    ↓ [AI Intake]
Classify → Draft Order (no human input)
    ↓ [Auto Vendor Blast]
Top 3 vendor dapat RFQ otomatis
    ↓ [Wait: Vendor Response]
AI compare quotes → suggest winner → notify admin
    ↓ [Admin 1-click Approve]
Auto SO created → Auto customer notification
    ↓ [Driver Assignment]
Auto assign driver → Auto job notification
    ↓ [Monitoring]
AI monitor ETA, document, geofence
    ↓ [POD]
Driver upload → Auto OCR verify → Auto complete
```

---

## 4. EVENT-DRIVEN ARCHITECTURE

### Current State: Explicit Procedural Chaining

Sistem saat ini menggunakan **direct chaining pattern** — route handler memanggil service functions secara sequential. Tidak ada centralized event bus.

```typescript
// Contoh: order_created handler saat ini
await db.insert(logisticOrders)...
await sendLogisticOrderNotification(...)   // direct call
await saveAndBroadcast(...)                // direct SSE
await logActivity(...)                     // direct log
// ❌ Tidak ada: event emission → subscriber processing
```

**Positif dari pattern ini:** Simple, debuggable, no external dependency.
**Negatif:** Sulit scale, sulit add new automation step tanpa edit route handler, tidak ada retry, tidak ada dead-letter.

### Recommended: DB-Backed Event Queue (No External Dependency)

```sql
-- Tabel baru: workflow_events
CREATE TABLE workflow_events (
  id            SERIAL PRIMARY KEY,
  event_type    TEXT NOT NULL,           -- 'order_created', 'vendor_responded', dll
  entity_type   TEXT NOT NULL,           -- 'logistic_order', 'rfq', 'shipment'
  entity_id     INTEGER NOT NULL,
  company_id    INTEGER,
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT DEFAULT 'pending',  -- pending | processing | completed | failed | dead
  attempts      INTEGER DEFAULT 0,
  max_attempts  INTEGER DEFAULT 3,
  process_after TIMESTAMP DEFAULT NOW(), -- support delayed events
  processed_at  TIMESTAMP,
  error_message TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workflow_events_pending ON workflow_events(status, process_after)
  WHERE status = 'pending';
```

**Worker Pattern (setInterval, sudah familiar dengan codebase):**
```typescript
// artifacts/api-server/src/lib/workflowWorker.ts
async function processWorkflowEvents() {
  const events = await db.select()
    .from(workflowEventsTable)
    .where(and(
      eq(workflowEventsTable.status, 'pending'),
      lte(workflowEventsTable.processAfter, new Date())
    ))
    .limit(10);

  for (const event of events) {
    await processEvent(event);
  }
}

setInterval(processWorkflowEvents, 5000); // poll tiap 5 detik
```

### Event Naming Standard

```
{entity}.{action}[.{qualifier}]

Contoh:
  order.created
  order.approved
  order.cancelled
  rfq.created
  rfq.vendor_responded
  rfq.expired
  quote.sent_to_customer
  quote.customer_approved
  quote.customer_rejected
  quote.expired
  so.created
  shipment.status_updated
  shipment.delivered
  shipment.route_deviated
  customs.document_uploaded
  customs.cleared
  pod.uploaded
  pod.verified
  payment.received
  driver.assigned
  driver.location_updated
```

### Event Architecture Plan Detail

| Event | Producer | Consumer | Delayed? | Retry? | Priority |
|---|---|---|---|---|---|
| `order.created` | `logisticOrders.ts` | Notify admin WA, assign PIC, log activity | No | Yes (3x) | P1 |
| `order.approved` | `vendorMiniForm.ts` | Create SO, notify vendor, notify customer | No | Yes | P1 |
| `rfq.created` | `logisticRfq.ts` | Blast WA to vendors, start response deadline timer | No | Yes | P1 |
| `rfq.vendor_responded` | `vendorMiniForm.ts` | Notify admin, update score, cancel pending reminder | No | Yes | P1 |
| `rfq.expired` | Worker (timer check) | Notify admin, suggest re-blast or close | T+48h | Yes | P1 |
| `quote.sent_to_customer` | `customerQuoteFlow.ts` | Start expiry countdown, log | No | Yes | P1 |
| `quote.expired` | Worker (timer check) | Mark closed, WA customer final, WA admin summary | T+7d | Yes | P1 |
| `shipment.route_deviated` | `orderGeofenceChecker.ts` | WA admin alert, create intelligence_alert | No | No (fire once) | P1 |
| `pod.uploaded` | `podOcr.ts` | Trigger OCR verify, update order status | No | Yes | P2 |
| `payment.received` | `accounting.ts` | Auto-reconcile vs invoice, update AR aging | No | Yes | P2 |
| `shipment.eta_approaching` | Worker (timer check) | Notify customer, notify driver | T-24h | No | P2 |
| `margin.below_minimum` | `rfqComparison.ts` | Alert admin, flag in UI | No | No | P2 |

### Retry Strategy
```
attempt 1 → immediate
attempt 2 → +5 minutes
attempt 3 → +30 minutes
attempt 4+ → dead-letter queue (status = 'dead', manual review)
```

---

## 5. ANALYTICS & DATA WAREHOUSE READINESS

### Current State
Data operasional ada, tapi tersebar dan belum pre-aggregated:
- `vendor_performance` — sudah ada KPI snapshot per vendor ✅
- `dashboard.ts` `/analytics` — query realtime ke raw tables (no cache) ⚠️
- `reports.ts` — query on-demand, bisa lambat di dataset besar ⚠️
- Tidak ada `daily_snapshots`, `weekly_rollups`, atau materialized views ❌

### Reporting Schema yang Direkomendasikan

```sql
-- 1. Daily order stats snapshot (run tiap midnight)
daily_order_stats (
  date DATE, company_id INT,
  total_orders INT, confirmed_orders INT, cancelled_orders INT,
  total_rfqs INT, rfqs_with_response INT, avg_response_hours NUMERIC,
  total_quotes_sent INT, quotes_approved INT, conversion_rate NUMERIC,
  total_revenue NUMERIC, total_cost NUMERIC, gross_margin_pct NUMERIC
)

-- 2. Vendor performance snapshot (run tiap minggu)
vendor_performance_snapshots (
  snapshot_date DATE, vendor_id INT, company_id INT,
  total_orders INT, completed INT, cancelled INT,
  avg_response_minutes NUMERIC, ontime_pct NUMERIC,
  avg_price_deviation NUMERIC,  -- actual vs quoted price
  total_revenue_generated NUMERIC,
  composite_score NUMERIC       -- dihitung dari formula scoring
)

-- 3. Customer health snapshot (run tiap minggu)
customer_health_snapshots (
  snapshot_date DATE, customer_id INT, company_id INT,
  total_orders INT, total_revenue NUMERIC,
  avg_approval_days NUMERIC,    -- berapa lama customer approve quote
  last_order_date DATE,
  rfm_score NUMERIC,            -- Recency + Frequency + Monetary
  churn_risk TEXT               -- low/medium/high
)

-- 4. Order stage duration log (real-time, per event)
order_stage_logs (
  id SERIAL, order_id INT, company_id INT,
  stage_from TEXT, stage_to TEXT,
  entered_at TIMESTAMP, exited_at TIMESTAMP,
  duration_hours NUMERIC,
  actor_id INT, actor_type TEXT  -- who triggered the change
)

-- 5. Quotation funnel tracker (real-time)
quotation_funnel_events (
  id SERIAL, order_id INT, rfq_id INT, quote_id INT,
  funnel_stage TEXT,  -- rfq_sent|vendor_responded|admin_selected|customer_sent|approved|rejected|expired
  occurred_at TIMESTAMP, actor_type TEXT
)
```

### Aggregation Strategy

```
Real-time (< 1 second):   SSE broadcast + cached dashboard summary
Near-real-time (5 min):   workflowWorker update `intelligence_alerts`
Hourly rollup:            Vendor response rate, open RFQ count
Daily snapshot:           `daily_order_stats` via midnight cron
Weekly snapshot:          `vendor_performance_snapshots`, `customer_health_snapshots`
On-demand:                Financial statements, AR/AP aging (query raw, paginated)
```

---

## 6. AI MEMORY & CONTEXT LAYER

### Current State

| Capability | Status | Detail |
|---|---|---|
| AI baca history order | 🟡 Parsial | `get_order_status` tool call — tapi hanya order yang linked ke session |
| AI baca attachment | ❌ Belum | `ai_chat_messages` tidak support file attachment reading dalam context |
| AI baca timeline | ✅ Ada | `order_updates` table linked ke order, bisa di-include dalam context |
| AI pahami vendor performance | ❌ Belum | AI tidak bisa query `vendor_performance` table |
| AI pahami customer behavior | ❌ Belum | Tidak ada customer profile/preference yang di-aggregate untuk AI |

### Context Aggregation Architecture

```typescript
// Proposed: ContextAggregator untuk AI Admin
interface AdminAIContext {
  // Operational snapshot
  openOrders: number;
  pendingRFQs: number;
  overdueOrders: OrderSummary[];
  activeAlerts: IntelligenceAlert[];

  // Vendor intelligence
  topVendors: VendorScoreSummary[];
  slowVendors: VendorScoreSummary[];   // avg response > 48h

  // Financial snapshot
  monthlyRevenue: number;
  monthlyMarginPct: number;
  overdueAR: number;

  // Customer context (kalau query specific customer)
  customerProfile?: CustomerHealthSnapshot;
  customerOrderHistory?: OrderSummary[];
}

// Customer AI Context (sudah parsial, perlu enhance)
interface CustomerAIContext {
  activeOrders: OrderSummary[];    // sudah ada via get_order_status ✅
  orderTimeline: OrderUpdate[];    // perlu expose via tool call
  attachments: DocumentSummary[];  // ❌ belum ada
  preferredServices: string[];     // ❌ belum ada
}
```

### Vector Database — Future Path

Saat ini AI menggunakan `chatbot_knowledge_base` (text search). Untuk semantic search:

```
Phase 2: Semantic search via pgvector (PostgreSQL extension)
  → Store embedding per knowledge_base entry
  → Query: similarity search saat customer tanya

Phase 3: Full RAG
  → Embed: order history, vendor profile, customs docs
  → AI retrieve relevant context automatically
  → Requires: pgvector + embedding pipeline
```

**pgvector** sudah supported di Supabase (PostgreSQL) yang dipakai sistem ini — bisa enable tanpa ganti database.

### AI Memory Boundary & Permission Layer

```
Customer AI:
  ✅ Can access: own orders, own quote status, order timeline
  ❌ Cannot: see other customers' data, pricing margins, vendor details

Vendor AI:
  ✅ Can access: RFQ assigned to vendor, own quote history
  ❌ Cannot: see competitor vendor quotes, customer internal notes

Admin AI:
  ✅ Can access: all orders (company_id scoped), vendor performance, analytics
  ❌ Cannot: access other company's data (company isolation via resolveCompanyId)

System AI (internal worker):
  ✅ Can access: all data within company scope for automation
  Must: log every AI decision to audit trail
```

---

## 7. MULTI-TENANT / MULTI-COMPANY READINESS

### Detailed Gap Matrix

| Aspek | Status | Detail | Gap |
|---|---|---|---|
| Multiple company schema | ✅ Solid | `company_id` di semua major tables, migration seeder sudah komprehensif | - |
| Company isolation (API) | ✅ Solid | `resolveCompanyId` + `resolveCompanyScope` enforced di routes | Staff-facing routes perlu audit menyeluruh |
| White-label portal | ⚠️ Parsial | `portal_content` per company ada (logo, tagline, colors) tapi satu domain | Perlu subdomain routing atau path-based tenant |
| Separate WA template | ⚠️ Parsial | `wa_template_configs` ada tapi belum ada `company_id` di template | Add `company_id` ke `wa_template_configs` |
| Separate branding | ⚠️ Parsial | CSS variabel via `portal_content` bisa, tapi belum ada theme engine di frontend | Build theme provider yang baca `portal_content.themeConfig` |
| Separate storage | ❌ Gap | Satu bucket, path-based — tidak ada policy enforcement per company | Add company_id prefix enforcement + bucket policy |
| Separate vendor pool | ⚠️ Parsial | `suppliers.companyId` ada tapi bisa share dengan query tanpa filter | Enforce company_id filter di semua vendor queries |
| Separate customer pool | ✅ Solid | `users.companyId` enforced | - |
| Separate pricing | ❌ Gap | `vendor_rates` tidak ada `company_id` — semua company pakai rate yang sama | Add `company_id` ke `vendor_rates` |

### Recommended White-Label Architecture:

```
Request: https://clientA.bizportal.com/
  → Nginx/gateway: extract subdomain → set X-Tenant-ID header
  → API resolve company dari X-Tenant-ID
  → Return portal_content.branding untuk clientA
  → Frontend apply theme: logo, colors, fonts

OR (simpler, no subdomain DNS):
  → Path-based: /portal/clientA/ → resolve tenant dari path
```

---

## 8. MOBILE & FIELD OPERATION READINESS

### Current Coverage

| App | Platform | Readiness | Feature Coverage |
|---|---|---|---|
| Driver App | Expo React Native | 🟢 **85%** | Job mgmt, GPS, 9-stage status, POD + signature, photo upload |
| Vendor Response | Mobile Web (VMF) | 🟡 **65%** | Rate submission, driver detail, accept/reject — no native app |
| Customer Tracking | Mobile Web | 🟡 **60%** | Order status, timeline — no native app, no push notif |
| Admin Approval | Desktop Web | 🔴 **20%** | Full BizPortal, not mobile-optimized |

### Driver App Gap Analysis:

| Feature | Status | Notes |
|---|---|---|
| Job management | ✅ Complete | 9-stage lifecycle |
| GPS tracking | ✅ Live | Periodic push to `driver_locations` |
| POD + signature | ✅ Complete | Touch-draw signature + photo |
| Geofence alerts | ✅ Server-side | Haversine-based deviation detection |
| Offline mode | ❌ Missing | Jika sinyal hilang, update tidak bisa masuk |
| Route navigation | ⚠️ Link only | Google Maps deep link, tidak in-app navigation |
| Push notification | ⚠️ VAPID ready | Server configured, perlu test end-to-end reliability |
| Barcode/QR scan | ❌ Missing | ZXing ada di BizPortal web, belum di driver app |
| Multi-job | ⚠️ Parsial | Bisa lihat job list tapi tidak ada multi-job optimization |

### Mobile Roadmap Priority:

```
P1 (Quick):  Driver app offline mode (queue updates, sync when online)
P1 (Quick):  Push notification reliability test + fix
P2 (Medium): Vendor Mini-Form PWA enhancement (installable, push notif)
P2 (Medium): Customer tracking PWA (installable, real-time via SSE)
P3 (Long):   Admin approval mobile app (Expo, approve quote on the go)
P3 (Long):   Barcode/QR scan di driver app
```

---

## 9. COMPLIANCE & AUDIT TRAIL

### Current Readiness — Strong Foundation

| Audit Area | Status | Tables / Mechanism |
|---|---|---|
| Operational audit | ✅ Ada | `activity_logs` (JSONB old/new value, actor_id, action) |
| Freight status history | ✅ Ada | `freight_shipment_audit_logs` (from_status, to_status, changed_by) |
| Customs document tracking | ✅ Ada | `freight_customs_docs` + `storage_audit_log` untuk uploads |
| Quotation history | ✅ Ada | `quotation_reply_logs` + `logistic_order_quotes` |
| Approval history | ✅ Ada | `purchase_approvals` (step, approver, status, notes, timestamp) |
| Document upload audit | ✅ Ada | `storage_audit_log` (action: upload/download/delete, entity_type, entity_id) |
| Optimistic locking | ✅ Ada | `logistic_orders.version` integer increment |
| File versioning | ❌ Missing | Tidak ada `document_versions` table — update = overwrite |
| Accounting entry immutability | ⚠️ Parsial | `accounting_entries` bisa diedit — tidak ada lock setelah period close |
| Legal evidence trail | ⚠️ Parsial | Hash/checksum dokumen tidak ada — tidak bisa prove dokumen tidak dimanipulasi |

### Critical Gap: Legal Evidence Trail

```sql
-- Perlu ditambah untuk legal defensibility
document_hashes (
  id SERIAL,
  entity_type TEXT,     -- 'customs_doc', 'bl', 'invoice', 'pod'
  entity_id INTEGER,
  file_url TEXT,
  sha256_hash TEXT,     -- hash file saat upload
  hashed_at TIMESTAMP,
  hashed_by_id INTEGER
)

-- Period close untuk accounting
accounting_periods (
  id SERIAL, company_id INT,
  period_start DATE, period_end DATE,
  status TEXT,  -- open | closed | locked
  closed_by_id INT, closed_at TIMESTAMP
)
-- Ketika period = 'locked': DENY semua UPDATE/DELETE pada accounting_entries di period itu
```

### Compliance Readiness Score:
- **Operational audit:** 🟢 85% — sangat baik
- **Financial audit:** 🟡 65% — period close dan entry immutability belum ada
- **Legal evidence (dokumen):** 🔴 40% — tidak ada hash/checksum, tidak ada versioning

---

## OUTPUT A — OPERATIONAL INTELLIGENCE MATRIX

| Capability | Current Readiness | Missing Component | Priority |
|---|---|---|---|
| Bottleneck detection | 🟡 40% | `order_stage_logs` table + duration analyzer + UI alert widget | P1 |
| Late order detection | 🟡 50% | Scheduled ETA checker (DB cron via setInterval) + `intelligence_alerts` | P1 |
| Vendor slow response alert | 🟡 60% | `rules_definitions` table + alert worker (data sudah ada) | P1 |
| Quotation expiry detection | 🟡 55% | `expires_at` kolom di `customer_quote_links` + expiry worker | P1 |
| Shipment risk monitoring | 🟢 70% | Geofence ada, perlu: document checklist enforcer + structured missing_doc list | P2 |
| Missing document alert | 🔴 20% | `required_docs[]` di schema + backend checker per service_category | P1 |
| Margin guard | 🟡 60% | `margin_rules` ada — perlu automated real-time alert (bukan hanya UI highlight) | P2 |
| Duplicate order detection | 🟢 80% | Sudah ada cooldown + unique index — perlu enhance cross-session detection | P3 |
| Stage stall detection | 🔴 15% | `order_stage_logs` table belum ada — perlu dari scratch | P1 |
| Anomaly pattern detection | 🔴 5% | Tidak ada — butuh aggregation layer + baseline calculation | P3 |

---

## OUTPUT B — AUTOMATION ROADMAP

| Level | Feature | Complexity | Business Impact |
|---|---|---|---|
| **L1** | Auto reminder vendor RFQ (T+24h, T+48h) | S | 🔴 Sangat Tinggi — paling banyak manual effort |
| **L1** | Auto reminder customer quote (T+3d, T+7d) | S | 🔴 Sangat Tinggi |
| **L1** | Auto quote expiry + final WA | S | 🔴 Sangat Tinggi |
| **L1** | Auto escalation ke admin group (vendor T+72h) | S | 🔴 Tinggi |
| **L1** | Auto PIC assignment (round-robin) | M | 🔴 Tinggi |
| **L2** | Auto draft quotation (AI price lookup + draft) | L | 🔴 Sangat Tinggi |
| **L2** | Auto vendor scoring + rank | M | 🔴 Sangat Tinggi |
| **L2** | Auto order classification (AI structured fields) | M | 🔴 Tinggi |
| **L2** | Auto operational checklist per service | M | 🟡 Medium |
| **L2** | Auto required document list | M | 🔴 Tinggi (customs compliance) |
| **L2** | Auto OCR queue + human review UI | L | 🟡 Medium |
| **L3** | AI admin operational query assistant | XL | 🟡 Medium |
| **L3** | AI vendor WA reply parser | L | 🟡 Medium |
| **L3** | AI anomaly monitoring dashboard | XL | 🔴 Tinggi |
| **L3** | AI margin guard (real-time alert) | M | 🔴 Tinggi |
| **L4** | Semi-autonomous full order cycle | XXL | 🔴 Sangat Tinggi (jangka panjang) |

---

## OUTPUT C — EVENT ARCHITECTURE PLAN

| Event | Producer | Consumer(s) | Queue? | Retry? | Priority |
|---|---|---|---|---|---|
| `order.created` | `logisticOrders.ts` | PIC assigner, WA admin, activity log, SSE | ✅ Yes | 3x | P1 |
| `order.approved` | `vendorMiniForm.ts` | SO creator, WA customer, WA vendor, activity log | ✅ Yes | 3x | P1 |
| `order.status_changed` | Route handlers | `order_stage_logs` writer, SSE broadcast, WA customer | ✅ Yes | 3x | P1 |
| `rfq.created` | `logisticRfq.ts` | Vendor WA blast, schedule expiry timer | ✅ Yes | 3x | P1 |
| `rfq.vendor_responded` | `vendorMiniForm.ts` | Cancel pending reminder, notify admin, update vendor score | ✅ Yes | 3x | P1 |
| `rfq.no_response` (T+24h) | Worker | Vendor reminder WA | ⏱ Delayed | 2x | P1 |
| `rfq.expired` (T+48h) | Worker | Escalate to admin, create `intelligence_alert` | ⏱ Delayed | 1x | P1 |
| `quote.sent` | `customerQuoteFlow.ts` | Schedule reminder + expiry countdown | ✅ Yes | 2x | P1 |
| `quote.customer_approved` | `vendorMiniForm.ts` | SO creation, WA both parties, cancel expiry timer | ✅ Yes | 3x | P1 |
| `quote.expired` | Worker | Mark closed, final WA customer, admin alert | ⏱ Delayed | 1x | P1 |
| `so.created` | `vmfSoIntegration.ts` | WA notification, accounting journal creation | ✅ Yes | 3x | P2 |
| `attachment.uploaded` | `storage.ts` | `storage_audit_log`, OCR trigger (if doc type), hash calculation | ✅ Yes | 2x | P2 |
| `shipment.status_updated` | Driver app / admin | SSE broadcast, WA customer, `order_stage_logs` | ✅ Yes | 2x | P1 |
| `shipment.route_deviated` | `orderGeofenceChecker.ts` | WA admin alert, `intelligence_alert` create | No | 1x | P1 |
| `customs.document_uploaded` | `freightCustomsDocs.ts` | Check required_docs completion, alert if complete | ✅ Yes | 2x | P2 |
| `delivery.completed` | Driver app (POD submit) | POD OCR trigger, WA customer, update vendor stats | ✅ Yes | 3x | P1 |
| `payment.received` | `accounting.ts` | Auto-reconcile vs invoice, update AR aging | ✅ Yes | 3x | P2 |
| `margin.below_minimum` | RFQ comparison calc | `intelligence_alert`, admin UI flag | No | 1x | P2 |
| `driver.location_updated` | Driver app | Geofence check, ETA recalculate | No | 0x | P2 |
| `eta.approaching` (T-24h) | Worker | WA customer + driver reminder | ⏱ Delayed | 1x | P2 |

---

## OUTPUT D — DATA READINESS AUDIT

| Area | AI-Ready? | Missing Data | Risk |
|---|---|---|---|
| Order classification | 🔴 No | `direction`, `is_dangerous_good`, `service_category` columns belum terstruktur | Tinggi — AI tidak bisa filter/group reliably |
| Vendor pricing | 🟡 Partial | `vendor_rates` tanpa `company_id`, `suppliers.eta` masih text | Medium — pricing cross-contaminate antar company |
| Vendor performance | 🟢 Yes | `vendor_performance` lengkap — hanya perlu weekly snapshot | Rendah |
| Customer behavior | 🔴 No | Tidak ada `customer_health_snapshots`, tidak ada preference tracking | Tinggi — AI tidak bisa personalize recommendation |
| Order stage duration | 🔴 No | `order_stage_logs` belum ada | Tinggi — bottleneck tidak bisa dideteksi |
| Quotation funnel | 🔴 No | `quotation_funnel_events` belum ada | Tinggi — conversion rate tidak bisa dihitung akurat |
| Document completeness | 🔴 No | `required_docs[]` di order belum ada, tidak ada checker | Tinggi — missing customs doc bisa jadi compliance risk |
| Accounting / Finance | 🟢 Yes | Period close dan immutability belum ada, tapi data lengkap | Medium |
| AI knowledge base | 🟢 Yes | `chatbot_knowledge_base` ada — perlu enrichment dengan ops data | Rendah |
| Geolocation history | 🟡 Partial | `driver_locations` ada current, history dari `order_updates` — tidak ada dedicated `driver_location_history` | Medium |

---

## OUTPUT E — AI READINESS SCORE

| Domain AI | Score | Bottleneck Utama |
|---|---|---|
| **Operational AI** (anomaly, alert, intelligence) | 🔴 **20 / 100** | Tidak ada rules engine, alert table, atau anomaly baseline |
| **OCR AI** (document extraction) | 🟢 **75 / 100** | Queue system & confidence score untuk general OCR |
| **Analytics AI** (query, insight) | 🟡 **35 / 100** | Data ada tapi tidak pre-aggregated, tidak ada AI query interface |
| **Recommendation AI** (vendor, pricing, SLA) | 🟡 **45 / 100** | Data vendor lengkap, scoring engine belum ada, customer preference tidak ada |
| **Assistant AI** (customer, admin, vendor) | 🟡 **55 / 100** | Customer assistant 80%, admin & vendor 0% |

**Overall AI Readiness: 🟡 46 / 100**

---

## OUTPUT F — ENTERPRISE MATURITY SCORE

| Dimensi | Score | Catatan |
|---|---|---|
| **Operational Maturity** | 🟡 **60 / 100** | Proses operasional terdefinisi baik, tapi banyak masih manual. WA automation kuat. |
| **Architecture Maturity** | 🟡 **65 / 100** | Monorepo solid, DB schema bagus, tapi tidak ada event bus, tidak ada queue. Procedural chaining tidak scalable jangka panjang. |
| **Scalability Maturity** | 🟡 **55 / 100** | PostgreSQL + Drizzle scalable, tapi tidak ada caching layer (Redis), tidak ada read replica, OCR synchronous bisa bottleneck. |
| **AI Maturity** | 🔴 **35 / 100** | Fondasi ada (GPT-4o integrated, OCR, intake), tapi intelligence layer (anomaly, recommendation, analytics AI) hampir tidak ada. |
| **Compliance Maturity** | 🟡 **65 / 100** | Audit trail bagus, tapi period close, file hashing, dan legal evidence trail belum ada. |
| **Mobile Maturity** | 🟡 **55 / 100** | Driver app production-ready. Customer & vendor hanya mobile web. Admin tidak ada. |

**Overall Enterprise Maturity: 🟡 56 / 100**

---

## OUTPUT G — RECOMMENDED NEXT PHASE

### PHASE 1 — Operational Foundation (4–5 minggu)
> **Goal:** Stop bleeding manual work. Build the plumbing untuk intelligence layer.
> **Team:** 1 backend + 1 frontend

**Schema Migrations (Week 1):**
```sql
-- Tambah ke logistic_orders:
direction            TEXT,  -- 'import'|'export'|'domestic'
is_dangerous_good    BOOLEAN DEFAULT false,
service_category     TEXT,  -- 'freight'|'trucking'|'customs'|'handling'
cargo_special_tags   TEXT[],
required_docs        TEXT[],

-- Tambah ke customer_quote_links:
expires_at           TIMESTAMP,

-- New tables:
workflow_events      (event queue)
intelligence_alerts  (alert store)
order_stage_logs     (stage duration tracking)
rules_definitions    (configurable alert rules)
```

**Automation (Week 2–3):**
- Workflow event worker (poll tiap 5 detik, process delayed events)
- L1 reminders: vendor RFQ T+24h/T+48h, customer quote T+3d/T+7d, expiry
- Auto PIC assignment (round-robin)
- Normalize `vendors.eta` → `eta_days_min` + `eta_days_max`

**Intelligence Layer v1 (Week 4–5):**
- Alert dashboard di BizPortal (list `intelligence_alerts`, filter severity)
- Rules worker: vendor slow response, quote expiry, stage stall, margin breach
- `order_stage_logs` writer (setiap status change, catat duration)

---

### PHASE 2 — AI-Assisted Operations (6–8 minggu)
> **Goal:** AI draft + recommend. Kurangi cognitive load admin 50%.
> **Team:** 1 backend + 1 frontend + AI prompting

**Vendor Intelligence (Week 1–2):**
- `vendorMatchingService.ts` — scoring engine (5 faktor, composite score)
- `vendor_scoring_history` table — audit trail setiap scoring run
- BizPortal UI: vendor recommendation widget di RFQ comparison

**AI Quotation Assistant (Week 3–4):**
- Enhanced `aiOrderIntake.ts` — structured JSON output dengan direction/mode/dg/service_category
- Auto price lookup dari `vendor_rates` + `margin_rules`
- Draft quotation generation dengan line items pre-filled
- Human review UI: admin approve/edit/reject AI draft

**Analytics Layer v1 (Week 5–6):**
- `daily_order_stats` snapshot (midnight job)
- `quotation_funnel_events` writer
- Dashboard widget: funnel visualisasi (RFQ → approved)
- `customer_health_snapshots` (weekly job)

**OCR Enhancement (Week 7–8):**
- `ocr_jobs` table + async OCR worker
- Confidence score untuk general scan-document
- Human review queue UI di BizPortal (low-confidence flag)

---

### PHASE 3 — Intelligent Operations (8–12 minggu)
> **Goal:** Platform bisa monitor, predict, dan semi-automate order lifecycle.
> **Team:** 1 backend + 1 frontend + 1 AI/ML

**AI Intelligence Layer (Week 1–4):**
- Admin AI assistant (`/api/ai-admin`) — RAG atas dashboard + order data
- AI anomaly detection — baseline dari snapshot data, flag unusual patterns
- AI margin guard — real-time check setiap quote submission
- AI document completeness checker — per service_category auto-check required_docs

**Semi-Autonomous Workflow (Week 5–8):**
- Auto vendor RFQ blast (setelah scoring, tidak perlu admin trigger)
- AI vendor WA reply parser (extract price + ETA dari WA natural language)
- Workflow event bus maturity — semua lifecycle events via `workflow_events`
- Dead-letter queue UI untuk event failures

**Enterprise Layer (Week 9–12):**
- Per-company pricing (`vendor_rates.company_id`)
- White-label portal routing (subdomain atau path-based)
- Period close untuk accounting (immutable ledger)
- Document hash/checksum untuk legal evidence trail
- pgvector embedding untuk semantic knowledge base search
- Admin mobile approval app (Expo — approve quote + view alerts on-the-go)

---

## PRIORITIZATION MATRIX

```
Impact ↑   | Phase 1 reminders     | Phase 2 vendor scoring
           | Phase 1 alert engine  | Phase 2 AI quotation draft
           |                       | Phase 3 admin AI assistant
───────────┼───────────────────────┼──────────────────────────
           | Phase 3 white-label   | Phase 3 semi-autonomous
           | Phase 3 mobile admin  | Phase 3 pgvector
           |                       |
           └──────────────────────────────────────────→ Complexity
           Low                                       High
```

---

*Dokumen ini adalah living architecture plan. Setiap phase selesai, update readiness scores di OUTPUT E dan F.*
*Dokumen sebelumnya: `docs/ai-automation-roadmap.md`*

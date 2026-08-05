# BizPortal — Enterprise Platform Governance & Autonomous Architecture Roadmap

> **Status**: Architecture plan — tidak ada implementasi yang dilakukan di dokumen ini.
> **Dibuat**: Mei 2026 · Berdasarkan audit codebase lengkap
> **Tujuan**: Peta jalan BizPortal menuju AI-native enterprise logistics orchestration platform

---

## RINGKASAN EKSEKUTIF

BizPortal saat ini adalah **ERP operasional yang matang** dengan fondasi multi-modul yang solid. Audit menunjukkan platform ini memiliki keunggulan:

- **Governance**: Hybrid RBAC (system roles + custom roles JSONB) + multi-level approval engine + org hierarchy 5 level
- **AI**: OpenAI GPT-4o aktif untuk OCR, agent, dan POD verification — jauh di depan rata-rata ERP lokal
- **Notification**: Multi-channel (WA + Email + WebPush) dengan dedup persistent
- **Isolation**: Company-level data isolation dengan resolveCompanyId konsisten

**Gap kritis** yang harus ditutup untuk mencapai enterprise grade:
1. Tidak ada event bus eksternal — seluruh async bergantung pada PostgreSQL polling
2. Tidak ada vector database — AI masih stateless, tidak punya memori semantik
3. Approval engine ada tapi belum configurable per-customer/per-branch SLA
4. Tidak ada observability terpusat (tracing, metrics, health aggregation)
5. Workflow DSL belum ada — workflow hanya di-hardcode per modul

---

## A. ENTERPRISE GOVERNANCE MATRIX

| Capability | Readiness Saat Ini | Gap | Rekomendasi |
|---|---|---|---|
| **Role hierarchy (RBAC)** | 🟡 Medium — 4 system roles + custom roles JSONB | Tidak ada role inheritance; custom role tidak bisa extend system role | Tambah `role_parent_id` untuk hierarchical role inheritance |
| **ABAC (Attribute-Based)** | 🔴 Rendah — hanya cek `company_id` + permission string | Tidak ada policy berdasarkan resource attribute (nilai order, jalur pengiriman, tipe kargo) | Bangun Policy Engine berbasis OPA/custom rule evaluator |
| **Multi-level approval** | 🟡 Medium — approval_requests + rules engine ada | Tidak ada parallel approval, tidak ada deadline/escalation otomatis | Tambah approval_stage, parallel quorum, auto-escalation pada timeout |
| **Dept/branch isolation** | 🟡 Medium — branch_id, division_id, dept_id di custom_roles | Data query masih kurang enforce scope branch/division secara konsisten | Middleware `resolveScopeFilter` wajib di semua route ERP |
| **Audit compliance** | 🟡 Medium — erp_audit_logs + activity_logs + storage_audit_log | Tidak ada tamper-proof audit (log bisa diedit di DB); tidak ada digital signature | Implement append-only audit dengan hash chain atau eksternal sink |
| **Policy engine** | 🔴 Rendah — tidak ada | Tidak ada rule engine generik; policy hanya di-hardcode | Bangun `PolicyEngine` service dengan DSL sederhana (YAML/JSON rules) |
| **Operational governance** | 🟡 Medium — intelligence_alerts baru diimplementasi | Tidak ada SLA breach dashboard, tidak ada compliance scoring per order | Bangun SLA compliance tracker per customer contract |

### Rekomendasi RBAC/ABAC Strategy

```
Layer 1 (DONE): System roles — admin / logistics / trading / ecommerce
Layer 2 (DONE): Custom roles with JSONB permission array + org scope
Layer 3 (MISSING): Resource-level ABAC
  → Rule: user.branch_id = resource.branch_id AND resource.value < user.approval_limit
Layer 4 (MISSING): Policy Engine
  → "If order.cargo_type = DG AND user.certification = none → DENY"
  → "If invoice.amount > 100M AND approver.level < 2 → ESCALATE"
```

### Approval Matrix Engine (Rekomendasi)

```
approval_rules (EXISTING) → tambah:
  - deadline_hours: berapa jam sebelum auto-escalate
  - escalation_role_id: ke mana escalate jika deadline lewat
  - parallel_required: apakah butuh semua approver (AND) atau cukup satu (OR)
  - condition_dsl: JSON rule e.g. {"field":"amount","op":"gt","value":50000000}

approval_stages (NEW):
  - stage_order: 1, 2, 3
  - required_role_id / required_user_id
  - quorum_type: all | any | majority
  - deadline_hours
  - auto_action_on_timeout: escalate | approve | reject | notify
```

---

## B. AI-NATIVE READINESS

| Area | Readiness | Missing Layer | Priority |
|---|---|---|---|
| **Document OCR** | 🟢 Tinggi — GPT-4o Vision aktif, multi-schema | Tidak ada feedback loop dari hasil ekstraksi; akurasi tidak diukur | P2 |
| **AI Agent (chatbot)** | 🟡 Medium — function calling aktif, knowledge base ada | Tidak ada memory; context hilang tiap sesi; tidak bisa referensi histori | **P1** |
| **Semantic search** | 🔴 Tidak ada | Tidak ada pgvector/embedding; search masih LIKE/full-text biasa | **P1** |
| **AI audit trail** | 🔴 Tidak ada | Tidak ada log untuk setiap AI call (prompt, output, token used, model) | **P1** |
| **Permission-aware AI** | 🔴 Tidak ada | AI agent tidak tahu role/scope user; bisa expose data cross-company | **P1** |
| **Vector database** | 🔴 Tidak ada | Tidak ada embedding store; tidak bisa similarity search | P2 |
| **AI memory layer** | 🔴 Tidak ada | Tidak ada long-term context storage per customer/vendor | P2 |
| **AI recommendation** | 🔴 Tidak ada | Tidak ada ML model untuk vendor selection, pricing, routing | P3 |
| **AI training data** | 🟡 Low — data operasional ada tapi tidak terstruktur untuk ML | Tidak ada pipeline ekstraksi feature; tidak ada label/annotation | P3 |
| **Retrieval pipeline** | 🔴 Tidak ada | Tidak ada RAG pipeline; AI tidak bisa query knowledge base secara semantik | P2 |

### AI Gateway Architecture (Rekomendasi)

```
┌─────────────────────────────────────────────────────┐
│                   AI GATEWAY                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Auth/    │  │ Context  │  │  Rate Limiter +   │ │
│  │ Scope    │  │ Injector │  │  Cost Tracker     │ │
│  │ Filter   │  │          │  │                   │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌──────────┐ ┌──────────────┐
   │ OpenAI     │ │ Vector   │ │ Knowledge    │
   │ GPT-4o     │ │ Store    │ │ Base RAG     │
   │ (existing) │ │(pgvector)│ │              │
   └────────────┘ └──────────┘ └──────────────┘
```

**Context Aggregation Pipeline (Rekomendasi):**
```typescript
interface AIContext {
  user: { id, role, company_id, branch_id, permissions }
  session: { recent_orders: [], recent_vendors: [], active_rfqs: [] }
  knowledge: KnowledgeBaseEntry[]   // semantic search dari pgvector
  history: ChatMessage[]            // N pesan terakhir per session_id
  tools: ToolDefinition[]           // hanya tools yang diizinkan oleh role
}
```

**AI Audit Trail (Rekomendasi — tabel `ai_audit_logs`):**
```sql
CREATE TABLE ai_audit_logs (
  id            SERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL,
  user_id       TEXT,
  company_id    INTEGER,
  model         TEXT NOT NULL,       -- gpt-4o, gpt-4-vision, etc.
  prompt_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC(10,6),
  context_type  TEXT,                -- agent | ocr | pod | recommendation
  input_hash    TEXT,                -- SHA256 prompt hash (tidak simpan raw)
  output_hash   TEXT,
  latency_ms    INTEGER,
  error         TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);
```

---

## C. MICROSERVICE / EVENT READINESS

| Domain | Separation Readiness | Queue Needed? | Risiko Saat Ini |
|---|---|---|---|
| **order-service** | 🟡 Medium — logistic_orders terisolasi di schema | 🔴 Ya — order events harus di-broadcast ke semua consumer | Jika satu modul error, bisa corrupt order state |
| **pricing-service** | 🔴 Rendah — margin, pricing tersebar di 5+ routes | 🔴 Ya — price change harus trigger re-quote semua draft | Pricing logic duplikat di frontend dan backend |
| **notification-service** | 🟢 Tinggi — fonnte.ts + mailer.ts + webPush.ts sudah terisolasi | 🟡 Idealnya — agar tidak blocking response | WA call sync bisa timeout dan delay API response |
| **document-service** | 🟡 Medium — scanDocument/podOcr sudah di-route tersendiri | 🟡 Ya untuk OCR job queue | OCR sync saat ini — user tunggu 10-30 detik |
| **customs-service** | 🔴 Rendah — tidak ada domain customs yang jelas | 🔴 Ya — customs validation adalah long-running job | Tidak ada modul customs PIB/PEB yang dedicated |
| **ai-service** | 🟡 Medium — aiAgent.ts terpisah, tapi shared dengan OCR | 🔴 Ya — AI job harus queued agar tidak overload | Rate limit OpenAI bisa cascade error ke semua AI feature |
| **analytics-service** | 🟡 Medium — dashboard.ts ada tapi heavy query langsung ke OLTP | 🟡 Ya — report generation harus background | Heavy report bisa lock DB connection pool |
| **driver-service** | 🟡 Medium — driver routes + SSE terpisah | 🟡 Ya untuk location events | SSE tanpa queue = drop event jika koneksi putus |

### Event Bus Architecture (Rekomendasi Bertahap)

**Phase 1 (sekarang — PostgreSQL as queue):**
```sql
-- workflow_events sudah ada (baru diimplementasi)
-- Tambah consumer pattern:
SELECT * FROM workflow_events
WHERE status = 'pending' AND process_after <= NOW()
ORDER BY process_after
FOR UPDATE SKIP LOCKED   -- ← kunci ini agar tidak double-process
LIMIT 10;
```

**Phase 2 (6-12 bulan — Redis Stream atau BullMQ):**
```
Order Created → [order.created event]
  ├─ notification-worker: kirim WA/email konfirmasi
  ├─ pricing-worker: hitung margin, update analytics
  ├─ document-worker: generate nomor SO
  └─ ai-worker: classify order, suggest vendor
```

**Phase 3 (12-24 bulan — Event Sourcing):**
```
EventStore (append-only log)
  → Projection: order_current_state
  → Projection: vendor_performance_materialized
  → Projection: customer_ltv_materialized
```

### Domain Boundaries (Rekomendasi)

```
artifacts/
  api-server/          ← BFF (Backend for Frontend) — tetap ada
  services/
    order-service/     ← logistic_orders, rfq, quote flow
    pricing-service/   ← margin rules, vendor rates, catalog pricing
    notification-service/ ← WA, email, push — sudah hampir siap
    document-service/  ← PDF generation, OCR, storage
    customs-service/   ← PIB/PEB validation, HS code lookup
    ai-service/        ← agent, recommendation, embedding
    analytics-service/ ← dashboard, reports, BI aggregation
```

---

## D. ENTERPRISE DATA READINESS

| Area | BI Ready? | AI Ready? | Data yang Kurang |
|---|---|---|---|
| **Order data** | 🟢 Ya — lengkap | 🟡 Parsial | Label quality (good/bad order), routing history, delay reason |
| **Pricing / margin** | 🟡 Parsial | 🔴 Tidak | Historical price by lane/commodity/season; markup elasticity |
| **Vendor performance** | 🟡 Parsial — vendor_performance ada | 🔴 Tidak | On-time delivery rate, damage rate, cost variance per trip |
| **Customer behavior** | 🔴 Tidak | 🔴 Tidak | Churn signal, LTV, order frequency, seasonal pattern |
| **Freight routing** | 🔴 Tidak | 🔴 Tidak | Lane history, transit time actual vs estimate, carrier comparison |
| **Customs data** | 🔴 Tidak | 🔴 Tidak | HS code accuracy rate, rejection rate, clearance time |
| **Financial** | 🟡 Parsial — COA + double-entry ada | 🔴 Tidak | Cash flow forecast data, AP/AR aging trends, budget vs actual |
| **Operational time** | 🟡 Parsial — order_stage_logs baru | 🔴 Tidak | Stage duration distribution, bottleneck frequency per stage |
| **AI interaction** | 🔴 Tidak ada | 🔴 Tidak | Semua AI call tanpa log = tidak bisa improve model |

### Data Warehouse Strategy (Rekomendasi)

**Short-term (PostgreSQL materialized views):**
```sql
-- Sudah bisa diimplementasi segera
CREATE MATERIALIZED VIEW mv_order_kpi AS
SELECT
  date_trunc('week', created_at) AS week,
  company_id,
  COUNT(*) AS total_orders,
  AVG(EXTRACT(EPOCH FROM (delivered_at - created_at))/3600) AS avg_hours_to_deliver,
  SUM(order_margin) AS total_margin,
  COUNT(*) FILTER (WHERE status = 'Cancelled') AS cancelled_count
FROM logistic_orders
GROUP BY 1, 2;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_kpi;
```

**Medium-term (TimescaleDB atau partitioned tables):**
```sql
-- Buat tabel hypertable untuk time-series metrics
CREATE TABLE operational_metrics (
  time        TIMESTAMPTZ NOT NULL,
  metric_name TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  company_id  INTEGER,
  value       NUMERIC
);
-- Partition by week, index by metric_name + entity
```

**Long-term (dedicated analytics DB):**
- Pertimbangkan Supabase Analytics atau ClickHouse untuk OLAP
- ETL pipeline dari PostgreSQL OLTP → OLAP nightly
- Dimensi: time, company, customer, vendor, lane, commodity
- Fakta: order, shipment, payment, AI_call, notification

---

## E. AUTONOMOUS MATURITY SCORE

### Skor Per Dimensi

| Dimensi | Skor (1-10) | Posisi Saat Ini |
|---|---|---|
| **Workflow Maturity** | 4/10 | Approval engine ada, tapi workflow hardcoded per modul. Tidak ada visual builder, tidak ada DSL |
| **AI Maturity** | 5/10 | OCR + agent + POD verification sudah production. Tapi tidak ada memory, tidak ada RAG, tidak ada rekomendasi |
| **Orchestration Maturity** | 3/10 | PostgreSQL polling + setInterval. Tidak ada job queue, tidak ada retry exponential backoff, tidak ada dead-letter |
| **Enterprise Maturity** | 5/10 | Multi-company, multi-role, multi-approval ada. Tapi audit tamper-proof, policy engine, SLA enforcement belum ada |
| **Event Bus Maturity** | 2/10 | SSE untuk realtime, webhook fonnte ada. Tapi tidak ada internal event bus, semua sync |
| **Data Platform Maturity** | 3/10 | OLTP data lengkap, tapi tidak ada OLAP, tidak ada materialized view, tidak ada ML feature store |

### Level Otonomi Per Fungsi

| Fungsi | Level Saat Ini | Target 12 Bulan | Target 24 Bulan |
|---|---|---|---|
| **Vendor selection** | L0 — manual | L1 — rekomendasi AI | L2 — assisted (AI suggest, human confirm) |
| **Quotation draft** | L1 — AI draft via scan | L2 — AI draft dari pattern historis | L3 — semi-auto (publish jika confidence > 90%) |
| **Customs validation** | L0 — tidak ada | L1 — checklist otomatis | L2 — AI flag anomali |
| **Anomaly detection** | L1 — intelligence_alerts baru | L2 — ML anomaly score | L3 — auto-escalation + auto-pause |
| **Order routing** | L0 — manual | L1 — lane suggestion | L2 — auto-assign vendor berdasarkan SLA + rate |
| **Invoice reconciliation** | L0 — manual | L1 — AI match suggestion | L2 — auto-reconcile jika confidence > 95% |
| **Customer quote** | L1 — reminder otomatis | L2 — AI-generated quote draft | L3 — auto-send jika dalam range harga |

---

## F. STRATEGIC ENTERPRISE ROADMAP

### YEAR 1 — Foundation & Intelligence (Q3 2026 – Q2 2027)

**Q3 2026 — Operational Stabilization (Phase 1 selesai)**
- ✅ Intelligence Alerts system
- ✅ Workflow Worker L1 reminders (RFQ T+24h/48h, quote T+3d/7d)
- ✅ Schema: workflow_events, order_stage_logs, intelligence_alerts
- ▶ `FOR UPDATE SKIP LOCKED` pattern di workflow_events untuk safe concurrent processing
- ▶ Materialized view pertama: `mv_order_kpi`, `mv_vendor_performance`
- ▶ AI Audit Log table (`ai_audit_logs`) — track semua AI call + token cost

**Q4 2026 — Workflow Intelligence (Phase 2)**
- Configurable approval matrix: deadline, escalation, parallel quorum
- SLA Contract per customer: definisikan target turnaround time
- Policy Engine v1: YAML-based rules untuk order validation
- AI Gateway: permission-aware context injection sebelum setiap AI call
- pgvector setup + embedding pipeline untuk knowledge base
- Semantic search untuk vendor catalog dan knowledge base

**Q1 2027 — AI-Assisted Operations (Phase 3 awal)**
- AI memory layer: per-customer + per-vendor session context (PostgreSQL JSONB)
- RAG pipeline: AI agent bisa query knowledge base secara semantik
- Auto-classify incoming orders (direction, service_category, cargo_tags)
- Vendor recommendation engine v1 (rule-based + historis)
- OCR feedback loop: admin bisa koreksi hasil ekstraksi → improve prompt

**Q2 2027 — Event Infrastructure (Phase 2 paralel)**
- BullMQ / pg-boss untuk job queue yang proper (retry, dead-letter, priority)
- Notification service menjadi async — tidak blocking API response
- OCR job queue — user tidak tunggu sinkron
- Order event publishing: setiap state change publish ke internal event log
- Webhook verifikasi signature (Fonnte, internal partner)

---

### YEAR 2 — Semi-Autonomous Enterprise (Q3 2027 – Q2 2028)

**Q3 2027 — Semi-Autonomous Workflow (Phase 3)**
- Auto vendor selection (jika confidence > threshold dan SLA match)
- Auto quotation draft: AI generate quote dari template + historis pricing
- Customs checklist automation: validasi dokumen PIB/PEB dari scan
- Auto-reconcile invoices jika delta < 0.5% dari PO
- L2 anomaly detection: ML scoring untuk order yang likely bermasalah
- Approval workflow dengan visual builder (drag-drop stage)

**Q4 2027 — Enterprise Data Platform**
- Partitioned time-series metrics table
- ClickHouse / TimescaleDB setup untuk OLAP queries
- ETL nightly: OLTP → OLAP pipeline
- Customer LTV model (first version)
- Freight lane profitability dashboard (per lane, per commodity, per carrier)
- Multi-currency support + historical FX rate untuk laporan konsolidasi

**Q1 2028 — Knowledge Graph**
- Vendor knowledge graph: performance, lane coverage, rate history, incident
- Customer relationship graph: order history, payment behavior, SLA compliance
- Shipment intelligence: transit time distribution per lane/carrier/season
- Historical pricing memory: AI bisa akses harga historis per commodity+lane
- Rekomendasi berbasis graph similarity

**Q2 2028 — Observability Platform**
- Distributed tracing: OpenTelemetry di semua service
- Centralized logging: structured JSON → external sink (Loki/Datadog/Grafana)
- Metrics: order throughput, AI latency, queue depth, error rate per domain
- Operational health dashboard: SLA compliance rate, alert resolution time
- Automated alerting: PagerDuty/Slack integration untuk critical incidents

---

### YEAR 3 — AI-Native Platform (Q3 2028 – Q2 2029)

**Q3 2028 — Autonomous Operations (Phase 4)**
- Auto vendor selection: L3 — system pilih vendor, eksekusi jika dalam pre-approved lane
- Auto customs validation: flag dan hold shipment yang berpotensi masalah
- Predictive ETA: ML model dari histori transit per lane+carrier+season
- Auto-generate BOL, PKS draft dari order data
- Dynamic pricing: AI suggest harga berdasarkan market, demand, vendor cost

**Q4 2028 — Enterprise Ecosystem Hub**
- Partner API marketplace: vendor bisa akses RFQ via standardized API
- Customer self-service portal: buat order, cek status, download dokumen
- Carrier integration: langsung connect ke sistem carrier (JNE, Tiki, Pos, shipping lines)
- Customs API integration: Bea Cukai INSW / SSm integration
- B2B EDI: Electronic Data Interchange untuk enterprise customer

**Q1 2029 — AI-Native Orchestration**
- Multi-agent system: orchestrator AI + specialized sub-agents
  - PricingAgent: real-time competitive pricing
  - ComplianceAgent: customs + regulatory check
  - RouteAgent: optimal routing suggestion
  - ReconciliationAgent: invoice matching
- Event-driven fully: semua state change melalui event bus
- AI dapat mengeksekusi workflow multi-step dengan human-in-the-loop checkpoint
- Fully configurable workflow DSL: visual builder untuk non-technical user

**Q2 2029 — Global Scale**
- Multi-region deployment
- CDN untuk customer portal dan dokumen
- Multi-language (EN, ID, ZH, MS) untuk portal dan notifikasi
- Multi-timezone untuk semua timestamp display
- Regional compliance: UU PDP Indonesia, GDPR untuk operasi internasional
- High concurrency: connection pooling (PgBouncer), read replicas

---

## G. FINAL STRATEGIC RECOMMENDATION

### Vision: BizPortal sebagai AI-Native Logistics Operating System

```
┌─────────────────────────────────────────────────────────────────┐
│              BIZPORTAL ENTERPRISE PLATFORM (2029)               │
│                                                                 │
│  ┌───────────────────┐   ┌───────────────────────────────────┐  │
│  │  CUSTOMER PORTAL  │   │      PARTNER ECOSYSTEM API        │  │
│  │  (Self-service)   │   │  (Vendor, Carrier, Customs)       │  │
│  └────────┬──────────┘   └──────────────┬────────────────────┘  │
│           │                             │                       │
│  ┌────────▼─────────────────────────────▼────────────────────┐  │
│  │                    AI GATEWAY + ORCHESTRATOR               │  │
│  │  Context Injection │ Permission-Aware │ Audit Trail        │  │
│  └────────────────────────────┬─────────────────────────────-┘  │
│                               │                                 │
│  ┌──────────┬─────────────────┼────────────┬──────────────────┐ │
│  │ ORDER    │ PRICING         │ CUSTOMS    │ NOTIFICATION     │ │
│  │ SERVICE  │ SERVICE         │ SERVICE    │ SERVICE          │ │
│  └──────────┴─────────────────┴────────────┴──────────────────┘ │
│                               │                                 │
│  ┌───────────────────────────-┼────────────────────────────────┐ │
│  │              EVENT BUS (BullMQ / pg-boss)                  │ │
│  └────────────────────────────┬─────────────────────────────—-┘ │
│                               │                                 │
│  ┌──────────┬─────────────────┼────────────┬──────────────────┐ │
│  │ OLTP DB  │ VECTOR STORE    │ OLAP / DWH │ AI AUDIT STORE  │ │
│  │ (PG)     │ (pgvector)      │ (ClickHouse│                  │ │
│  └──────────┴─────────────────┴────────────┴──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 7 Prinsip Arsitektur untuk Menuju Sana

**1. Event-First, Not Request-First**
Setiap perubahan state penting harus menjadi event yang bisa di-consume oleh banyak consumer. Mulai dari workflow_events yang sudah ada → BullMQ → full event sourcing.

**2. AI sebagai First-Class Citizen, Bukan Feature**
AI harus punya gateway, audit trail, permission scope, dan context aggregation sendiri. Jangan inject AI call langsung di route handler.

**3. Data sebagai Produk**
Setiap domain harus punya kontrak data yang jelas. Mulai dengan materialized view → time-series metrics → OLAP warehouse.

**4. Governance by Default**
Setiap route baru harus melewati `requireScope(scope)` dan `enforcePolicy(policy_id)`. Governance tidak boleh opt-in, harus opt-out.

**5. Observability Sebelum Scale**
Jangan scale tanpa tracing dan metrics. Implementasi OpenTelemetry sebelum menambah service baru.

**6. Human-in-the-Loop untuk Semua Autonomous Action**
Setiap action autonomous Level 3+ harus punya:
- Pre-condition confidence threshold
- Audit log yang tamper-proof
- Rollback mechanism
- Override UI untuk operator

**7. Incremental Decomposition**
Jangan big-bang microservice. Pisahkan domain satu per satu, mulai dari notification-service (sudah hampir siap) → document-service → pricing-service.

---

### Priority Action Items (Next 90 Hari)

| # | Item | Impact | Effort | Prioritas |
|---|---|---|---|---|
| 1 | `FOR UPDATE SKIP LOCKED` pada workflow_events | Concurrent-safe job processing | Rendah | **P0** |
| 2 | `ai_audit_logs` table + middleware | Track AI cost + compliance | Rendah | **P0** |
| 3 | Materialized view: `mv_order_kpi` + `mv_vendor_performance` | BI foundation | Rendah | **P0** |
| 4 | pgvector extension + embedding pipeline untuk knowledge base | Semantic search | Medium | **P1** |
| 5 | Permission-aware AI context injector | Security + compliance | Medium | **P1** |
| 6 | Approval engine: tambah deadline + auto-escalation | Governance maturity | Medium | **P1** |
| 7 | OCR job queue (async, tidak blocking) | UX + reliability | Medium | **P1** |
| 8 | SLA contract per customer | Operational intelligence | Medium | **P2** |
| 9 | Policy Engine v1 (YAML rules) | Governance automation | Tinggi | **P2** |
| 10 | OpenTelemetry setup | Observability prerequisite | Tinggi | **P2** |

---

*Dokumen ini adalah living document. Update setiap kuartal bersamaan dengan sprint planning.*
*Versi berikutnya: setelah Phase 2 (Workflow Intelligence) selesai diimplementasi.*

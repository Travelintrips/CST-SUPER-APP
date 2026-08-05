# BizPortal — AI-Native Enterprise Execution Layer
## Enterprise Architecture Roadmap · AI Orchestration Strategy · Autonomous Execution Framework

> **Basis dokumen:** Audit penuh codebase BizPortal per 27 Mei 2026.
> Seluruh readiness rating didasarkan pada kondisi nyata schema, route, dan modul yang ada.
> **Ini adalah dokumen perencanaan — belum ada implementasi.**

---

## RINGKASAN EKSEKUTIF

BizPortal sudah berada di **AI Maturity Level 2** dari 5. AI sudah digunakan secara aktif untuk order intake (email/WA parsing), POD OCR, document scanning, dan customer chatbot. Data operasional sangat kaya: 40+ tabel schema dengan full lifecycle logistics, accounting double-entry, vendor performance, dan audit trail. Foundation untuk AI-native enterprise sudah ada — yang dibutuhkan adalah **orchestration layer**, **memory system**, dan **governance framework** untuk naik ke Level 4–5.

---

## BAGIAN 1 — AI AGENT ARCHITECTURE READINESS

### A. Customer AI Agent

**Kondisi saat ini:**
- ✅ `aiOrderIntake.ts` — parsing email/WA inbound → auto-create draft quotation
- ✅ `routes/aiAgent.ts` — chatbot publik dengan tool-calling (cek stok, buat order logistik, search produk)
- ✅ `chatbot_knowledge_base` table — custom FAQ/business rules injected ke system prompt
- ✅ `ai_chat_sessions` + `ai_chat_messages` — session history ada
- ✅ `customerQuoteFlow.ts` — approval/rejection classification sudah ada
- ❌ Proactive follow-up (agent-initiated outreach)
- ❌ Multi-turn memory lintas sesi
- ❌ Tracking status via natural language query ke sistem nyata (saat ini hanya statis)

**Gap utama:** Agent reaktif saja. Belum bisa inisiasi follow-up otomatis, cek dokumen kurang, atau push update tracking ke customer tanpa trigger manual.

---

### B. Vendor AI Agent

**Kondisi saat ini:**
- ✅ `orderNotification.ts` — WA/email blast ke vendor saat RFQ
- ✅ `vmfGapNotifier.ts` — daily check stalled VMF, kirim digest WA ke admin
- ✅ `vendorMiniForm.ts` — tokenized form untuk vendor submission
- ✅ `vendorPerformance.ts` — KPI tracking vendor ada
- ✅ `vendor_rates` table — historical pricing per mode/route
- ❌ AI yang bisa baca respons vendor dan ekstrak data secara otomatis dari email bebas
- ❌ SLA monitoring real-time dengan prediktif alert
- ❌ Auto-follow-up bertingkat (reminder 1x, 2x, escalate)
- ❌ Vendor reliability scoring berbasis AI

**Gap utama:** Notifikasi ke vendor sudah ada, tapi follow-up masih manual. Tidak ada mekanisme AI yang membaca balasan vendor email bebas (non-form) dan mengekstraknya ke sistem.

---

### C. Operational AI Agent

**Kondisi saat ini:**
- ✅ `intelligenceAlerts.ts` — geofence-based alerts
- ✅ `activityLog.ts` — full order timeline
- ✅ `freight.ts` — tracking stage per shipment
- ✅ `dashboard.ts` — aggregated operational data
- ❌ Bottleneck detection (misal: vendor X selalu lambat di stage customs)
- ❌ Anomaly detection lintas order (pattern overdue)
- ❌ Escalation recommendation engine
- ❌ Predictive delay alert sebelum SLA breach

**Gap utama:** Data sudah cukup kaya untuk anomaly detection, tapi belum ada engine yang menganalisis pola secara otomatis dan merekomendasikan tindakan.

---

### D. Customs AI Agent

**Kondisi saat ini:**
- ✅ `scanDocument.ts` — ekstraksi data PIB/PEB dengan 50+ field (hsCode, taxAmount, consignee, dll)
- ✅ Schema freight shipment mencakup customs stage
- ❌ HS code validation (cross-check database tarif)
- ❌ Document completeness checklist otomatis
- ❌ CEISA API integration
- ❌ AI yang bisa detect inconsistency antar dokumen

**Gap utama:** OCR customs sudah sangat kuat. Yang kurang adalah validasi lanjutan (apakah data yang diekstrak konsisten dengan aturan CEISA/DJBC) dan checklist compliance otomatis.

---

### E. Finance AI Agent

**Kondisi saat ini:**
- ✅ `accounting.ts` — full double-entry, COA, journals, payments
- ✅ `expenses.ts` — operational cost tracking
- ✅ `reports.ts` — financial reporting
- ✅ `marginRules.ts` — markup automation
- ❌ Invoice aging analysis dengan AI-driven reminder
- ❌ Profitability per route/vendor/customer analysis AI
- ❌ Cash flow anomaly detection
- ❌ Payment pattern prediction

**Gap utama:** Accounting data sangat kaya dan double-entry sudah berjalan otomatis. Yang kurang adalah lapisan analitik AI di atasnya untuk payment prediction dan anomaly detection cost.

---

## BAGIAN 2 — AI ORCHESTRATION LAYER

### Kondisi Saat Ini
Saat ini tidak ada orchestration layer formal. Setiap "AI workflow" berjalan independen:
- `aiOrderIntake.ts` dipanggil dari webhook/IMAP poller
- `aiAgent.ts` dipanggil dari HTTP endpoint
- `vmfGapNotifier.ts` berjalan via setInterval
- `orderNotification.ts` dipanggil manual dari route handlers

### Rekomendasi Arsitektur Orchestration

```
┌─────────────────────────────────────────────────────┐
│              AI WORKFLOW ROUTER                     │
│  Input: event type + context                        │
│  Output: agent assignment + task queue              │
└──────────┬──────────┬──────────┬───────────┬────────┘
           │          │          │           │
    Customer    Vendor    Ops     Customs   Finance
     Agent      Agent    Agent    Agent     Agent
           │          │          │           │
└─────────────────────────────────────────────────────┐
│              SHARED CONTEXT LAYER                   │
│  - Order state                                      │
│  - Active tasks per order                           │
│  - Agent execution history                          │
│  - Human approval queue                             │
└─────────────────────────────────────────────────────┘
```

**Komponen yang perlu dibangun:**

| Komponen | Deskripsi | Priority |
|----------|-----------|----------|
| `AgentTaskQueue` | Queue berbasis DB untuk task agent, dengan status (pending/running/done/failed) | HIGH |
| `AgentRouter` | Menerima event, memilih agent yang tepat, inject context | HIGH |
| `AgentExecutionLog` | Tabel `ai_agent_executions` — log setiap tindakan agent, alasan, dan output | HIGH |
| `HumanApprovalBoundary` | Semua action Level 3+ perlu approval token dari staff | CRITICAL |
| `ContextShareLayer` | Shared memory ringan per order/vendor/customer yang bisa diakses semua agent | MEDIUM |
| `AgentMemoryBoundary` | Setiap agent hanya bisa read/write ke scope datanya sendiri (permission-aware) | HIGH |

---

## BAGIAN 3 — ENTERPRISE MEMORY SYSTEM

### Kondisi Saat Ini

| Memory Type | Status | Keterangan |
|-------------|--------|------------|
| Order activity log | ✅ Ada | `activityLog.ts` — full event timeline per order |
| System audit log | ✅ Ada | `auditLog.ts` — CRUD + old/new data JSONB |
| Chat session memory | ✅ Ada | `ai_chat_sessions` + `ai_chat_messages` |
| Vendor pricing history | ✅ Ada | `vendor_rates` + `logistic_order_quotes` |
| AI intake log | ✅ Ada | `wa_ai_intake_log` |
| Knowledge base | ✅ Ada | `chatbot_knowledge_base` — manual rules |
| Long-term semantic memory | ❌ Tidak ada | Perlu vector DB |
| Customer preference memory | ❌ Tidak ada | Pola order, preferensi rute, cargo type |
| Operational anomaly memory | ❌ Tidak ada | Pattern delay, vendor SLA breach history |
| Pricing intelligence | 🟡 Parsial | Data ada di DB, belum ada retrieval semantik |

### Rekomendasi Memory Architecture

**Jangka pendek (tanpa vector DB):**
Gunakan PostgreSQL full-text search + trgm (sudah ada `pg_trgm` migration!) sebagai retrieval engine untuk knowledge base dan vendor history. Ini cukup untuk 80% use case.

**Jangka menengah (6-12 bulan):**
Tambahkan tabel `embedding_cache` — simpan OpenAI embedding untuk dokumen, knowledge base, dan vendor notes. Gunakan `pgvector` extension PostgreSQL (tersedia di Supabase/Neon). Tidak perlu pindah ke vector DB eksternal.

**Retensi policy:**
- Chat messages: 90 hari aktif, 1 tahun archive
- Activity log: permanen
- AI agent execution log: 2 tahun
- Embedding cache: regenerate saat source berubah

---

## BAGIAN 4 — PREDICTIVE INTELLIGENCE READINESS

### Data Quality Assessment

| Kapabilitas Prediktif | Data Tersedia? | Volume Cukup? | Kualitas? |
|----------------------|---------------|---------------|-----------|
| ETA prediction | 🟡 Parsial | Perlu 6+ bulan history | `estimatedDelivery` ada tapi tidak selalu diisi |
| Delay prediction | 🟡 Parsial | `activityLog` ada event timestamps | Perlu label "delayed" vs "on-time" |
| Quote win prediction | ✅ Ada | `logistic_order_quotes` + `quoteStatus` | Baik — history approval/rejection tersedia |
| Vendor reliability | ✅ Ada | `vendorPerformance.ts` + quote history | KPI sudah ditrack |
| Pricing prediction | ✅ Ada | `vendor_rates` + historical quotes | Baik — data per route/mode ada |
| Operational risk | 🟡 Parsial | `intelligenceAlerts` + geofence | Perlu enrichment dari delay patterns |

### Catatan Penting
Sebelum membangun prediction models, perlu **data quality pass**:
1. Pastikan `estimatedDelivery` vs `actualDelivery` diisi konsisten
2. Tambahkan `actual_pickup_date` dan `actual_delivery_date` di shipments
3. Label setiap order yang overdue secara retroaktif

---

## BAGIAN 5 — AUTONOMOUS EXECUTION READINESS

### Maturity Level Framework

```
Level 1: AI recommendation only
Level 2: AI-assisted execution (staff tetap confirm)
Level 3: Human-approved autonomous execution (approve sekali, AI execute)
Level 4: Semi-autonomous (AI execute, notify hasil)
Level 5: Fully autonomous (edge cases saja ke manusia)
```

### Current Automation Inventory

| Workflow | Level Saat Ini | Target | Catatan |
|----------|---------------|--------|---------|
| Vendor RFQ blast | Level 2 | Level 3 | Sudah otomatis, tapi vendor selection masih manual |
| Draft quotation dari email/WA | Level 2 | Level 3 | `aiOrderIntake` sudah buat draft, staff masih approve |
| Customer approval classification | Level 2 | Level 3 | AI classifies, staff masih lihat manual |
| Stalled order alert | Level 2 | Level 3 | `vmfGapNotifier` sudah kirim alert, tapi tindakan manual |
| Document data extraction | Level 3 | Level 4 | AI ekstrak, staff validasi cepat |
| POD verification | Level 3 | Level 4 | AI verify, auto-flag jika mismatch |
| Vendor follow-up reminder | Level 1 | Level 3 | Hanya notif manual saat ini |
| Auto-assign vendor | Level 1 | Level 3 | Perlu scoring engine + approval |
| Invoice payment reminder | Level 1 | Level 3 | Data ada, belum ada automation |
| Anomaly escalation | Level 1 | Level 3 | Belum ada engine |

### Human Approval Boundary Design
```
SEMUA autonomous execution Level 3+ WAJIB melalui:
1. Confidence threshold check (AI confidence < 85% → ke human)
2. Amount threshold (> Rp 50jt → selalu human approve)
3. New entity check (vendor/customer baru → selalu human)
4. Audit trail wajib sebelum execute
5. Satu-klik undo dalam 30 menit untuk setiap autonomous action
```

---

## BAGIAN 6 — KNOWLEDGE & INTELLIGENCE GRAPH

### Kondisi Saat Ini
Relasi data sudah kaya tapi tersebar di tabel relasional terpisah. Tidak ada graph traversal saat ini.

### Graph yang Bisa Dibangun dari Data yang Ada

**Shipment Relationship Graph:**
`customer → sales_document → logistic_order → rfq → vendor_quote → vendor → shipment → driver`
Semua relasi FK sudah ada. Perlu query layer yang bisa traverse dan aggregate.

**Vendor Performance Graph:**
`vendor → routes_served → quote_history → win_rate → avg_margin → sla_score`
Data ada di `vendor_rates`, `logistic_order_quotes`, `vendorPerformance`.

**Customer Behavior Graph:**
`customer → order_frequency → preferred_routes → preferred_modes → avg_order_value`
Data ada di `logistic_orders`, `sales_documents`, `customers`.

**Rekomendasi:** Mulai dengan materialized views PostgreSQL untuk graph-like queries. Vector DB dan graph DB (Neo4j dll) tidak diperlukan di fase awal.

---

## BAGIAN 7 — ENTERPRISE COMMAND CENTER

### Kondisi Saat Ini
- ✅ `dashboard.ts` — aggregated metrics
- ✅ `reports.ts` — financial reports
- ✅ `intelligenceAlerts.ts` — geofence alerts
- ✅ `notifications.ts` — SSE + web push
- 🟡 Realtime: SSE infrastructure ada, belum di semua modul
- ❌ Unified operational alert center (semua alert dalam satu surface)
- ❌ AI insight center (pattern, rekomendasi proaktif)
- ❌ Executive analytics (cross-module KPI rollup)
- ❌ SLA breach monitoring real-time

### Rekomendasi
Bangun "Intelligence Hub" sebagai tab di BizPortal dashboard:
1. **Alert Feed** — agregasi semua alerts (geofence + stalled + overdue + anomaly)
2. **AI Insight Cards** — 3-5 rekomendasi AI setiap hari (generated batch, bukan real-time)
3. **SLA Heatmap** — per vendor, per route, per mode
4. **Executive Scorecard** — revenue, margin, order volume, vendor KPI

---

## BAGIAN 8 — AI GOVERNANCE & SAFETY

### Kondisi Saat Ini
- ✅ `auditLog.ts` — system-wide audit dengan old/new data
- ✅ `activityLog.ts` — order timeline
- ✅ Bearer token + session auth (trust boundary jelas)
- ✅ `requireAdmin` + role-based access
- ✅ Rate limiting pada bearer requests
- ❌ AI-specific audit trail (tidak bisa track "AI made this decision because...")
- ❌ Confidence score logging
- ❌ Human override record
- ❌ AI hallucination prevention layer (prompt validation, output schema enforcement)
- ❌ Compliance logging terpisah untuk AI decisions

### Framework AI Governance yang Direkomendasikan

```
Setiap AI action harus log:
{
  agentType: "customer|vendor|ops|customs|finance",
  action: "create_quote|send_reminder|classify_document|...",
  confidence: 0.92,
  reasoning: "vendor X memiliki win rate 78% di rute ini",
  inputTokens: 1240,
  outputTokens: 180,
  humanApprovalRequired: true,
  humanApprovedBy: "user_id | null",
  humanApprovedAt: "timestamp | null",
  wasOverridden: false,
  orderId: "...",
  safetyChecks: ["amount_below_threshold", "not_new_entity"]
}
```

**Hallucination Prevention:**
- Semua AI output yang menyentuh DB harus melalui Zod schema validation (sudah ada Zod di stack)
- Gunakan structured output / JSON mode OpenAI — jangan parse free text ke DB
- Confidence threshold: output di bawah 70% tidak dieksekusi, masuk human queue

---

## BAGIAN 9 — GLOBAL ENTERPRISE READINESS

### Kondisi Saat Ini

| Kapabilitas | Status | Keterangan |
|-------------|--------|------------|
| Multi-currency | 🟡 Parsial | `accounting.ts` ada, belum ada FX rate layer |
| Multi-language AI | 🟡 Parsial | AI order intake sudah handle Bahasa Indonesia |
| Multi-country customs | 🟡 Parsial | `scanDocument.ts` handle PIB/PEB, belum multi-country |
| Timezone-aware | 🟡 Parsial | Timestamps ada, belum ada TZ-aware workflow scheduling |
| Multi-company | ✅ Ada | `companyId` di semua tabel, multi-tenant ready |
| Regional compliance | ❌ Tidak ada | Hanya Indonesia saat ini |

---

## OUTPUT WAJIB

---

### A. AI AGENT READINESS MATRIX

| Agent | Current Readiness | Missing Layer | Priority |
|-------|------------------|---------------|----------|
| **Customer AI Agent** | 55% — reactive chatbot + email parsing ada | Proactive follow-up engine, cross-session memory, document request automation | HIGH |
| **Vendor AI Agent** | 40% — RFQ blast + VMF form ada | Email parsing free-form vendor reply, SLA monitoring AI, auto follow-up bertingkat | HIGH |
| **Operational AI Agent** | 30% — geofence alert + activity log ada | Bottleneck detection, anomaly pattern engine, escalation recommender | MEDIUM |
| **Customs AI Agent** | 65% — OCR PIB/PEB sangat kuat | HS code validation DB, document consistency checker, CEISA integration | MEDIUM |
| **Finance AI Agent** | 25% — accounting data kaya tapi tidak ada AI layer | Invoice aging AI, payment predictor, profitability AI, cost anomaly engine | LOW-MEDIUM |

---

### B. AUTONOMOUS EXECUTION MATRIX

| Workflow | Level Sekarang | Level Target | Human Approval? | Risk |
|----------|---------------|-------------|-----------------|------|
| Vendor RFQ blast otomatis | L2 | L3 | Ya — vendor selection approve | LOW |
| Draft quote dari email/WA | L2 | L3 | Ya — amount > threshold | LOW |
| Customer approval classification | L2 | L3 | Tidak — read-only classify | LOW |
| Stalled order follow-up | L2 | L3 | Tidak — hanya notifikasi | LOW |
| POD verification | L3 | L4 | Tidak — flag saja jika gagal | LOW |
| Auto-assign vendor terbaik | L1 | L3 | Ya — selalu approve first | MEDIUM |
| Invoice payment reminder | L1 | L3 | Tidak — hanya WA/email | LOW |
| Auto-close completed order | L1 | L3 | Ya — kondisi tertentu | MEDIUM |
| Anomaly escalation | L1 | L3 | Tidak — alert saja | LOW |
| Auto-generate recurring quote | L1 | L4 | Ya — customer existing saja | HIGH |

---

### C. ENTERPRISE MEMORY READINESS

| Memory Type | Data Availability | AI Ready? | Missing Component |
|-------------|------------------|-----------|-------------------|
| Order activity timeline | ✅ Lengkap | ✅ Ya | — |
| Vendor pricing history | ✅ Lengkap | 🟡 Parsial | Semantic retrieval layer |
| Customer order pattern | 🟡 Ada tapi tidak ter-aggregate | ❌ Belum | Materialized view + embedding |
| Chat session memory | ✅ Ada | 🟡 Parsial | Cross-session context aggregation |
| Operational anomaly memory | ❌ Tidak ada | ❌ Belum | Anomaly detection + storage schema |
| Shipment intelligence | 🟡 Parsial | ❌ Belum | ETA vs actual tracking, label dataset |
| Pricing intelligence | ✅ Ada | 🟡 Parsial | Trend analysis layer |
| Knowledge base | ✅ Ada (manual) | ✅ Ya | Auto-learning dari resolved cases |

---

### D. PREDICTIVE INTELLIGENCE READINESS

| Capability | Data Quality | Model Readiness | Risk |
|-----------|-------------|-----------------|------|
| Pricing prediction (route-based) | ✅ BAIK — vendor_rates kaya | Siap untuk GPT-assisted | LOW |
| Quote win prediction | ✅ BAIK — approval/rejection history ada | Siap untuk logistic regression | LOW |
| Vendor reliability prediction | ✅ BAIK — vendorPerformance + quote history | Siap untuk scoring model | LOW |
| ETA prediction | 🟡 CUKUP — perlu actual vs estimated filling | 3-6 bulan data bersih | MEDIUM |
| Delay prediction | 🟡 CUKUP — perlu label retroaktif | 3-6 bulan data bersih | MEDIUM |
| Operational risk prediction | ❌ KURANG — anomaly data belum ada | Perlu 6+ bulan history | HIGH |
| Cash flow prediction | 🟡 CUKUP — accounting data ada | Butuh payment pattern analysis | MEDIUM |

---

### E. AI GOVERNANCE READINESS

| Area | Current Safety | Missing Protection | Recommendation |
|------|---------------|-------------------|----------------|
| AI audit trail | 🟡 Parsial (system audit ada, AI-specific tidak) | AI-specific execution log dengan reasoning | Buat tabel `ai_agent_executions` |
| Human approval boundary | 🟡 Parsial (auth ada, AI boundary tidak formal) | Formal threshold rules + approval token | Buat `ai_approval_rules` config table |
| Explainable AI | ❌ Tidak ada | Reasoning field di setiap AI output | Enforce structured output + log reasoning |
| Hallucination prevention | 🟡 Parsial (Zod ada, belum di AI output path) | Output schema validation sebelum DB write | Zod parse semua AI JSON output |
| Human override | ❌ Tidak ada | One-click undo untuk AI actions | Soft-delete + undo window 30 menit |
| Compliance logging | 🟡 Parsial (auditLog ada) | AI-specific compliance report | Extend auditLog dengan `ai_triggered` flag |
| Confidence thresholding | ❌ Tidak ada | Minimum confidence sebelum execute | Tambahkan `minConfidence` per workflow config |

---

### F. ENTERPRISE EVOLUTION SCORE

```
┌─────────────────────────────────────────────────────────────────┐
│  BIZPORTAL AI MATURITY SCORECARD                                │
├──────────────────────────────┬──────────┬───────────────────────┤
│  Dimensi                     │  Score   │  Level                │
├──────────────────────────────┼──────────┼───────────────────────┤
│  AI Maturity                 │  2.2/5   │  ██░░░  Emerging      │
│  Orchestration Maturity      │  1.0/5   │  █░░░░  Foundational  │
│  Operational Intelligence    │  2.5/5   │  ██░░░  Developing    │
│  Autonomous Readiness        │  1.5/5   │  █░░░░  Early Stage   │
│  Data Foundation             │  3.5/5   │  ███░░  Strong        │
│  Governance & Safety         │  2.0/5   │  ██░░░  Basic         │
│  Memory & Context            │  1.8/5   │  █░░░░  Limited       │
├──────────────────────────────┼──────────┼───────────────────────┤
│  OVERALL AI ENTERPRISE SCORE │  2.1/5   │  ██░░░  EMERGING AI   │
└──────────────────────────────┴──────────┴───────────────────────┘

Kekuatan terbesar: Data Foundation (schema kaya, relasi lengkap, audit ada)
Gap terbesar: Orchestration Layer (tidak ada, harus dibangun dari nol)
Quick win terbesar: Finance AI Agent (data lengkap, belum disentuh AI)
```

---

### G. FINAL STRATEGIC RECOMMENDATION

---

## PHASE 1 — Operational Intelligence (Q3 2026, 3 bulan)
**Tujuan:** Buat semua data yang ada "AI-queryable"

Deliverables:
- [ ] Materialized views untuk customer behavior, vendor performance, shipment patterns
- [ ] Tabel `ai_agent_executions` — fondasi governance log
- [ ] Tabel `ai_approval_queue` — human-in-the-loop boundary
- [ ] Upgrade `intelligenceAlerts.ts` → unified Alert Feed di dashboard
- [ ] Isi gap data: `actual_pickup_date`, `actual_delivery_date` di shipments
- [ ] Finance AI Agent MVP: invoice aging report + payment reminder otomatis

**Ukuran sukses:** Staff bisa lihat semua alert dalam satu feed. Finance reminder berjalan otomatis.

---

## PHASE 2 — AI-Assisted Workflow (Q4 2026, 3 bulan)
**Tujuan:** Naikkan semua workflow yang ada dari Level 2 ke Level 3

Deliverables:
- [ ] Vendor free-form email parsing (extend `aiOrderIntake.ts` untuk vendor replies)
- [ ] Auto-vendor scoring + recommender (berdasarkan win rate + SLA + harga)
- [ ] Customer proactive follow-up engine (belum approve 48 jam → AI draft WA/email)
- [ ] Anomaly detection MVP: order overdue pattern + alert ke ops
- [ ] Governance layer: Zod validation semua AI JSON output, confidence thresholding
- [ ] `pgvector` di PostgreSQL untuk semantic knowledge base search

**Ukuran sukses:** 50% kurang intervensi manual di RFQ-to-quote flow.

---

## PHASE 3 — AI Operational Agents (Q1 2027, 4 bulan)
**Tujuan:** Deploy agent pertama yang bisa execute dengan human approval sekali

Deliverables:
- [ ] `AgentRouter` — event-driven orchestration (event → agent assignment)
- [ ] Customer AI Agent full: proactive follow-up + document checklist + status update
- [ ] Vendor AI Agent full: multi-tier follow-up + SLA breach alert + reliability scoring
- [ ] Customs AI Agent: document consistency checker + HS code DB validation
- [ ] Human approval boundary UI di BizPortal (inbox approval untuk AI actions)
- [ ] AI audit trail dashboard untuk management

**Ukuran sukses:** Customer AI Agent bisa handle 80% inquiry awal tanpa staff.

---

## PHASE 4 — Semi-Autonomous Operations (Q2–Q3 2027, 6 bulan)
**Tujuan:** Operasi berjalan dengan AI sebagai primary executor, manusia sebagai exception handler

Deliverables:
- [ ] Auto-assign vendor (Level 4: AI assign, staff hanya reject jika mau)
- [ ] Auto-generate recurring quotes untuk customer existing
- [ ] Predictive ETA dengan alert proaktif ke customer
- [ ] Finance AI: cash flow forecasting + cost anomaly detection
- [ ] Multi-agent coordination: Customer Agent + Vendor Agent berkolaborasi per order
- [ ] Operational AI Agent: full bottleneck detection + escalation engine
- [ ] Context sharing layer: semua agent baca/tulis ke shared order context

**Ukuran sukses:** End-to-end order bisa diproses tanpa staff dari inquiry → vendor assignment → PO.

---

## PHASE 5 — AI-Native Enterprise Orchestration (2028+)
**Tujuan:** BizPortal sebagai autonomous logistics execution platform

Deliverables:
- [ ] Fully autonomous RFQ → vendor → execution untuk order standard
- [ ] Predictive demand → pre-qualification vendor otomatis
- [ ] Multi-country customs intelligence (expand dari Indonesia ke regional)
- [ ] AI workforce: agent bisa spawn sub-task ke agent lain
- [ ] Executive AI: weekly briefing otomatis ke management (anomali, peluang, risiko)
- [ ] Self-improving knowledge base: agent belajar dari resolved edge cases

**Ukuran sukses:** Staff fokus pada exception handling, relationship management, dan strategic decisions saja.

---

## REKOMENDASI TEKNOLOGI

| Kebutuhan | Rekomendasi | Alasan |
|-----------|-------------|--------|
| Vector search | `pgvector` di PostgreSQL existing | Tidak perlu infra baru, sudah Supabase-compatible |
| Orchestration | Custom `AgentRouter` di api-server | Kontrol penuh, tidak perlu vendor lock-in |
| Agent memory | PostgreSQL JSONB + pgvector | Data sudah di sini |
| LLM | GPT-4o via Replit AI Integration (sudah ada) | Sudah dikonfigurasi, tidak perlu key baru |
| Streaming AI response | SSE infrastructure sudah ada | Tinggal pakai |
| Task queue | PostgreSQL-backed (seperti pola migration sekarang) | Tidak perlu Redis/BullMQ dulu |

---

## CATATAN AKHIR

BizPortal sudah punya **fondasi data terkuat** yang bisa saya lihat dari codebase logistics system di ukuran ini. Double-entry accounting, full lifecycle order tracking, vendor KPI, multi-channel notification, dan audit trail — semua sudah ada. Yang kurang bukan data, tapi **lapisan orchestrasi dan governance** yang menghubungkan dot-dot tersebut menjadi sistem AI yang kohesif.

**Prioritas absolut sebelum naik ke Phase 2:**
1. Buat `ai_agent_executions` table — tanpa ini, AI governance tidak bisa dimulai
2. Isi gap data aktual (actual delivery dates)
3. Validasi Zod untuk semua AI JSON output

Dengan eksekusi Phase 1 yang solid, BizPortal bisa mencapai Level 4 autonomous dalam 18–24 bulan.

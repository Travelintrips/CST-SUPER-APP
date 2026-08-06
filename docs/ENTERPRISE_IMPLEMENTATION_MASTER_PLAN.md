# ENTERPRISE IMPLEMENTATION MASTER PLAN

**Versi:** 1.0  
**Tanggal:** 2026-08-06  
**Status:** DRAFT — Menunggu Review dan Approval  
**Fase:** IMPLEMENTATION-MASTER-PLAN-01

## Referensi Resmi (FINAL — JANGAN DIUBAH)

| Dokumen | Path |
|---|---|
| Vendor Architecture Blueprint | `docs/enterprise-marketplace-blueprint-v1.2.md` |
| Enterprise Master Blueprint | `docs/ENTERPRISE_MASTER_BLUEPRINT.md` |
| Architecture Decision Records | `ARCHITECTURE_DECISIONS.md` |
| AI Architecture Guardrails | `AI_ARCHITECTURE_GUARDRAILS.md` |
| AI Rules | `AI_RULES.md` |

> **ATURAN:** Dokumen ini adalah backlog resmi proyek.
> Seluruh pekerjaan berikutnya WAJIB mengacu pada dokumen ini.
> Jangan mengubah Blueprint. Jangan coding tanpa approval fase implementasi yang relevan.

---

## Daftar Isi

1. [Master Backlog](#1-master-backlog)
2. [Implementation Roadmap](#2-implementation-roadmap)
3. [Module Breakdown](#3-module-breakdown)
4. [Dependency Graph](#4-dependency-graph)
5. [Sprint Planning](#5-sprint-planning)
6. [Testing Matrix](#6-testing-matrix)
7. [Deployment Plan](#7-deployment-plan)
8. [Rollback Plan](#8-rollback-plan)
9. [Go Live Checklist](#9-go-live-checklist)
10. [Risk Register](#10-risk-register)
11. [Priority Matrix](#11-priority-matrix)
12. [Complexity Matrix](#12-complexity-matrix)
13. [Timeline](#13-timeline)
14. [Milestones](#14-milestones)
15. [Acceptance Criteria](#15-acceptance-criteria)
16. [Definition of Done](#16-definition-of-done)
17. [Project Governance](#17-project-governance)
18. [Recommended Implementation Order](#18-recommended-implementation-order)
19. [Executive Summary](#19-executive-summary)
20. [Final Recommendation](#20-final-recommendation)

---

## 1. Master Backlog

### 1.1 P0 — Critical (Blocker untuk core business)

| ID | Nama Pekerjaan | Modul | Kompleksitas | Estimasi | Dependency | Risiko |
|---|---|---|---|---|---|---|
| **B01** | Marketplace P0: Migration 7 tabel (mkt_rfqs, mkt_rfq_lines, mkt_vendor_quotes, mkt_vendor_quote_lines, mkt_purchase_orders, mkt_rfq_guest_claims, mkt_activity_logs) | Marketplace | Medium | 3 hari | Schema Drizzle, Supabase runtime | Migration gagal di prod jika FK conflict |
| **B02** | Marketplace P0: Buyer RFQ API (submit, view, cancel) | Marketplace | Medium | 2 hari | B01 | - |
| **B03** | Marketplace P0: Vendor Quote API via token (view, submit, withdraw) | Marketplace | Medium | 3 hari | B01, B02 | Token expiry edge cases |
| **B04** | Marketplace P0: Admin API (invite vendor, select winner, post journal) | Marketplace | High | 3 hari | B01, B02, B03 | Commission accounting rules |
| **B05** | Marketplace P0: Guest RFQ claim setelah register | Marketplace | Medium | 2 hari | B01, B02 | Race condition saat claim |
| **B06** | Marketplace P0: Activity log di semua marketplace events | Marketplace | Low | 1 hari | B01 | - |
| **B07** | Marketplace P0: Commission journal posting ke accounting_entries | Marketplace | High | 2 hari | B04, COA, accounting_entries | Double-journal prevention (ADR-0003) |
| **B08** | Universal Approval Engine: schema (workflow_configs, approval_requests, approval_actions) | Approval | High | 3 hari | Organization, Users, Roles | Polymorphic FK design |
| **B09** | Universal Approval Engine: state machine service (submit, approve, reject, revisi, delegate) | Approval | High | 4 hari | B08 | Concurrent approval race condition |
| **B10** | Universal Approval Engine: notifikasi ke approver | Approval | Medium | 2 hari | B09, Notification | - |
| **B11** | Universal Approval Engine: API endpoint + integrasi ke Procurement PR | Approval | Medium | 3 hari | B09, B10 | - |
| **B12** | Document Management: tabel `documents` polymorphic + `document_versions` | Document | Medium | 2 hari | Storage, Company | - |
| **B13** | Document Management: upload/download API dengan access control | Document | Medium | 2 hari | B12, Auth | Signed URL expiry |
| **B14** | Document Management: migrasi dokumen existing (company_legal_documents, supplier_documents) ke tabel baru | Document | High | 3 hari | B12 | Data loss risk saat migrasi |

**Total P0: 35 hari kerja (~7 minggu, 1 developer)**

---

### 1.2 P1 — High (Business value tinggi, Q4 2026)

| ID | Nama Pekerjaan | Modul | Kompleksitas | Estimasi | Dependency | Risiko |
|---|---|---|---|---|---|---|
| **B15** | CRM: Lead management (tabel, API, UI BizPortal) | CRM | Medium | 5 hari | Customer, User | - |
| **B16** | CRM: Opportunity pipeline (tabel, API, kanban UI) | CRM | High | 7 hari | B15 | - |
| **B17** | CRM: Activity timeline per customer | CRM | Medium | 3 hari | B15, B16 | - |
| **B18** | CRM: Support ticket system | CRM | High | 5 hari | Customer, Notification | - |
| **B19** | Financial Statement Engine: Trial Balance otomatis | Finance | High | 4 hari | accounting_entries, COA | Slow query di data besar |
| **B20** | Financial Statement Engine: P&L (Income Statement) | Finance | High | 3 hari | B19 | - |
| **B21** | Financial Statement Engine: Balance Sheet (Neraca) | Finance | High | 3 hari | B19 | - |
| **B22** | Financial Statement Engine: Cash Flow Statement | Finance | High | 4 hari | B19 | Indirect vs direct method |
| **B23** | Multi-currency: Forex rate table + rate management API | Finance | Medium | 3 hari | Currency master, COA | Rate staleness |
| **B24** | Multi-currency: Conversion engine di semua transaksi | Finance | High | 5 hari | B23 | Rounding, realized/unrealized gains |
| **B25** | Procurement 3-Way Match: matching engine (PR ↔ PO ↔ GR) | Procurement | High | 5 hari | purchase_requests, purchase_documents, goods_receipts | Tolerance calculation |
| **B26** | Procurement 3-Way Match: exception queue + UI | Procurement | Medium | 3 hari | B25 | - |
| **B27** | OpenAPI 3.0 spec: semua existing endpoints | API | Medium | 5 hari | Semua route files | Drift antara spec dan kode |
| **B28** | OpenAPI 3.0 spec: auto-validation middleware | API | Medium | 2 hari | B27 | - |
| **B29** | Business Unit layer: tabel + org structure update | Organization | Medium | 3 hari | companies, divisions | FK migration kompleks |

**Total P1: 64 hari kerja (~13 minggu)**

---

### 1.3 P2 — Medium (2027 H1)

| ID | Nama Pekerjaan | Modul | Kompleksitas | Estimasi | Dependency | Risiko |
|---|---|---|---|---|---|---|
| **B30** | AI OCR: invoice dan PO document parsing | AI + Document | High | 7 hari | B13, OpenAI | Accuracy rendah = manual review lebih banyak |
| **B31** | AI Demand Forecasting: inventory + procurement | AI + Inventory | Very High | 10 hari | Inventory history, Procurement history | Model accuracy |
| **B32** | CEO/Director Analytics Dashboard: BizPortal | Analytics | High | 7 hari | Financial Statement, semua domain | Performance query |
| **B33** | Finance/Accounting Dashboard | Analytics | Medium | 5 hari | B19, B20, B21 | - |
| **B34** | Procurement/Operations Dashboard | Analytics | Medium | 5 hari | Procurement, Inventory | - |
| **B35** | Webhook outbound delivery system | Integration | Medium | 4 hari | Event system | Retry + idempotency |
| **B36** | Universal Audit Log: tabel `audit_logs` polymorphic | Security | Medium | 3 hari | Semua domain | Volume data besar |
| **B37** | Rate limiting: per endpoint type + IP | API | Low | 2 hari | Express middleware | - |
| **B38** | Request ID tracing: `X-Request-ID` semua route | API | Low | 1 hari | Express middleware | - |
| **B39** | Inventory FIFO costing engine | Inventory | High | 6 hari | stock_movements | Perubahan retroaktif mahal |
| **B40** | Vendor self-service portal: performance analytics | Marketplace | Medium | 5 hari | Marketplace P0 done | - |
| **B41** | Marketplace: Rating & Review system | Marketplace | Medium | 4 hari | mkt_purchase_orders | Abuse prevention |
| **B42** | Document expiry notification (NPWP, NIB, sertifikat) | Document + Notification | Low | 2 hari | B12, B13, Notification workers | - |

**Total P2: 61 hari kerja (~12 minggu)**

---

### 1.4 P3 — Low (2027 H2 — 2028)

| ID | Nama Pekerjaan | Modul | Kompleksitas | Estimasi | Dependency | Risiko |
|---|---|---|---|---|---|---|
| **B43** | Intercompany transactions + elimination entries | Finance | Very High | 14 hari | Multi-company, COA | Regulasi PSAK |
| **B44** | SMS channel (OTP fallback) | Notification | Low | 2 hari | SMS provider contract | Provider SLA |
| **B45** | AI Fraud Detection: payment + accounting anomaly | AI + Security | Very High | 14 hari | AI Engine, accounting_entries | False positive rate |
| **B46** | AI Smart Vendor Matching | AI + Marketplace | High | 7 hari | Vendor history, AI Engine | - |
| **B47** | Customer Churn Prediction | AI + CRM | High | 7 hari | CRM, order history | - |
| **B48** | BizPortal Mobile (React Native) | Mobile | Very High | 30 hari | API stability | Cross-platform complexity |
| **B49** | External Public API + API Marketplace | API | High | 14 hari | OpenAPI spec, Auth | Security surface |
| **B50** | OLAP / Data Warehouse integration | Analytics | Very High | 14 hari | All domains stable | Infrastructure cost |

**Total P3: 102 hari kerja (~21 minggu)**

---

## 2. Implementation Roadmap

### Phase 1 — Marketplace Foundation (Vendor Blueprint P0)
**Durasi:** 5 minggu | **Target:** Q3 2026

Mengimplementasikan seluruh alur RFQ → Quote → PO berdasarkan Vendor Blueprint v1.2 yang sudah FINAL.

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| 7 tabel P0 via migration | B01 | Minggu 1 |
| Buyer RFQ flow | B02, B05, B06 | Minggu 2 |
| Vendor Quote flow | B03 | Minggu 3 |
| Admin workflow + Commission | B04, B07 | Minggu 4 |
| Integration test + bug fix | — | Minggu 5 |

**Acceptance Criteria:** Buyer bisa submit RFQ → vendor terima notifikasi → vendor submit quote → admin pilih winner → PO terbuat → commission journal ter-post ke accounting.

---

### Phase 2 — Universal Approval Engine
**Durasi:** 3 minggu | **Target:** Q3 2026

Membangun approval engine reusable yang akan dipakai semua modul.

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| Schema + migration | B08 | Minggu 1 |
| State machine service | B09, B10 | Minggu 2 |
| API + integrasi PR Procurement | B11 | Minggu 3 |

**Acceptance Criteria:** Procurement PR bisa melalui approval flow multi-level. Approval bisa di-delegate. Notifikasi dikirim ke approver. Rejection dengan komentar berfungsi.

---

### Phase 3 — Procurement Completion
**Durasi:** 3 minggu | **Target:** Q4 2026

Melengkapi procurement loop dengan 3-way match dan integrasi approval engine.

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| 3-Way Match engine | B25 | Minggu 1–2 |
| Exception queue + UI | B26 | Minggu 2 |
| Approval Engine di PR | B11 (extend) | Minggu 3 |

**Acceptance Criteria:** GR masuk → sistem auto-match ke PO dan Invoice → jika match valid: AP posting otomatis. Jika tidak match: masuk exception queue untuk Finance review.

---

### Phase 4 — Finance Integration
**Durasi:** 4 minggu | **Target:** Q4 2026

Melengkapi modul Finance dengan Financial Statement otomatis dan Document Management.

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| Trial Balance otomatis | B19 | Minggu 1 |
| P&L + Balance Sheet | B20, B21 | Minggu 2 |
| Cash Flow Statement | B22 | Minggu 3 |
| Document Management foundation | B12, B13 | Minggu 4 |

**Acceptance Criteria:** Finance bisa generate P&L dan Balance Sheet untuk periode apapun langsung dari accounting entries. Dokumen bisa diupload dan di-download dengan access control.

---

### Phase 5 — Document Management & AI OCR
**Durasi:** 4 minggu | **Target:** Q4 2026 — Q1 2027

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| Migrasi dokumen existing | B14 | Minggu 1 |
| Document expiry + notifikasi | B42 | Minggu 1 |
| AI OCR: invoice parsing | B30 (partial) | Minggu 2–3 |
| AI OCR: PO parsing | B30 (full) | Minggu 4 |

**Acceptance Criteria:** User bisa upload invoice → OCR mengekstrak tanggal, nominal, vendor, nomor dokumen → pre-fill form → user konfirmasi.

---

### Phase 6 — Inventory Completion
**Durasi:** 3 minggu | **Target:** Q1 2027

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| FIFO costing engine | B39 | Minggu 1–2 |
| Inventory valuation report | B39 (extend) | Minggu 3 |

---

### Phase 7 — CRM
**Durasi:** 5 minggu | **Target:** Q1 2027

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| Lead management | B15 | Minggu 1 |
| Opportunity pipeline | B16 | Minggu 2–3 |
| Activity timeline | B17 | Minggu 3 |
| Support ticket system | B18 | Minggu 4–5 |

---

### Phase 8 — Analytics & Reporting
**Durasi:** 5 minggu | **Target:** Q2 2027

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| Finance dashboard | B33 | Minggu 1 |
| CEO/Director dashboard | B32 | Minggu 2–3 |
| Procurement/Operations dashboard | B34 | Minggu 4 |
| Vendor analytics | B40 | Minggu 5 |

---

### Phase 9 — AI Engine
**Durasi:** 7 minggu | **Target:** Q2–Q3 2027

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| AI Demand Forecasting | B31 | Minggu 1–3 |
| Smart Vendor Matching | B46 | Minggu 4–5 |
| Anomaly Detection (Accounting) | B45 (partial) | Minggu 6–7 |

---

### Phase 10 — Enterprise Integration & Governance
**Durasi:** 4 minggu | **Target:** Q3 2027

| Deliverable | Backlog Items | Waktu |
|---|---|---|
| OpenAPI 3.0 spec + validation | B27, B28 | Minggu 1–2 |
| Webhook outbound system | B35 | Minggu 3 |
| Universal Audit Log | B36 | Minggu 3 |
| Rate limiting + Request ID tracing | B37, B38 | Minggu 4 |

---

## 3. Module Breakdown

### 3.1 Marketplace (Phase 1)

| Layer | Item | Detail |
|---|---|---|
| **Database** | 7 tabel baru | mkt_rfqs, mkt_rfq_lines, mkt_vendor_quotes, mkt_vendor_quote_lines, mkt_purchase_orders, mkt_rfq_guest_claims, mkt_activity_logs |
| **Database** | 1 kolom baru di existing | `purchase_documents.mkt_purchase_order_id` |
| **API** | Buyer routes | `POST /marketplace/rfq`, `GET /marketplace/rfq/:id`, `POST /marketplace/rfq/:id/cancel` |
| **API** | Vendor routes | `GET /vendor/rfq/:token`, `POST /vendor/rfq/:token/quote`, `POST /vendor/quote/:token/withdraw` |
| **API** | Admin routes | `POST /admin/marketplace/rfq/:id/invite`, `POST /admin/marketplace/quotes/:id/select-winner`, `POST /admin/purchase-orders/:id/post-journal` |
| **Frontend** | BizPortal | RFQ management, vendor invite, quote comparison, PO management |
| **Frontend** | Customer Portal | RFQ submission form, tracking status |
| **Testing** | Unit | Commission calculation, journal reuse engine, state transitions |
| **Testing** | Integration | Full RFQ → PO → journal flow |
| **Testing** | E2E | Buyer submit → vendor quote → admin select → PO created |
| **Documentation** | Update | `docs/enterprise-marketplace-blueprint-v1.2.md` — sudah ada |
| **Deployment** | Migration | Run via startup runtime migrations (pattern existing) |

---

### 3.2 Universal Approval Engine (Phase 2)

| Layer | Item | Detail |
|---|---|---|
| **Database** | `approval_workflow_configs` | document_type, company_id, level_count, amount_thresholds |
| **Database** | `approval_requests` | entity_type (polymorphic), entity_id, current_level, status, created_by |
| **Database** | `approval_actions` | request_id, actor_id, action, comment, delegated_to, created_at |
| **API** | Core | `POST /approvals/:type/:id/submit`, `/approve`, `/reject`, `/revise`, `/delegate` |
| **API** | Query | `GET /approvals/pending` (per user), `GET /approvals/:type/:id/history` |
| **Service** | ApprovalEngine | State machine service, routing rules, timeout escalation |
| **Frontend** | BizPortal | Approval inbox, history, delegate UI |
| **Testing** | Unit | State transitions, routing logic, concurrent approval |
| **Testing** | Integration | PR full approval flow, COA change flow |

---

### 3.3 Finance Module (Phase 4)

| Layer | Item | Detail |
|---|---|---|
| **Service** | TrialBalanceService | Period-based aggregation dari accounting_entry_lines |
| **Service** | IncomeStatementService | Revenue - COGS - Opex per periode |
| **Service** | BalanceSheetService | Assets = Liabilities + Equity (snapshot date) |
| **Service** | CashFlowService | Operating + Investing + Financing activities |
| **API** | Financial Reports | `GET /finance/trial-balance?from&to&company_id`, `/income-statement`, `/balance-sheet`, `/cash-flow` |
| **Frontend** | BizPortal | Financial report viewer, period selector, export PDF/Excel |
| **Testing** | Unit | Balance sheet equation (Assets = Liabilities + Equity) |
| **Testing** | Integration | Full accounting cycle → report match |

---

### 3.4 CRM Module (Phase 7)

| Layer | Item | Detail |
|---|---|---|
| **Database** | `crm_leads` | source, status, assigned_to, company_id |
| **Database** | `crm_opportunities` | lead_id, stage, estimated_value, close_date |
| **Database** | `crm_activities` | entity_type (polymorphic), type (call/email/meeting), notes |
| **Database** | `crm_tickets` | customer_id, subject, status, priority, assigned_to |
| **API** | Leads | Full CRUD + status transitions |
| **API** | Opportunities | Kanban stage management, pipeline view |
| **API** | Tickets | Create, assign, resolve, escalate |
| **Frontend** | BizPortal | Lead list, opportunity kanban, customer 360, ticket queue |
| **Testing** | Unit | Lead qualification rules, opportunity scoring |
| **Testing** | E2E | Lead → Opportunity → Quotation (linked to sales_documents) |

---

## 4. Dependency Graph

```
[ B01 ] Marketplace DB Migration
    │
    ├──► [ B02 ] Buyer RFQ API
    │         │
    │         ├──► [ B05 ] Guest Claim
    │         └──► [ B06 ] Activity Log
    │
    ├──► [ B03 ] Vendor Quote API
    │
    └──► [ B04 ] Admin API
              │
              └──► [ B07 ] Commission Journal
                        │
                        └── Requires: COA, accounting_entries, ADR-0003

[ B08 ] Approval Schema
    │
    └──► [ B09 ] Approval State Machine
              │
              ├──► [ B10 ] Approval Notification
              └──► [ B11 ] Approval API + PR Integration

[ B12 ] Document Schema
    │
    └──► [ B13 ] Document API
              │
              ├──► [ B14 ] Migrate Existing Docs
              └──► [ B42 ] Expiry Notification
                        │
                        └──► [ B30 ] AI OCR Pipeline

[ B19 ] Trial Balance
    │
    ├──► [ B20 ] P&L
    ├──► [ B21 ] Balance Sheet
    └──► [ B22 ] Cash Flow

[ B15 ] CRM Lead
    │
    └──► [ B16 ] CRM Opportunity
              │
              └──► [ B17 ] Activity Timeline
                        │
                        └──► [ B18 ] Support Ticket

[ B25 ] 3-Way Match Engine
    │
    └──► [ B26 ] Exception Queue

[ B32, B33, B34 ] Dashboards
    │   (depend on: B19, B20, B21, B25, Marketplace, CRM all done)

[ B31, B46 ] AI Engine
    (depend on: all domain data stable)

[ B27, B28 ] OpenAPI Spec
    (depend on: all API routes stable)

[ B35, B36, B37, B38 ] Integration Governance
    (depend on: B27, B28)
```

**Topological order (no circular deps):**
```
Level 0: Auth, Organization, COA (existing — sudah production)
Level 1: B01 (Marketplace DB)
Level 2: B02, B03, B08, B12 (independent setelah Level 1)
Level 3: B04, B05, B06, B09, B13 
Level 4: B07, B10, B11, B14, B19, B25
Level 5: B15, B20, B21, B22, B26, B27, B30, B42
Level 6: B16, B32, B33, B34
Level 7: B17, B31, B35, B36, B46
Level 8: B18, B47, B50
```

---

## 5. Sprint Planning

> Sprint = 2 minggu. Kapasitas = 1 developer × 10 hari × 8 SP/hari = 80 SP per sprint.
> Story Point reference: 1 SP ≈ 1 jam focused work.

### Sprint 1 (Minggu 1–2): Marketplace DB + Buyer Flow
**Target:** Tabel P0 + Buyer RFQ API berjalan

| Task | SP | Owner |
|---|---|---|
| B01: 7 tabel migration | 24 | Backend |
| B02: Buyer RFQ API | 16 | Backend |
| B06: Activity Log hooks | 8 | Backend |
| B05: Guest Claim | 16 | Backend |
| Unit test: B01, B02 | 16 | QA |
| **Total** | **80 SP** | |

**Risiko:** Migration FK conflict dengan existing tables → mitigation: test di dev dulu
**Deliverable:** `POST /marketplace/rfq` berjalan, RFQ tersimpan, activity log tercatat

---

### Sprint 2 (Minggu 3–4): Vendor Quote + Admin
**Target:** Vendor bisa submit quote, admin bisa invite dan pilih winner

| Task | SP | Owner |
|---|---|---|
| B03: Vendor Quote API | 24 | Backend |
| B04: Admin API | 24 | Backend |
| B07: Commission Journal | 16 | Backend |
| Integration test: full RFQ flow | 16 | QA |
| **Total** | **80 SP** | |

**Risiko:** ADR-0003 (journal reuse) harus diimplementasi dengan benar → mitigation: checklist pre-PR
**Deliverable:** Full RFQ → Quote → PO → Journal flow berjalan di dev

---

### Sprint 3 (Minggu 5): Marketplace BizPortal UI + Bug Fix
**Target:** BizPortal Marketplace UI, E2E test, siap internal QA

| Task | SP | Owner |
|---|---|---|
| BizPortal: RFQ management page | 20 | Frontend |
| BizPortal: Quote comparison view | 16 | Frontend |
| BizPortal: PO management | 16 | Frontend |
| E2E test: full buyer → vendor → admin flow | 20 | QA |
| Bug fix buffer | 8 | All |
| **Total** | **80 SP** | |

**Deliverable:** Marketplace P0 siap internal QA

---

### Sprint 4 (Minggu 6–7): Universal Approval Engine
**Target:** Approval engine core selesai, terintegrasi ke PR

| Task | SP | Owner |
|---|---|---|
| B08: Approval schema | 24 | Backend |
| B09: State machine service | 32 | Backend |
| B10: Approval notifications | 16 | Backend |
| Unit test: state machine | 8 | QA |
| **Total** | **80 SP** | |

**Risiko:** Concurrent approval edge cases → mitigation: optimistic locking / DB-level constraint
**Deliverable:** Approval engine service siap diintegrasikan ke semua domain

---

### Sprint 5 (Minggu 8): Approval API + PR Integration
**Target:** Approval endpoint live, PR Procurement pakai Approval Engine

| Task | SP | Owner |
|---|---|---|
| B11: Approval API endpoint | 24 | Backend |
| Integrasi Approval ke Procurement PR | 20 | Backend |
| BizPortal: Approval inbox UI | 20 | Frontend |
| Integration test: PR approval flow | 16 | QA |
| **Total** | **80 SP** | |

**Deliverable:** PR bisa di-submit → approver terima notifikasi → approve/reject berfungsi

---

### Sprint 6 (Minggu 9–10): Document Management
**Target:** Document Management foundation + migrasi existing

| Task | SP | Owner |
|---|---|---|
| B12: Document schema | 16 | Backend |
| B13: Upload/download API | 24 | Backend |
| B14: Migrasi dokumen existing | 24 | Backend |
| B42: Expiry notification | 8 | Backend |
| Test: upload/download + access control | 8 | QA |
| **Total** | **80 SP** | |

**Risiko:** Migrasi B14 bisa data loss → mitigation: dry-run dulu, backup before run

---

### Sprint 7 (Minggu 11–12): 3-Way Match
**Target:** Procurement 3-way match engine + exception queue

| Task | SP | Owner |
|---|---|---|
| B25: 3-way match engine | 40 | Backend |
| B26: Exception queue + UI | 24 | Full-stack |
| Integration test: GR → match → AP | 16 | QA |
| **Total** | **80 SP** | |

---

### Sprint 8 (Minggu 13–14): Financial Statement
**Target:** P&L, Balance Sheet, Cash Flow otomatis

| Task | SP | Owner |
|---|---|---|
| B19: Trial Balance | 32 | Backend |
| B20: P&L | 16 | Backend |
| B21: Balance Sheet | 16 | Backend |
| B22: Cash Flow | 16 | Backend |
| **Total** | **80 SP** | |

---

### Sprint 9–10 (Minggu 15–18): CRM Lead + Opportunity
*(Details lihat Phase 7 di atas)*

---

### Sprint 11–13 (Minggu 19–24): Analytics Dashboard
*(Details lihat Phase 8 di atas)*

---

### Sprint 14–16 (Minggu 25–30): AI Engine
*(Details lihat Phase 9 di atas)*

---

### Sprint 17–18 (Minggu 31–34): API Governance + Integration
*(Details lihat Phase 10 di atas)*

---

## 6. Testing Matrix

### 6.1 Coverage Target per Layer

| Layer | Target Coverage | Tool |
|---|---|---|
| Unit Test | ≥ 80% critical paths | Vitest |
| Integration Test | Semua API endpoint | Supertest + Vitest |
| E2E Test | Semua user journeys critical | Playwright |
| Security Test | Per release | Manual + automated scan |
| Performance Test | Per phase go-live | k6 / Artillery |
| Regression Test | Per sprint setelah Sprint 3 | Vitest + Playwright |
| UAT | Setiap Phase sebelum go-live | User + QA Lead |

---

### 6.2 Testing Matrix per Modul

| Modul | Unit | Integration | E2E | Security | Performance | Regression | UAT |
|---|---|---|---|---|---|---|---|
| **Marketplace P0** | ✅ Wajib | ✅ Wajib | ✅ Wajib | ✅ | ✅ | ✅ | ✅ |
| **Approval Engine** | ✅ Wajib | ✅ Wajib | ✅ Wajib | ✅ | — | ✅ | ✅ |
| **Document Mgmt** | ✅ | ✅ | ✅ | ✅ (file access) | ✅ | ✅ | ✅ |
| **3-Way Match** | ✅ Wajib | ✅ Wajib | ✅ | — | — | ✅ | ✅ |
| **Financial Statement** | ✅ Wajib | ✅ Wajib | ✅ | — | ✅ | ✅ | ✅ |
| **CRM** | ✅ | ✅ | ✅ | — | — | ✅ | ✅ |
| **Analytics** | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| **AI Engine** | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| **API Governance** | — | ✅ | — | ✅ | ✅ | ✅ | — |

---

### 6.3 Test Case Kritis (Harus Pass Sebelum Go-Live)

| TC-ID | Test Case | Modul | Severity |
|---|---|---|---|
| TC01 | Buyer submit RFQ → vendor terima notifikasi WA | Marketplace | BLOCKER |
| TC02 | Vendor submit quote → admin bisa compare | Marketplace | BLOCKER |
| TC03 | Admin select winner → PO terbuat → journal ter-post | Marketplace | BLOCKER |
| TC04 | Commission journal TIDAK double-post (ADR-0003) | Marketplace + Accounting | BLOCKER |
| TC05 | PR submitted → approver terima notifikasi → approve/reject berfungsi | Approval | BLOCKER |
| TC06 | Concurrent approval tidak race condition | Approval | CRITICAL |
| TC07 | GR match 3-way → AP posting otomatis | Procurement | BLOCKER |
| TC08 | GR tidak match → masuk exception queue, TIDAK auto-post | Procurement | BLOCKER |
| TC09 | Balance Sheet: Assets = Liabilities + Equity | Finance | BLOCKER |
| TC10 | Trial Balance: Total Debit = Total Kredit | Finance | BLOCKER |
| TC11 | Document upload hanya bisa diakses oleh company yang sama | Document | BLOCKER |
| TC12 | AI rekomendasi COA → user HARUS konfirmasi, tidak auto-post (ADR-0004) | AI | BLOCKER |
| TC13 | Dev DB tidak bisa diakses dari production context (ADR-0001) | Security | BLOCKER |
| TC14 | Akuntansi entry posted tidak bisa di-UPDATE/DELETE (ADR-0002) | Accounting | BLOCKER |

---

## 7. Deployment Plan

### 7.1 Environment Pipeline

```
Development (Replit)
    │  Developer push kode
    │  pnpm test (unit + integration)
    │
    └──► Internal QA
              │  QA run full test suite
              │  UAT per module
              │
              └──► Staging
                        │  Mirror production config
                        │  Performance test
                        │  Security scan
                        │
                        └──► Pilot (Soft Launch)
                                  │  1–2 user terpilih
                                  │  Monitor 1–2 minggu
                                  │
                                  └──► Production
                                            │  Full deployment
                                            │  Monitoring aktif
                                            │
                                            └──► Post Go-Live (24–48 jam)
                                                      │  Hypercare (2 minggu)
                                                      │
                                                      └──► Maintenance
```

### 7.2 Deployment Checklist per Phase

Sebelum setiap phase masuk Production:

- [ ] Semua BLOCKER test cases PASS
- [ ] Database migration tested di staging
- [ ] Backup database diambil sebelum migration
- [ ] Rollback procedure sudah ditest
- [ ] `APP_ENV=production` dikonfirmasi
- [ ] GCP Secret Manager diupdate jika ada secret baru
- [ ] Replit deployment workflow dikonfigurasi
- [ ] Monitoring alert dikonfigurasi
- [ ] On-call person ditentukan untuk 24 jam post go-live

### 7.3 Migration Strategy

Semua migration menggunakan pattern existing (runtime migration di startup):
```
artifacts/api-server/src/run-dev-migrations.ts  — pattern untuk dev
Startup sequence → check migration applied → apply if not
Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS
```

Urutan migration setiap phase:
1. Backup database (Supabase point-in-time)
2. Apply migration (idempotent SQL)
3. Verify schema di DB
4. Deploy application code baru
5. Smoke test critical paths
6. Monitor 30 menit

---

## 8. Rollback Plan

### 8.1 Rollback per Phase

#### Phase 1 — Marketplace P0

| Trigger | Procedure | Recovery | Verification |
|---|---|---|---|
| Migration gagal / FK conflict | Revert kode ke commit sebelumnya; tabel baru di-DROP jika partial | Supabase PITR ke sebelum migration | `SELECT COUNT(*) FROM mkt_rfqs` harus error (tabel tidak ada) |
| Commission journal double-post | Disable marketplace routes (`FEATURE_FLAG=false`); void duplicate entries | Manual review semua entries dengan `source='marketplace_commission'` | Query: cek tidak ada double `source_id` |
| Buyer/vendor flow error | Rollback app code; tabel tetap ada | Bug fix + redeploy | Smoke test RFQ flow |

#### Phase 2 — Approval Engine

| Trigger | Procedure | Recovery | Verification |
|---|---|---|---|
| State machine deadlock | Disable approval engine; revert ke direct approval per domain | Restart application | Pending approvals bisa di-manual approve via direct query |
| Notification flood / infinite retry | Kill wa-retry-worker; fix retry logic | Clear retry queue | Check notification count normal |

#### Phase 4 — Finance

| Trigger | Procedure | Recovery | Verification |
|---|---|---|---|
| Balance Sheet tidak balance | Disable financial report endpoint; alert Finance | Manual audit entry per entry | BS equation check: Aset = Liabilitas + Ekuitas |
| Query lambat / timeout | Enable materialized view (workaround); schedule refresh | Index optimization | Response time < 5 detik untuk 12 bulan data |

### 8.2 Emergency Rollback Universal

Semua phase punya emergency rollback via Replit checkpoint:
1. Identifikasi checkpoint sebelum deployment
2. Rollback via Replit UI → "View Checkpoints"
3. Verify aplikasi berjalan normal
4. Audit apa yang hilang / perlu di-reapply

---

## 9. Go Live Checklist

### 9.1 Architecture ✅

- [ ] Semua ADR-0001 s/d ADR-0004 diimplementasi
- [ ] `APP_ENV` dikonfirmasi sebagai sumber kebenaran
- [ ] Dev/Prod isolation diverifikasi (envGuard aktif)
- [ ] AI advisor-only pattern diverifikasi (tidak ada auto-post)

### 9.2 Database

- [ ] Semua migration applied di production Supabase
- [ ] Supabase RLS policies dikonfigurasi per tabel baru
- [ ] Indexes dibuat sesuai Index Plan (blueprint Section 18)
- [ ] Backup pre-deployment diambil
- [ ] PITR (Point-in-Time Recovery) dikonfirmasi aktif

### 9.3 Migration

- [ ] Migration idempotent (sudah ditest run 2×)
- [ ] Migration ditest di staging dulu
- [ ] Rollback script tersedia
- [ ] Data integrity check post-migration

### 9.4 API

- [ ] Semua endpoint baru memiliki auth middleware
- [ ] Rate limiting dikonfigurasi
- [ ] Error format konsisten `{ code, message, details }`
- [ ] Response time < 2 detik untuk semua endpoint normal

### 9.5 Frontend

- [ ] Semua halaman baru responsive (mobile-friendly)
- [ ] Loading state + error state semua ada
- [ ] Browser console tidak ada unhandled error
- [ ] Semua form memiliki client-side validation

### 9.6 Testing

- [ ] Semua BLOCKER test cases PASS (TC01–TC14)
- [ ] Unit test coverage ≥ 80% critical paths
- [ ] E2E critical journeys semua PASS
- [ ] UAT sign-off dari representative users

### 9.7 Security

- [ ] Semua secret baru masuk GCP Secret Manager
- [ ] Tidak ada secret hardcoded di kode
- [ ] OWASP top 10 checklist diverifikasi
- [ ] SQL injection prevention diverifikasi (Drizzle parameterized queries)
- [ ] XSS prevention diverifikasi (sanitize inputs)

### 9.8 Backup

- [ ] Production backup terbaru tersedia
- [ ] Restore procedure sudah ditest
- [ ] Supabase PITR aktif
- [ ] Kode di GitHub (commit + push sebelum go-live)

### 9.9 Monitoring

- [ ] Application logs terstruktur (Pino logger aktif)
- [ ] Error alerting dikonfigurasi (WA admin)
- [ ] Startup health check berjalan normal
- [ ] All background workers berjalan (`startupOrchestrator` log OK)

### 9.10 Documentation

- [ ] `replit.md` diupdate
- [ ] API docs diupdate (atau OpenAPI spec)
- [ ] Changelog diupdate
- [ ] ADR baru dibuat jika ada keputusan arsitektur baru

### 9.11 Training

- [ ] Finance team terlatih untuk Financial Statement
- [ ] Procurement team terlatih untuk 3-Way Match + Approval
- [ ] Admin terlatih untuk Marketplace PO management
- [ ] Support dokumentasi / SOP tersedia

### 9.12 Support

- [ ] On-call schedule untuk 48 jam post go-live
- [ ] Rollback procedure tersedia dan diketahui team
- [ ] Hotfix procedure dikonfirmasi

---

## 10. Risk Register

| ID | Risiko | Modul | Probability | Impact | Severity | Mitigasi |
|---|---|---|---|---|---|---|
| **R01** | Double journal di Marketplace karena ADR-0003 tidak diimplementasi dengan benar | Marketplace + Accounting | High | Critical | 🔴 | Code review wajib, TC04 sebagai blocker, run journal reuse check before POST |
| **R02** | Migration FK conflict menyebabkan production downtime | Marketplace DB | Medium | High | 🔴 | Test migration di staging, idempotent SQL, backup sebelum apply |
| **R03** | Concurrent approval race condition | Approval Engine | Medium | High | 🟠 | DB-level optimistic locking, unique constraint per approval step |
| **R04** | Balance Sheet tidak balance setelah Financial Statement diimplementasi | Finance | Low | Critical | 🟠 | TC09 blocker, double-entry validation di setiap posting |
| **R05** | Migrasi dokumen (B14) menyebabkan data loss | Document Mgmt | Medium | High | 🟠 | Dry-run dulu, backup, validate row count before/after |
| **R06** | AI OCR accuracy rendah → user frustasi | AI + Document | Medium | Medium | 🟡 | Show confidence score, allow manual correction, log feedback for improvement |
| **R07** | Analytics query lambat di data produksi besar | Analytics | High | Medium | 🟡 | Materialized views, read replica, query caching |
| **R08** | Vendor Blueprint diubah tanpa approval | Marketplace | Low | Critical | 🟠 | File monitoring, code review mandatory, blueprint di git |
| **R09** | Secret bocor ke log / commit | Security | Low | Critical | 🟠 | Secret scan di CI, tidak ada `console.log(process.env)` di kode |
| **R10** | API breaking change tanpa versioning | API | High | High | 🟠 | API versioning (B18), OpenAPI spec (B27), contract testing |

---

## 11. Priority Matrix

```
            HIGH IMPACT
                 │
    B07  B25 B19 │ B01 B02 B03 B04 B08 B09
    B20  B21 B22 │ B11 B12 B13
                 │
LOW EFFORT ──────┼────────────────── HIGH EFFORT
                 │
    B37  B38 B36 │ B30 B31 B32 B43 B45
    B42          │ B33 B39 B50
                 │
            LOW IMPACT

Kuadran Kanan Atas (High Impact + High Effort) = Buat secara bertahap, wajib dilakukan
Kuadran Kiri Atas (High Impact + Low Effort) = Quick wins, bisa paralel
Kuadran Kanan Bawah (Low Impact + High Effort) = Defer ke P3
Kuadran Kiri Bawah (Low Impact + Low Effort) = Fill-in tasks saat ada kapasitas
```

**Quick Wins (High Impact + Low Effort):**
- B06: Activity Log hooks (1 hari, high value untuk audit)
- B37: Rate limiting (2 hari, security value tinggi)
- B38: Request ID tracing (1 hari, debugging value)
- B42: Document expiry notification (2 hari, prevent legal risk)

---

## 12. Complexity Matrix

| ID | Nama | Complexity | Alasan |
|---|---|---|---|
| B01 | Marketplace DB Migration | Medium | 7 tabel baru + 1 FK di existing table; pattern sudah ada |
| B07 | Commission Journal | High | ADR-0003 reuse check, COA mapping, tax calculation |
| B09 | Approval State Machine | High | Concurrent access, polymorphic entity, delegation chain |
| B14 | Migrasi Dokumen Existing | High | Data migration, FK remap, integrity check |
| B19 | Trial Balance | High | Aggregation besar, period filtering, multi-company |
| B22 | Cash Flow Statement | High | Indirect method calculation kompleks |
| B23/B24 | Multi-currency | High | Forex conversion, realized/unrealized gains, PSAK compliance |
| B25 | 3-Way Match Engine | High | Tolerance calculation, multi-document matching |
| B30 | AI OCR | High | OpenAI integration, parsing variasi format dokumen |
| B31 | Demand Forecasting | Very High | ML model, historical data pipeline, accuracy validation |
| B39 | FIFO Costing | High | Historical recalculation, performance di data besar |
| B43 | Intercompany Transactions | Very High | Elimination entries, PSAK, multi-company journal |
| B45 | AI Fraud Detection | Very High | Anomaly detection model, false positive management |

---

## 13. Timeline

### Summary Timeline 2026–2027

```
2026
────────────────────────────────────────────────────────────
Q3 2026 (Jul–Sep)     Q4 2026 (Oct–Dec)
│                     │
├── Phase 1           ├── Phase 3 (Procurement)
│   Marketplace P0    ├── Phase 4 (Finance)
│   5 minggu          ├── Phase 5 (Document + OCR)
│                     │   Selesai: Des 2026
├── Phase 2           │
│   Approval Engine   │
│   3 minggu          │

2027
────────────────────────────────────────────────────────────
Q1 2027               Q2 2027               Q3 2027
│                     │                     │
├── Phase 6           ├── Phase 8           ├── Phase 10
│   Inventory         │   Analytics         │   API Governance
│                     │                     │
├── Phase 7           ├── Phase 9           │
│   CRM               │   AI Engine         │
```

### Detail Timeline per Sprint

| Sprint | Periode | Phase | Utama Deliverable |
|---|---|---|---|
| S1 | Sep W1–2 | 1 | Marketplace DB + Buyer API |
| S2 | Sep W3–4 | 1 | Vendor Quote + Admin API |
| S3 | Okt W1 | 1 | BizPortal UI + E2E |
| S4 | Okt W2–3 | 2 | Approval Engine core |
| S5 | Okt W4 | 2 | Approval API + PR integration |
| S6 | Nov W1–2 | 4+5 | Document Management |
| S7 | Nov W3–4 | 3 | 3-Way Match |
| S8 | Des W1–2 | 4 | Financial Statement |
| S9–10 | Jan 2027 | 7 | CRM Lead + Opportunity |
| S11–13 | Feb–Mar 2027 | 8 | Analytics Dashboard |
| S14–16 | Apr–Mai 2027 | 9 | AI Engine |
| S17–18 | Jun 2027 | 10 | API Governance |

---

## 14. Milestones

| Milestone | Target | Criteria Sukses |
|---|---|---|
| **M1: Marketplace P0 Live** | Okt 2026 W1 | Buyer submit RFQ → Vendor quote → Admin confirm PO → Journal posted |
| **M2: Approval Engine Live** | Okt 2026 W4 | PR Procurement bisa melalui multi-level approval |
| **M3: Procurement Loop Closed** | Nov 2026 W4 | 3-way match + AP posting otomatis berfungsi |
| **M4: Finance Statement Live** | Des 2026 W2 | P&L + Balance Sheet + Cash Flow bisa di-generate |
| **M5: Document Management Live** | Des 2026 W2 | Upload/download dokumen + expiry notification berfungsi |
| **M6: CRM Live** | Feb 2027 | Lead → Opportunity → Quotation flow berfungsi |
| **M7: Analytics Dashboard Live** | Apr 2027 | CEO, Finance, Procurement dashboard berfungsi |
| **M8: AI Engine v1 Live** | Jun 2027 | Demand forecasting + Vendor matching tersedia |
| **M9: Full API Governance** | Jul 2027 | OpenAPI spec, versioning, rate limiting semua aktif |
| **M10: Platform Maturity** | Des 2027 | Semua P1 items selesai, coverage test ≥ 80% |

---

## 15. Acceptance Criteria

### Phase 1 — Marketplace P0

1. **Buyer Flow:** User terdaftar bisa submit RFQ dengan ≥1 line item. RFQ tersimpan di `mkt_rfqs` dengan status `submitted`. Activity log tercatat.
2. **Guest Flow:** Guest bisa submit RFQ tanpa login. Guest mendapat token. Setelah register, RFQ bisa di-claim.
3. **Vendor Flow:** Vendor terima notifikasi (WA + Email) saat diundang. Vendor bisa akses RFQ via token. Vendor bisa submit quote untuk setiap line.
4. **Admin Flow:** Admin bisa compare quotes. Admin pilih winner → PO terbuat. Admin bisa post commission journal setelah PO `completed`.
5. **Accounting:** Commission journal ter-post ke `accounting_entries` dengan `source='marketplace_commission'`. Tidak ada double journal (ADR-0003).
6. **Non-functional:** Response time < 2 detik. Tidak ada memory leak dalam 1 jam load test.

### Phase 2 — Approval Engine

1. PR bisa di-submit → routing ke level 1 approver.
2. Approver terima notifikasi WA/Email dalam < 1 menit.
3. Approve/reject/revisi berfungsi dengan komentar.
4. Concurrent approval dari 2 user tidak menyebabkan race condition.
5. Delegation berfungsi: approver A bisa delegate ke approver B dengan audit trail.

### Phase 4 — Finance

1. Trial Balance: Total Debit = Total Kredit (selisih 0).
2. Balance Sheet: Total Aset = Total Liabilitas + Ekuitas (selisih 0).
3. Financial statement bisa di-generate untuk periode apapun dalam < 5 detik.
4. Export ke PDF/Excel berfungsi.

---

## 16. Definition of Done

Sebuah task/backlog item dianggap DONE bila semua kriteria berikut terpenuhi:

### Kode
- [ ] Kode di-review oleh minimal 1 developer lain (atau 1 AI review pass)
- [ ] Tidak ada TypeScript error (`tsc --noEmit` clean)
- [ ] Tidak ada `console.log` sisa di production code
- [ ] Tidak ada secret hardcoded
- [ ] Fungsi kritis memiliki JSDoc / komentar

### Testing
- [ ] Unit test ditulis untuk semua business logic baru
- [ ] Unit test PASS
- [ ] Integration test untuk semua API endpoint baru PASS
- [ ] Test coverage ≥ 80% untuk file baru

### Database
- [ ] Migration idempotent (bisa dirun 2× tanpa error)
- [ ] Migration ditest di dev environment
- [ ] Indexes dibuat untuk foreign key dan query yang sering dipakai
- [ ] RLS policies dipertimbangkan untuk tabel baru

### API
- [ ] Semua endpoint memiliki auth middleware (kecuali public yang disengaja)
- [ ] Error response mengikuti format `{ code, message, details }`
- [ ] Pagination diimplementasi di semua list endpoint
- [ ] Request body memiliki Zod validation

### Frontend
- [ ] Loading state dan error state diimplementasi
- [ ] Form validation di client-side
- [ ] Responsive (tidak pecah di mobile 375px)
- [ ] Tidak ada unhandled promise rejection di browser console

### Documentation
- [ ] `replit.md` diupdate jika ada perubahan cara menjalankan
- [ ] Changelog diupdate
- [ ] ADR baru dibuat jika ada keputusan arsitektur

### Deployment
- [ ] Workflow restart sukses setelah perubahan
- [ ] Smoke test critical paths PASS di dev
- [ ] Tidak ada breaking change di existing functionality

---

## 17. Project Governance

### 17.1 Struktur Tim & Tanggung Jawab

| Role | Tanggung Jawab | Keputusan yang Dimiliki |
|---|---|---|
| **Owner / Sponsor** | Menentukan prioritas bisnis, budget, go/no-go per phase | Prioritas fitur, scope change, go-live approval |
| **Technical Lead** | Arsitektur kode, code review, ADR authoring | Keputusan teknis, tech stack, breaking change |
| **QA Lead** | Test plan, acceptance criteria sign-off, regression | Go-live readiness dari sisi quality |
| **Deployment Lead** | Migration, deployment, rollback eksekusi | Deployment timing, rollback trigger |
| **Risk Owner** | Monitor risk register, eskalasi risiko | Risk mitigation approval |
| **Reviewer** | Review blueprint, ADR, dan deliverable | Approval blueprint dan ADR baru |

### 17.2 Decision Making Framework

```
Keputusan Level 1 (Routine — harian):
  → Technical Lead + developer yang berkaitan
  → Contoh: naming convention, file structure, algorithm choice

Keputusan Level 2 (Significant — mingguan):
  → Technical Lead + QA Lead
  → Contoh: schema change, new dependency, API design

Keputusan Level 3 (Strategic — per phase):
  → Owner + Technical Lead + QA Lead
  → Contoh: scope change, timeline extension, new ADR

Keputusan Level 4 (Architecture — rare):
  → Owner + Technical Lead + Reviewer
  → Contoh: perubahan ADR existing, platform migration
```

### 17.3 Communication Cadence

| Rapat | Frekuensi | Peserta | Agenda |
|---|---|---|---|
| Sprint Planning | Tiap 2 minggu (awal sprint) | All | Target sprint, SP, risiko |
| Sprint Review | Tiap 2 minggu (akhir sprint) | All | Demo deliverable, feedback |
| Architecture Review | Per phase | Tech Lead + Reviewer | Blueprint compliance check |
| Risk Review | Mingguan | Risk Owner + Tech Lead | Update risk register |

### 17.4 Change Management

Jika ada permintaan perubahan scope / blueprint:

1. **Raise:** Buat isu dengan judul, deskripsi, justifikasi bisnis
2. **Impact Analysis:** Tech Lead estimasi dampak (waktu, dependencies, risiko)
3. **Decision:** Level governance sesuai kategori di atas
4. **Document:** Jika approve → update blueprint + ADR baru jika arsitektural
5. **Implement:** Masuk backlog dengan prioritas yang sudah ditentukan

---

## 18. Recommended Implementation Order

### Urutan Mutlak (Tidak Boleh Dibalik)

```
1. Marketplace P0 (Phase 1)
   ↳ Alasan: Vendor Blueprint sudah FINAL, siap implementasi, highest business value

2. Universal Approval Engine (Phase 2)
   ↳ Alasan: Semua modul berikutnya butuh approval; buat sekarang atau setiap modul
             punya approval sendiri yang tidak reusable

3. Procurement 3-Way Match (Phase 3)
   ↳ Alasan: Bergantung pada Approval Engine (B11); closing P0 procurement loop

4. Document Management + Financial Statement (Phase 4 & 5 paralel)
   ↳ Alasan: Document foundation dibutuhkan OCR; Financial Statement dibutuhkan Analytics

5. CRM (Phase 7)
   ↳ Alasan: Bergantung pada customer master + sales flow yang sudah stabil

6. Analytics (Phase 8)
   ↳ Alasan: Bergantung pada semua domain data stabil dan Financial Statement selesai

7. AI Engine (Phase 9)
   ↳ Alasan: Bergantung pada historical data yang cukup; OCR butuh Document Mgmt

8. API Governance (Phase 10)
   ↳ Alasan: Dilakukan setelah semua API stabil; versioning dan OpenAPI spec

9. P3 items (Intercompany, SMS, Fraud Detection)
   ↳ Alasan: Bergantung pada semua P0–P1 selesai dan stable
```

### Yang Bisa Diparalelkan

```
Paralel dengan Phase 1:
  - B37, B38 (Rate limiting + Request ID) → quick wins, developer berbeda

Paralel dengan Phase 2:
  - B27 (OpenAPI spec draft) → bisa mulai selama API Phase 1 dibangun

Paralel dengan Phase 3–5:
  - B15 (CRM Lead schema) → database work bisa dimulai
  - B23 (Currency table) → data setup untuk multi-currency

Paralel dengan Phase 7:
  - B33 (Finance Dashboard basic) → bisa dimulai setelah B19 selesai
```

---

## 19. Executive Summary

### Situasi Saat Ini

CST Super App adalah platform ERP B2B enterprise dengan 5 service aktif (API Server, BizPortal, Customer Portal, Logistic Order, CST Driver). Core accounting, procurement, dan inventory sudah production-ready. Vendor Blueprint v1.2 untuk Marketplace sudah FINAL. Enterprise Master Blueprint sudah selesai mencakup 18 modul.

**Kekuatan:**
- Accounting immutable (ADR-0002) — audit-proof
- Secret management via GCP — zero hardcoded secrets
- Dev/Prod isolation absolut (ADR-0001)
- Vendor Blueprint sudah FINAL — siap implementasi
- Background workers ter-orchestrate dengan baik

**Gap Utama:**
1. Marketplace P0 belum diimplementasi (blueprint FINAL)
2. Universal Approval Engine tidak ada
3. Document Management tersebar
4. CRM tidak ada
5. Financial Statement belum otomatis

### Scope Implementasi

| Phase | Timeline | Effort | Business Value |
|---|---|---|---|
| Phase 1–2 (Marketplace + Approval) | Q3 2026 | 8 minggu | 🔴 Critical |
| Phase 3–5 (Procurement + Finance + Docs) | Q4 2026 | 8 minggu | 🔴 Critical |
| Phase 6–7 (Inventory + CRM) | Q1 2027 | 8 minggu | 🟠 High |
| Phase 8–9 (Analytics + AI) | Q2–Q3 2027 | 14 minggu | 🟠 High |
| Phase 10 (Governance) | Q3 2027 | 4 minggu | 🟡 Medium |

**Total estimasi (1 developer):** ~42 minggu untuk P0+P1 selesai (Q3 2026 – Q3 2027)  
**Dengan 2 developer paralel:** ~25 minggu untuk milestone yang sama

### Investasi yang Diperlukan

- Development capacity: minimal 1 full-time developer, ideal 2
- QA capacity: minimal 1 QA person part-time dari Phase 3 onward
- External services sudah ada: Supabase, GCP, OpenAI, Fonnte, Paylabs ✅

---

## 20. Final Recommendation

### Rekomendasi Urutan Tindakan (Segera)

**Minggu Ini:**
1. Approve dokumen ini sebagai backlog resmi
2. Assign developer ke Phase 1 (Sprint 1: B01 Marketplace DB migration)
3. Konfirmasi test environment staging tersedia

**30 Hari Pertama (Sprint 1–2):**
1. Implementasi B01–B07 (Marketplace P0 database + API)
2. Setup test framework (Vitest + Playwright) jika belum lengkap
3. Mulai draft OpenAPI spec untuk endpoint yang dibangun (paralel)

**90 Hari Pertama:**
1. Marketplace P0 live (M1) — target Okt 2026
2. Universal Approval Engine live (M2) — target Okt 2026
3. Procurement 3-Way Match selesai (M3) — target Nov 2026

### Prinsip Panduan untuk Seluruh Implementasi

1. **Blueprint adalah hukum** — tidak ada implementasi tanpa blueprint yang disetujui
2. **ADR tidak boleh di-reverse** — ADR-0001 s/d ADR-0004 adalah FINAL
3. **Vendor Blueprint sacred** — `enterprise-marketplace-blueprint-v1.2.md` JANGAN DIUBAH
4. **Test before merge** — tidak ada code merge tanpa unit test PASS
5. **Definition of Done wajib** — semua 16 checklist DoD harus terpenuhi
6. **Secret tetap di GCP** — tidak ada secret baru masuk Replit Secrets langsung
7. **Universal over custom** — approval, notification, document adalah shared infrastructure
8. **AI advises, human decides** — tidak ada auto-approve atau auto-post dari AI

### Warning untuk Implementer

> ⚠️ Dokumen ini adalah **backlog resmi**. Setiap implementasi berikutnya WAJIB mengacu
> pada dokumen ini. Jika ada perbedaan antara dokumen ini dan Blueprint referensi,
> Blueprint referensi yang MENANG.
>
> Vendor Blueprint v1.2 (`docs/enterprise-marketplace-blueprint-v1.2.md`) adalah FINAL.
> Jangan mengubah schema, API naming, accounting rules, atau security rules di dalamnya.
>
> Semua ADR di `ARCHITECTURE_DECISIONS.md` adalah keputusan PERMANEN.
> Tidak ada developer — manusia maupun AI — yang boleh reverse ADR tanpa proses formal.

---

*CST Enterprise Implementation Master Plan v1.0 — 2026-08-06*  
*Dokumen ini menjadi backlog resmi seluruh implementasi CST Enterprise Platform.*  
*Update dokumen ini setiap ada scope change yang disetujui Owner.*

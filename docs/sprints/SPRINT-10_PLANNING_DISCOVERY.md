# Sprint 10 — Planning & Discovery

**Tanggal discovery:** 2026-08-10  
**Status:** Planning only — Sprint 10 belum dimulai  
**Baseline repository:** working tree bersih saat discovery  
**Sumber utama:** `docs/sprints/SPRINT-09.md`,
`docs/release/SPRINT-09_FINAL_CLOSURE_REPORT.md`,
`docs/release/release-readiness.md`,
`docs/release/release-evidence-matrix.md`,
`docs/enterprise-platform-roadmap.md`,
`AI_COGNITIVE_ENTERPRISE_ROADMAP.md`,
`docs/ENTERPRISE_EXECUTION_GATE_REPORT.md`, dan
`docs/MASTER_FIX_PLAN.md`.

> Dokumen ini hanya berisi planning, discovery, prioritas, dependency, dan
> rekomendasi. Tidak ada fitur, endpoint, service, migration, test, refactor,
> atau perubahan source code yang dibuat sebagai bagian dari dokumen ini.

## 1. Ringkasan Kondisi Repository

### Status aktual

- Working tree bersih pada saat discovery.
- `docs/release/SPRINT-09_FINAL_CLOSURE_REPORT.md` tersedia dan menyatakan
  Sprint 09 **implementation complete**.
- Sprint 10 belum memiliki dokumen resmi `docs/sprints/SPRINT-10.md`; dokumen
  ini adalah discovery/planning awal, bukan sprint implementation plan yang
  telah disetujui.
- `docs/sprints/README.md` masih stale: Sprint 9 tercatat `PLANNED`, dan
  deskripsi lama menyatakan Sprint 9–12 belum memiliki requirement resmi.
  Informasi tersebut bertentangan dengan closure report terbaru dan harus
  diperlakukan sebagai documentation hygiene backlog.

### Kondisi arsitektur

Repository sudah memiliki fondasi operasional yang luas:

- Marketplace sampai AP preparation dan handoff Payment/Accounting/
  Reconciliation.
- Multi-company authorization dan scope checks di banyak route.
- AI governance runtime melalui `ai_agent_executions` dan
  `ai_approval_queue`.
- Context orchestration runtime melalui `contextOrchestrator`.
- Notification queue dan accounting outbox dengan pola `FOR UPDATE SKIP LOCKED`.
- Intelligence alerts dan order-stage data.
- Release gate fail-closed, tetapi belum GO.

### Kondisi release

Release readiness masih **PRODUCTION: NO-GO**. Blocker yang tercatat:

1. Secret rotation owner verification belum lengkap.
2. Dedicated staging target belum dikonfigurasi.
3. Full HTTP E2E, tenant isolation, security, accounting, SSE, dan cleanup
   masih BLOCKED karena staging.
4. Backup/restore evidence, staging rollback test, monitoring setup, dan
   owner/technical-lead sign-off belum lengkap.

Blocker tersebut adalah release/operational prerequisite, bukan fitur Sprint 10.

## 2. Ringkasan Hasil Sprint 09

Sprint 09 ditutup sebagai:

- ✅ **IMPLEMENTATION COMPLETE**
- ✅ **SPRINT 09 DEVELOPMENT COMPLETE**
- ⚠️ **REPOSITORY VERIFICATION GAP**

Scope yang telah diimplementasikan:

1. **09A — Marketplace → Payment Handoff**
   - Handoff contract, idempotency, payload fingerprint, dan schema additive.
2. **09B — Marketplace Payment Lifecycle**
   - Lifecycle `payment_request_created` sampai `completed`, dengan
     `failed` dan `cancelled` sebagai exception state.
3. **09C — Retry / Failure / Idempotency**
   - Execution attempt terpisah, retry setelah `failed`, cancellation cutoff,
     audit event, notification deduplication, dan conflict guard.
4. **09D — Marketplace → Accounting Handoff**
   - Evidence-only handoff table; tidak membuat atau mem-posting journal.
5. **09E — Marketplace → Bank Reconciliation Link**
   - Reference-only link; tidak mengubah bank mutation maupun accounting rows.
6. **09F — Verification Review**
   - Closure report dan pemisahan implementation gap dari verification tooling.

### Batas overlap

Item berikut tidak boleh dimasukkan sebagai fitur baru Sprint 10:

| Item | Mengapa bukan Sprint 10 |
|---|---|
| Runtime proof 09A–09E | Ini adalah verification backlog untuk Sprint 09 yang belum memiliki artefak resmi lengkap. |
| Dedicated staging, secret rotation, full HTTP E2E | Ini adalah release gate/operational prerequisite, bukan business feature baru. |
| Perbaikan Payment, Accounting, atau Reconciliation boundary 09A–09E | Sudah termasuk scope Sprint 09; perubahan lanjutan harus dibuat sebagai defect ticket yang memiliki evidence baru. |
| Stale `docs/sprints/README.md` | Documentation hygiene, bukan implementasi fitur. |

## 3. Outstanding Backlog

### 3.1 High Priority

#### H0 — Tutup release verification Sprint 09

**Status:** Outstanding, bukan kandidat Sprint 10.  
**Isi:** secret rotation, dedicated staging, full HTTP E2E, tenant isolation,
security, accounting, SSE, cleanup, backup/restore, rollback rehearsal,
monitoring, dan sign-off.  
**Sumber:** `docs/release/release-readiness.md`,
`docs/release/release-evidence-matrix.md`,
`docs/release/go-live-remediation-final-report.md`.

**Keputusan:** Tetap sebagai **QA/release backlog**. Jangan mengubah statusnya
menjadi fitur Sprint 10 hanya karena verifikasinya belum selesai.

#### H1 — Security delta audit dan hardening berbasis evidence

`docs/MASTER_FIX_PLAN.md` berisi 35 temuan lama, termasuk critical auth,
tenant isolation, duplicate protection, SSRF, dan race-condition items.
Namun sebagian temuan sudah memiliki indikasi perbaikan di source code saat ini,
misalnya `requireClerkUser`, `assertCompanyAccess`, dan parameterized SQL.

**Keputusan:** Jangan mengimplementasikan daftar lama secara blind. Lakukan
re-validation terhadap source code dan dedicated staging E2E terlebih dahulu.
Hanya temuan yang masih reproducible yang menjadi defect/hardening scope.

#### H2 — Operational observability activation

Monitoring matrix sudah mendefinisikan threshold API, database, worker,
payment callback, notification, SSE, CPU, memory, dan error rate, tetapi
monitoring stack eksternal masih `Not configured`.

**Keputusan:** Kandidat Sprint 10 yang valid setelah owner menentukan stack,
on-call channel, retention, dan environment target.

### 3.2 Medium Priority

#### M1 — AI governance visibility

Runtime sudah memiliki `ai_agent_executions` dan `ai_approval_queue`, tetapi
roadmap masih mencatat kebutuhan AI execution audit trail UI dan AI governance
dashboard.

#### M2 — Configurable approval deadline dan escalation

Approval engine telah ada, tetapi roadmap mengidentifikasi gap pada deadline,
parallel quorum, escalation, dan timeout action. Ini melengkapi governance
tanpa mengubah boundary payment Sprint 09.

#### M3 — Unified operational context governance

Roadmap mengusulkan Unified Operational Context Builder dan permission-aware AI
context. Repository sudah memiliki `contextOrchestrator`, sehingga kandidat
yang tepat adalah audit/completion terhadap context scope, bukan membuat
service duplikat.

#### M4 — BI foundation

Materialized views seperti `mv_order_kpi` dan `mv_vendor_performance` tercantum
sebagai priority action item. Sebelum implementasi perlu memastikan definisi
metric, refresh policy, tenant scope, dan dampak query terhadap OLTP.

#### M5 — Async OCR/job processing

Roadmap mengidentifikasi OCR sinkron sebagai risiko UX dan reliability.
Candidate ini membutuhkan job ownership, retry, dead-letter, status UI, dan
storage lifecycle yang jelas.

#### M6 — API contract documentation

`ENTERPRISE_EXECUTION_GATE_REPORT.md` mencatat API documentation/OpenAPI belum
ada. Ini bukan fitur bisnis, tetapi meningkatkan contract review, QA automation,
dan integrasi partner.

#### M7 — Advance management pre-production validation

`docs/advance-migration-plan.md` masih memiliki checklist staging dan COA
validation yang belum dicentang. Ini bukan bagian Sprint 09 Marketplace, namun
merupakan candidate stabilization terpisah bila Finance Owner memprioritaskan
modul Advance.

### 3.3 Low Priority

#### L1 — Documentation synchronization

- Sinkronkan status Sprint 9 pada `docs/sprints/README.md`.
- Tetapkan format dokumen Sprint 10–12.
- Tautkan closure report dan planning discovery.
- Pisahkan dokumen historis yang stale dari source of truth aktif.

#### L2 — PPJK audit metadata enhancement

`docs/ppjk-pre-production-backlog.md` mencatat metadata audit tambahan sebagai
low priority dan non-blocking.

#### L3 — Cleanup technical debt

Items seperti dead code, naming inconsistency, hardcoded fallback, dan upload
hook duplication tetap dapat dikerjakan incremental, tetapi tidak layak
menjadi fokus Sprint 10 sebelum release/security gate lebih jelas.

## 4. Kandidat Sprint 10

> Kandidat di bawah ini belum menjadi commitment. Pemilihan final memerlukan
> persetujuan Product Owner, Technical Lead, dan owner modul terkait.

### Candidate S10-A — Release Verification & Production Readiness

| Aspek | Rencana |
|---|---|
| Nama fitur | Release Verification & Production Readiness |
| Tujuan bisnis | Mengubah evidence release dari NO-GO/BLOCKED menjadi keputusan GO yang dapat diaudit, tanpa memalsukan PASS. |
| Modul terdampak | DevOps, release gate, staging, API runtime, database, security, monitoring |
| Dependency | Secret rotation owner, dedicated staging Supabase, backup/restore, rollback target, on-call owner |
| Risiko | Tinggi; staging dapat menemukan defect baru dan data boundary salah |
| Kompleksitas | Tinggi — operational/release epic |
| Prasyarat | Provision staging terisolasi, injeksi `TEST_*`, owner sign-off, no production mutation |
| Status scope | **Prerequisite, bukan fitur Sprint 10** |

**Rekomendasi:** Kerjakan sebelum Sprint 10 development, tetapi lacak sebagai
release/QA epic terpisah.

### Candidate S10-B — Security Delta & Tenant Isolation Hardening

| Aspek | Rencana |
|---|---|
| Nama fitur | Security Delta Audit & Tenant Isolation Hardening |
| Tujuan bisnis | Menutup vulnerability yang masih reproducible dan membuktikan auth, RBAC, company scope, rate limit, SSRF, dan duplicate protection. |
| Modul terdampak | API routes, auth middleware, company scope, ecommerce, logistics, webhooks, database constraints |
| Dependency | Source re-validation, dedicated staging, threat model, regression matrix |
| Risiko | Tinggi; middleware atau constraint dapat memblokir POS, portal, atau legacy flow |
| Kompleksitas | Tinggi |
| Prasyarat | Inventaris temuan aktual, acceptance test per finding, DNB validation, rollback plan |
| Status scope | Candidate P0/P1 setelah evidence |

**Catatan:** Temuan dari `MASTER_FIX_PLAN.md` tidak boleh dianggap masih valid
tanpa reproduksi terhadap source dan environment saat ini.

### Candidate S10-C — Operational Observability Activation

| Aspek | Rencana |
|---|---|
| Nama fitur | Centralized Monitoring & Incident Readiness |
| Tujuan bisnis | Mendeteksi downtime, payment failure, queue backlog, SSE degradation, dan database pressure sebelum berdampak luas. |
| Modul terdampak | API, workers, database, payment callback, notification, SSE, deployment |
| Dependency | Monitoring provider, alert channel, ownership roster, retention policy, production/staging URLs |
| Risiko | Medium; false positive, credential/config exposure, alert fatigue |
| Kompleksitas | Medium |
| Prasyarat | Threshold approval, runbook, escalation SLA, test alert, dashboard ownership |
| Status scope | Candidate P0/P1 |

### Candidate S10-D — AI Governance Dashboard

| Aspek | Rencana |
|---|---|
| Nama fitur | AI Execution Audit Trail & Governance Dashboard |
| Tujuan bisnis | Memberi Finance/Ops/Security visibilitas atas AI action, confidence, approval, reasoning metadata, error, dan cost. |
| Modul terdampak | BizPortal governance UI, API AI governance, `ai_agent_executions`, `ai_approval_queue`, audit/access control |
| Dependency | Permission-aware query scope, metric definition, retention policy, PII redaction |
| Risiko | Tinggi; raw prompt/output dapat mengandung PII atau data lintas company |
| Kompleksitas | Medium–High |
| Prasyarat | Role matrix, company scope, data minimization, pagination/filter contract, audit access log |
| Status scope | Candidate P1 |

### Candidate S10-E — Configurable Approval Deadline & Escalation

| Aspek | Rencana |
|---|---|
| Nama fitur | Approval SLA, Deadline, dan Auto-Escalation |
| Tujuan bisnis | Mengurangi approval stagnation dan membuat escalation path terukur per company/branch/value threshold. |
| Modul terdampak | Approval engine, BizPortal approval UI, notification, audit log, scheduler/worker |
| Dependency | Existing approval rules, role hierarchy, notification queue, time-zone policy |
| Risiko | Tinggi; auto-action yang salah dapat menyetujui atau menolak transaksi finansial |
| Kompleksitas | High |
| Prasyarat | Business policy tertulis, escalation owner, dry-run mode, idempotent scheduler, reversal/rollback policy |
| Status scope | Candidate P1 |

### Candidate S10-F — Permission-Aware Operational Context

| Aspek | Rencana |
|---|---|
| Nama fitur | Context Governance Completion |
| Tujuan bisnis | Memastikan AI dan operational assistant menerima context order/vendor/finance yang sesuai role dan company scope. |
| Modul terdampak | `contextOrchestrator`, AI agent, auth/scope middleware, BizPortal assistant |
| Dependency | Existing context builder, auth user-role contract, company/branch scope rules |
| Risiko | Tinggi; data leakage atau context omission dapat menghasilkan keputusan salah |
| Kompleksitas | Medium–High |
| Prasyarat | Data classification, allowlist tool per role, negative cross-company tests, audit trail |
| Status scope | Candidate P1 |

**Catatan:** Repository sudah memiliki context orchestration. Sprint 10 tidak
boleh membuat orchestrator kedua; scope harus berupa gap analysis, contract
completion, dan verification.

### Candidate S10-G — BI Operational KPI Foundation

| Aspek | Rencana |
|---|---|
| Nama fitur | Order dan Vendor KPI Materialized Views |
| Tujuan bisnis | Menyediakan KPI operasional yang konsisten untuk dashboard, SLA, dan AI ranking tanpa heavy query OLTP. |
| Modul terdampak | Database, analytics/dashboard, Marketplace, logistics, vendor performance |
| Dependency | Metric definitions, source-table ownership, refresh mechanism, company scope |
| Risiko | Medium; angka KPI dapat berbeda dari ledger/operational source dan refresh dapat membebani DB |
| Kompleksitas | Medium |
| Prasyarat | Data dictionary, reconciliation query, refresh SLA, index/query plan, read-only consumer |
| Status scope | Candidate P1/P2 |

### Candidate S10-H — Async OCR Job Queue

| Aspek | Rencana |
|---|---|
| Nama fitur | OCR Processing Queue dan Status Tracking |
| Tujuan bisnis | Menghindari request timeout dan memberi status/retry yang jelas untuk OCR invoice/POD. |
| Modul terdampak | Document/OCR routes, workers, storage, AI provider, notification, portal UI |
| Dependency | Queue primitive, idempotency, storage object lifecycle, AI cost limit, dead-letter handling |
| Risiko | Tinggi; duplicate processing, biaya AI, stale status, dan orphaned files |
| Kompleksitas | High |
| Prasyarat | Job state machine, retry budget, poison-message policy, cleanup policy, UX contract |
| Status scope | Candidate P2 |

### Candidate S10-I — API Contract & Partner Documentation

| Aspek | Rencana |
|---|---|
| Nama fitur | OpenAPI/Contract Documentation Baseline |
| Tujuan bisnis | Mempercepat QA, integrasi partner, security review, dan contract drift detection. |
| Modul terdampak | API server, route schemas, CI/validation, developer docs |
| Dependency | Route inventory, auth/RBAC annotations, error model, versioning policy |
| Risiko | Medium; dokumen stale dapat memberi rasa aman palsu |
| Kompleksitas | Medium |
| Prasyarat | Source-of-truth decision, generated-vs-handwritten policy, CI diff check |
| Status scope | Candidate P2 |

## 5. Prioritas Implementasi

### Prioritas P0 — Gate dan safety sebelum feature sprint

1. Tutup **S10-A** sebagai release/QA epic terpisah.
2. Re-validate **S10-B** menggunakan source code saat ini dan staging evidence.
3. Jangan menambah feature yang memperluas production risk ketika dedicated
   staging, secret rotation, dan rollback belum siap.

### Prioritas P1 — Kandidat paling bernilai setelah release safety

1. **S10-C — Operational Observability Activation**
2. **S10-D — AI Governance Dashboard**
3. **S10-F — Permission-Aware Operational Context**
4. **S10-E — Approval Deadline & Escalation**, setelah policy owner tersedia.

### Prioritas P2 — Foundation berikutnya

1. **S10-G — BI KPI Foundation**
2. **S10-I — API Contract Documentation**
3. **S10-H — Async OCR Queue**, setelah queue/worker operating model disepakati.

### Prioritas rendah

- Documentation synchronization.
- PPJK audit metadata enhancement.
- Cosmetic refactor dan dead-code cleanup.

## 6. Dependency Matrix

| Candidate | Depends on | Can run in parallel with | Must not start before |
|---|---|---|---|
| S10-A Release readiness | Staging owner, secret owner, DevOps, release lead | Documentation cleanup; source re-audit | Dedicated target identity and cleanup safety are defined |
| S10-B Security hardening | Source re-validation, threat model, staging E2E | S10-C planning; S10-I contract inventory | Findings are reproduced and DNB list is frozen |
| S10-C Observability | Provider, alert channel, owners, runbooks | S10-B analysis, S10-I | Thresholds and escalation ownership approved |
| S10-D AI governance UI | AI schema, role/scope contract, PII policy | S10-C, S10-I | Permission-aware query contract exists |
| S10-E Approval escalation | Approval rules, scheduler, notification queue, policy owner | S10-D design | Timeout action and financial authority are approved |
| S10-F Context governance | Auth scope, data classification, existing orchestrator | S10-C, S10-D | Tool/data allowlist per role exists |
| S10-G KPI views | Metric dictionary, source ownership, refresh policy | S10-I | Reconciliation against source queries is defined |
| S10-H OCR queue | Queue primitive, idempotency, storage and AI cost policy | S10-I | Job state machine and cleanup policy are approved |
| S10-I API contracts | Route inventory, auth/error model, version policy | All discovery work | Owner agrees which routes are public/internal |

### Critical dependency chain

```text
Release safety / staging (S10-A)
  → security evidence and tenant proof (S10-B)
  → monitoring and incident readiness (S10-C)
  → permission-aware AI governance (S10-F)
      ├─→ AI governance dashboard (S10-D)
      └─→ approval escalation (S10-E)
  → KPI foundation (S10-G)
  → async OCR queue (S10-H)
  → API contract baseline (S10-I, parallel where safe)
```

## 7. Risk Matrix

| Risk | Probability | Impact | Mitigation | Owner |
|---|---:|---:|---|---|
| Sprint 09 verification backlog dianggap fitur baru | High | High | Keep separate release/QA epic and preserve closure verdict | Release Lead |
| Old audit findings stale tetapi langsung di-fix | High | High | Reproduce against current source and staging first | Technical Lead |
| Staging memakai shared dev/prod DB | Medium | Critical | Verify database identity and required schema read-only before writes | DevOps |
| AI dashboard exposes PII/cross-company data | Medium | Critical | Scope filters, redaction, access audit, negative tests | Security Owner |
| Auto-escalation changes financial authority incorrectly | Medium | Critical | Human approval policy, dry-run, idempotent scheduler, rollback | Finance Owner |
| Monitoring creates alert fatigue | Medium | Medium | Threshold calibration, owner/SLA, test alerts, review cadence | DevOps |
| KPI materialized view diverges from source | Medium | High | Data dictionary, reconciliation queries, refresh evidence | Data/Finance Owner |
| OCR queue duplicates expensive AI jobs | Medium | High | Idempotency key, retry budget, dead-letter, cost cap | Document/AI Owner |
| API documentation drifts from implementation | Medium | Medium | Generated spec or CI contract-diff validation | Backend Owner |
| Large scope causes Sprint 10 to become a platform rewrite | High | High | Select one vertical slice and reject unbounded roadmap items | Product Owner |

## 8. Recommended Sprint Order

### Stage 0 — Close readiness prerequisites

1. Complete secret rotation with owner verification.
2. Provision and identify dedicated staging; do not use shared development DB.
3. Run full HTTP E2E and retain timestamped evidence.
4. Verify backup/restore, rollback, monitoring, cleanup, and sign-off.
5. Keep any defects discovered here in the release defect queue, not silently
   inside a new feature sprint.

### Stage 1 — Security and operational baseline

1. Re-audit the old security backlog against current source.
2. Fix only reproducible critical/high issues with regression tests and DNB
   validation.
3. Activate monitoring, alert routing, and incident runbooks.

### Stage 2 — Governance foundation

1. Complete permission-aware context contract.
2. Deliver AI governance dashboard using existing execution/approval data.
3. Design and, only after policy approval, implement approval deadline and
   escalation.

### Stage 3 — Data and integration foundation

1. Define and verify KPI materialized views.
2. Establish API contract documentation and drift checks.
3. Plan async OCR as a separate epic after queue operating rules are approved.

### Suggested first implementation slice

If Product Owner requires a single bounded Sprint 10 feature after release
prerequisites are satisfied, select:

> **AI Governance Dashboard + permission-aware read contract**

Reason:

- Existing data tables and governance runtime already exist.
- It creates visible business value for audit/compliance.
- It does not require a new payment/accounting boundary.
- It forces tenant-scope and PII rules to become explicit.
- It is smaller and safer than starting a new event bus, vector database, or
  multi-agent platform.

## 9. Final Recommendation

1. **Do not start implementation Sprint 10 yet.** Sprint 09 release verification
   and production-readiness blockers remain open.
2. Treat **S10-A** as a separate release/QA epic, not as a feature inside
   Sprint 10.
3. Make **Security Delta Audit** the first technical discovery gate, because
   the old Master Fix Plan contains findings that may already be stale.
4. After the release gate is safe, prioritize **Observability** and
   **Permission-Aware AI Governance**.
5. Choose one bounded vertical slice for the actual Sprint 10 commitment; do
   not combine approval engine, vector search, OCR queue, event bus, and
   microservice decomposition in one sprint.
6. Keep the existing fail-closed production gate unchanged.
7. Update the stale sprint index and create a formal Sprint 10 requirement
   document only after Product Owner approval of scope.

### Final planning verdict

- ✅ Sprint 09 remains closed.
- ✅ Sprint 10 planning/discovery is prepared.
- ⚠️ Sprint 10 implementation has **not started**.
- ⚠️ Release verification and production readiness remain prerequisites.
- ❌ No feature implementation, migration, endpoint, service, test, or refactor
  was performed for Sprint 10.
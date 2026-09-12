# Sprint 10 — Business Decisions

**Tanggal:** 2026-08-10  
**Status:** Business decision closure — **APPROVED**
**Implementation:** **NOT STARTED**  
**Sumber of truth:**

- `docs/sprints/SPRINT-10_PLANNING_DISCOVERY.md`
- `docs/sprints/SPRINT-10_SCOPE_LOCK.md`
- `docs/sprints/SPRINT-10_ARCHITECTURE_LOCK.md`

> Dokumen ini hanya mengunci dan merangkum keputusan bisnis Sprint 10.
> Dokumen ini bukan implementasi, coding, refactor, migration, schema,
> endpoint, service, database change, test, runtime harness, workflow, atau
> konfigurasi.

## 1. Executive Summary

Sprint 09 tetap ditutup sebagai **implementation complete** dan **development
complete**, dengan repository verification gap dan production readiness yang
masih **NO-GO**. Sprint 09 memiliki boundary yang sudah disetujui:

```text
Marketplace AP preparation → waiting_payment
  → Payment lifecycle
  → Accounting evidence handoff
  → Bank Reconciliation reference link
```

Sprint 10 tidak boleh menyerap verification backlog Sprint 09, tidak boleh
mengubah payment/accounting/reconciliation authority, dan tidak boleh
memperlakukan scope lock sebagai bukti production GO.

Scope Sprint 10 yang terkunci:

1. **S10-B — Security Delta Audit & Tenant Isolation Hardening**
2. **S10-C — Centralized Monitoring & Incident Readiness**
3. **S10-F — Permission-Aware Operational Context**
4. **S10-D — AI Execution Audit Trail & Governance Dashboard**

Urutan dependency yang dipertahankan:

```text
S10-A release/QA prerequisite
  → S10-B security evidence
  → S10-C operational readiness
  → S10-F permission-aware context
  → S10-D governance dashboard
```

Repository evidence cukup untuk menetapkan recommendation teknis berikut:

- gunakan bounded module dan komponen existing;
- lakukan security delta berdasarkan reproduksi, bukan label finding lama;
- gunakan `contextOrchestrator` sebagai satu-satunya context builder;
- terapkan actor-specific projection setelah context retrieval;
- buat governance dashboard read-only;
- pertahankan `ai_agent_executions` dan `ai_approval_queue` sebagai source of
  truth;
- jangan memperlakukan company selection dari browser sebagai authorization;
- evidence security/environment yang unknown bukan PASS.

Product Owner telah menyetujui opsi final untuk keenam ADR pada 2026-08-10.
Business approval ini menyelesaikan G-00, tetapi belum mengaktifkan implementasi
atau operational/runtime gate. S10-A/G-01 dan G-02 sampai G-05 tetap wajib.

Detail implementasi dan evidence yang masih diperlukan:

- provider dan channel monitoring;
- retensi evidence monitoring dan format export insiden;
- definisi metric dan denominator governance;
- klasifikasi data AI dan periode retensi;
- semantics branch/division untuk consolidated governance;
- metadata model/token/cost yang boleh dilihat oleh setiap persona.

### Decision closure verdict

> ✅ **Sprint 10 Business Decisions Approved**
>
> 9 keputusan arsitektur: **APPROVED**  
> 6 business decisions: **APPROVED by Product Owner**
> G-00: **RESOLVED**
> Sprint 10 implementation: **NOT IMPLEMENTED**

## 2. Decision Register

### 2.1 Keputusan yang sudah approved

| Decision ID | Feature | Topic | Status | Owner | Consequence |
|---|---|---|---|---|---|
| ADR-10B-001 | Cross-feature | Reuse bounded modules, bukan platform rewrite | APPROVED | Technical Lead | Scope tetap kecil dan ownership domain existing dipertahankan. |
| ADR-10B-002 | S10-B / release | S10-A release verification tetap terpisah dari feature implementation | APPROVED | Release Lead | Evidence Sprint 09 tidak boleh dilabel ulang sebagai delivery Sprint 10. |
| ADR-10B-003 | S10-F | `contextOrchestrator` menjadi satu-satunya operational context builder | APPROVED | Architecture Owner | Tidak ada context builder kedua atau aggregation logic paralel. |
| ADR-10B-004 | S10-F | Actor-specific projection dijalankan setelah retrieval dan sebelum AI consumption | APPROVED | Security Owner | Cache reuse tidak boleh melewati permission dan redaction. |
| ADR-10B-005 | S10-D | Governance Dashboard read-only pada locked slice | APPROVED | Product Owner / Finance | Dashboard tidak memperoleh authority untuk approval, payment, accounting, atau journal. |
| ADR-10B-006 | S10-D | `ai_agent_executions` canonical untuk execution evidence | APPROVED | AI Owner | Tidak dibuat audit source paralel untuk execution. |
| ADR-10B-007 | S10-D | `ai_approval_queue` canonical untuk approval evidence dan mutation | APPROVED | Finance Owner | Dashboard tidak berubah menjadi approval engine. |
| ADR-10B-008 | S10-F / S10-D | Browser company selection hanya hint, bukan authorization | APPROVED | Security Owner | Scope selalu di-resolve dan divalidasi server-side. |
| ADR-10B-009 | S10-B / release | Unknown security/environment evidence bukan PASS | APPROVED | Release Lead | Production posture tetap fail-closed. |

### 2.2 Keputusan yang telah disetujui Product Owner

| Decision ID | Feature | Topic | Status | Owner | Resolution gate |
|---|---|---|---|---|---|
| ADR-10B-010 | S10-C | Monitoring provider dan alert channel | APPROVED | DevOps | Opsi C disetujui Product Owner; DevOps tetap memilih provider/channel konkret dan menyelesaikan G-03. |
| ADR-10B-011 | S10-D | Governance metric definitions dan denominator policy | APPROVED | Product Owner / Finance | Opsi B disetujui; metric dictionary dan G-05 evidence tetap wajib. |
| ADR-10B-012 | S10-F / S10-D | Field-level AI data classification dan retention period | APPROVED | Security / Product Owner | Opsi B disetujui dengan Opsi C sebagai kontrol sementara sampai implementasi Opsi B selesai. |
| ADR-10B-013 | S10-F / S10-D | Branch/division scope untuk consolidated governance views | APPROVED | Product Owner / Org Owner | Opsi B disetujui dengan Opsi C sebagai fallback sementara sampai implementasi Opsi B selesai. |
| ADR-10B-014 | S10-C | External monitoring evidence retention dan incident export format | APPROVED | DevOps / Operations | Opsi B disetujui Product Owner; DevOps/Operations tetap menerjemahkan policy dan menyelesaikan G-03. |
| ADR-10B-015 | S10-D | Persona-level visibility untuk model/token/cost metadata | APPROVED | Product Owner / Finance | Opsi B disetujui dengan Opsi C sebagai fallback sementara sampai implementasi Opsi B selesai. |

### 2.3 Status interpretation

- **APPROVED:** dapat menjadi invariant desain, tetapi belum berarti
  implementasi atau production activation sudah disetujui.
- **PENDING:** keputusan operasional belum dipilih atau belum lengkap.
- **REQUIRES PRODUCT OWNER:** policy/business authority belum ditetapkan oleh
  pihak yang berwenang. Tidak ada ADR Sprint 10 yang masih berada pada status
  ini setelah approval 2026-08-10.
- **REJECTED:** tidak ada pada decision register Sprint 10 saat ini.

## 3. Decision Matrix

| Feature | Decision ID | Decision question | Status | Current recommendation | Owner | Blocking implementation? |
|---|---|---|---|---|---|---|
| S10-B | ADR-10B-001 | Apakah Sprint 10 membangun platform security/AI baru? | APPROVED | Tidak; reuse bounded modules dan security boundary existing. | Technical Lead | No |
| S10-B | ADR-10B-002 | Apakah release verification Sprint 09 menjadi feature Sprint 10? | APPROVED | Tidak; S10-A tetap release/QA epic terpisah. | Release Lead | No |
| S10-B | ADR-10B-009 | Bagaimana memperlakukan evidence security/environment yang unknown? | APPROVED | Fail-closed; unknown bukan PASS. | Release Lead | No |
| S10-C | ADR-10B-010 | Provider dan channel alert apa yang digunakan? | APPROVED | Opsi C disetujui; provider/channel konkret, owner, dan G-03 evidence tetap harus diselesaikan DevOps. | DevOps | **Yes — technical/operational gate** |
| S10-C | ADR-10B-014 | Berapa lama evidence disimpan dan bagaimana incident diekspor? | APPROVED | Opsi B disetujui; structured redacted evidence bundle tetap menunggu provider/runbook mapping dan G-03. | DevOps / Operations | **Yes — technical/operational gate** |
| S10-F | ADR-10B-003 | Apakah dibuat orchestrator kedua? | APPROVED | Tidak; `contextOrchestrator` tetap single builder. | Architecture Owner | No |
| S10-F | ADR-10B-004 | Kapan permission projection diterapkan? | APPROVED | Setelah retrieval/cache dan sebelum AI/tool consumption. | Security Owner | No |
| S10-F | ADR-10B-008 | Apakah browser company selection dapat memperluas scope? | APPROVED | Tidak; hanya hint dan selalu diverifikasi server-side. | Security Owner | No |
| S10-F | ADR-10B-012 | Data AI apa yang boleh digunakan, dilihat, dicatat, dan berapa lama? | APPROVED | Opsi B disetujui dengan Opsi C sebagai kontrol sementara; G-04/G-05 tetap wajib. | Security / Product Owner | **Yes — technical gate** |
| S10-F | ADR-10B-013 | Apa arti branch/division dalam consolidated view? | APPROVED | Opsi B disetujui dengan Opsi C sebagai fallback sementara; G-04 tetap wajib. | Product Owner / Org Owner | **Yes — technical gate** |
| S10-D | ADR-10B-005 | Apakah dashboard dapat mengubah approval atau business state? | APPROVED | Tidak; read-only bounded slice. | Product Owner / Finance | No |
| S10-D | ADR-10B-006 | Source of truth execution evidence apa? | APPROVED | `ai_agent_executions`. | AI Owner | No |
| S10-D | ADR-10B-007 | Source of truth approval evidence apa? | APPROVED | `ai_approval_queue`. | Finance Owner | No |
| S10-D | ADR-10B-011 | Metric governance apa yang ditampilkan dan bagaimana denominator dihitung? | APPROVED | Opsi B disetujui; metric dictionary, unknown/partial semantics, dan G-05 tetap wajib. | Product Owner / Finance | **Yes — technical gate** |
| S10-D | ADR-10B-015 | Persona mana yang boleh melihat model/token/cost? | APPROVED | Opsi B disetujui dengan Opsi C sebagai fallback sementara; visibility matrix dan G-05 tetap wajib. | Product Owner / Finance | **Yes — technical gate** |

## 4. Feature Decisions

## 4.1 S10-B — Security Delta Audit & Tenant Isolation Hardening

### Decision summary

| Field | Decision |
|---|---|
| Decision ID | ADR-10B-001, ADR-10B-002, ADR-10B-009 |
| Topic | Evidence-driven security delta, tenant isolation, dan release boundary |
| Current State | Scope sudah locked sebagai conditional P0/P1 gate. Finding lama belum boleh dianggap current tanpa reproduksi. S10-A release/QA tetap terpisah dan production masih fail-closed. |
| Business Context | Governance dan AI read features tidak boleh dibangun di atas security finding yang stale atau tenant proof yang belum tersedia. |
| Existing Repository Evidence | Existing `authMiddleware`, `requireAdmin`, `requireRole`, `requireClerkUser`, `assertCompanyAccess`, company/branch resolution, rate limiter, audit patterns, security tests, staging E2E harness, dan fail-closed release gate. |
| Available Options | (A) Blind-fix seluruh backlog lama; (B) abaikan backlog lama; (C) reproduce current source/staging, klasifikasikan finding, lalu remediate hanya yang reproducible. |
| Recommendation | **Option C.** Gunakan finding register dengan identity, reproduction, severity, owner, decision, regression/DNB evidence, dan rollback reference. |
| Architecture Impact | Hardening ditempatkan pada boundary middleware, scope resolver, validation, constraint, atau service yang tepat; tidak memindahkan ownership domain. |
| Security Impact | Same-company allow, cross-company deny, branch boundary, admin exception, rate limits, SSRF/validation, dan cleanup harus dibuktikan berdasarkan evidence. |
| Operational Impact | Membutuhkan dedicated staging identity, cleanup safety, threat-model/security owner, regression matrix, DNB validation, dan rollback plan. |
| Risk | Finding stale bisa menimbulkan perubahan tidak perlu; finding reproducible yang tidak ditangani dapat membuka cross-tenant exposure. |
| Decision Required | Tidak ada business decision terbuka pada prinsip ini. Execution gate tetap menunggu S10-A evidence dan finding reproduction. |

### Boundary

S10-B tidak boleh mengubah Marketplace AP preparation, Payment lifecycle,
Accounting handoff, atau Reconciliation reference link. Defect Sprint 09 yang
ditemukan harus dicatat sebagai evidence-backed defect dengan boundary impact
eksplisit, bukan diubah diam-diam sebagai kontrak baru.

## 4.2 S10-C — Centralized Monitoring & Incident Readiness

### Decision summary

| Field | Decision |
|---|---|
| Decision ID | ADR-10B-010, ADR-10B-014 |
| Topic | Provider, alert routing, threshold, incident evidence, owner, dan SLA |
| Current State | Signal inventory dan `docs/operations/monitoring-matrix.md` sudah tersedia. Monitoring stack belum dikonfigurasi; provider/channel serta external evidence policy belum dipilih. |
| Business Context | Downtime, callback failure, queue backlog, database pressure, SSE degradation, integration failure, dan error spike harus sampai ke owner yang dapat merespons dalam SLA. |
| Existing Repository Evidence | Health/readiness endpoints, worker heartbeat, integration health, system observability, notification/accounting outbox patterns, structured logger, deployment health evidence, dan monitoring matrix dengan target threshold/routing. |
| Available Options | (A) konfigurasi beberapa platform sekaligus; (B) membangun observability platform baru; (C) pilih satu provider adapter tipis, designated channel, owner roster, threshold, runbook, dan evidence bundle. |
| Recommendation | **Option C.** Provider choice harus eksplisit dan tidak boleh diasumsikan dari contoh pada monitoring matrix. Gunakan signal normalizer, deduplication, cooldown, recovery, escalation, dan P0–P3 SLA. |
| Architecture Impact | Tambahkan adapter/policy secara bounded di sekitar signal existing; tidak membuat event bus atau polling loop platform baru. |
| Security Impact | Jangan kirim secret, auth token, raw business payload, PII, raw AI prompt/output, atau credential ke provider/log. Detailed operational data tetap permissioned. |
| Operational Impact | Membutuhkan provider/channel, on-call owner, threshold approval, runbook, test alert yang di-acknowledge, retention, dan incident export format. |
| Risk | Provider outage dapat disalahartikan sebagai app outage; alert fatigue dapat membuat monitoring dekoratif; evidence dapat tidak audit-ready tanpa retention policy. |
| Decision Required | **ADR-10B-010:** DevOps memilih provider dan channel. **ADR-10B-014:** DevOps/Operations menetapkan retention dan export format. |

### Recommendation on existing evidence

Monitoring matrix dapat menjadi baseline kandidat threshold, tetapi statusnya
bukan approval final untuk activation. Threshold harus dikalibrasi dengan
baseline nyata dan setiap signal harus dipetakan ke owner yang accountable.

## 4.3 S10-F — Permission-Aware Operational Context

### Decision summary

| Field | Decision |
|---|---|
| Decision ID | ADR-10B-003, ADR-10B-004, ADR-10B-008, ADR-10B-012, ADR-10B-013 |
| Topic | Context projection berdasarkan actor, role, company, branch, purpose, dan classification |
| Current State | `contextOrchestrator` dan context cache existing tersedia. Contract permission-aware, classification, allowlist, dan consolidated branch/division semantics belum lengkap sebagai business policy. |
| Business Context | AI dan operational assistant hanya boleh menerima context yang sesuai authority. Kesalahan scope dapat menyebabkan data leakage atau keputusan operasional yang salah. |
| Existing Repository Evidence | `buildOrderContext`, `buildShipmentContext`, `OperationalContext`, 30-second cache/invalidation, server-side user `companyId`, `CompanyContext` display hint, `assertCompanyAccess`, role/custom-role checks, AI governance linkage, dan route/tool rate limits. |
| Available Options | (A) membuat context builder kedua; (B) memberikan broad context ke seluruh consumer; (C) reuse builder/cache lalu menerapkan permission-aware projection, classification, dan tool allowlist sebelum consumption. |
| Recommendation | **Option C.** Default deny/minimize untuk missing scope, personal data, financial detail, credential, raw prompt/output, restricted data, dan cross-company records. |
| Architecture Impact | `contextOrchestrator` tetap single builder; actor-specific projector, classification registry, tool allowlist, dan access audit menjadi design contracts sebelum implementation. |
| Security Impact | Authorization ditentukan server-side. Consolidated mode memerlukan allowed-company set dan tidak boleh menjadi unrestricted all-company access. Cache tanpa scope identity tidak boleh digunakan untuk actor/policy lain tanpa projection ulang. |
| Operational Impact | Membutuhkan negative isolation proof untuk cross-company, cross-branch, consolidated mode, missing scope, stale session context, access audit, dan correlation ID. |
| Risk | Projection terlalu longgar membocorkan data; projection terlalu ketat menghilangkan context penting; semantics branch/division yang ambigu membuat hasil tidak konsisten. |
| Decision Required | **ADR-10B-012:** Security/Product Owner menyetujui classification dan retention. **ADR-10B-013:** Product/Org Owner menyetujui branch/division dan consolidated visibility. |

### Default policy pending approval

Sebelum policy final, context sensitif harus **redacted atau denied**, bukan
diterka dari UI state. Browser `companyQueryParam` dan consolidated selection
hanya intent/hint; server wajib resolve actor, resource owner, company, branch,
role, permission, dan purpose.

## 4.4 S10-D — AI Execution Audit Trail & Governance Dashboard

### Decision summary

| Field | Decision |
|---|---|
| Decision ID | ADR-10B-005, ADR-10B-006, ADR-10B-007, ADR-10B-011, ADR-10B-015 |
| Topic | Read-only AI governance visibility atas execution dan approval evidence |
| Current State | Existing AI execution/approval records dan review query patterns tersedia. Dashboard read contract, metric dictionary, redaction/retention policy, dan persona-level metadata visibility belum final. |
| Business Context | Finance, Operations, dan Security membutuhkan visibility yang dapat diaudit tanpa memperoleh raw prompt/output, data lintas company, atau authority baru. |
| Existing Repository Evidence | `aiGovernance` lifecycle methods, `ai_agent_executions`, `ai_approval_queue`, `aiApprovals` route patterns, `useAiReview`, company/role scope, `assertCompanyAccess`, audit/access logging, dan existing review/observability surfaces. |
| Available Options | (A) dashboard global dengan raw data; (B) audit source dan approval engine baru; (C) scoped read model atas canonical tables dengan redacted DTO, bounded pagination, explicit metrics, freshness, dan access audit. |
| Recommendation | **Option C.** Implementasi pertama harus read-only, server-scoped, redacted, paginated, dan tidak memblokir AI execution atau approval writes. |
| Architecture Impact | Governance read contract, permission-aware query service, metric definitions, redacted projection, UI states, dan access audit menjadi design/implementation boundary; tidak membuat AI platform baru. |
| Security Impact | Aggregate dihitung setelah scope filter; raw prompt/output, sensitive `context_data`, credentials, dan unrestricted tenant rows dilarang secara default. Unauthorized access harus generic 401/403 tanpa membocorkan tenant counts. |
| Operational Impact | Dashboard memerlukan partial/stale/error states, `as of` metadata, query latency/error telemetry, access/redaction counts, retention, dan bounded date/page/filter limits. |
| Risk | Metric yang salah atau stale menciptakan false compliance confidence; cost/model metadata dapat sensitif; concurrent approval transitions membuat dashboard eventually consistent. |
| Decision Required | **ADR-10B-011:** Product/Finance menetapkan metric/denominator. **ADR-10B-012:** classification/retention. **ADR-10B-015:** persona visibility model/token/cost. |

### Read-only invariant

Dashboard tidak boleh:

- menulis atau mengubah `ai_agent_executions` atau `ai_approval_queue`;
- resolve, approve, reject, undo, execute, atau retry AI action;
- memanggil payment/accounting mutation path;
- mengubah journal, payment, settlement, atau reconciliation;
- menjadi parallel source of truth untuk AI governance.

## 5. Architecture Impact

### Locked decisions

1. Sprint 10 menggunakan bounded existing modules, bukan platform rewrite.
2. `contextOrchestrator` tetap menjadi single operational context builder.
3. Projection permission-aware dilakukan setelah retrieval dan sebelum AI/tool
   consumption.
4. Governance dashboard adalah read-only dan memakai canonical execution/
   approval records.
5. Server tetap authoritative atas identity, role, company, branch, resource
   ownership, permission, redaction, dan business values.
6. S10-A tetap release/QA prerequisite terpisah.

### Design boundaries

- Tidak ada second orchestrator, vector store, event bus, AI gateway platform,
  approval automation engine, atau payment/accounting boundary baru.
- S10-C mengonsumsi signal existing dan menggunakan adapter/policy tipis.
- S10-F menjadi permission boundary sebelum AI/tool consumer.
- S10-D menjadi scoped read projection di atas data governance canonical.

### Dependency gates

| Gate | Required evidence before activation |
|---|---|
| S10-A | Dedicated staging identity, release E2E, backup/restore, rollback, monitoring evidence, sign-off |
| S10-B | Frozen finding register, current reproduction/decision, tenant proof, regression/DNB, rollback |
| S10-C | Provider/channel, owner, threshold approval, test alert, runbook, SLA |
| S10-F | Permission contract, classification/allowlist, isolation proof, audit evidence |
| S10-D | Scoped read contract, redaction/PII review, metric definitions, dashboard acceptance |

## 6. Security Impact

Security posture yang dikunci:

- internal staff route memerlukan authenticated internal session;
- bearer portal/mobile tidak dipromosikan menjadi internal staff melalui client
  metadata;
- user role/company context dimuat server-side;
- resource ownership diperiksa dengan `assertCompanyAccess`;
- cross-company admin access yang memang diizinkan menghasilkan audit event;
- non-admin cross-company access mendapat generic denial;
- rate limits tetap menjadi security boundary;
- SQL/filter/pagination tetap bounded dan parameterized;
- prompt, output, token, secret, credential, dan personal data tidak masuk
  operational logs atau monitoring payload;
- unknown environment/database identity memblok fixture writes dan security
  proof;
- aggregate governance dihitung setelah scope filtering;
- default untuk sensitive context adalah redaction atau denial.

Business decisions yang belum ditutup langsung memengaruhi security:

1. Klasifikasi field dan retention menentukan apa yang boleh disimpan atau
   diekspor.
2. Branch/division semantics menentukan apakah consolidated view tetap tenant
   safe.
3. Model/token/cost visibility menentukan exposure metadata yang mungkin
   sensitif secara finansial atau operasional.

## 7. Operational Impact

### Owner dan response

Monitoring activation memerlukan ownership roster yang nyata, bukan hanya
nama role. Baseline `docs/operations/monitoring-matrix.md` sudah memetakan
komponen, threshold target, verification, owner, severity, channel, dan SLA,
tetapi provider/channel dan activation policy belum dipilih.

### Minimum operational evidence

- test alert mencapai designated channel dan di-acknowledge;
- P0–P3 runbook dan response SLA tersedia;
- deduplication, cooldown, escalation, dan recovery terbukti;
- signal `healthy`, `degraded`, `critical`, dan `unknown` dibedakan;
- incident evidence memiliki timestamp, correlation ID, owner, response, dan
  redacted export;
- dashboard menampilkan freshness/partial/error state;
- query latency, permission denial, redaction, refresh failure, dan source
  availability dapat diawasi tanpa raw sensitive payload.

### Data handling

Tidak ada keputusan final untuk external monitoring retention atau AI data
retention. Sampai disetujui, gunakan minimization dan fail-closed behavior:
jangan mengirim atau menampilkan data sensitif hanya karena provider atau UI
tersedia.

## 8. Dependency Review

| Dependency | Owner | Current state | Impact |
|---|---|---|---|
| S10-A release/QA prerequisite | Release Lead / DevOps | Open; production NO-GO | Feature implementation berisiko tidak boleh dimulai sebelum environment/evidence gate jelas. |
| S10-B current security reproduction | Technical Lead / Security | Design ready; runtime evidence belum dihasilkan pada phase ini | S10-C/S10-F progression membutuhkan finding decision dan tenant proof. |
| Monitoring provider/channel | DevOps | APPROVED — business option | Opsi C disetujui Product Owner; concrete provider/channel dan G-03 tetap wajib. |
| Monitoring retention/export | DevOps / Operations | APPROVED — business option | Opsi B disetujui Product Owner; mapping dan G-03 tetap wajib. |
| Auth user-role/company contract | Security / Backend | Existing contract identified | Prasyarat S10-F; tidak boleh melemahkan role/company authorization. |
| Classification and retention policy | Security / Product Owner | APPROVED — business option | Opsi B disetujui dengan Opsi C interim sampai implementasi B selesai; G-04/G-05 tetap wajib. |
| Branch/division semantics | Product Owner / Org Owner | APPROVED — business option | Opsi B disetujui dengan Opsi C interim sampai implementasi B selesai; G-04 tetap wajib. |
| Tool/data allowlist | Security / Product Owner | Design requirement identified | Memblok AI context exposure. |
| Governance metric dictionary | Product Owner / Finance | APPROVED — business option | Opsi B disetujui; metric evidence dan G-05 tetap wajib. |
| Persona model/token/cost visibility | Product Owner / Finance | APPROVED — business option | Opsi B disetujui dengan Opsi C interim sampai implementasi B selesai; G-05 tetap wajib. |
| Canonical AI records | AI Owner / Finance Owner | Existing: `ai_agent_executions`, `ai_approval_queue` | Tidak boleh digantikan atau diduplikasi. |

### Sprint 09 overlap review

Tidak ada keputusan Sprint 10 yang mengubah kontrak berikut:

| Sprint 09 boundary | Sprint 10 treatment |
|---|---|
| Marketplace AP berhenti di `waiting_payment` | Tidak diubah. |
| Payment approval, execution, retry, failure, cancellation, idempotency | Tidak diubah oleh governance scope. |
| Accounting journal dan posting | Tidak dibuat atau dimutasi oleh S10-D. |
| Settlement dan bank reconciliation | Tidak diubah oleh S10-B/S10-C/S10-F/S10-D. |
| Runtime proof 09A–09E dan dedicated HTTP E2E | Tetap release/QA verification backlog. |
| S10-A production readiness | Tetap prerequisite terpisah, bukan feature implementation. |

Jika audit security menemukan defect pada route Sprint 09, defect tersebut
harus memiliki reproduction, boundary impact, owner, remediation decision,
regression/DNB, dan rollback evidence sebelum dianggap sebagai perubahan yang
diperlukan.

## 9. Approved Decisions — Implementation Conditions

### APPROVED — operational decisions with execution conditions

#### ADR-10B-010 — Monitoring provider and alert channel

**Owner:** DevOps  
**Required outcome:**

- satu provider/adapter yang dipilih atau keputusan eksplisit untuk local-only
  evidence;
- designated on-call channel;
- cost and retention constraints;
- owner roster dan escalation route;
- batas data yang boleh dikirim.

**Gate:** S10-C tidak aktif sebelum provider, channel, owner, threshold, test
alert, runbook, dan SLA lengkap.

#### ADR-10B-014 — External monitoring retention and incident export

**Owner:** DevOps / Operations  
**Required outcome:**

- retention period dan legal/operational rationale;
- redacted export format;
- timestamp, correlation ID, owner, severity, acknowledgement, mitigation,
  recovery, dan post-incident reference;
- access control dan deletion policy.

**Gate:** Incident evidence tidak dianggap audit-ready hanya karena alert
berhasil dikirim.

### APPROVED — business and security policy

#### ADR-10B-011 — Governance metrics and denominators

**Owner:** Product Owner / Finance  
**Required outcome:**

- definisi execution count dan unit of count;
- completion/failure rate dan denominator;
- approval rate dan treatment untuk cancelled/expired;
- pending/expired semantics;
- confidence/latency/token/cost formulas;
- freshness, partial source, unknown, dan not-available treatment.

**Recommendation:** Jangan mengisi missing value sebagai zero atau success.
Metric harus membawa `as of`/freshness dan source completeness.

#### ADR-10B-012 — AI data classification and retention

**Owner:** Security / Product Owner  
**Required outcome:**

- field registry untuk `operational`, `financial-summary`, `personal`,
  `credential`, dan `restricted`;
- raw prompt/output dan `context_data` policy;
- redaction rule per consumer;
- retention, deletion, legal hold, dan external-monitoring export policy.

**Interim control:** Default deny/redact untuk credential, raw prompt/output,
unrestricted context, personal data, dan restricted data sampai implementasi
Opsi B selesai sepenuhnya.

#### ADR-10B-013 — Branch/division semantics

**Owner:** Product Owner / Org Owner  
**Required outcome:**

- definisi branch/division dan ownership;
- allowed-company set untuk consolidated mode;
- apakah admin dapat melihat lintas branch/company dan dalam kondisi apa;
- exception/audit requirement;
- missing atau ambiguous scope behavior.

**Recommendation:** Consolidated UI tidak pernah berarti unrestricted access.
Server harus memvalidasi allowed-company dan branch set.

#### ADR-10B-015 — Model/token/cost visibility

**Owner:** Product Owner / Finance  
**Required outcome:**

- metadata apa yang boleh dilihat Finance, Operations, Security, Admin, dan
  role lain;
- apakah cost/token totals boleh menjadi aggregate;
- apakah model name/version bersifat restricted;
- redaction dan audit untuk detail-on-demand.

**Recommendation:** Expose only authoritative, persona-allowed summaries;
raw provider credentials dan sensitive execution payload tetap dilarang.

## 10. Recommendation

1. **Jangan mulai implementasi Sprint 10** hanya berdasarkan business approval.
   S10-A/G-01 dan technical gates G-02 sampai G-05 harus memiliki evidence dan
   sign-off terlebih dahulu.
2. Pertahankan S10-A sebagai release/QA epic terpisah dan selesaikan dedicated
   staging, secret rotation owner verification, HTTP E2E, backup/restore,
   rollback, monitoring evidence, dan sign-off sesuai release gate.
3. Setelah S10-A siap, mulai dengan S10-B: revalidate finding terhadap source
   dan environment yang tepat, bekukan DNB scope, lalu simpan evidence.
4. Gunakan monitoring matrix existing sebagai candidate inventory, tetapi
   pilih provider/channel, threshold, owner, runbook, retention, dan SLA secara
   eksplisit sebelum S10-C activation.
5. Selesaikan S10-F sebelum membuka AI context atau governance reads:
   permission contract, classification, tool/data allowlist, branch/company
   semantics, negative isolation proof, dan access audit.
6. Gunakan AI Governance Dashboard sebagai bounded first product-visible slice
   setelah S10-F, dengan read-only scoped DTO, redaction default, explicit
   metric dictionary, pagination, freshness, dan partial/error states.
7. Pertahankan canonical ownership `ai_agent_executions` dan
   `ai_approval_queue`; jangan membuat audit source atau approval engine kedua.
8. Jangan mengimplementasikan S10-E, S10-G, atau S10-H pada scope ini. S10-I
   dan L1 tetap documentation work terpisah.
9. Jangan menyatakan production GO berdasarkan dokumen ini atau architecture
   lock saja.

### Final verdict

> ✅ **Sprint 10 Business Decisions Approved**
>
> Keenam business decisions telah disetujui Product Owner pada 2026-08-10.
> Persetujuan ini menyelesaikan G-00, tetapi belum cukup untuk implementation
> authorization karena S10-A/G-01 dan technical gates G-02 sampai G-05 masih
> memerlukan evidence.
>
> ✅ Sprint 09 boundaries preserved  
> ✅ Sprint 10 scope preserved  
> ✅ Recommendations recorded  
> ❌ Sprint 10 implementation: **NOT IMPLEMENTED**
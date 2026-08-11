# Sprint 10 — Implementation Master Plan

**Tanggal:** 2026-08-10  
**Status:** Master plan complete — implementation **NOT STARTED**  
**Implementation authorization:** **CONDITIONAL / NOT YET AUTHORIZED**

**Source of truth:**

- `docs/sprints/SPRINT-10_PLANNING_DISCOVERY.md`
- `docs/sprints/SPRINT-10_SCOPE_LOCK.md`
- `docs/sprints/SPRINT-10_ARCHITECTURE_LOCK.md`
- `docs/sprints/SPRINT-10_BUSINESS_DECISIONS.md`

> Dokumen ini adalah rencana implementasi. Dokumen ini bukan implementasi,
> coding, refactor, migration, schema, endpoint, service, database change,
> test, runtime harness, workflow, atau konfigurasi.

## 1. Executive Summary

Sprint 09 tetap **CLOSED**, dengan implementation/development complete tetapi
repository verification gap dan production readiness masih **NO-GO**. Sprint
09 boundaries tidak boleh diubah oleh Sprint 10:

```text
Marketplace AP preparation → waiting_payment
  → Payment lifecycle
  → Accounting evidence handoff
  → Bank Reconciliation reference link
```

Sprint 10 adalah bounded governance dan operational-safety scope yang terdiri
dari:

1. **S10-B — Security Delta Audit & Tenant Isolation Hardening**
2. **S10-C — Centralized Monitoring & Incident Readiness**
3. **S10-F — Permission-Aware Operational Context**
4. **S10-D — AI Execution Audit Trail & Governance Dashboard**

S10-A adalah release/QA prerequisite terpisah. S10-E, S10-G, dan S10-H tetap
future backlog; S10-I dan L1 tetap documentation work terpisah.

### Master plan verdict

> ✅ Work Breakdown Structure, roadmap, dependency, test, release, risk, dan
> execution plan telah disusun.
>
> ⏸️ Implementasi belum boleh dimulai. Business Decisions telah disetujui
> Product Owner dan G-00 terselesaikan, tetapi S10-A release gate serta G-02
> sampai G-05 technical/operational gates masih terpisah dan belum ditutup.
>
> ✅ Sprint 10 Master Plan Ready as a conditional baseline  
> ❌ Sprint 10 implementation: **NOT IMPLEMENTED**

## 2. Implementation Strategy

### 2.1 Strategy principles

Seluruh implementasi yang kelak diotorisasi harus:

- **Additive:** menambah contract, projection, evidence, atau read capability
  tanpa menghapus kontrak existing.
- **Backward compatible:** consumer existing tetap bekerja; perubahan kontrak
  harus versioned atau memiliki compatibility path.
- **Server authoritative:** identity, role, company, branch, resource
  ownership, permission, redaction, metric, dan business value diputuskan
  server-side.
- **Tenant isolated:** scope diterapkan sebelum detail query, pagination,
  aggregation, cache reuse, atau serialization.
- **Idempotent:** repeated evidence ingestion, alert deduplication, context
  cache/invalidation, dan dashboard reads tidak membuat duplicate effect.
- **Audit-friendly:** access, decision, redaction, alert, dan remediation
  evidence dapat ditelusuri tanpa logging secret atau raw AI payload.
- **Fail-closed:** unknown environment, unknown scope, ambiguous policy, atau
  unavailable authority tidak berubah menjadi PASS atau unrestricted access.
- **Read/evidence bounded:** S10-D membaca governance evidence; tidak menjadi
  approval engine, payment executor, accounting writer, atau reconciliation
  mutator.

### 2.2 Locked architecture

- Reuse bounded modules; tidak ada platform rewrite.
- `contextOrchestrator` tetap satu-satunya operational context builder.
- Actor-specific projection diterapkan setelah context retrieval/cache dan
  sebelum AI/tool consumption.
- `ai_agent_executions` tetap canonical untuk execution evidence.
- `ai_approval_queue` tetap canonical untuk approval evidence dan mutation.
- Browser company selection dan consolidated UI mode hanya hint, bukan
  authorization.
- S10-C memakai adapter/policy tipis di sekitar signal existing, bukan event
  bus atau observability platform baru.
- S10-D adalah read-only governance projection.

### 2.3 Authorization gates

Tidak ada Work Package feature yang boleh masuk implementation execution sebelum
gate berikut terpenuhi:

| Gate | Required decision/evidence |
|---|---|
| G-00 — Business decision | ADR-10B-010 sampai ADR-10B-015 memiliki resolution dan Product Owner sign-off. |
| G-01 — Release/QA | S10-A memiliki dedicated staging identity, HTTP E2E, backup/restore, rollback, monitoring evidence, cleanup, dan sign-off. |
| G-02 — Security | S10-B finding register, current reproduction/decision, tenant proof, regression/DNB, dan rollback evidence tersedia. |
| G-03 — Observability | Provider/channel, owner, threshold, test alert, runbook, SLA, retention, dan export format disetujui. |
| G-04 — Context | Permission contract, classification/retention, tool/data allowlist, branch/company semantics, isolation proof, dan access audit disetujui. |
| G-05 — Dashboard | Scoped read contract, redaction/PII review, metric dictionary, persona visibility, freshness/error states, dan dashboard acceptance tersedia. |

## 3. Work Breakdown Structure

### WBS overview

```text
WP-00  Authorization and release readiness
  ↓
WP-01  Security delta inventory and tenant-isolation proof
  ↓
WP-02  Security hardening and regression evidence
  ↓
WP-03  Observability signal and incident-readiness design
  ↓
WP-04  Observability activation and operational handoff
  ↓
WP-05  Permission-aware context contract and projector
  ↓
WP-06  Context isolation, redaction, and audit verification
  ↓
WP-07  AI governance read contract and metric policy
  ↓
WP-08  AI Governance Dashboard bounded read-only slice
  ↓
WP-09  Integrated acceptance, release evidence, and handoff
```

WP-03 signal inventory and WP-07 UI information architecture may be drafted
in parallel where safe. They must not bypass their blocking decision gates.

### WP-00 — Authorization and release readiness

| Field | Plan |
|---|---|
| **Name** | Authorization and release readiness |
| **Objective** | Menutup S10-A sebagai release/QA prerequisite dan memastikan Business Decision yang diperlukan sudah final sebelum feature implementation. |
| **Business Value** | Mencegah feature governance dibangun di environment yang tidak dapat dibuktikan aman atau di atas policy yang ambigu. |
| **Affected Module** | Release evidence, dedicated staging, secrets/identity ownership, backup/restore, rollback, sign-off, decision documentation. |
| **Dependency** | Planning, scope, architecture, dan business decision documents. |
| **Estimated Complexity** | High — release coordination, bukan feature coding. |
| **Estimated Risk** | Critical jika dilewati; dapat mencampur dev/prod atau memberi false production confidence. |
| **Acceptance Criteria** | Dedicated staging identity tervalidasi; full HTTP E2E, tenant/security/accounting/SSE/cleanup evidence retained; backup/restore dan rollback rehearsal; owner sign-off; seluruh outstanding business decision memiliki resolution. |
| **Definition of Done** | S10-A tetap dilacak sebagai epic terpisah, release matrix lengkap, production gate masih fail-closed sampai semua evidence valid, dan G-00/G-01 ditandatangani. |
| **Reuse Components** | Existing release readiness/evidence matrix, E2E safety guard, environment identity checks, rollback procedure. |
| **New Components** | Tidak ada component runtime baru; hanya evidence/approval artifacts bila diperlukan. |
| **API Impact** | Tidak ada feature API impact. |
| **Database Impact** | Tidak ada database write sebagai bagian master plan. |
| **UI Impact** | Tidak ada. |
| **Security Impact** | Verifikasi identity, secret ownership, tenant isolation environment, dan no-production-mutation guard. |
| **Operational Impact** | Release lead, DevOps, Technical Lead, Security, dan acceptance owner harus sign off. |

### WP-01 — Security delta inventory and tenant-isolation proof

| Field | Plan |
|---|---|
| **Name** | Security delta inventory and tenant-isolation proof |
| **Objective** | Revalidate legacy/current security findings terhadap source dan staging terkini, lalu membekukan decision register berbasis evidence. |
| **Business Value** | Hanya defect yang benar-benar reproducible yang dikerjakan; stale finding tidak memicu perubahan berisiko. |
| **Affected Module** | `authMiddleware`, `requireAdmin`, `requireRole`, `requireClerkUser`, `assertCompanyAccess`, company/branch resolver, rate limiter, audit paths, ecommerce/logistics/webhook/AI/governance reads. |
| **Dependency** | WP-00, current source review, threat model/security owner, dedicated staging, cleanup safety. |
| **Estimated Complexity** | High. |
| **Estimated Risk** | High; false negative dapat membuka tenant exposure, false positive dapat menghasilkan remediation yang tidak perlu. |
| **Acceptance Criteria** | Finding memiliki identity, source reference, current reproduction/decision, severity, affected route/resource, owner, scope, dan explicit status: reproducible, already-fixed, not-reproducible, accepted-risk, atau blocked-by-environment. Same-company allow, cross-company deny, authorized admin exception, branch boundary, dan cleanup terbukti. |
| **Definition of Done** | Frozen finding register, timestamped environment/build identity, current evidence, DNB scope, owner decision, dan rollback reference tersedia. |
| **Reuse Components** | Existing auth/scope middleware, parameterized SQL, rate limiter, audit event patterns, security tests, staging E2E harness. |
| **New Components** | Logical Security Finding Register, Decision Adapter, Scope Proof Fixture Contract, Security Evidence Manifest; design/contract first. |
| **API Impact** | Revalidation seluruh relevant routes; tidak ada API contract change tanpa evidence-backed defect decision. |
| **Database Impact** | Read-only proof by default; constraint change hanya bila finding reproducible dan plan additive/idempotent/rollback-approved. |
| **UI Impact** | Tidak ada feature UI; optional evidence display tetap bukan scope utama. |
| **Security Impact** | Menjadi baseline tenant isolation, auth/RBAC, rate limiting, SSRF/validation, duplicate protection, dan access audit. |
| **Operational Impact** | Memerlukan evidence retention, owner review, DNB, rollback, dan defect routing yang jelas. |

### WP-02 — Security hardening and regression evidence

| Field | Plan |
|---|---|
| **Name** | Bounded security remediation |
| **Objective** | Memperbaiki hanya finding critical/high yang sudah direproduksi dan disetujui, tanpa memindahkan domain ownership. |
| **Business Value** | Mengurangi risiko auth, tenant isolation, dan abuse tanpa memperluas Sprint 10 menjadi rewrite. |
| **Affected Module** | Boundary middleware, scope resolver, validation, constraint, atau service yang ditunjuk finding register. |
| **Dependency** | WP-01 frozen finding register, remediation decision, DNB scope, owner, rollback plan. |
| **Estimated Complexity** | Medium–High per finding. |
| **Estimated Risk** | High; perubahan authorization dapat memblokir legitimate access atau menyentuh Sprint 09 routes. |
| **Acceptance Criteria** | Reproducible finding memiliki remediation bounded, regression evidence, DNB result, rollback evidence, no cross-tenant regression, dan owner sign-off. |
| **Definition of Done** | Semua finding memiliki final disposition; tidak ada blind fix; perubahan yang menyentuh Sprint 09 memiliki explicit boundary impact dan defect approval. |
| **Reuse Components** | Existing middleware, scope helpers, validation/SQL conventions, audit, rate limit, contract tests. |
| **New Components** | Tidak membuat security platform baru; hanya bounded remediation yang disetujui. |
| **API Impact** | Hanya perubahan behavior pada route yang tercantum di finding register; compatibility dan generic denial contract wajib dijaga. |
| **Database Impact** | Additive/constraint-only bila dibutuhkan; migration, backup, idempotency, environment proof, dan rollback wajib direncanakan terpisah sebelum coding. |
| **UI Impact** | Tidak ada perubahan UI yang diperlukan untuk acceptance. |
| **Security Impact** | Positive dan negative authorization behavior harus sama-sama dibuktikan. |
| **Operational Impact** | Rollout bertahap, observability signal, rollback trigger, dan incident owner wajib tersedia. |

### WP-03 — Observability signal and incident-readiness design

| Field | Plan |
|---|---|
| **Name** | Operational signal, owner, and alert policy |
| **Objective** | Mengubah signal existing menjadi inventory, state model, threshold, routing, runbook, dan retention contract yang dapat diaktifkan. |
| **Business Value** | Downtime, callback failure, queue backlog, database pressure, SSE degradation, integration failure, dan error spike dapat diarahkan ke responder yang accountable. |
| **Affected Module** | Health/readiness, workers/queues, database/pool, payment callback telemetry, notification/SSE, storage/SMTP/WhatsApp/Paylabs integration health, deployment/resource signals. |
| **Dependency** | WP-00 dan decision ADR-10B-010/014; S10-B discovery boleh berjalan paralel. |
| **Estimated Complexity** | Medium. |
| **Estimated Risk** | Medium–High; threshold salah menghasilkan alert fatigue atau missed incident. |
| **Acceptance Criteria** | Signal inventory mencakup component, metric, threshold, severity, dedup key, cooldown, owner, channel, SLA, runbook, retention, redaction, dan recovery semantics. Provider/channel dipilih secara eksplisit. |
| **Definition of Done** | Approved monitoring policy dan incident evidence contract tersedia, tanpa external integration/configuration dibuat dalam phase planning. |
| **Reuse Components** | `health.ts`, `/api/healthz`, worker health, readiness, sequence/E2E safety, `systemObservability`, `integrationHealthService`, structured logger, monitoring matrix. |
| **New Components** | Design-only Monitoring Provider Adapter, Signal Normalizer, Alert Routing Policy, Incident Evidence Bundle, Operational Ownership Registry. |
| **API Impact** | Reuse health/readiness endpoints; tidak mengekspos sensitive operational history secara public. |
| **Database Impact** | Tidak ada schema requirement dalam plan; query/retention design harus bounded. |
| **UI Impact** | Optional operational view design; tidak membuat dashboard platform baru pada phase ini. |
| **Security Impact** | Secret, token, PII, raw business payload, raw prompt/output, dan credential dilarang masuk external payload/log. |
| **Operational Impact** | DevOps/Operations memilih provider, on-call channel, owner roster, escalation SLA, runbook, retention, dan export format. |

### WP-04 — Observability activation and operational handoff

| Field | Plan |
|---|---|
| **Name** | Centralized monitoring activation |
| **Objective** | Mengaktifkan signal, alert routing, test alert, acknowledgement, recovery, escalation, dan incident evidence sesuai policy yang sudah approved. |
| **Business Value** | Incident detection dan response menjadi operasional, bukan sekadar daftar threshold. |
| **Affected Module** | Approved provider adapter/channel, health/worker/integration signals, alert routing, runbook, evidence store/export. |
| **Dependency** | WP-03 approved policy, WP-02 relevant security evidence, S10-A release environment. |
| **Estimated Complexity** | Medium–High. |
| **Estimated Risk** | High operational risk jika provider outage, alert duplication, atau payload leakage tidak ditangani. |
| **Acceptance Criteria** | Test alert reaches designated channel and is acknowledged; P0–P3 SLA/runbook exists; deduplication, cooldown, recovery, escalation, unknown/degraded/critical states evidenced; no secret/PII leakage. |
| **Definition of Done** | Operational handoff diterima on-call owner, timestamped evidence retained, alert failure/rollback path tested, dan monitoring activation tidak diklaim sebelum seluruh gate complete. |
| **Reuse Components** | Signal inventory dan observability sources dari WP-03. |
| **New Components** | Provider adapter/routing implementation hanya setelah provider decision; no new event bus/polling platform. |
| **API Impact** | Health/readiness semantics dipertahankan; detailed status tetap permissioned. |
| **Database Impact** | Tidak ada mandatory data mutation; retention/evidence storage mengikuti policy approved. |
| **UI Impact** | Operational status/error states bila sudah menjadi bagian approved surface. |
| **Security Impact** | Redaction, provider access control, least privilege, and audit of alert access/export. |
| **Operational Impact** | On-call acknowledgement, monthly calibration, incident review, and escalation ownership. |

### WP-05 — Permission-aware context contract and projector

| Field | Plan |
|---|---|
| **Name** | Permission-aware operational context |
| **Objective** | Melengkapi contract dan projection di atas `contextOrchestrator` existing agar AI/tool hanya menerima context sesuai actor, resource, company, branch, purpose, dan classification. |
| **Business Value** | Mencegah data leakage dan memperbaiki kualitas context dengan scope yang dapat diaudit. |
| **Affected Module** | `contextOrchestrator`, `buildOrderContext`, `buildShipmentContext`, `operationalContext`, auth/user context cache, role/scope middleware, AI agent/tool path, BizPortal assistant, audit trail. |
| **Dependency** | WP-02 security evidence, WP-04 correlation/incident signals, auth user-role contract, ADR-10B-012/013, tool/data allowlist. |
| **Estimated Complexity** | High. |
| **Estimated Risk** | Critical; broad projection dapat membocorkan data, overly strict projection dapat merusak AI behavior. |
| **Acceptance Criteria** | Server resolves actor/role/company/branch/resource; permission/classification/allowlist applied after retrieval and before consumption; missing/ambiguous scope fails closed; cache reuse is scope-safe; access decision/redaction metadata auditable; no second orchestrator. |
| **Definition of Done** | Contract, projector, classification/retention policy, tool allowlist, negative isolation evidence, audit contract, performance budget, and owner sign-off complete. |
| **Reuse Components** | Existing context builder/cache/invalidation, `OperationalContext`, server `companyId`, `assertCompanyAccess`, `requireRole`, AI governance linkage, rate limits. |
| **New Components** | Context Access Contract, Permission-Aware Context Projector, Data Classification Registry, Tool Allowlist Resolver, Context Access Audit Event, Negative Isolation Test Contract. |
| **API Impact** | Existing operational context/AI consumers must receive scoped projection; browser query params cannot override server scope. |
| **Database Impact** | Read-only contract by default; no second context store; any additive metadata requires separate approved data plan. |
| **UI Impact** | Company/consolidated selection remains display hint; UI must represent deny/minimized context without implying unrestricted access. |
| **Security Impact** | Default deny/redact for personal, credential, restricted, raw prompt/output, sensitive financial detail, and cross-company records. |
| **Operational Impact** | Correlation ID, access audit, latency budget, cache-scope safety, and incident visibility required. |

### WP-06 — Context isolation, redaction, and audit verification

| Field | Plan |
|---|---|
| **Name** | Context security and isolation verification |
| **Objective** | Membuktikan permission-aware context melalui positive, negative, stale-context, branch, consolidated, and redaction scenarios. |
| **Business Value** | AI decisions tidak bergantung pada data tenant/branch yang salah atau sensitive fields yang tidak disetujui. |
| **Affected Module** | Context projector, scope resolver, cache, AI/tool boundary, audit/access events. |
| **Dependency** | WP-05 implementation candidate and approved classification/branch policy. |
| **Estimated Complexity** | High. |
| **Estimated Risk** | Critical; test yang tidak memakai isolated environment dapat memberi false PASS. |
| **Acceptance Criteria** | Same-company allow; cross-company deny; authorized admin exception audited; cross-branch boundary; consolidated allowed-company set; anonymous/portal bearer denied; missing scope minimized/denied; stale session/cache cannot widen scope; raw sensitive fields absent. |
| **Definition of Done** | Retained timestamped security/runtime evidence on correct dedicated environment, audit events reviewed, performance/security regression passed, rollback path validated. |
| **Reuse Components** | Existing security/contract test patterns, dedicated staging guards, health/readiness, audit trail. |
| **New Components** | Negative test fixtures/harness only when separately authorized; no runtime platform. |
| **API Impact** | Generic denial/not-found semantics must not leak tenant existence. |
| **Database Impact** | Fixture setup/cleanup must be isolated, guarded, idempotent, and never use production/shared DB. |
| **UI Impact** | Permission-denied, minimized, stale, and error states should not expose hidden tenant counts or resource existence. |
| **Security Impact** | Primary tenant isolation proof for S10-F and prerequisite for S10-D. |
| **Operational Impact** | Evidence bundle, correlation IDs, cleanup report, and owner sign-off. |

### WP-07 — AI governance read contract and metric policy

| Field | Plan |
|---|---|
| **Name** | Scoped governance read model and metric definitions |
| **Objective** | Menetapkan DTO, query policy, metric dictionary, denominator, freshness, partial-data, redaction, retention, dan persona visibility untuk governance reads. |
| **Business Value** | Finance/Ops/Security memperoleh visibility AI yang tepercaya tanpa raw payload atau tenant widening. |
| **Affected Module** | `ai_agent_executions`, `ai_approval_queue`, `aiGovernance`, AI review query patterns, role/company scope, access audit. |
| **Dependency** | WP-05/WP-06, ADR-10B-011/012/015, S10-B tenant evidence, S10-C operational signals. |
| **Estimated Complexity** | Medium–High. |
| **Estimated Risk** | High; inconsistent denominator atau missing-data handling dapat membuat false compliance confidence. |
| **Acceptance Criteria** | List/detail/aggregate contract is server-scoped; bounded pagination/filter/sort/date range; raw prompt/output/context redacted; metric source and denominator explicit; unknown/partial/not-available not treated as zero/success; persona visibility approved; access audit emitted. |
| **Definition of Done** | Read contract, metric dictionary, PII/redaction review, retention, freshness/error contract, and acceptance owner sign-off complete. |
| **Reuse Components** | Canonical tables, `aiGovernance`, `aiApprovals` route patterns, `useAiReview`, `assertCompanyAccess`, role permission, audit logging. |
| **New Components** | Governance Read Contract, Permission-Aware Query Service, Metric Definitions, Redacted Projection, Governance Access Audit Event. |
| **API Impact** | New/read contract only after authorization; no mutation endpoints; generic 401/403 and bounded validation errors. |
| **Database Impact** | Scoped/index-aware reads; no parallel audit source; no raw payload list loading; schema changes are not assumed. |
| **UI Impact** | Loading, empty, partial, permission-denied, provider/data-error, stale, and `as of` states defined. |
| **Security Impact** | Scope before aggregation; no browser `companyId` authority; no raw sensitive data. |
| **Operational Impact** | Query latency/error, freshness, redaction count, denial count, and source availability observable. |

### WP-08 — AI Governance Dashboard bounded read-only slice

| Field | Plan |
|---|---|
| **Name** | AI Governance Dashboard |
| **Objective** | Menyediakan product-visible read-only dashboard atas execution/approval evidence yang sudah scoped dan redacted. |
| **Business Value** | Finance, Operations, dan Security dapat meninjau AI execution, status, approval, confidence/reasoning metadata, error, dan authoritative cost sesuai persona. |
| **Affected Module** | BizPortal governance UI, API governance read path, `ai_agent_executions`, `ai_approval_queue`, access audit, existing query hooks. |
| **Dependency** | WP-07 complete; S10-F read scope/redaction approved; S10-C signals; dashboard acceptance. |
| **Estimated Complexity** | Medium–High. |
| **Estimated Risk** | High; dashboard dapat menciptakan false confidence atau data leakage jika query/metric salah. |
| **Acceptance Criteria** | Read-only; server-scoped list/detail/aggregate; pagination/filter/sort/date bounds; redaction; explicit freshness/partial/error states; access audit; no payment/accounting/approval/journal mutation; cross-company attempts auditable. |
| **Definition of Done** | UI/API contract review, permission/PII review, functional/regression/security/performance evidence, owner acceptance, and rollback/removal plan complete. |
| **Reuse Components** | Existing BizPortal `CompanyContext` as hint, AI review patterns, canonical tables, `useAiReview`, role/scope/audit helpers. |
| **New Components** | Dashboard UI states, scoped DTO/read hook/page only after WP-07 authorization; no AI runtime platform. |
| **API Impact** | Scoped read endpoints or existing read-path extension only; no write authority. |
| **Database Impact** | Read-only canonical source usage; no new approval/audit source. |
| **UI Impact** | Governance page with loading/empty/partial/denied/error/stale states, pagination, filters, freshness. |
| **Security Impact** | Persona-aware visibility, default redaction, no raw prompt/output, tenant isolation. |
| **Operational Impact** | Refresh failure, query latency, access denial, stale data, and source outage visible. |

### WP-09 — Integrated acceptance, release evidence, and handoff

| Field | Plan |
|---|---|
| **Name** | Sprint 10 integrated acceptance and handoff |
| **Objective** | Menggabungkan evidence seluruh in-scope workstream dan memastikan production authorization tetap mengikuti release evidence matrix. |
| **Business Value** | Menghindari feature selesai secara lokal tetapi tidak dapat dioperasikan, diaudit, di-rollback, atau dirilis dengan aman. |
| **Affected Module** | Security evidence, monitoring, context, dashboard, documentation, release gate, operational runbook. |
| **Dependency** | WP-02, WP-04, WP-06, WP-08, all exit gates. |
| **Estimated Complexity** | High. |
| **Estimated Risk** | High; cross-workstream gap sering muncul pada scope, privacy, retention, and rollback. |
| **Acceptance Criteria** | Semua evidence timestamped/retained; owner sign-offs; no Sprint 09 overlap; deferred work excluded; security/PII/tenant/performance/rollback checks passed; production GO separately approved. |
| **Definition of Done** | Scope acceptance report, operational handoff, release evidence update, rollback decision, and final stakeholder sign-off complete. |
| **Reuse Components** | Existing release evidence matrix, runbooks, audit/logging, health/readiness, rollback process. |
| **New Components** | Integrated evidence bundle/report only; no runtime component required by the plan. |
| **API Impact** | Contract inventory and release regression review. |
| **Database Impact** | Migration/backup/rollback evidence review if any later authorized change exists. |
| **UI Impact** | Acceptance review for dashboard and permission states. |
| **Security Impact** | Final tenant isolation, redaction, access audit, and fail-closed review. |
| **Operational Impact** | On-call handoff, alert/runbook acceptance, monitoring calibration, incident ownership. |

## 4. Implementation Roadmap

### Stage 0 — Release and decision readiness

1. Resolve ADR-10B-010 through ADR-10B-015 with named owner sign-off.
2. Close S10-A as a separate release/QA epic.
3. Validate dedicated staging identity and database isolation.
4. Retain release E2E, backup/restore, rollback, cleanup, monitoring, and
   sign-off evidence.
5. Do not count S10-A evidence as feature acceptance.

**Exit gate:** G-00 and G-01.

### Stage 1 — Security delta

1. Execute WP-01 inventory/revalidation.
2. Freeze finding dispositions and DNB scope.
3. Execute WP-02 only for approved reproducible findings.
4. Run regression, security, DNB, rollback, and tenant proof.

**Exit gate:** G-02.

### Stage 2 — Operational baseline

1. Execute WP-03 using existing monitoring matrix as candidate inventory.
2. Confirm provider, channel, threshold, owner, retention, runbook, and SLA.
3. Execute WP-04 activation and test alert.
4. Retain alert, acknowledgement, recovery, escalation, and redaction evidence.

**Exit gate:** G-03.

### Stage 3 — Governance foundation

1. Execute WP-05 context contract/projector design and implementation when
   authorized.
2. Execute WP-06 negative isolation, redaction, cache, and audit verification.
3. Do not expose AI context until policy and proof are approved.

**Exit gate:** G-04.

### Stage 4 — Product-visible governance slice

1. Execute WP-07 metric/read contract and persona policy.
2. Execute WP-08 dashboard UI/API read-only slice.
3. Verify query scope before pagination and aggregation.
4. Verify partial/stale/error states and dashboard access audit.

**Exit gate:** G-05.

### Stage 5 — Integrated acceptance

1. Execute WP-09.
2. Confirm no Payment, Accounting, Reconciliation, Marketplace, or customer
   transactional boundary changed.
3. Update evidence and operational handoff.
4. Obtain separate release/production authorization.

## 5. Dependency Matrix

| Work Package | Mandatory dependency | Optional dependency | Parallel work | Blocking work |
|---|---|---|---|---|
| WP-00 | Source-of-truth documents, owner decisions, dedicated staging plan | Documentation hygiene | None that bypasses release gate | S10-A release/QA and ADR closure |
| WP-01 | WP-00, current source, threat model, staging identity | S10-I route inventory | WP-03 signal inventory | Security discovery before WP-02 |
| WP-02 | WP-01 frozen reproducible findings, DNB, rollback | Existing contract suites | Limited WP-03 design | Must finish before S10-B exit |
| WP-03 | WP-00, provider/channel/owner/threshold policy | WP-01 discovery | WP-01, S10-I | Policy decisions before WP-04 |
| WP-04 | WP-03 approved alert contract, S10-A environment | Existing manual dashboards | None after activation begins | Test alert/runbook/SLA before S10-C active |
| WP-05 | WP-02, WP-04 signals, auth/scope contract, ADR-10B-012/013 | WP-07 UI information architecture | WP-07 design only | Policy and security evidence before AI context |
| WP-06 | WP-05 contract/projector, isolated fixtures | S10-D read DTO draft | None that exposes context | Negative isolation proof before WP-07/WP-08 |
| WP-07 | WP-05/WP-06, ADR-10B-011/012/015, canonical tables | WP-08 UI wireframe | UI information architecture | Metric/redaction/read contract before dashboard |
| WP-08 | WP-07, S10-F read scope, dashboard acceptance | S10-I documentation | None that consumes unapproved scope | Permission/PII/read-only review |
| WP-09 | WP-02, WP-04, WP-06, WP-08 | Documentation cleanup | None | All feature exit evidence and release review |

### Critical path

```text
S10-A / G-00
  → WP-01
  → WP-02 / G-02
  → WP-03
  → WP-04 / G-03
  → WP-05
  → WP-06 / G-04
  → WP-07
  → WP-08 / G-05
  → WP-09
```

### Approved parallel work

- S10-C signal inventory may be prepared while S10-B discovery runs.
- S10-I API documentation inventory may run separately.
- S10-D UI information architecture may be drafted while S10-F policy is
  finalized, but it cannot consume unapproved scope.
- S10-E, S10-G, S10-H, and technical debt are not dependencies for the locked
  feature chain.

## 6. Risk Matrix

| Category | Risk | Probability | Impact | Mitigation | Owner | Trigger/response |
|---|---|---:|---:|---|---|---|
| Architecture | Sprint 10 becomes platform rewrite or creates second orchestrator | High | High | Reuse bounded modules and `contextOrchestrator`; architecture review before implementation | Architecture Owner | Stop scope expansion; return to ADR-10B-001/003 |
| Architecture | Dashboard becomes approval engine or mutation path | Medium | Critical | Read-only contract and negative mutation tests | Product/Finance Owner | Block release; remove mutation path |
| Architecture | S10-A release work is counted as feature delivery | High | High | Separate epic, evidence matrix, and acceptance report | Release Lead | Reclassify evidence and keep production NO-GO |
| Security | Cross-company or cross-branch data leakage | Medium | Critical | Server scope before query/aggregation, default deny, negative isolation, access audit | Security Owner | Fail closed, quarantine evidence, investigate |
| Security | Browser company selection widens tenant access | Medium | Critical | Server-resolved company/branch; browser values are hints only | Backend/Security | Generic denial and audit event |
| Security | Raw prompt/output, credential, PII, or context reaches logs/provider/UI | Medium | Critical | Classification, redaction, minimization, retention, payload review | Security / DevOps | Stop export/release; rotate/clean evidence if required |
| Security | Stale finding is blindly remediated | High | High | Current reproduction and explicit disposition | Technical Lead | Reject remediation until evidence exists |
| Performance | Context projection creates unacceptable AI latency | Medium | High | Bounded history, cache-safe projection, indexed scope, timeout/budget | AI/Backend Owner | Degrade/deny sensitive context; tune or rollback |
| Performance | Governance aggregates scan broad history | Medium | High | Bounded date/page/filter, scoped indexes, summary/detail separation | Backend/Data Owner | Limit query and show safe error/stale state |
| Performance | Alert polling/collection increases critical request latency | Medium | Medium | Asynchronous/externally evaluated alerts, cached health checks | DevOps | Disable noisy signal and retain local evidence |
| Operational | Alert fatigue or no responder | Medium | High | Owner roster, P0-P3 SLA, dedup/cooldown, runbook, calibration | Operations Owner | Deactivate alert until owner/SLA fixed |
| Operational | Provider outage appears as application healthy/critical incorrectly | Medium | High | Distinguish `unknown`, `degraded`, `critical`; preserve local evidence | DevOps | Escalate provider dependency separately |
| Operational | Dashboard partial data appears authoritative | Medium | High | `asOf`, freshness, source availability, partial/unknown state | AI/Data Owner | Mark stale/partial; do not fabricate zero/success |
| Deployment | Shared dev/prod DB used for fixtures or proof | Medium | Critical | Environment identity guard and read-only preflight | DevOps | Abort writes and invalidate evidence |
| Deployment | Migration/data change lacks rollback or idempotency | Medium | High | Additive plan, backup, rollback, environment proof | Backend/DB Owner | No deployment until plan and rehearsal |
| Deployment | Feature scope is released before all gates | Medium | Critical | G-00 through G-05 checklist and fail-closed release gate | Release Lead | Roll back/hold release |

## 7. Testing Strategy

> Test implementation belongs to a later authorized phase. This section defines
> required evidence, not tests created by this master-plan phase.

### 7.1 Unit test

- **S10-B:** finding classification/decision adapter, scope decision helpers,
  generic denial behavior, rate-limit policy, redaction/minimization helpers.
- **S10-C:** signal normalization, state mapping, severity, deduplication key,
  cooldown, recovery, escalation, and payload redaction.
- **S10-F:** actor/resource scope resolution, classification, field projection,
  tool allowlist, cache-scope safety, missing/ambiguous scope behavior.
- **S10-D:** metric formulas/denominators, unknown/partial handling, bounded
  filter validation, redacted DTO, pagination/sort, freshness state.

Unit evidence must include positive and fail-closed paths and must not assert
that missing data equals zero or success unless the approved policy explicitly
defines that behavior.

### 7.2 Integration test

- Auth/session → role/company/branch resolution → route guard.
- Resource ownership → context retrieval → permission projector → AI/tool
  boundary.
- Existing health/worker/integration signals → normalizer → alert routing.
- Canonical AI execution/approval records → scoped query → redacted DTO.
- Access audit and correlation ID linkage across reads/denials/alerts.
- Repeated requests/alerts/evidence do not create duplicate side effects.

Integration fixtures must verify environment identity before any write and must
use dedicated non-production data with deterministic cleanup.

### 7.3 Regression

- Existing authentication, role, company, branch, portal bearer, and admin
  behavior.
- Existing Marketplace → Payment → Accounting → Reconciliation contract.
- Existing AI execution/approval lifecycle; dashboard must not mutate it.
- Existing health/readiness, worker heartbeat, integration health, notification,
  SSE, and callback paths.
- Existing BizPortal company context behavior as a display hint.
- Broad build/typecheck/contract suites recorded in the release evidence
  matrix.

Regression evidence must separate Sprint 09 verification backlog from Sprint 10
feature acceptance.

### 7.4 Runtime verification

Required runtime evidence:

- readiness and environment/database identity checks;
- dedicated staging only; no shared dev/prod fixture writes;
- S10-B tenant proof and current finding reproduction;
- S10-C test alert delivery, acknowledgement, recovery, escalation, and
  incident export;
- S10-F same-company allow, cross-company deny, cross-branch deny, allowed
  consolidated scope, stale session/cache isolation, and redaction;
- S10-D scoped list/detail/aggregate reads, pagination, freshness, partial
  data, permission denial, and read-only mutation guard;
- retained timestamp, build/commit identity, environment identity, owner, and
  result for each evidence item.

An available script without retained timestamped execution result is not PASS.

### 7.5 Security verification

- Auth boundary: anonymous, internal session, portal/mobile bearer, role,
  admin, and invalid session behavior.
- Tenant boundary: same company allow, cross-company deny, branch boundary,
  consolidated allowed-company set, ambiguous scope fail-closed.
- Data boundary: raw prompt/output, credentials, personal data, restricted
  fields, financial detail, and unrestricted `context_data` absent by default.
- Browser authority: `companyQueryParam`, filters, IDs, and consolidated mode
  cannot override server scope.
- Mutation boundary: dashboard cannot resolve approval, execute payment, write
  accounting/journal, or mutate reconciliation.
- Observability boundary: no secrets, auth tokens, raw business payload, PII,
  or raw AI payload in logs/provider/export.
- Abuse boundary: bounded page/date/filter, rate limits, duplicate/dedup,
  SSRF/validation findings where current evidence requires them.

### 7.6 Performance verification

- Context projection latency under approved AI request budget.
- Context cache reuse remains safe across actor/policy/scope changes.
- Governance list/detail/aggregate query latency with bounded date/page/filter.
- No full `context_data`, raw prompt/output, or unbounded history loaded for
  list pages.
- Alert evaluation does not block critical business requests.
- Query count and indexed scope behavior reviewed to avoid N+1 expansion.
- Degraded/timeout behavior returns safe error or minimized result with
  correlation/freshness metadata.

### 7.7 Rollback verification

- S10-B remediation can be reverted without widening authorization.
- S10-C provider/alert routing can be disabled while local evidence remains
  available.
- S10-F projection can fail closed or be disabled without exposing broad
  context; existing orchestrator ownership remains intact.
- S10-D dashboard can be hidden/disabled without affecting AI execution,
  approval, payment, accounting, or reconciliation.
- Any later database change has additive, idempotent, backup, restore, and
  rollback evidence before release.
- Rollback trigger, owner, time window, evidence preservation, and recovery
  communication are documented.

## 8. Release Strategy

### 8.1 Development

Entry:

- G-00 decision authorization for the relevant work package;
- isolated development database/environment;
- source and dependency review complete.

Controls:

- implement one bounded WP at a time;
- keep source of truth canonical;
- run unit/integration/contract checks;
- no production credentials/payloads in logs or fixtures;
- no Sprint 09 boundary changes.

Exit:

- local acceptance evidence;
- type/build checks;
- reviewer approval;
- explicit next-stage decision.

### 8.2 Internal QA

Scope:

- full regression around auth/scope, health/workers, AI governance, BizPortal,
  and Sprint 09 protected boundaries;
- negative isolation and redaction;
- failure, stale, partial, timeout, and permission-denied states;
- alert dedup/recovery/escalation;
- read-only mutation guard.

Exit:

- no unresolved critical/high security or tenant findings;
- retained test evidence;
- known limitations documented;
- rollback rehearsal or approved rollback proof.

### 8.3 Staging

Requirements:

- dedicated staging identity and database;
- environment identity preflight;
- secret rotation owner verification;
- full HTTP E2E and cleanup;
- backup/restore and rollback rehearsal;
- monitoring provider/channel and test alert;
- S10-B current reproduction/tenant proof;
- S10-F isolation/redaction proof;
- S10-D permission/metric/read-only acceptance.

Staging must not use shared development or production database. Any environment
identity mismatch aborts writes and invalidates the affected evidence.

### 8.4 Production

Production is allowed only after:

- S10-A release/QA epic is closed;
- all relevant feature gates G-00 through G-05 are signed off;
- release evidence matrix says GO;
- production owner, security owner, technical lead, and operational owner
  approve;
- rollback plan and incident channel are active.

This master plan alone never authorizes production deployment.

### 8.5 Rollback

Rollback is preferred over forward repair when:

- tenant isolation or redaction proof fails;
- alert payload contains sensitive data;
- dashboard read accidentally exposes cross-scope aggregates;
- context projection widens AI/tool authority;
- dashboard or monitoring changes affect payment/accounting/reconciliation;
- performance degradation blocks critical business requests.

Rollback must preserve audit/evidence, use the named owner, record timestamp and
correlation IDs, and validate that the protected Sprint 09 boundaries remain
unchanged.

## 9. Execution Checklist

### Planning

- [x] Planning/discovery reviewed.
- [x] Scope lock reviewed.
- [x] Architecture lock reviewed.
- [x] Business decision document reviewed.
- [x] In-scope work packages identified.
- [x] S10-A separated from feature scope.
- [x] S10-E/S10-G/S10-H deferred.
- [x] S10-I/L1 separated as documentation work.

### Architecture

- [x] Dependency chain is S10-B → S10-C → S10-F → S10-D.
- [x] `contextOrchestrator` remains the single builder.
- [x] Server-authoritative scope and redaction defined.
- [x] Canonical AI sources preserved.
- [x] Read-only dashboard boundary defined.
- [x] No new event bus, vector store, approval engine, or payment/accounting
  boundary included.

### Business Decision

- [x] ADR-10B-010 business option C approved; concrete provider/channel tetap
  menunggu DevOps dan G-03.
- [x] ADR-10B-011 metric definitions dan denominators approved.
- [x] ADR-10B-012 AI classification dan retention approved; Opsi C interim.
- [x] ADR-10B-013 branch/division dan consolidated semantics approved; Opsi C
  interim.
- [x] ADR-10B-014 monitoring evidence retention/export approved.
- [x] ADR-10B-015 model/token/cost visibility per persona approved; Opsi C
  interim.
- [x] Product Owner approval record retained for all six decisions.

### Implementation authorization

- [ ] S10-A dedicated staging/release gate closed.
- [x] G-00 business decision gate passed via Product Owner approval.
- [ ] G-01 release/QA gate passed.
- [ ] WP-01 finding register frozen before WP-02.
- [ ] WP-02 security evidence and rollback accepted.
- [ ] G-02 security gate passed.
- [ ] G-03 observability gate passed before activation.
- [ ] G-04 context gate passed before AI context exposure.
- [ ] G-05 dashboard gate passed before governance reads exposed.

### Testing

- [ ] Unit strategy implemented and evidence retained.
- [ ] Integration/contract strategy implemented and evidence retained.
- [ ] Regression suite passed with Sprint 09 boundary checks.
- [ ] Runtime proof passed on correct isolated environment.
- [ ] Security isolation/redaction proof passed.
- [ ] Performance budgets and bounded-query evidence passed.
- [ ] Rollback verification passed.

### Release

- [ ] Internal QA accepted.
- [ ] Staging accepted.
- [ ] Monitoring alert and incident runbook handed off.
- [ ] Security/PII/access review signed off.
- [ ] Release evidence matrix updated.
- [ ] Production GO separately authorized.

## 10. Acceptance Criteria

### Master-plan acceptance

- [x] Executive summary and implementation strategy are present.
- [x] WBS covers all four in-scope features and integrated handoff.
- [x] Every WP includes name, objective, business value, affected module,
  dependency, complexity, risk, acceptance criteria, and DoD.
- [x] Every WP includes reuse/new components and API/database/UI/security/
  operational impact.
- [x] Roadmap and dependency matrix identify mandatory, optional, parallel, and
  blocking work.
- [x] Testing strategy covers unit, integration, regression, runtime,
  security, performance, and rollback verification.
- [x] Release strategy covers development, internal QA, staging, production,
  and rollback.
- [x] Risk matrix covers architecture, security, performance, operational, and
  deployment risk.
- [x] Execution checklist covers planning, architecture, business decisions,
  implementation, testing, and release.
- [x] Additive, backward-compatible, server-authoritative, tenant-isolated,
  idempotent, and audit-friendly invariants are explicit.

### Feature acceptance gates

#### S10-B

- [ ] Current reproduction or explicit non-PASS disposition exists for every
  finding in scope.
- [ ] Tenant isolation/auth/RBAC regression evidence exists.
- [ ] DNB, rollback, owner, and environment evidence are retained.

#### S10-C

- [ ] Provider, channel, owner, threshold, retention, test alert, runbook,
  escalation, and SLA approved.
- [ ] Test alert is acknowledged and recovery/escalation evidenced.
- [ ] Sensitive data is absent from provider/log/export payloads.

#### S10-F

- [ ] Permission contract includes actor, resource, company, branch, purpose,
  classification, and denied fields.
- [ ] Projector occurs after context retrieval and before AI/tool consumption.
- [ ] Tool/data allowlist, redaction, retention, and audit contract approved.
- [ ] Negative cross-company/cross-branch/consolidated/stale-scope proof passes.

#### S10-D

- [ ] Scoped read contract and metric dictionary approved.
- [ ] Server scope is applied before pagination and aggregation.
- [ ] Raw prompt/output and sensitive context are redacted by default.
- [ ] Freshness/partial/error/permission-denied states are explicit.
- [ ] Dashboard is read-only and cannot mutate protected domains.

## 11. Definition of Done

Sprint 10 implementation may be considered complete for review only when:

1. All four in-scope work packages have implementation and acceptance evidence.
2. S10-B has a frozen finding register, reproduction/decision, tenant proof,
   regression/DNB, rollback, and owner sign-off.
3. S10-C has provider/channel, threshold, owner, test alert, runbook, SLA,
   retention, recovery, escalation, and incident evidence.
4. S10-F has permission, classification, allowlist, branch/company, redaction,
   isolation, cache-scope, and audit evidence.
5. S10-D has scoped read contract, metric/denominator approval, persona
   visibility, PII review, pagination/filter, freshness, error, and read-only
   evidence.
6. All relevant unit, integration, regression, runtime, security, performance,
   and rollback checks pass with retained timestamped results.
7. No raw prompt/output, secret, credential, unrestricted context, or
   cross-tenant data is exposed in UI, API, audit, monitoring, or export.
8. No Marketplace, Payment, Accounting, or Reconciliation boundary has been
   silently changed.
9. Deferred and documentation backlog items remain separate.
10. Acceptance owners sign off and production authorization is separately
    granted by the release evidence process.

## 12. Recommendation

1. Accept this document as the **conditional implementation baseline**, not as
   authorization to start coding.
2. Treat the six Product Owner decisions as G-00 approval, not as permission
   to skip technical or release evidence.
3. Close S10-A separately before high-risk feature work and retain all release
   evidence in the release process.
4. Begin authorized feature work with WP-01/S10-B security revalidation; do not
   blind-fix legacy findings.
5. Activate S10-C only after provider/channel/owner/threshold/runbook/test
   alert/SLA/retention decisions are complete.
6. Complete S10-F permission-aware projection and negative isolation evidence
   before exposing AI context or S10-D reads.
7. Use S10-D as the first bounded product-visible slice, read-only and
   permission-aware, over the canonical AI governance records.
8. Keep S10-E, S10-G, S10-H, S10-I, L1, L2, L3, and unrelated Finance work out
   of this implementation scope.
9. Keep production fail-closed. Plan completion, architecture approval, and
   feature acceptance are not substitutes for production GO.

### Final verdict

> ✅ **Sprint 10 Implementation Master Plan Ready as a Conditional Baseline**
>
> ✅ WBS and implementation roadmap complete  
> ✅ Dependency, risk, testing, release, and execution checklist complete  
> ✅ Business decision gate G-00 resolved by Product Owner approval
> 🚧 S10-A release gate and G-02 through G-05 technical gates remain blocking
> ❌ Sprint 10 implementation: **NOT IMPLEMENTED**
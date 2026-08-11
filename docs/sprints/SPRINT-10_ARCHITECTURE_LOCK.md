# Sprint 10 — Architecture Lock & Technical Design

**Tanggal architecture lock:** 2026-08-10
**Status:** ✅ Sprint 10 Architecture Locked — implementation belum dimulai
**Sumber utama:** `docs/sprints/SPRINT-10_PLANNING_DISCOVERY.md` dan
`docs/sprints/SPRINT-10_SCOPE_LOCK.md`
**Boundary reference:** `docs/sprints/SPRINT-09.md` dan
`docs/release/SPRINT-09_FINAL_CLOSURE_REPORT.md`

> Dokumen ini adalah baseline technical architecture dan technical design.
> Dokumen ini bukan implementasi, bukan coding, bukan refactor, bukan migration,
> dan tidak membuat endpoint, service, database, schema, test, workflow, atau
> konfigurasi.

## 1. Executive Summary

Sprint 10 dikunci sebagai rangkaian bounded governance dan operational-safety
work yang additive, backward compatible, reusable, server-authoritative,
idempotent, audit-friendly, dan tenant-isolated.

Feature in scope:

1. **S10-B — Security Delta Audit & Tenant Isolation Hardening**
2. **S10-C — Centralized Monitoring & Incident Readiness**
3. **S10-F — Permission-Aware Operational Context**
4. **S10-D — AI Execution Audit Trail & Governance Dashboard**

Urutan dependency yang dikunci:

```text
S10-B Security evidence
  → S10-C Operational observability
  → S10-F Permission-aware context
  → S10-D AI Governance Dashboard
```

S10-A release verification Sprint 09 tetap merupakan release/QA prerequisite
terpisah. S10-E approval escalation, S10-G KPI foundation, dan S10-H async OCR
tetap future backlog. S10-I API contract documentation tetap documentation
backlog.

Architecture lock ini tidak mengubah keputusan Sprint 09. Marketplace tetap
berhenti pada `waiting_payment`, Payment tetap menjadi owner lifecycle,
Accounting tetap menjadi source of truth untuk journal/posting, dan
Reconciliation tetap menjadi owner settlement matching.

## 2. Architecture Vision

### 2.1 Vision statement

BizPortal harus memiliki governance layer yang dapat menjawab tiga pertanyaan
tanpa membuka data yang tidak berwenang:

1. **Security:** Apakah kontrol akses dan tenant isolation benar-benar terbukti
   pada source serta environment yang aman?
2. **Operations:** Apakah kegagalan, degradasi, queue backlog, dan integration
   issue terlihat oleh owner dengan SLA yang jelas?
3. **AI:** Context apa yang diberikan kepada AI, siapa yang boleh melihat
   execution/approval evidence, dan bagaimana seluruh akses dapat diaudit?

### 2.2 Architecture principles

| Principle | Locked decision |
|---|---|
| Additive | Menambah evidence, projection, adapter, policy, dan read path tanpa mengganti kontrak domain yang sudah stabil. |
| Backward compatible | Existing callers dan existing domain lifecycle tetap berjalan; field baru bersifat optional atau projection-only. |
| Reusable | Memakai `contextOrchestrator`, `aiGovernance`, auth/scope, audit, health, worker heartbeat, dan existing query patterns. |
| Server authoritative | Role, company, branch, permission, resource ownership, redaction, dan approval visibility diputuskan server-side. |
| Idempotent | Evidence registration, alert delivery, context build/invalidation, dan dashboard reads aman saat diulang. |
| Audit friendly | Security decision, cross-company attempt, context access, dashboard access, alert transition, dan governance query memiliki correlation metadata. |
| Tenant isolated | Default deny untuk scope tidak jelas; `company_id` dan scope attributes berasal dari server, bukan request body atau prompt. |
| Fail closed | Ketika identity, scope, policy, atau database safety tidak dapat dipastikan, akses sensitif ditolak atau data dipangkas. |
| Existing-boundary first | Tidak membuat payment, accounting, bank reconciliation, customer portal, atau sport-center implementation baru. |

### 2.3 Baseline interpretation

Repository saat ini sudah memiliki sebagian fondasi yang sebelumnya disebut gap
di roadmap lama, termasuk:

- `contextOrchestrator` dengan order/shipment operational context dan TTL cache;
- `aiGovernance` dengan `ai_agent_executions` dan `ai_approval_queue`;
- `assertCompanyAccess`, `requireRole`, `requireClerkUser`, dan `requireAdmin`;
- `authMiddleware` yang membedakan internal session dari bearer-token portal/mobile;
- `systemObservability` untuk client error dan integration health;
- `/api/healthz`, worker heartbeat, readiness, dan E2E safety status;
- `erp_audit_logs` melalui `auditLog`;
- BizPortal `CompanyContext` dan existing AI review query patterns.

Roadmap atau audit lama yang menyatakan komponen tersebut belum ada harus
diperlakukan sebagai discovery input, bukan alasan untuk membuat duplikat.
Gap Sprint 10 adalah contract completion, evidence, permission hardening,
operational activation, dan read-only governance visibility.

## 3. Feature Architecture

## 3.1 S10-B — Security Delta Audit & Tenant Isolation Hardening

### Business Goal

Memastikan hanya vulnerability yang masih reproducible yang diperbaiki, serta
membuktikan auth, RBAC, company/branch scope, rate limiting, SSRF protection,
duplicate protection, dan cross-tenant denial sebelum governance feature
digunakan pada environment yang lebih sensitif.

### Architecture Goal

Menyediakan security delta process yang evidence-driven di atas kontrol existing,
bukan blind rewrite dari `docs/MASTER_FIX_PLAN.md`. Setiap finding memiliki
identity, reproduction, severity, affected scope, decision, remediation,
regression evidence, DNB result, owner, dan rollback reference.

Hardening harus berada di boundary middleware, scope resolver, validation,
constraint, atau service yang tepat. Ia tidak boleh memindahkan ownership
Marketplace, Payment, Accounting, atau Reconciliation.

### Affected Modules

- API routes dan route-level authorization;
- `authMiddleware`, `requireAdmin`, `requireRole`, `requireClerkUser`;
- `assertCompanyAccess` dan company/branch scope resolution;
- rate limiter dan audit logging;
- ecommerce, logistics, webhook, AI, dan governance read paths;
- database uniqueness/foreign-key constraints bila finding membutuhkan proof;
- dedicated staging security/E2E evidence.

### Existing Components to Reuse

- `authMiddleware` untuk session-versus-bearer distinction serta user context;
- `requireAdmin`, `requireRole`, dan `requireClerkUser` untuk role gates;
- `assertCompanyAccess` untuk ownership denial dan cross-company audit event;
- `resolveCompany`/company resolution patterns yang sudah digunakan route;
- `securityRateLimiter` dan audit event patterns;
- parameterized SQL/Drizzle query conventions;
- existing contract/security tests dan staging E2E harness;
- fail-closed release gate dan E2E safety guard.

### New Components (Design Only)

Komponen berikut hanya desain, tidak dibuat pada phase ini:

1. **Security Finding Register** — logical record atau evidence artifact dengan
   `findingId`, source reference, reproduction, severity, affected route/resource,
   decision, owner, status, regression evidence, DNB result, dan rollback link.
2. **Security Delta Decision Adapter** — policy untuk membedakan
   `reproducible`, `already-fixed`, `not-reproducible`, `accepted-risk`, dan
   `blocked-by-environment`.
3. **Scope Proof Fixture Contract** — format fixture non-production untuk
   membuktikan same-company allow, cross-company deny, authorized admin
   exception, branch boundary, dan cleanup.
4. **Security Evidence Manifest** — manifest timestamped yang mengikat finding,
   commit/build identity, environment identity, test result, dan owner sign-off.

Tidak ada tabel, endpoint, migration, atau runtime harness baru yang dibuat
sebagai bagian dari architecture lock ini.

### Dependency

- Dedicated staging identity dan cleanup safety;
- source re-validation;
- threat model/security owner;
- regression matrix;
- DNB validation;
- rollback plan;
- S10-A release/QA prerequisite untuk evidence environment.

S10-B dapat melakukan discovery paralel dengan S10-C setup, tetapi hardening
yang mengubah behavior tidak boleh dimulai sebelum finding direproduksi dan DNB
scope dibekukan.

### Data Flow

```text
Current source + old finding
  → Finding inventory
  → Safe reproduction in dedicated staging
  → Scope/tenant proof
  → Security decision
      ├─ already-fixed / not-reproducible → retain evidence only
      ├─ accepted-risk → owner approval and expiry/review
      └─ reproducible → bounded remediation design
  → Regression + DNB + rollback evidence
  → Security delta manifest
```

Request payload tidak boleh menjadi sumber authority untuk `company_id`,
`role`, `branch_id`, atau resource ownership.

### Sequence Flow

1. Security owner selects a finding from the inventory.
2. Technical owner maps it to current route, middleware, service, and data
   owner.
3. Reproduction runs only against an identified non-production target.
4. Server resolves authenticated user, internal-session status, role,
   company/branch context, and resource owner.
5. The proof records allow/deny result and audit event without exposing secret
   values or unrelated tenant data.
6. The finding receives a decision.
7. If remediation is approved, the change is separately implemented, reviewed,
   regression-tested, and checked against DNB.
8. The evidence manifest is retained for release/security review.

### Permission Model

- Unauthenticated request: deny protected resources.
- Portal/mobile bearer token: cannot be treated as internal staff.
- Internal user: role and custom-role permissions are resolved server-side.
- Resource access: same-company and permitted scope required.
- Admin/super-admin cross-company access: allowed only where existing policy
  permits and must emit a high-severity audit event.
- Non-admin cross-company access: deny with generic response and audit event.
- Unknown or stale user context: fail closed for sensitive resources.

### Failure Handling

- Unknown database identity or shared staging target: stop before fixture/write.
- Missing auth context: return unauthorized, never infer identity from payload.
- Missing company/resource owner: deny or quarantine the finding for review.
- Reproduction inconclusive: mark `blocked-by-environment`, not PASS.
- Existing control already fixes finding: mark `already-fixed`, do not duplicate
  the control.
- Regression failure: block remediation acceptance and retain previous behavior.
- Evidence write failure: block security sign-off where evidence is mandatory.

### Observability

- Correlation ID for each proof and remediation run;
- finding ID, route/resource type, environment identity, and decision status;
- counts of allowed/denied cross-company attempts;
- rate-limit denials and auth failures without token values;
- DNB/regression result and owner;
- no raw credentials, bearer tokens, session IDs, or sensitive payloads in logs.

### Security Boundary

S10-B can inspect and harden API/security boundaries but cannot:

- change Payment execution or retry lifecycle;
- create or post Accounting journals;
- alter Bank Reconciliation settlement matching;
- weaken customer portal or sport-center isolation;
- use production data as a test fixture;
- treat admin access as a universal bypass without audit and policy review.

### Performance Consideration

- Avoid adding database round trips to every request when a verified
  request-scope context is sufficient.
- Scope checks should use indexed ownership/company columns.
- Security evidence queries are bounded, paginated, and outside hot transaction
  paths where possible.
- Do not introduce synchronous external calls into payment/accounting flows.

### Operational Risk

High. A security change can block legitimate POS, portal, logistics, or legacy
users. Every change therefore requires rollout visibility, owner sign-off,
rollback, and a proof that the denial boundary is not broader than intended.

### Acceptance Criteria

- Every implemented finding has current reproduction evidence or is explicitly
  classified as already-fixed, not-reproducible, accepted-risk, or blocked.
- Critical/high tenant, auth, and scope findings have regression and DNB proof.
- Cross-company allow/deny behavior is explicit and audited.
- No production mutation is used to produce evidence.
- Security delta manifest is timestamped, reviewable, and owner-approved.

## 3.2 S10-C — Centralized Monitoring & Incident Readiness

### Business Goal

Detect downtime, payment callback failure, queue backlog, SSE degradation,
database pressure, external integration failure, and error spikes early enough
for an accountable owner to respond within the agreed SLA.

### Architecture Goal

Activate a thin monitoring and incident layer around existing health,
worker-heartbeat, integration-health, error-log, notification, and deployment
signals. The design favors provider adapters and runbooks over a new
observability platform.

### Affected Modules

- API health and readiness;
- database and connection pool;
- workers and queues;
- payment callback telemetry;
- notification, WhatsApp, SMTP, and storage integration signals;
- SSE notification stream;
- deployment/resource metrics;
- on-call alert routing and incident runbooks.

### Existing Components to Reuse

- `health.ts` health checks and cached external checks;
- `/api/healthz`, `/api/health/workers`, readiness, sequence check, and E2E
  safety status;
- worker heartbeat and aggregate worker status;
- `systemObservability` client-error stats and integration-health snapshots;
- `integrationHealthService` and health worker;
- notification/accounting outbox patterns using `FOR UPDATE SKIP LOCKED`;
- `docs/operations/monitoring-matrix.md` thresholds and SLA routing;
- existing structured logger and deployment health evidence.

### New Components (Design Only)

1. **Monitoring Provider Adapter** — normalized interface for uptime, logs,
   errors, metrics, and alert delivery; provider choice remains pending.
2. **Signal Normalizer** — maps existing endpoint/worker/database/integration
   signals into `healthy`, `degraded`, `critical`, or `unknown`.
3. **Alert Routing Policy** — severity, channel, owner, deduplication key,
   cooldown, escalation SLA, and acknowledgement state.
4. **Incident Evidence Bundle** — timestamped alert, response, runbook,
   mitigation, and post-incident reference.
5. **Operational Ownership Registry** — design-level owner map for Technical
   Lead, DevOps, Backend, Finance, Security, and integration owners.

These are design contracts only. No external monitoring integration or
configuration is created in this phase.

### Dependency

- Monitoring provider and alert channel;
- owner roster and on-call coverage;
- threshold approval;
- retention and PII policy;
- staging/production environment identity;
- runbooks and escalation SLA;
- S10-A release/QA evidence for production readiness.

S10-C can prepare signal inventory while S10-B performs security discovery, but
activation requires approved thresholds and accountable responders.

### Data Flow

```text
Existing health / worker / DB / integration / application signals
  → Signal normalizer
  → Threshold and state evaluation
  → Deduplication + severity policy
  → Alert channel
  → On-call acknowledgement
  → Incident runbook and evidence bundle
  → Review / threshold calibration
```

Application signal collection must not include secrets, request bodies with
PII, authentication tokens, or raw AI prompt/output.

### Sequence Flow

1. A health, error, worker, queue, or integration signal is emitted or polled.
2. The adapter normalizes the signal and attaches component, environment,
   timestamp, correlation ID, and owner.
3. The policy evaluates threshold, severity, deduplication, and cooldown.
4. A new alert is routed to the approved channel.
5. The owner acknowledges and follows the runbook.
6. Recovery or escalation is recorded.
7. Evidence is retained for release and incident review.

### Permission Model

- Health liveness/readiness may remain public only for non-sensitive status.
- Detailed client-error, integration, queue, and operational history is
  internal/admin or explicitly permissioned.
- Alert payloads are scoped to operational owners and must be redacted.
- Monitoring does not grant access to underlying tenant business records.
- Production diagnostic endpoints must not reveal secrets, database URLs, or
  E2E metadata.

### Failure Handling

- Provider unavailable: retain local signal/log and mark alert delivery
  degraded; do not claim delivered.
- Duplicate signal: deduplicate by stable component/condition/window key.
- Missing owner/channel: mark operationally unready and escalate to owner
  setup, not silently discard.
- Health check timeout: record `unknown` or `degraded` according to policy,
  distinguishing it from a confirmed outage.
- Database pressure: avoid expensive diagnostic queries during the incident.
- Alert storm: apply bounded cooldown and preserve critical signals.

### Observability

The monitoring matrix remains the source for initial targets, including:

- API 5xx, p95 latency, health availability and latency;
- database query latency/error, replication lag, row-growth anomaly;
- connection pool activity/wait/refusal;
- storage, auth, and external integration health;
- notification queue depth/failures and worker heartbeat/error rate;
- SSE availability/delivery latency/connections;
- Paylabs callback success, latency, signature failure, duplicate prevention;
- WhatsApp/SMTP delivery and quota;
- CPU, memory, gateway latency, overall and auth error rates.

The stack is currently not configured. Configuration, test alert, on-call
routing, and evidence are acceptance work, not architecture implementation.

### Security Boundary

Monitoring may observe metadata from payment callbacks, notification, and
accounting outbox, but it must not:

- alter payment state;
- retry or settle payment;
- write accounting journal entries;
- mutate bank reconciliation;
- copy tenant business payloads into an external log without approved
  minimization and retention policy.

### Performance Consideration

- Reuse cached health checks and bounded history queries.
- Avoid polling every tenant or every row for global health.
- Use aggregation and sampling for high-volume client errors.
- Use existing worker/outbox locking patterns rather than a new polling loop.
- Alert evaluation must be asynchronous or outside critical business requests.

### Operational Risk

Medium. False positives create alert fatigue, while missing owners make
monitoring decorative. Activation is therefore blocked until provider, channel,
threshold, retention, runbook, and owner are explicit.

### Acceptance Criteria

- Approved signal and threshold inventory maps to each owner.
- Test alert reaches the designated channel and is acknowledged.
- Runbook and response SLA exist for P0–P3 conditions.
- Health, worker, queue, integration, SSE, and callback signals are represented
  without exposing secrets or raw business data.
- Alert deduplication, cooldown, recovery, and escalation are evidenced.

## 3.3 S10-F — Permission-Aware Operational Context

### Business Goal

Ensure that AI and operational assistants receive only the order, shipment,
vendor, financial summary, alert, and AI activity context allowed by the
requesting user's role, company, branch, and data classification.

### Architecture Goal

Complete the permission and redaction contract around the existing
`contextOrchestrator`. The architecture must not create a second orchestrator.
The current broad context builder becomes an internal data aggregation source;
a permission-aware projection is the boundary exposed to AI consumers and
governance reads.

### Affected Modules

- `contextOrchestrator`;
- `operationalContext` route;
- `authMiddleware` and user context cache;
- `requireAdmin`, `requireRole`, `requireClerkUser`;
- `assertCompanyAccess` and company/branch resolution;
- AI agent/tool execution path;
- BizPortal assistant and company context;
- audit trail and security evidence.

### Existing Components to Reuse

- `buildOrderContext` and `buildShipmentContext`;
- existing 30-second context cache and explicit invalidation;
- `OperationalContext` domain shape;
- server-side `companyId` from loaded user context;
- `CompanyContext` active/consolidated UI state as a display hint only;
- `assertCompanyAccess` cross-company allow/deny audit behavior;
- `requireRole`/custom-role JSONB permission checks;
- `aiGovernance` execution and approval linkage;
- existing route and tool rate limits.

### New Components (Design Only)

1. **Context Access Contract** — logical policy input/output describing actor,
   resource, company/branch scope, allowed domains, and denied fields.
2. **Permission-Aware Context Projector** — design-only projection layer that
   filters a built context before AI/tool consumption.
3. **Data Classification Registry** — design-level classification such as
   `operational`, `financial-summary`, `personal`, `credential`, and
   `restricted`.
4. **Tool Allowlist Resolver** — design-only mapping from role/permission and
   context purpose to allowed AI tools.
5. **Context Access Audit Event** — structured event containing actor, scope,
   entity, policy decision, redaction summary, and correlation ID.
6. **Negative Isolation Test Contract** — planned test cases for
   cross-company, cross-branch, consolidated mode, missing scope, and stale
   session context.

No second context builder, vector store, event bus, or AI gateway platform is
created by this architecture lock.

### Dependency

- S10-B security delta evidence;
- auth user-role contract, including role and company identity;
- company/branch scope rules;
- data classification and redaction policy;
- per-role tool/data allowlist;
- negative cross-company and cross-branch test plan;
- S10-C correlation and incident signals.

### Data Flow

```text
Authenticated internal request
  → Server-resolved actor context
  → Resource owner/company/branch lookup
  → Existing contextOrchestrator build/cache
  → Permission and classification policy
  → Redacted, scoped context projection
  → AI/tool consumer
  → Context access audit + execution governance
```

The browser's `companyQueryParam` and consolidated UI mode are not authority.
They are input hints that must be re-resolved and validated server-side.

### Sequence Flow

1. Authenticate the request and determine whether it is an internal session.
2. Load role, company, allowed companies, branch, and relevant permissions.
3. Resolve the target order/shipment and its canonical company/branch.
4. Deny when actor/resource scope is incompatible or unresolved.
5. Build or retrieve context through the existing orchestrator.
6. Apply field-level classification, role allowlist, and purpose limitation.
7. Emit an access decision with redaction metadata.
8. Pass only the projected context to the AI/tool call.
9. Link the context decision to `ai_agent_executions` when governance logging
   is applicable.

### Permission Model

| Actor/context | Default behavior |
|---|---|
| Anonymous | No internal operational context. |
| Customer portal/mobile bearer | Only existing portal contract; never treated as internal staff. |
| Internal staff same company and allowed role | Read only permitted operational fields. |
| Branch-scoped staff | Read only permitted branch/resource scope. |
| Admin with explicit cross-company allowance | May read permitted projection; emit high-severity cross-company audit. |
| Consolidated company mode | Server verifies allowed-company set; never means unrestricted all-company access. |
| Missing/ambiguous scope | Deny sensitive context or return a minimized projection. |

Financial detail, personal data, credentials, raw prompt/output, and
cross-company records require explicit policy. Default is redaction or denial.

### Failure Handling

- Context builder returns no resource: return not found without leaking
  existence across tenant.
- Scope resolver fails: fail closed for sensitive context.
- Cache hit lacks scope identity: do not reuse it for a different actor/policy;
  projection must be applied after retrieval.
- Classification policy unavailable: return minimal safe context or deny.
- AI governance logging fails: do not silently grant a sensitive tool action;
  read-only assistance may degrade according to explicit policy.
- AI provider timeout: retain context/access evidence and return a safe error.

### Observability

- Context build duration, cache hit/miss, and failure rate;
- projection decision, redacted field categories, and denied tool count;
- cross-company/branch denial count;
- context-to-execution correlation ID;
- no raw context, financial secrets, prompt, or output in operational logs.

### Security Boundary

Context is a derived read projection. It does not become a new source of truth.
It cannot write order, shipment, vendor, payment, accounting, bank, or customer
records. Any tool that can mutate business state remains behind its existing
server-authoritative contract and human approval requirements.

### Performance Consideration

- Retain existing parallel domain queries and 30-second cache where safe.
- Separate cache retrieval from actor-specific projection.
- Use bounded stage history, alert history, and AI activity windows.
- Avoid an N+1 policy lookup per field; compile role/classification decisions
  per request.
- Do not add synchronous cross-service calls to critical payment or accounting
  paths.

### Operational Risk

High. Over-permission leaks data; under-permission removes context and can
produce wrong AI decisions. Rollout must expose deny/redaction metrics and
allow a controlled fallback to minimal safe context, never to unrestricted
context.

### Acceptance Criteria

- Role, company, branch, and data classification are explicit in the contract.
- Cross-company and cross-branch negative cases are denied and audited.
- Consolidated mode respects the server-authorized company set.
- Cache reuse cannot bypass actor-specific policy.
- Only allowlisted tools receive projected context.
- No second orchestrator or unrestricted fallback is introduced.

## 3.4 S10-D — AI Execution Audit Trail & Governance Dashboard

### Business Goal

Give Finance, Operations, and Security a safe read-only view of AI activity:
execution count, agent/action, status, confidence, approval state, reasoning
metadata, errors, and cost where authoritative data exists.

### Architecture Goal

Create a permission-aware dashboard projection over existing AI governance
records. The dashboard is a read model and review surface, not a new AI runtime.
It must not change payment, accounting, journal, approval authority, or
execution behavior.

### Affected Modules

- BizPortal governance pages, route registration, and query hooks;
- API AI governance read path;
- `ai_agent_executions`;
- `ai_approval_queue`;
- `aiGovernance` lifecycle metadata;
- audit/access logging;
- company/role scope and PII redaction;
- existing AI review/observability query patterns.

### Existing Components to Reuse

- `aiGovernance.logExecution`, `completeExecution`, `failExecution`,
  `requestApproval`, and approval lifecycle metadata;
- `ai_agent_executions` fields for agent type, action, status, confidence,
  reasoning, model, token counts, summaries, company, and correlation;
- `ai_approval_queue` fields for action, priority, company, status, expiry,
  decision, and linked execution;
- `aiApprovals` list/stats route patterns and bounded pagination;
- `useAiReview` query-key, pagination, refresh, and error-handling patterns;
- BizPortal `CompanyContext` for display selection;
- `assertCompanyAccess`, role permission, and audit log;
- existing AI review audit and observability surfaces.

### New Components (Design Only)

1. **Governance Read Contract** — normalized, redacted DTO for list, summary,
   detail, and aggregate metrics.
2. **Permission-Aware Governance Query Service** — server-side query policy that
   applies company/branch/role filters before pagination and aggregation.
3. **Governance Metric Definitions** — explicit formulas for execution count,
   completion/failure rate, approval rate, pending/expired count, confidence
   aggregate, latency, token/cost totals, and unknown-data handling.
4. **Redacted Governance Projection** — hides raw prompt/output and sensitive
   `context_data` by default; exposes approved summaries and metadata only.
5. **Governance Dashboard UI States** — loading, empty, partial-data,
   permission-denied, provider/data error, and stale-data indicators.
6. **Governance Access Audit Event** — records dashboard/query access without
   copying sensitive result rows into audit payloads.

These are design contracts only. No new route, schema, database object, or UI
page is created by this document.

### Dependency

- S10-F permission-aware context/read contract;
- S10-B tenant isolation evidence;
- S10-C operational error/latency signals;
- role matrix and governance access policy;
- PII minimization/redaction policy;
- retention policy;
- pagination/filter/sort contract;
- authoritative metric definitions and cost availability.

### Data Flow

```text
Existing AI execution + approval records
  → Server-resolved actor/company/branch scope
  → Governance query policy
  → Aggregate/detail query
  → Redacted governance DTO
  → BizPortal dashboard
  → Access audit + UI telemetry
```

No browser-provided `companyId`, filter, or record ID may override server-side
scope. Aggregates must be computed after scope filtering, not from a global
count accidentally exposed to a tenant.

### Sequence Flow

1. Internal user opens the governance dashboard.
2. Server authenticates the internal session and resolves role/permissions.
3. Server determines the authorized company/branch scope.
4. Query validates bounded filters, sort, cursor/offset, and date range.
5. Server filters execution and approval data by authorized scope.
6. Server applies redaction and computes only approved metrics.
7. Server emits a governance access audit event.
8. BizPortal renders data with pagination and explicit stale/error states.
9. Refresh repeats the same scoped, idempotent read path.

### Permission Model

| Persona | Intended visibility |
|---|---|
| Finance | Finance-relevant AI governance metadata within authorized company/branch scope. |
| Operations | Operational agent execution and approval metadata within authorized scope. |
| Security | Cross-company denial/access events and governance metadata according to security policy. |
| Admin/super-admin | Authorized consolidated view, with audit event for cross-company access. |
| Other internal roles | Deny or minimized view unless explicit governance permission exists. |
| Portal/mobile bearer | No internal governance dashboard access. |

Dashboard access is read-only. It does not imply permission to resolve,
approve, reject, undo, execute, or retry an AI action.

### Failure Handling

- Unauthorized: return generic 401/403 without revealing dashboard existence or
  tenant counts.
- Invalid filter/date/page: return validation error with bounded limits.
- Query timeout: return safe error and preserve correlation ID; do not return
  partial cross-scope data.
- Missing cost/confidence/reasoning: show `unknown` or `not available`, never
  fabricate zero or a successful metric.
- Raw sensitive fields present: redact before serialization.
- One source table unavailable: mark metric partial/stale and identify the
  affected source without exposing data.
- Concurrent approval transition: dashboard is eventually consistent and must
  display `as of`/refresh metadata rather than claiming a transactional
  snapshot across unrelated tables.

### Observability

- Query latency, result count, page size, filter dimensions, and error rate;
- permission denials and redaction counts;
- data freshness/source availability;
- dashboard refresh failures and stale state;
- correlation between dashboard access and underlying governance query;
- no raw prompt, model secret, token, personal data, or full context in logs.

### Security Boundary

The dashboard may read existing governance data through a scoped projection. It
must not:

- write to `ai_agent_executions` or `ai_approval_queue`;
- resolve or undo approvals;
- call payment or accounting mutation paths;
- expose raw prompt/output or unrestricted context;
- bypass `assertCompanyAccess` or role permission because the user is an admin;
- create a parallel AI audit source of truth.

### Performance Consideration

- Enforce bounded page size, date range, and filter cardinality.
- Use indexed company/status/created-at fields and aggregate at the database
  boundary where safe.
- Avoid loading full `context_data`, raw prompt, or output for list pages.
- Prefer summary queries and detail-on-demand.
- Cache only scope-safe aggregates with an explicit freshness timestamp.
- Do not make dashboard reads block AI execution or approval writes.

### Operational Risk

High. A dashboard can create false compliance confidence if it omits failures,
mixes tenants, or invents metrics. Metric definitions, partial-data states,
retention, and access logs are therefore part of the architecture, not optional
UI polish.

### Acceptance Criteria

- All list, detail, and aggregate reads are server-scoped and permission-aware.
- Pagination, filtering, sorting, error contract, and freshness metadata are
  explicit.
- Raw prompt/output and sensitive context are redacted by default.
- Execution, approval, status/error, confidence/reasoning metadata, and cost
  appear only when authoritative and permitted.
- Dashboard is read-only and cannot mutate payment, accounting, approval, or
  journal state.
- Cross-company access attempts and dashboard access are auditable.

## 4. Overall Architecture

### 4.1 Textual architecture diagram

```text
                         ┌─────────────────────────┐
                         │ BizPortal / internal UI │
                         │ CompanyContext + views  │
                         └────────────┬────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │ Internal session/auth   │
                         │ role + company + scope  │
                         └────────────┬────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │ API route boundary      │
                         │ requireRole/Admin/User  │
                         └────────────┬────────────┘
                                      │
                    ┌─────────────────┼──────────────────┐
                    ▼                 ▼                  ▼
          ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐
          │ S10-B security │ │ S10-C signals  │ │ S10-F context    │
          │ proof/policy   │ │ health/alerts  │ │ build/projector  │
          └───────┬────────┘ └───────┬────────┘ └────────┬─────────┘
                  │                  │                   │
                  └──────────────────┼───────────────────┘
                                     ▼
                         ┌─────────────────────────┐
                         │ Existing domain sources │
                         │ orders, shipment, users │
                         │ AI execution/approval   │
                         │ audit, health, workers  │
                         └────────────┬────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │ S10-D governance read   │
                         │ redaction + metrics     │
                         └────────────┬────────────┘
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
              ┌────────────────────┐     ┌────────────────────┐
              │ Read-only dashboard│     │ Audit/observability│
              │ scoped DTO + state  │     │ evidence + alerts  │
              └────────────────────┘     └────────────────────┘
```

### 4.2 Request authority

The browser supplies intent, filters, and display selection. The server supplies
identity, role, company/branch scope, resource ownership, permission decision,
redaction, and authoritative business values.

### 4.3 Write authority

Sprint 10 governance components are primarily read/evidence paths:

- security findings are evidence and review artifacts;
- monitoring consumes signals and routes alerts;
- context projection reads and redacts;
- governance dashboard reads existing execution/approval evidence.

No Sprint 10 component becomes owner of payment, accounting, bank, customer,
sport-center, or marketplace transactional state.

## 5. Module Interaction Matrix

| Source / module | Interaction | Consumer | Direction | Contract / boundary |
|---|---|---|---|---|
| Auth/session | Supplies internal identity, role, company, allowed companies | S10-B, S10-F, S10-D | Read | Server-resolved; bearer portal/mobile is not internal staff |
| Company/branch scope | Resolves active authorized scope | S10-B, S10-F, S10-D | Read | Browser company selection is a hint, not authority |
| API security layer | Applies auth, role, resource ownership, rate limit | All in-scope features | Guard | Fail closed and audit denials |
| `contextOrchestrator` | Builds order/shipment operational context | S10-F, AI consumers | Read | Existing source; projection applies actor policy |
| AI governance service | Logs execution and approval lifecycle | S10-D, context correlation | Read/link | Existing `aiGovernance`; dashboard is read-only |
| AI execution table | Stores execution evidence | S10-D, context | Read | Filter by server scope; no raw unrestricted exposure |
| AI approval queue | Stores approval evidence | S10-D | Read | Approval mutations remain existing approval owner |
| Audit log | Records access and security decisions | S10-B, S10-F, S10-D | Append | Use existing audit owner; no parallel audit source |
| Health/readiness | Provides DB, dependency, integration status | S10-C | Read | Public response remains non-sensitive |
| Worker/outbox health | Provides heartbeat/backlog/failure signals | S10-C | Read | Existing lock/worker ownership preserved |
| Monitoring provider | Receives normalized signal/alert | S10-C | Write via adapter | Provider choice and config pending |
| BizPortal `CompanyContext` | Displays selected company/consolidated mode | S10-D | UI hint | Cannot bypass server scope |
| Payment engine | Existing callback/lifecycle telemetry only | S10-C | Read-only contract | No payment state mutation |
| Accounting core | Existing error/health telemetry only | S10-C | Read-only contract | No journal/posting mutation |
| Bank reconciliation | No direct Sprint 10 interaction | None | None | Boundary remains unchanged |
| Customer Portal | No direct Sprint 10 interaction | None | None | Existing public/customer contract only |
| Sport Center | No direct Sprint 10 interaction | None | None | Existing module ownership preserved |

## 6. Data Ownership Matrix

| Entity / data | Canonical owner | Read by Sprint 10 | Write by Sprint 10 | Event source | Audit owner |
|---|---|---|---|---|---|
| User identity, role, custom permissions | Auth/user and role subsystem | S10-B, S10-F, S10-D policy layer | None | Session/auth and user-role changes | Existing audit log; security owner reviews |
| Company and branch scope | Company/org subsystem | S10-B, S10-F, S10-D | None | Company/branch assignment changes | Existing audit log |
| Orders and shipments | Marketplace/logistics domain | `contextOrchestrator`, scoped governance projection | None | Existing domain lifecycle | Marketplace/logistics audit owner |
| Vendor and vendor performance | Vendor/logistics domain | Context projection | None | Existing vendor/order events | Vendor/logistics audit owner |
| Financial summary/payment status | Sales/finance/payment domain | Minimized context and permitted dashboard fields | None | Existing financial/payment events | Finance/payment owner |
| AI execution record | AI governance runtime / `ai_agent_executions` | S10-D, context summary | Existing AI runtime only; not dashboard | `aiGovernance.logExecution/complete/fail` | AI governance owner plus access audit |
| AI approval record | Approval engine / `ai_approval_queue` | S10-D and context pending summary | Existing approval owner only; not dashboard | Request/resolve/expire/undo lifecycle | Approval owner plus access audit |
| Operational context | Derived by `contextOrchestrator` | S10-F projection and permitted consumers | Context builder/cache only if existing contract requires | Order/shipment/alert/AI source changes | Context access audit |
| Security finding/evidence | Security/release governance | S10-B review | Evidence artifact/register only after design approval | Reproduction, regression, DNB, sign-off | Security owner |
| Health/worker/integration signal | API/worker/integration owners | S10-C normalizer | Existing health snapshot/error mechanisms; provider adapter later | Health checks, heartbeat, client error, integration check | Operations/DevOps owner |
| Alert and incident record | Operations/monitoring system | S10-C and incident review | Monitoring adapter/runbook process | Threshold transition and acknowledgement | Operations owner |
| Audit access event | Existing `erp_audit_logs` audit service | Security/operations review | Existing audit service | Security decision, context access, dashboard access | Audit/security owner |
| Raw prompt/output/context | AI runtime and retention policy | Not exposed by default | No new copy by Sprint 10 | Existing AI execution lifecycle | AI/security policy owner |

Ownership rule: a Sprint 10 consumer may read a canonical entity only through
an existing contract or a new design-approved read projection. It may not
silently become a second writer or source of truth.

## 7. Integration Boundary

### 7.1 Allowed integration

Sprint 10 may integrate with existing contracts for:

- authentication/session and server-side user context;
- company/branch and resource ownership resolution;
- order/shipment operational context;
- AI execution/approval evidence;
- health/readiness/worker/integration signals;
- existing audit logging;
- BizPortal read/query patterns.

External monitoring providers may be selected and configured only after owner,
retention, security, and environment decisions. This document does not add a
connector or expose credentials.

### 7.2 Explicitly protected modules

Sprint 10 must not directly touch:

- **Customer Portal** — no new internal governance authority or customer data
  exposure;
- **Sport Center** — no payment mirror, booking, or accounting behavior change;
- **Accounting Core** — no journal, COA, posting, period lock, reversal, or
  ledger mutation;
- **Payment Engine** — no lifecycle, provider callback, retry, cancellation, or
  execution mutation;
- **Bank Reconciliation Engine** — no bank mutation, settlement match, or
  reconciliation state mutation.

Access to metadata from these modules is allowed only through existing
read/health/audit contracts, with the owning module remaining canonical.

### 7.3 Sprint 09 non-overlap

The architecture does not alter:

```text
Marketplace AP preparation → waiting_payment
  → Payment lifecycle
  → Accounting evidence handoff
  → Bank Reconciliation reference link
```

Sprint 09 runtime proof and release E2E gaps remain release/QA evidence work.
If S10-B discovers a defect in a Sprint 09 route, it must be handled as a
separate evidence-backed defect with explicit boundary impact, not as a silent
contract change.

## 8. Security Architecture

### 8.1 Trust zones

```text
Untrusted browser / external client
  → authenticated session or scoped portal token
  → API authorization boundary
  → server-side company/resource policy
  → minimized domain read projection
  → AI governance / monitoring read path
```

### 8.2 Security controls

- Internal staff routes require an internal authenticated session.
- Bearer-token portal/mobile users cannot be promoted to internal staff by
  client metadata.
- User role and company context are loaded server-side; session fallback remains
  bounded and must not widen authority.
- Resource company ownership is checked with `assertCompanyAccess`.
- Cross-company admin access, when permitted, produces an explicit audit event.
- Non-admin cross-company access returns a generic denial.
- Rate limits remain part of the security boundary for AI/public operations.
- SQL remains parameterized; filters and pagination are bounded.
- Prompt, output, token, secret, and credential values are not placed into
  operational logs or external monitoring payloads.
- Unknown environment/database identity blocks fixture writes and security proof.

### 8.3 Data minimization

The default governance projection includes identifiers, type/status,
timestamps, approved summaries, confidence, approval state, and scoped business
metadata. It excludes raw prompts, raw outputs, credentials, unnecessary
personal data, unrestricted `context_data`, and unrelated tenant rows.

### 8.4 Security failure posture

Sensitive reads fail closed. Operational health may return degraded/unknown
status when a dependency is unavailable, but it must not substitute a broader
scope or claim a successful check.

## 9. Permission Architecture

### 9.1 Permission decision inputs

```text
actor identity
  + internal-session status
  + system/custom role
  + permission strings
  + company assignment / allowed companies
  + branch/division scope
  + resource canonical company/branch
  + data classification
  + requested purpose
  + requested fields/tools
```

### 9.2 Decision order

1. Authenticate actor.
2. Reject non-internal actor for internal governance paths.
3. Resolve role and permission.
4. Resolve company and branch scope server-side.
5. Resolve resource owner.
6. Apply route permission and resource ownership.
7. Apply field classification/redaction.
8. Apply tool allowlist for AI context.
9. Emit audit metadata.
10. Return allow, minimize, or deny.

### 9.3 Consolidated mode

`CompanyContext` uses a consolidated sentinel for UI selection. Architecture
requires the server to resolve that mode against the user's authorized company
set. Consolidated mode is not an unrestricted global permission and must not
return rows from companies outside that set.

### 9.4 Permission outcomes

| Outcome | Meaning |
|---|---|
| Allow | Requested resource and fields are within policy. |
| Minimize | Resource is allowed but sensitive fields are redacted. |
| Deny | Identity, scope, role, resource, or policy is incompatible. |
| Unknown | Dependency/policy could not be safely evaluated; sensitive access must behave as deny. |

## 10. Observability Architecture

### 10.1 Signal layers

1. **Availability:** `/api/healthz`, readiness, gateway, SSE.
2. **Dependency:** database, Supabase, storage, SMTP, WhatsApp/Paylabs.
3. **Work execution:** worker heartbeat, queue depth, failed jobs, outbox state.
4. **Application:** 4xx/5xx, latency, client errors, auth failures.
5. **Governance:** AI execution failure, pending/expired approvals, context
   denial/redaction, dashboard query errors.
6. **Security:** cross-company denial/allow audit, rate-limit events, proof
   outcomes, environment identity checks.

### 10.2 State model

```text
healthy → degraded → critical
    ↑         │          │
    └─ recovery / acknowledgement / escalation

unknown is distinct from healthy and must not be treated as PASS.
```

### 10.3 Alert contract

Every alert design includes:

- stable deduplication key;
- component and environment;
- severity P0–P3;
- first seen and last seen;
- owner and channel;
- response SLA;
- acknowledgement and escalation;
- recovery condition;
- runbook reference;
- timestamped evidence.

The monitoring matrix remains authoritative for initial thresholds. Stack
selection is pending and not part of this document's implementation.

## 11. AI Governance Architecture

### 11.1 Existing governance runtime

`aiGovernance` already provides the execution/approval lifecycle:

- execution logging;
- completion/failure status;
- confidence/reasoning/model/token metadata;
- approval request and linkage;
- resolve, undo, expiry, and auto-approval guards;
- correlation through company/order/RFQ/request metadata.

`ai_agent_executions` and `ai_approval_queue` remain canonical for their
respective records.

### 11.2 Governance read model

The planned dashboard consumes a normalized projection:

```text
GovernanceSummary
  - time window / freshness
  - scoped execution count
  - status counts
  - approval counts and rates
  - pending / expired / failed counts
  - confidence aggregate where available
  - duration/latency aggregate where available
  - token/cost aggregate only when authoritative
  - source completeness / partial-data markers

GovernanceExecutionRow
  - execution ID
  - agent type and action
  - status and timestamps
  - confidence / approved reasoning metadata
  - company/branch scope already authorized
  - linked approval status
  - redacted input/output summaries
  - correlation reference
```

### 11.3 Metric rules

- Counts are computed after scope filtering.
- Unknown cost/confidence is `unknown`, not zero.
- Approval rate excludes records without an applicable approval state or
  explicitly labels the denominator.
- Partial source failure is displayed as partial/stale.
- A dashboard read never changes execution or approval status.
- Metrics must carry `asOf`/freshness metadata.

### 11.4 AI action boundary

AI may receive a permission-aware context projection. It does not receive
unrestricted database access. Mutating tools retain their existing
server-authoritative validation and human approval boundary. S10-D adds
visibility, not autonomy.

## 12. Dependency Graph

### 12.1 Locked graph

```text
                         ┌──────────────────────────────┐
                         │ S10-A release/QA prerequisite │
                         │ separate from feature scope  │
                         └──────────────┬───────────────┘
                                        ▼
                         ┌──────────────────────────────┐
                         │ S10-B Security delta evidence │
                         │ tenant isolation hardening   │
                         └──────────────┬───────────────┘
                                        ▼
                         ┌──────────────────────────────┐
                         │ S10-C Observability activation│
                         │ incident readiness           │
                         └──────────────┬───────────────┘
                                        ▼
                         ┌──────────────────────────────┐
                         │ S10-F Permission-aware       │
                         │ operational context          │
                         └──────────────┬───────────────┘
                                        ▼
                         ┌──────────────────────────────┐
                         │ S10-D AI Governance Dashboard │
                         │ read-only bounded slice      │
                         └──────────────────────────────┘
```

### 12.2 Parallel work

- S10-C signal inventory may run in parallel with S10-B discovery.
- S10-I documentation may run in parallel as a separate backlog.
- S10-D UI information architecture may be drafted while S10-F contract is
  being finalized, but implementation cannot consume an unapproved scope
  contract.
- S10-E, S10-G, and S10-H are not dependencies for the locked feature chain.

### 12.3 Dependency exit gates

| Gate | Exit evidence |
|---|---|
| S10-A | Dedicated staging identity, release E2E, backup/restore, rollback, monitoring evidence, sign-off |
| S10-B | Frozen finding register, reproduction/decision, tenant proof, regression/DNB, rollback |
| S10-C | Provider/channel/owner, threshold approval, test alert, runbook, SLA |
| S10-F | Permission contract, classification/allowlist, isolation proof, audit evidence |
| S10-D | Scoped read contract, redaction/PII review, metric definitions, dashboard acceptance |

## 13. Risk Matrix

| Category | Risk | Probability | Impact | Mitigation | Owner |
|---|---|---:|---:|---|---|
| Technical | Existing broad context is reused without actor-specific projection. | Medium | Critical | Separate context build/cache from permission-aware projection; negative isolation tests. | Technical Lead / Security |
| Technical | A legacy security finding is stale but treated as current. | High | High | Reproduce against current source and staging; retain explicit decision status. | Technical Lead |
| Technical | Dashboard metrics use inconsistent denominators or stale data. | Medium | High | Metric dictionary, source completeness, freshness metadata, reconciliation review. | Data Owner |
| Technical | New design accidentally creates a second AI gateway/orchestrator. | Medium | High | Reuse `contextOrchestrator` and `aiGovernance`; architecture review before implementation. | Architecture Owner |
| Security | Cross-company data appears in context or dashboard aggregates. | Medium | Critical | Server-side scope before aggregation, default deny, redaction, access audit, negative tests. | Security Owner |
| Security | Admin or consolidated mode becomes unrestricted access. | Medium | Critical | Explicit allowed-company resolution and high-severity cross-company audit. | Security Owner |
| Security | Sensitive prompt/output or credentials reach logs/provider. | Medium | Critical | Data classification, structured redaction, minimization, retention review. | Security / DevOps |
| Performance | Governance queries scan full execution/approval history. | Medium | High | Bounded date/page filters, indexed scope/status/time fields, summary/detail separation. | Backend / Data Owner |
| Performance | Context aggregation adds latency to AI requests. | Medium | High | Parallel existing queries, bounded history, cache, projection budget, timeout policy. | AI/Backend Owner |
| Operational | Monitoring alerts have no responder or create fatigue. | Medium | High | Owner roster, P0–P3 SLA, dedup/cooldown, test alert, monthly calibration. | Operations Owner |
| Operational | Provider outage is mistaken for application outage or healthy state. | Medium | High | Distinguish `unknown`, `degraded`, and `critical`; retain local evidence. | DevOps |
| Scalability | AI execution volume makes dashboard and audit writes expensive. | Medium | High | Summary queries, retention policy, pagination, no raw payload list reads. | AI/Data Owner |
| Scalability | Scope checks add N+1 queries across high-volume routes. | Medium | Medium | Request-scope context, indexed ownership, compiled policy decisions. | Backend Owner |

## 14. Decision Register

| ID | Decision | Status | Rationale / consequence | Owner |
|---|---|---|---|---|
| ADR-10B-001 | Sprint 10 uses existing bounded modules rather than a new platform rewrite. | APPROVED | Limits risk and preserves current ownership. | Technical Lead |
| ADR-10B-002 | S10-A release verification remains separate from feature implementation. | APPROVED | Sprint 09 release evidence must not be relabeled as feature delivery. | Release Lead |
| ADR-10B-003 | `contextOrchestrator` remains the single operational context builder. | APPROVED | Prevents duplicate aggregation logic and inconsistent context. | Architecture Owner |
| ADR-10B-004 | Actor-specific projection is applied after context retrieval and before AI consumption. | APPROVED | Cache reuse cannot bypass permission or redaction. | Security Owner |
| ADR-10B-005 | AI Governance Dashboard is read-only in the locked slice. | APPROVED | Visibility must not change approval, payment, accounting, or journal authority. | Product Owner / Finance |
| ADR-10B-006 | `ai_agent_executions` remains canonical for execution evidence. | APPROVED | Avoids parallel audit source and preserves existing governance lifecycle. | AI Owner |
| ADR-10B-007 | `ai_approval_queue` remains canonical for approval evidence and mutation. | APPROVED | Dashboard cannot become approval engine. | Finance Owner |
| ADR-10B-008 | Browser company selection is a hint, never authorization. | APPROVED | Prevents client-controlled tenant widening. | Security Owner |
| ADR-10B-009 | Unknown security/environment evidence is not PASS. | APPROVED | Preserves fail-closed release posture. | Release Lead |
| ADR-10B-010 | Monitoring provider and alert channel are not selected by this document. | APPROVED — business decision | Opsi C approved by Product Owner; concrete provider/channel and G-03 evidence remain required. | DevOps |
| ADR-10B-011 | Governance metric definitions and denominator policy. | APPROVED — business decision | Opsi B approved by Product Owner; metric dictionary and G-05 evidence remain required. | Product Owner / Finance |
| ADR-10B-012 | Field-level AI data classification and retention period. | APPROVED — business decision | Opsi B approved with Opsi C interim until implementation B is complete. | Security / Product Owner |
| ADR-10B-013 | Branch/division-level scope semantics for consolidated governance views. | APPROVED — business decision | Opsi B approved with Opsi C interim until implementation B is complete. | Product Owner / Org Owner |
| ADR-10B-014 | External monitoring evidence retention and incident export format. | APPROVED — business decision | Opsi B approved by Product Owner; provider mapping and G-03 evidence remain required. | DevOps / Operations |
| ADR-10B-015 | Whether approved governance summaries may show model/token/cost metadata to each persona. | APPROVED — business decision | Opsi B approved with Opsi C interim until implementation B is complete. | Product Owner / Finance |

No PENDING or REQUIRES PRODUCT OWNER decision authorizes implementation that
would widen scope or bypass an existing protected boundary.

## 15. Acceptance Criteria

### Architecture-level acceptance

- [ ] Four in-scope features have technical designs with business goal,
  architecture goal, modules, reuse, design-only additions, dependency, data
  flow, sequence, permission, failure, observability, security, performance,
  operational risk, and acceptance criteria.
- [ ] Overall textual architecture diagram is present.
- [ ] Module interaction matrix identifies direction and boundary.
- [ ] Data ownership matrix identifies canonical owner, read, write, event, and
  audit owner for each relevant entity.
- [ ] Integration boundary explicitly protects Customer Portal, Sport Center,
  Accounting Core, Payment Engine, and Bank Reconciliation Engine.
- [ ] Risk matrix covers Technical, Security, Performance, Operational, and
  Scalability categories.
- [x] Decision register records the approved business decisions and their
  remaining technical/operational resolution gates.
- [ ] Dependency graph follows S10-B → S10-C → S10-F → S10-D.

### Design invariants

- [ ] Additive and backward compatible.
- [ ] Existing components are reused where already present.
- [ ] Server authoritative for identity, scope, permission, ownership, and
  redaction.
- [ ] Idempotent for evidence, alert deduplication, context cache/invalidation,
  and repeated dashboard reads.
- [ ] Audit-friendly without logging secrets or raw sensitive AI payloads.
- [ ] Tenant-isolated with fail-closed behavior for unknown scope.
- [ ] No direct mutation of Sprint 09 Payment, Accounting, or Reconciliation
  boundaries.

### Feature gate acceptance

- [ ] S10-B cannot proceed from finding label alone; current reproduction or an
  explicit non-PASS decision is required.
- [ ] S10-C cannot be called active until provider/channel/owner/threshold/
  runbook/test-alert decisions are complete.
- [ ] S10-F cannot expose AI context until permission, classification, allowlist,
  and isolation contracts are approved.
- [ ] S10-D cannot expose dashboard data until S10-F read scope and redaction
  policy are approved.

## 16. Exit Criteria

Architecture lock is complete when:

1. This document is approved as the baseline for the four in-scope workstreams.
2. All APPROVED decisions are preserved in implementation tickets/designs.
3. Product Owner business decisions have named owners, approval records, and
   explicit technical/operational resolution gates.
4. S10-A remains separately tracked as release/QA prerequisite.
5. No source code, migration, endpoint, service, schema, test, workflow, API,
   or configuration has been created as part of this phase.
6. Sprint 09 boundaries remain unchanged.
7. Implementation work, when authorized later, starts with S10-B and produces
   evidence before S10-C/S10-F/S10-D progression.
8. Production GO remains governed by the release evidence matrix and is not
   implied by architecture approval.

## 17. Recommendation

1. Accept this document as the formal technical baseline for Sprint 10.
2. Resolve S10-A release/QA evidence independently before high-risk feature
   implementation.
3. Start implementation only with the S10-B security evidence gate.
4. Activate S10-C only after monitoring owner/provider/SLA decisions are
   complete.
5. Complete S10-F permission-aware projection before S10-D dashboard reads.
6. Use the AI Governance Dashboard as the first bounded product-visible slice,
   but keep it read-only and scoped.
7. Do not introduce a second orchestrator, a new event bus, a vector database,
   an approval automation engine, or a new payment/accounting boundary in this
   sprint.
8. Keep S10-E, S10-G, S10-H, S10-I, and technical debt outside the locked
   feature implementation unless a later scope change is approved.

### Final verdict

> ✅ **Sprint 10 Architecture Locked**
>
> ✅ Design baseline: S10-B → S10-C → S10-F → S10-D
> 🚧 S10-A: separate release/QA prerequisite
> ⏸️ S10-E, S10-G, S10-H: future backlog
> 📚 S10-I: documentation backlog
> ❌ Sprint 10 implementation: **NOT IMPLEMENTED**

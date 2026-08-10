# Sprint 10 — Product Owner Decision Closure

**Tanggal:** 2026-08-10  
**Status:** Planning / governance only  
**Sprint 10 implementation:** **NOT STARTED**  
**Final verdict:** ❌ **Sprint 10 Authorization Still Blocked**

## 1. Tujuan dan batasan

Dokumen ini menutup analisis keputusan Product Owner untuk ADR berikut:

- ADR-10B-010 — Monitoring provider dan alert channel
- ADR-10B-011 — Governance metric definitions dan denominator policy
- ADR-10B-012 — Field-level AI data classification dan retention
- ADR-10B-013 — Branch/division scope untuk consolidated governance views
- ADR-10B-014 — Monitoring evidence retention dan incident export
- ADR-10B-015 — Persona-level model/token/cost visibility

Dokumen ini adalah artefak perencanaan dan governance. Dokumen ini **tidak**
melakukan coding, migration, perubahan schema, endpoint, service, workflow,
runtime activation, test, refactor, atau implementasi Sprint 10.

Source of truth:

- `docs/sprints/SPRINT-10_PLANNING_DISCOVERY.md`
- `docs/sprints/SPRINT-10_SCOPE_LOCK.md`
- `docs/sprints/SPRINT-10_ARCHITECTURE_LOCK.md`
- `docs/sprints/SPRINT-10_BUSINESS_DECISIONS.md`
- `docs/sprints/SPRINT-10_IMPLEMENTATION_MASTER_PLAN.md`
- `docs/sprints/SPRINT-10_DECISION_RESOLUTION.md`

## 2. Executive summary

Scope Sprint 10 yang sudah dikunci adalah:

1. S10-B — Security Delta Audit & Tenant Isolation Hardening
2. S10-C — Centralized Monitoring & Incident Readiness
3. S10-F — Permission-Aware Operational Context
4. S10-D — AI Execution Audit Trail & Governance Dashboard

S10-A tetap merupakan release/QA prerequisite terpisah. Boundary Sprint 09
berikut tidak berubah:

```text
Marketplace AP preparation → waiting_payment
  → Payment lifecycle
  → Accounting evidence handoff
  → Bank Reconciliation reference link
```

Keputusan yang telah approved pada architecture/business baseline tetap berlaku:

- gunakan bounded module yang sudah ada, bukan platform rewrite;
- `contextOrchestrator` tetap menjadi satu-satunya context builder;
- actor-specific projection diterapkan setelah retrieval/cache dan sebelum
  AI/tool consumption;
- governance dashboard bersifat read-only;
- `ai_agent_executions` dan `ai_approval_queue` tetap canonical;
- pilihan company dari browser hanya merupakan hint, bukan authorization;
- unknown security/environment evidence bukan PASS;
- sensitive atau ambiguous data harus default-deny atau redacted.

Namun, keenam ADR di bawah belum memiliki opsi final dan sign-off yang dapat
membuka gate implementasi. Rekomendasi dalam dokumen ini bukan approval.

| ADR | Status saat ini | Owner | Dampak blocking |
|---|---|---|---|
| ADR-10B-010 | `PENDING` | DevOps | Memblok pemilihan provider/channel dan aktivasi S10-C |
| ADR-10B-011 | `REQUIRES PRODUCT OWNER` | Product Owner / Finance | Memblok metric dan aggregate dashboard yang authoritative |
| ADR-10B-012 | `REQUIRES PRODUCT OWNER` | Security / Product Owner | Memblok context sensitif, redaction, retention, dan DTO final |
| ADR-10B-013 | `REQUIRES PRODUCT OWNER` | Product Owner / Org Owner | Memblok consolidated dan branch-aware scope |
| ADR-10B-014 | `PENDING` | DevOps / Operations | Memblok evidence monitoring yang audit-ready |
| ADR-10B-015 | `REQUIRES PRODUCT OWNER` | Product Owner / Finance | Memblok visibility model/token/cost per persona |

## 3. Invariants lintas ADR

Setiap keputusan final harus tetap:

- additive dan backward compatible;
- server-authoritative untuk identity, role, company, branch, ownership,
  permission, redaction, dan business values;
- tenant-isolated dengan default deny untuk scope yang unknown atau ambiguous;
- idempotent untuk evidence, alert deduplication, cache/invalidation, dan
  repeated read;
- audit-friendly tanpa menyimpan secret, credential, token, raw prompt/output,
  atau raw business payload yang tidak diperlukan;
- tidak mengubah authority Payment, Accounting, Reconciliation, Marketplace,
  Customer Portal, atau Sport Center;
- tidak membuat second orchestrator, event bus, vector store, approval engine,
  atau parallel AI audit source of truth;
- tidak menganggap recommendation sebagai approval;
- tidak menyatakan production GO berdasarkan dokumen planning.

---

## 4. ADR-10B-010 — Monitoring Provider and Alert Channel

### 4.1 Current decision

**Status:** `PENDING`  
**Feature:** S10-C — Centralized Monitoring & Incident Readiness  
**Keputusan saat ini:** provider, designated alert channel, cost boundary,
retention constraint, owner roster, dan escalation route belum dipilih.
Monitoring matrix yang ada hanya merupakan candidate signal dan threshold
inventory; matrix tersebut belum menjadi approval activation.

### 4.2 Business impact

Tanpa provider dan channel yang jelas, downtime, payment callback failure,
queue backlog, database pressure, SSE degradation, integration failure, dan
error spike tidak memiliki jalur respons yang accountable. Monitoring dapat
menjadi sekadar dashboard tanpa acknowledgement, SLA, escalation, atau
evidence yang dapat diaudit.

Keputusan yang terlalu luas juga dapat meningkatkan biaya, alert fatigue, dan
risiko ketergantungan vendor.

### 4.3 Technical impact

Pilihan provider menentukan adapter contract untuk health, error, worker,
queue, database, integration, callback, dan deployment signals. Implementasi
kelak harus memakai adapter/policy tipis di sekitar signal existing, bukan
membuat event bus atau observability platform baru.

Signal harus memiliki state `healthy`, `degraded`, `critical`, atau `unknown`,
stable deduplication key, cooldown, recovery condition, severity P0–P3, dan
correlation metadata. Provider outage tidak boleh diperlakukan sebagai
application outage atau healthy state secara otomatis.

### 4.4 Security impact

Provider dan channel tidak boleh menerima secret, bearer token, credential,
raw request/business payload, raw AI prompt/output, atau PII yang tidak
diperlukan. Detailed operational history harus tetap internal atau
permissioned. Credential provider harus least-privilege dan dipisahkan dari
application business authority.

### 4.5 Operational impact

DevOps harus menetapkan designated on-call channel, owner per severity,
escalation SLA, acknowledgement expectation, runbook, test-alert procedure,
retention boundary, dan continuity path ketika provider unavailable.

Activation belum boleh disebut selesai sebelum test alert mencapai channel,
di-acknowledge, memiliki recovery/escalation evidence, dan dapat direview.

### 4.6 Available options

| Opsi | Deskripsi |
|---|---|
| A | Hanya memakai dashboard/manual health check existing |
| B | Mengonfigurasi beberapa provider sekaligus |
| C | Memilih satu provider/adapter tipis dan satu designated channel |

### 4.7 Pros & cons tiap opsi

**Opsi A — Existing dashboards only**

- **Pros:** biaya dan konfigurasi tambahan paling kecil; tidak menambah
  dependency eksternal.
- **Cons:** routing, acknowledgement, deduplication, escalation, dan evidence
  tidak konsisten; tidak memenuhi incident-readiness yang terpusat.

**Opsi B — Multiple providers**

- **Pros:** redundansi dan pilihan signal/provider lebih luas.
- **Cons:** konfigurasi, biaya, duplicate alert, retention boundary, dan
  operational ownership menjadi lebih kompleks; memperbesar attack surface.

**Opsi C — One thin provider adapter + designated channel**

- **Pros:** bounded, mudah diaudit, ownership jelas, deduplication dan SLA
  lebih konsisten, serta tidak memerlukan platform observability baru.
- **Cons:** menambah single-provider dependency; outage provider memerlukan
  local evidence dan degraded/unknown fallback.

### 4.8 Recommended option

**Opsi C.** Pilih satu provider/adapter tipis, satu designated on-call channel,
owner roster, routing policy, deduplication, cooldown, recovery, escalation,
dan P0–P3 SLA. Provider harus dipilih setelah review cost, data boundary,
retention, access control, dan continuity.

### 4.9 Decision owner

**DevOps.** Related approvers: Operations Owner, Technical Lead, dan Security
Owner.

### 4.10 Approval required

Approval tertulis harus mencakup:

- provider/adapter dan designated channel;
- cost, access, data-minimization, serta retention constraint;
- owner roster dan escalation route;
- threshold, severity, deduplication, cooldown, recovery, dan SLA;
- batas signal/payload yang boleh dikirim;
- test alert dan runbook acceptance.

### 4.11 Blocking dependency

- S10-A/G-01 release/QA environment dan identity yang dedicated;
- monitoring matrix sebagai candidate inventory;
- ADR-10B-014 untuk retention/export;
- owner roster, threshold approval, runbook, dan on-call coverage;
- G-02 security evidence sebelum activation penuh.

### 4.12 Final recommended decision

**Belum final / belum approved.** Product Owner menerima **Opsi C sebagai
rekomendasi**, tetapi ADR tetap `PENDING` sampai DevOps memilih provider dan
channel serta memperoleh approval terkait. S10-C tidak boleh diaktifkan sebelum
G-03 terpenuhi.

---

## 5. ADR-10B-011 — Governance Metric Definitions and Denominators

### 5.1 Current decision

**Status:** `REQUIRES PRODUCT OWNER`  
**Feature:** S10-D — AI Execution Audit Trail & Governance Dashboard  
**Keputusan saat ini:** unit execution, numerator/denominator untuk completion,
failure, approval, pending, expired, confidence, latency, token, cost,
freshness, dan partial/unknown handling belum ditetapkan.

Canonical source tetap `ai_agent_executions` untuk execution evidence dan
`ai_approval_queue` untuk approval evidence. Source tersebut tidak diganti atau
diduplikasi.

### 5.2 Business impact

Metric yang tidak memiliki definisi bisnis dapat menghasilkan false compliance
confidence. Retry dapat dihitung sebagai execution baru atau attempt; cancelled
dan expired dapat salah diperlakukan sebagai failure; missing cost dapat salah
ditampilkan sebagai zero; dan aggregate lintas scope dapat menyesatkan Finance,
Operations, atau Security.

### 5.3 Technical impact

Dashboard memerlukan metric dictionary yang mendefinisikan source, unit,
filter scope, numerator, denominator, inclusion/exclusion, timezone, date
window, freshness, `asOf`, dan partial-data semantics. Scope server harus
diterapkan sebelum pagination, aggregation, atau cache.

Metric calculation harus bounded dan menggunakan data canonical. Unknown,
partial, dan not available harus dipertahankan sebagai status eksplisit, bukan
dipaksa menjadi angka nol.

### 5.4 Security impact

Aggregate harus dihitung setelah company/branch/role filtering sehingga global
count tidak bocor ke tenant. Detail metric tidak boleh membuka raw prompt,
raw output, unrestricted `context_data`, credential, atau data company lain.
Access terhadap metric dan detail tetap diaudit.

### 5.5 Operational impact

Owner metric harus dapat menjelaskan kapan data dianggap fresh, bagaimana
partial source ditangani, dan kapan dashboard menampilkan stale/error state.
Perlu review cadence, reconciliation terhadap canonical source, dan prosedur
ketika definisi bisnis berubah.

### 5.6 Available options

| Opsi | Deskripsi |
|---|---|
| A | Simple row counts dari tabel |
| B | Business-event denominators dengan metric dictionary eksplisit |
| C | Menunda aggregate dan hanya menampilkan bounded raw status/read evidence |

### 5.7 Pros & cons tiap opsi

**Opsi A — Simple row counts**

- **Pros:** implementasi dan penjelasan awal sederhana; cepat menghasilkan
  angka dasar.
- **Cons:** tidak membedakan attempt/retry, lifecycle state, cancelled,
  expired, atau applicability approval; berisiko menghasilkan metric yang
  tidak bermakna.

**Opsi B — Business-event denominators**

- **Pros:** metric sesuai lifecycle dan kebutuhan Finance/Operations; definisi
  dapat diaudit, direkonsiliasi, dan menjadi kontrak yang stabil.
- **Cons:** lebih kompleks; membutuhkan workshop Product/Finance dan
  pemeliharaan metric dictionary.

**Opsi C — Defer aggregates**

- **Pros:** risiko metric palsu paling rendah selama policy belum selesai.
- **Cons:** business value dashboard berkurang dan governance visibility tetap
  terbatas; hanya aman sebagai interim state.

### 5.8 Recommended option

**Opsi B**, dengan **Opsi C sebagai interim safe state** sampai approval final.
Setiap metric harus memiliki unit, numerator, denominator, source, freshness,
dan perlakuan `unknown`, `partial`, serta `not available`. Missing value tidak
boleh diisi sebagai zero atau success tanpa policy eksplisit.

### 5.9 Decision owner

**Product Owner / Finance.** Related approvers: AI Owner, Data Owner, dan
Security Owner.

### 5.10 Approval required

Approval harus menetapkan:

- definisi execution dan unit of count;
- completion/failure serta retry semantics;
- approval rate dan perlakuan cancelled, rejected, serta expired;
- pending/expired semantics;
- confidence, latency, token, dan cost formulas;
- freshness, `asOf`, source completeness, unknown, partial, dan not-available;
- review cadence dan owner metric.

### 5.11 Blocking dependency

- review canonical `ai_agent_executions` dan `ai_approval_queue`;
- S10-F permission-aware read contract;
- ADR-10B-012 classification/retention;
- ADR-10B-013 company/branch scope semantics;
- S10-C freshness/error signals;
- G-05 dashboard acceptance.

### 5.12 Final recommended decision

**Belum final / belum approved.** Product Owner/Finance menerima **Opsi B
sebagai rekomendasi**, dengan Opsi C sebagai fallback sementara. ADR tetap
`REQUIRES PRODUCT OWNER`; trusted dashboard aggregates dan G-05 belum boleh
dibuka.

---

## 6. ADR-10B-012 — Field-Level AI Data Classification and Retention

### 6.1 Current decision

**Status:** `REQUIRES PRODUCT OWNER`  
**Feature:** S10-F / S10-D  
**Keputusan saat ini:** field-level classification, allowed consumer/purpose,
redaction, retention, deletion, legal hold, dan provider export policy belum
final.

Classification baseline yang telah diidentifikasi adalah `operational`,
`financial-summary`, `personal`, `credential`, dan `restricted`. Sebelum policy
final, sensitive data wajib default-deny atau redacted.

### 6.2 Business impact

Policy ini menentukan context apa yang boleh dipakai AI, metadata apa yang dapat
dilihat persona tertentu, dan data apa yang dapat disimpan untuk audit. Policy
terlalu luas meningkatkan risiko kebocoran dan compliance exposure; policy
terlalu sempit dapat mengurangi kualitas assistant serta nilai governance.

### 6.3 Technical impact

Classification harus diterapkan setelah context retrieval/cache dan sebelum
AI/tool consumption, serialization, audit payload, monitoring export, dan
dashboard DTO. Diperlukan field registry, purpose limitation, consumer
allowlist, redaction rules, retention/deletion semantics, dan scope-safe cache
projection.

Raw `context_data`, raw prompt/output, credential, dan unrestricted tenant data
tidak boleh dimuat atau diekspos secara default.

### 6.4 Security impact

Ini adalah keputusan security-critical. Field yang personal, credential,
restricted, raw prompt/output, atau sensitive financial detail berpotensi
menyebabkan PII exposure, credential leakage, cross-company disclosure, dan
retention yang tidak sah.

Server, bukan browser atau UI state, harus menentukan actor, company, branch,
purpose, allowed fields, dan redaction. Unknown classification harus
fail-closed.

### 6.5 Operational impact

Security/Product/Privacy owner perlu memelihara registry, review cadence,
deletion/legal hold process, provider export review, access audit, dan incident
response apabila data salah terklasifikasi. Policy harus dapat dipahami oleh
AI, dashboard, audit, dan monitoring owners.

### 6.6 Available options

| Opsi | Deskripsi |
|---|---|
| A | Broad operational access untuk consumer yang berwenang |
| B | Field-level classification dan purpose limitation |
| C | Deny seluruh sensitive fields sampai policy lengkap |

### 6.7 Pros & cons tiap opsi

**Opsi A — Broad operational access**

- **Pros:** context lebih lengkap dan implementasi awal lebih sederhana.
- **Cons:** risiko leakage, over-collection, cross-persona exposure, dan
  retention violation sangat tinggi; tidak sesuai fail-closed posture.

**Opsi B — Field-level classification + purpose limitation**

- **Pros:** paling seimbang antara utility dan minimization; dapat diaudit,
  dibatasi per consumer, dan dipakai untuk redaction yang konsisten.
- **Cons:** memerlukan catalog field, policy maintenance, dan review lintas
  Security/Product/Privacy.

**Opsi C — Deny sensitive fields pending policy**

- **Pros:** kontrol interim paling aman dan membatasi exposure sebelum policy
  final.
- **Cons:** context dan business value berkurang; bukan policy final yang
  memadai untuk kebutuhan operational AI.

### 6.8 Recommended option

**Opsi B sebagai policy final**, dengan **Opsi C sebagai interim control**.
Default deny/redact berlaku untuk credential, raw prompt/output, unrestricted
context, personal, restricted, dan sensitive financial detail sampai rule
eksplisit tersedia.

### 6.9 Decision owner

**Security / Product Owner.** Related approvers: Legal/Privacy bila berlaku,
AI Owner, dan Finance Owner.

### 6.10 Approval required

Approval harus mencakup:

- field registry dan classification;
- allowed consumer, purpose, dan tool/data allowlist;
- raw prompt/output serta `context_data` policy;
- redaction/minimization per persona dan provider;
- retention, deletion, legal hold, dan export policy;
- access audit, incident handling, dan review cadence;
- interim default-deny behavior.

### 6.11 Blocking dependency

- S10-B tenant/security evidence;
- ADR-10B-013 branch/division semantics;
- auth user-role-company contract;
- tool/data allowlist;
- S10-F permission contract dan negative isolation proof;
- G-04 context gate dan G-05 PII/redaction review.

### 6.12 Final recommended decision

**Belum final / belum approved.** Security/Product Owner menerima **Opsi B
sebagai target policy**, dengan Opsi C wajib dipertahankan sebagai interim.
ADR tetap `REQUIRES PRODUCT OWNER`; AI context sensitif dan dashboard DTO final
belum boleh diekspos.

---

## 7. ADR-10B-013 — Branch/Division Scope for Consolidated Views

### 7.1 Current decision

**Status:** `REQUIRES PRODUCT OWNER`  
**Feature:** S10-F / S10-D  
**Keputusan saat ini:** definisi branch/division, ownership, allowed-company
set, cross-branch visibility, consolidated aggregation, admin exception, dan
missing/ambiguous scope behavior belum final.

`CompanyContext` dan consolidated UI mode tetap hanya display hint. Keduanya
tidak boleh menjadi authorization atau memperluas scope.

### 7.2 Business impact

Keputusan ini menentukan apakah Finance, Operations, Security, dan Admin dapat
melihat data lintas branch/company dalam consolidated governance view. Definisi
yang ambigu dapat mencampur KPI, AI context, approval metadata, atau operational
records dari unit yang tidak berwenang.

### 7.3 Technical impact

Server harus me-resolve allowed company/branch set sebelum detail query,
pagination, aggregation, serialization, dan cache reuse. Policy perlu
menetapkan ownership, branch hierarchy, consolidated sentinel, cache
invalidation ketika scope berubah, dan generic deny/not-found behavior.

Cross-company admin exception, bila diizinkan, harus menjadi explicit policy
path dan menghasilkan high-severity audit event.

### 7.4 Security impact

Opsi “consolidated = semua data” menciptakan critical tenant/branch overreach
dan tidak dapat diterima. Missing atau ambiguous scope harus deny atau
minimize, bukan diisi dengan unrestricted fallback. Browser `companyId`,
filter, record ID, dan consolidated selection tidak boleh override server scope.

### 7.5 Operational impact

Org Owner dan Product Owner perlu menyediakan authorization matrix yang dapat
dipakai Support, Finance, Operations, Security, dan Admin secara konsisten.
Perubahan assignment company/branch harus memiliki cache invalidation,
auditability, dan review process.

### 7.6 Available options

| Opsi | Deskripsi |
|---|---|
| A | Consolidated berarti seluruh data company |
| B | Consolidated hanya untuk explicit allowed-company dan branch set |
| C | Menonaktifkan consolidated mode pada fase awal |

### 7.7 Pros & cons tiap opsi

**Opsi A — All company data**

- **Pros:** UX paling sederhana dan visibility paling luas.
- **Cons:** critical overreach, branch isolation gagal, aggregate dapat mencampur
  data yang tidak berwenang; tidak direkomendasikan.

**Opsi B — Explicit allowed-company/branch set**

- **Pros:** server-authoritative, tenant-safe, mendukung consolidated use case
  yang memang diizinkan, dan dapat diaudit.
- **Cons:** memerlukan policy matrix, resolver yang jelas, negative tests, dan
  pemeliharaan assignment.

**Opsi C — No consolidated mode initially**

- **Pros:** paling aman sementara ketika semantics belum final.
- **Cons:** mengurangi business value untuk authorized consolidated users dan
  memerlukan fallback UX yang jelas.

### 7.8 Recommended option

**Opsi B sebagai final policy**, dengan **Opsi C sebagai interim fallback**.
Consolidated mode tidak pernah berarti unrestricted access. Server memvalidasi
allowed company/branch set sebelum query atau aggregate; cross-company admin
exception wajib diaudit.

### 7.9 Decision owner

**Product Owner / Org Owner.** Related approvers: Security Owner dan
Finance/Ops Owner.

### 7.10 Approval required

Approval harus menetapkan:

- definisi branch/division dan ownership;
- allowed-company/branch resolution;
- persona yang boleh consolidated;
- cross-branch/cross-company admin exception;
- detail dan aggregate visibility;
- purpose limitation;
- missing/ambiguous scope behavior;
- cache invalidation ketika assignment berubah;
- audit dan negative-isolation requirement.

### 7.11 Blocking dependency

- S10-B security/tenant evidence;
- auth user-role-company contract;
- classification dan purpose policy ADR-10B-012;
- branch/company authorization matrix;
- S10-F negative cross-company/cross-branch/consolidated proof;
- G-04 sebelum AI context atau consolidated governance reads.

### 7.12 Final recommended decision

**Belum final / belum approved.** Product Owner/Org Owner menerima **Opsi B
sebagai target policy**, dengan Opsi C sebagai fallback interim. ADR tetap
`REQUIRES PRODUCT OWNER`; consolidated reads dan branch-aware projection belum
boleh dibuka.

---

## 8. ADR-10B-014 — Monitoring Evidence Retention and Incident Export

### 8.1 Current decision

**Status:** `PENDING`  
**Feature:** S10-C — Centralized Monitoring & Incident Readiness  
**Keputusan saat ini:** retention period, review cadence, structured export
format, access control, deletion, legal hold, provider mapping, dan continuity
path belum final. Keputusan ini bergantung pada ADR-10B-010.

### 8.2 Business impact

Alert yang terkirim belum otomatis menjadi incident evidence yang audit-ready.
Tanpa retention dan export contract, organisasi tidak dapat membuktikan kapan
incident terjadi, siapa merespons, apa mitigasinya, kapan pulih, atau apakah
SLA terpenuhi.

Retention terlalu panjang meningkatkan exposure dan cost; terlalu pendek dapat
menghilangkan bukti release, incident review, atau regulatory need.

### 8.3 Technical impact

Diperlukan structured redacted incident evidence bundle minimal berisi timestamp,
correlation ID, component/environment, severity, owner, first/last seen,
acknowledgement, escalation, mitigation, recovery, runbook reference, dan
post-incident reference.

Provider default retention hanya menjadi transport detail, bukan policy source
of truth. Export harus portable, bounded, integrity-aware, dan tidak memuat
secret, token, raw prompt/output, raw business payload, atau unnecessary PII.

### 8.4 Security impact

Evidence dan export harus memiliki least-privilege access, redaction,
deletion, legal hold, dan audit policy. Incident bundle tidak boleh menjadi
salinan tenant data atau membuka diagnostic detail kepada public endpoint.
Provider/channel compromise harus memiliki containment dan continuity path.

### 8.5 Operational impact

Operations harus menentukan siapa yang dapat membuat, melihat, mengekspor,
menahan, dan menghapus evidence. Runbook harus menjelaskan acknowledgement,
escalation, recovery, post-incident review, retention expiry, dan provider
outage. Evidence harus dapat dikorelasikan dengan alert tanpa bergantung pada
ingatan manual.

### 8.6 Available options

| Opsi | Deskripsi |
|---|---|
| A | Mengikuti default retention/export dari provider |
| B | Structured redacted incident evidence bundle |
| C | Local-only manual incident notes |

### 8.7 Pros & cons tiap opsi

**Opsi A — Provider default**

- **Pros:** setup cepat dan operational overhead rendah.
- **Cons:** residency, redaction, access, legal hold, dan audit fields belum
  tentu sesuai; retention dapat berubah mengikuti provider.

**Opsi B — Structured redacted evidence bundle**

- **Pros:** portable, audit-friendly, scope dan redaction dapat dikontrol,
  serta correlation/ownership/recovery dapat distandardisasi.
- **Cons:** memerlukan policy, storage/access lifecycle, review cadence, dan
  mapping ke provider.

**Opsi C — Local-only manual notes**

- **Pros:** dependency eksternal minimum dan kontrol lokal lebih besar.
- **Cons:** tidak konsisten, sulit dikorelasikan dengan alert/recovery,
  rawan hilang, dan tidak cukup untuk centralized incident readiness.

### 8.8 Recommended option

**Opsi B.** Provider dipakai sebagai transport detail, sedangkan structured
redacted incident evidence bundle menjadi policy source of truth. Simpan
minimum evidence yang timestamped, correlated, owned, redacted, dan memiliki
access/deletion/legal-hold rules.

### 8.9 Decision owner

**DevOps / Operations.** Related approvers: Security Owner, Technical Lead,
dan Legal/Privacy bila berlaku.

### 8.10 Approval required

Approval harus menetapkan:

- retention period dan review cadence;
- required export fields dan redaction;
- timestamp, correlation ID, owner, severity, acknowledgement, mitigation,
  recovery, escalation, serta post-incident reference;
- access control, deletion, legal hold, dan evidence integrity;
- provider mapping, provider outage continuity, dan sign-off.

### 8.11 Blocking dependency

- ADR-10B-010 provider/channel;
- S10-A release/QA evidence;
- monitoring runbook, owner roster, dan SLA;
- Security/Privacy review;
- G-03 observability activation gate.

### 8.12 Final recommended decision

**Belum final / belum approved.** DevOps/Operations menerima **Opsi B sebagai
rekomendasi**, tetapi ADR tetap `PENDING` sampai ADR-10B-010 selesai dan
retention/export policy memperoleh sign-off. Monitoring evidence belum dapat
dinyatakan audit-ready.

---

## 9. ADR-10B-015 — Persona-Level Model/Token/Cost Visibility

### 9.1 Current decision

**Status:** `REQUIRES PRODUCT OWNER`  
**Feature:** S10-D — AI Execution Audit Trail & Governance Dashboard  
**Keputusan saat ini:** metadata model, token, cost, confidence, reasoning
summary, aggregate/detail-on-demand, dan missing/unknown behavior per persona
belum ditetapkan.

Raw provider credentials, raw prompt/output, raw execution payload, dan
unrestricted reasoning/context tetap dilarang.

### 9.2 Business impact

Finance membutuhkan cost oversight; Operations mungkin membutuhkan status dan
performance; Security membutuhkan audit metadata; Admin mungkin membutuhkan
authorized consolidated view. Jika semua metadata dibuka ke semua user, vendor,
cost, model/version, atau operational information dapat terekspos tanpa need.

Jika semuanya disembunyikan, governance dashboard kehilangan sebagian business
value.

### 9.3 Technical impact

Governance read contract perlu memiliki visibility matrix berbasis persona,
role, company, branch, purpose, field, aggregate/detail, authoritative source,
dan freshness. Query harus melakukan scope dan permission filtering sebelum
pagination atau aggregation.

Cost/token/confidence yang tidak authoritative harus ditampilkan sebagai
`unknown` atau `not available`, bukan zero. Detail-on-demand harus bounded,
redacted, auditable, dan tidak memuat raw payload.

### 9.4 Security impact

Model/version dapat merupakan vendor-sensitive information; token dan cost
dapat menjadi financial/operationally sensitive metadata. Visibility tidak
boleh ditentukan oleh UI role label atau browser filter saja. Server harus
menerapkan role/company/branch policy dan mencatat access event.

### 9.5 Operational impact

Product/Finance/AI/Data owners perlu menjaga visibility matrix, authoritative
cost source, review cadence, stale/unknown semantics, retention, export, dan
access audit. Dashboard harus mampu menunjukkan partial source atau data
staleness tanpa memberi kesan bahwa angka tersebut lengkap.

### 9.6 Available options

| Opsi | Deskripsi |
|---|---|
| A | Semua authorized dashboard users melihat seluruh metadata |
| B | Persona-scoped approved summaries |
| C | Menyembunyikan model/token/cost pada fase awal |

### 9.7 Pros & cons tiap opsi

**Opsi A — Semua metadata untuk semua user**

- **Pros:** UX dan implementasi lebih sederhana; visibility maksimal.
- **Cons:** overexposure, financial sensitivity, vendor/model leakage, dan
  violation terhadap data minimization.

**Opsi B — Persona-scoped approved summaries**

- **Pros:** keseimbangan terbaik antara cost oversight dan minimization;
  mendukung Finance/Ops/Security sesuai purpose serta dapat diaudit.
- **Cons:** memerlukan role matrix, source authority, detail policy, dan
  pemeliharaan ketika persona atau metric berubah.

**Opsi C — Hide metadata initially**

- **Pros:** aman sementara dan mengurangi exposure sebelum policy final.
- **Cons:** cost oversight tertunda; business value dashboard berkurang dan
  tidak menyelesaikan policy final.

### 9.8 Recommended option

**Opsi B sebagai policy final**, dengan **Opsi C sebagai interim fallback**.
Expose hanya authoritative, purpose-limited summaries yang diizinkan persona.
Credentials, raw execution payload, raw prompt/output, dan unrestricted
reasoning/context tetap selalu dilarang.

### 9.9 Decision owner

**Product Owner / Finance.** Related approvers: AI Owner, Security Owner, dan
Data Owner.

### 9.10 Approval required

Approval harus menetapkan:

- visibility matrix Finance, Operations, Security, Admin, dan role lain;
- field-level access untuk model, token, cost, confidence, reasoning, dan
  summaries;
- aggregate versus detail-on-demand;
- authoritative source dan unknown behavior;
- redaction, audit, retention, dan export;
- interim fallback sampai policy efektif.

### 9.11 Blocking dependency

- ADR-10B-011 metric/denominator policy;
- ADR-10B-012 classification/retention policy;
- ADR-10B-013 branch/company scope;
- S10-F permission-aware read contract;
- PII/redaction review dan G-05 dashboard gate.

### 9.12 Final recommended decision

**Belum final / belum approved.** Product Owner/Finance menerima **Opsi B
sebagai target policy**, dengan Opsi C sebagai fallback interim. ADR tetap
`REQUIRES PRODUCT OWNER`; final governance DTO dan persona metadata visibility
belum boleh diekspos.

---

## 10. Cross-ADR dependency and authorization gates

### 10.1 Dependency graph

```text
ADR-10B-010 → ADR-10B-014 → G-03 / S10-C activation
ADR-10B-012 + ADR-10B-013 → G-04 / S10-F context exposure
ADR-10B-011 + ADR-10B-015 + G-04 → G-05 / S10-D dashboard reads
S10-A / G-01 → G-02 security evidence → feature progression
```

### 10.2 Required gates

| Gate | Required evidence |
|---|---|
| G-00 Business decision | ADR-10B-010 sampai ADR-10B-015 memiliki resolution dan sign-off |
| G-01 S10-A release/QA | Dedicated staging, HTTP E2E, backup/restore, rollback, cleanup, monitoring evidence, sign-off |
| G-02 Security | Frozen finding register, current reproduction/decision, tenant proof, regression/DNB, rollback |
| G-03 Observability | Provider/channel, owners, thresholds, test alert, runbook, SLA, retention/export |
| G-04 Context | Permission, classification, allowlist, branch/company semantics, isolation proof, audit |
| G-05 Dashboard | Scoped read contract, metrics, persona visibility, PII/redaction, freshness/error, read-only acceptance |

### 10.3 Interim posture while decisions are open

Selama keenam ADR belum memperoleh sign-off:

- jangan expose sensitive AI context atau raw governance fields;
- gunakan default-deny/redact untuk unknown atau ambiguous classification/scope;
- jangan mengaktifkan monitoring sebagai production-ready hanya karena signal
  inventory tersedia;
- jangan menghitung missing metric sebagai zero/success;
- jangan menganggap consolidated mode unrestricted;
- jangan menganggap recommendation sebagai authorization;
- pertahankan production fail-closed dan S10-A sebagai epic release/QA
  terpisah.

## 11. Final decision status

### Decision closure result

Seluruh ADR telah memiliki analisis current decision, impact, options,
pros/cons, recommendation, owner, approval requirement, dan blocking
dependency. Namun, tidak ada bukti final owner sign-off dalam source of truth.

| ADR | Recommended option | Final status |
|---|---|---|
| ADR-10B-010 | Opsi C — one thin provider adapter + designated channel | `PENDING` |
| ADR-10B-011 | Opsi B — business-event denominators | `REQUIRES PRODUCT OWNER` |
| ADR-10B-012 | Opsi B — field-level classification; Opsi C interim | `REQUIRES PRODUCT OWNER` |
| ADR-10B-013 | Opsi B — explicit allowed-company/branch set; Opsi C interim | `REQUIRES PRODUCT OWNER` |
| ADR-10B-014 | Opsi B — structured redacted evidence bundle | `PENDING` |
| ADR-10B-015 | Opsi B — persona-scoped summaries; Opsi C interim | `REQUIRES PRODUCT OWNER` |

### Final recommended decision

Product Owner dan owner terkait **direkomendasikan menerima opsi yang tercantum
di atas sebagai basis workshop keputusan**, tetapi status keenam ADR **tidak
boleh diubah menjadi `APPROVED`** sampai:

1. opsi final, rationale, scope, consequence, retention/audit/rollback rule,
   tanggal, dan review cadence direkam;
2. decision owner dan approver memberikan sign-off;
3. dependency gate yang relevan memiliki evidence;
4. S10-A/G-01 release/QA prerequisite tetap ditutup secara terpisah;
5. tidak ada perubahan pada boundary Sprint 09 atau production authorization
   yang disimpulkan dari dokumen ini.

### Final verdict

> ❌ **Sprint 10 Authorization Still Blocked**
>
> Decision closure analysis selesai, tetapi ADR-10B-010 sampai ADR-10B-015
> masih `PENDING` atau `REQUIRES PRODUCT OWNER`, dan S10-A/G-01 release gate
> belum ditutup. Sprint 10 tetap **NOT IMPLEMENTED**.

## 12. Explicit stop boundary

Phase ini berhenti pada Product Owner Decision Closure. Jangan melanjutkan ke
coding, migration, endpoint, service, schema, workflow, runtime, test,
refactor, atau implementasi Sprint 10 berdasarkan dokumen ini saja.
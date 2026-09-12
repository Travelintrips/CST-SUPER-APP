# Sprint 10 — Decision Resolution

**Tanggal:** 2026-08-10  
**Status:** Resolution complete — **BUSINESS DECISIONS APPROVED**
**Sprint 10 implementation:** **NOT STARTED**  
**Final verdict:** ❌ **Sprint 10 Still Blocked**

**Source of truth:**

- `docs/sprints/SPRINT-10_PLANNING_DISCOVERY.md`
- `docs/sprints/SPRINT-10_SCOPE_LOCK.md`
- `docs/sprints/SPRINT-10_ARCHITECTURE_LOCK.md`
- `docs/sprints/SPRINT-10_BUSINESS_DECISIONS.md`
- `docs/sprints/SPRINT-10_IMPLEMENTATION_MASTER_PLAN.md`

> Dokumen ini hanya merencanakan resolusi keputusan. Tidak ada source code,
> endpoint, migration, schema, service, database, workflow, test, runtime,
> refactor, konfigurasi, atau implementasi Sprint 10 yang dibuat.

## 1. Executive Summary

Sprint 09 tetap **CLOSED**. Boundary berikut tidak boleh berubah:

```text
Marketplace AP preparation → waiting_payment
  → Payment lifecycle
  → Accounting evidence handoff
  → Bank Reconciliation reference link
```

Sprint 10 memiliki master plan sebagai baseline. Product Owner telah menyetujui
keenam business decisions pada 2026-08-10. Otorisasi implementasi tetap belum
terbit karena S10-A/G-01 dan technical gates G-02 sampai G-05 masih terpisah.

| Status | Count | Decision IDs |
|---|---:|---|
| APPROVED by Product Owner | 6 | ADR-10B-010 through ADR-10B-015 |
| Separate blocking release gate | 1 | S10-A / G-01 |

Approval yang dicatat adalah business decision. Status implementasi/activation
tetap blocked sampai evidence dan sign-off gate terkait tersedia.

### Product Owner approval record

- **Approver:** Product Owner
- **Tanggal:** 2026-08-10
- **ADR-10B-010:** Opsi C
- **ADR-10B-011:** Opsi B
- **ADR-10B-012:** Opsi B, interim Opsi C
- **ADR-10B-013:** Opsi B, interim Opsi C
- **ADR-10B-014:** Opsi B
- **ADR-10B-015:** Opsi B, interim Opsi C
- **Scope:** business decision untuk Sprint 10; tidak menutup release atau
  technical gates.

## 2. Resolution Rules

### Status

- **PENDING:** keputusan operasional belum dipilih atau belum lengkap.
- **REQUIRES PRODUCT OWNER:** business/security policy membutuhkan keputusan
  Product Owner atau owner organisasi.
- **BLOCKING:** implementation atau activation tidak boleh melewati gate.
- **APPROVED:** opsi, scope, owner, approver, dan sign-off sudah direkam.

### Resolution record minimum

Setiap closure harus menyimpan Decision ID, tanggal, owner/approver, opsi
terpilih, rationale, consequence, scope, retention/audit/rollback rule bila
relevan, dan gate yang dapat dibuka.

### Common constraints

Semua opsi harus additive, backward compatible, server-authoritative,
tenant-isolated, idempotent, audit-friendly, dan fail-closed untuk unknown atau
ambiguous scope. Tidak boleh ada perubahan authority Payment, Accounting,
Reconciliation, atau Marketplace dari Sprint 09, second orchestrator, event bus,
vector store, approval engine, atau payment/accounting boundary baru.

## 3. Approved Decision Register

| Decision ID | Feature | Status | Owner | Blocking effect |
|---|---|---|---|---|
| ADR-10B-010 | S10-C | APPROVED | DevOps | Opsi C disetujui; concrete provider/channel dan G-03 tetap wajib. |
| ADR-10B-011 | S10-D | APPROVED | Product Owner / Finance | Opsi B disetujui; metric evidence dan G-05 tetap wajib. |
| ADR-10B-012 | S10-F / S10-D | APPROVED | Security / Product Owner | Opsi B disetujui; Opsi C interim sampai implementasi B selesai. |
| ADR-10B-013 | S10-F / S10-D | APPROVED | Product Owner / Org Owner | Opsi B disetujui; Opsi C interim sampai implementasi B selesai. |
| ADR-10B-014 | S10-C | APPROVED | DevOps / Operations | Opsi B disetujui; evidence mapping dan G-03 tetap wajib. |
| ADR-10B-015 | S10-D | APPROVED | Product Owner / Finance | Opsi B disetujui; Opsi C interim sampai implementasi B selesai. |

## 4. Decision Resolutions

## 4.1 ADR-10B-010 — Monitoring Provider and Alert Channel

**Feature:** S10-C — Centralized Monitoring & Incident Readiness  
**Status:** `APPROVED` — Product Owner business approval recorded 2026-08-10
**Decision owner:** DevOps  
**Related approvers:** Operations Owner, Technical Lead, Security Owner  
**Blocking:** Yes — S10-C cannot be active

### Why open

Monitoring matrix sudah memiliki candidate signals dan thresholds, tetapi
provider, cost, retention constraint, on-call channel, owner roster, dan
escalation route belum dipilih. Architecture Lock sengaja tidak memilih
provider.

### Impact

Tanpa keputusan, alert tidak memiliki responder accountable; test alert,
acknowledgement, recovery, escalation, retention, dan data minimization tidak
memiliki contract yang dapat diaudit.

### Options and risks

| Option | Description | Risk |
|---|---|---|
| A | Manual/existing dashboards only | Tidak memenuhi centralized routing; response dan evidence tidak konsisten. |
| B | Multiple providers | Cost, duplicate alert, complexity, dan data-retention boundary meningkat. |
| C | One thin provider adapter plus designated channel | Single-provider dependency tetap ada, tetapi paling bounded dan auditable. |

### Recommendation

Pilih **Option C**. Gunakan satu provider/adapter tipis, satu designated
on-call channel, owner roster, routing, deduplication, cooldown, recovery, dan
escalation. Provider outage harus dibedakan sebagai `unknown`/`degraded`, bukan
dianggap application outage.

### Final action required

DevOps memilih provider/channel, menyatakan cost/access/data-retention
constraint, menunjuk P0–P3 owner, menyetujui threshold, routing, dedup,
cooldown, recovery, escalation, lalu merekam sign-off. G-03 hanya boleh dibuka
setelah test alert, runbook, SLA, dan retention/export policy tersedia.

## 4.2 ADR-10B-011 — Governance Metric Definitions and Denominators

**Feature:** S10-D — AI Execution Audit Trail & Governance Dashboard  
**Status:** `APPROVED` — Product Owner business approval recorded 2026-08-10
**Decision owner:** Product Owner / Finance  
**Related approvers:** AI Owner, Data Owner, Security Owner  
**Blocking:** Yes — dashboard aggregates cannot be trusted

### Why open

Canonical execution/approval records sudah ada, tetapi business policy belum
menetapkan unit execution, completion/failure, approval, pending, expired,
confidence, latency, token, cost, freshness, dan denominator.

### Impact

Metric dapat menyesatkan bila retry, cancelled, expired, missing cost, atau
partial source diperlakukan keliru. S10-D tidak dapat melewati acceptance tanpa
metric dictionary.

### Options and risks

| Option | Description | Risk |
|---|---|---|
| A | Simple row counts | Tidak membedakan attempt, retry, state, cancelled/expired; rawan metric palsu. |
| B | Business-event denominators | Lebih kompleks, tetapi bermakna dan dapat direview. |
| C | Defer aggregates | Aman sementara, tetapi business value dan governance visibility berkurang. |

### Recommendation

Pilih **Option B**. Tetapkan unit, numerator, denominator, inclusion/exclusion,
source, freshness, dan treatment `unknown`, `partial`, serta `not available`.
Option C hanya interim safe state. Missing value tidak boleh menjadi zero atau
success tanpa policy eksplisit.

### Final action required

Product Owner/Finance menyetujui execution unit; completion/failure dan
approval denominator; cancelled/expired/rejected semantics; pending/expired;
confidence/latency; token/cost formula; freshness, `asOf`, source completeness,
unknown/partial behavior; review cadence; dan owner. Setelah sign-off, bagian
metric pada G-05 dapat dibuka.

## 4.3 ADR-10B-012 — Field-Level AI Data Classification and Retention

**Feature:** S10-F / S10-D  
**Status:** `APPROVED` — Product Owner business approval recorded 2026-08-10
**Decision owner:** Security / Product Owner  
**Related approvers:** Legal/Privacy bila berlaku, AI Owner, Finance Owner  
**Blocking:** Yes — sensitive AI context/read exposure is prohibited

### Why open

Klasifikasi `operational`, `financial-summary`, `personal`, `credential`, dan
`restricted` sudah diidentifikasi, tetapi field-level consumer, purpose,
redaction, audit, provider export, retention, deletion, dan legal hold belum
ditetapkan.

### Impact

Tanpa policy, raw prompt/output, unrestricted `context_data`, PII, credential,
financial detail, atau restricted data dapat masuk AI, dashboard, log, audit,
atau monitoring provider.

### Options and risks

| Option | Description | Risk |
|---|---|---|
| A | Broad operational access | Critical leakage, over-collection, retention, dan cross-persona exposure. |
| B | Field-level classification and purpose limitation | Memerlukan catalog dan maintenance, tetapi paling sesuai untuk audit. |
| C | Deny sensitive fields pending policy | Paling aman sementara, tetapi context/business value berkurang. |

### Recommendation

Pilih **Option B** sebagai policy final dengan **Option C** sebagai interim
control. Classification berlaku sebelum AI/tool consumption, serialization,
audit payload, dan monitoring export.

### Final action required

Security/Product Owner menyetujui field registry, allowed consumer/purpose,
raw prompt/output dan `context_data` policy, redaction/minimization per persona
dan provider, retention/deletion/legal hold/export, access audit, review
cadence, dan default-deny interim behavior. G-04 dan S10-D redaction hanya
dibuka setelah policy efektif.

## 4.4 ADR-10B-013 — Branch/Division Scope for Consolidated Views

**Feature:** S10-F / S10-D  
**Status:** `APPROVED` — Product Owner business approval recorded 2026-08-10
**Decision owner:** Product Owner / Org Owner  
**Related approvers:** Security Owner, Finance/Ops Owner  
**Blocking:** Yes — consolidated governance scope is undefined

### Why open

`CompanyContext` dan consolidated UI state hanyalah display hint. Definisi
branch/division ownership, allowed-company set, cross-branch visibility,
aggregation, admin exception, dan missing/ambiguous scope behavior belum final.

### Impact

Consolidated mode dapat menjadi unrestricted access, aggregate dapat mencampur
branch yang tidak diizinkan, dan AI context dapat melewati branch actor.

### Options and risks

| Option | Description | Risk |
|---|---|---|
| A | Consolidated means all company data | Critical branch/tenant overreach; tidak direkomendasikan. |
| B | Explicit allowed-company and branch set | Memerlukan policy matrix, tetapi tenant-safe dan server-authoritative. |
| C | No consolidated mode initially | Paling aman sementara, tetapi mengurangi authorized business value. |

### Recommendation

Pilih **Option B** sebagai final policy dengan **Option C** sebagai interim
fallback. Server memvalidasi allowed company/branch sebelum detail, pagination,
cache reuse, atau aggregation. Cross-company admin exception wajib diaudit.

### Final action required

Product Owner/Org Owner menyetujui definisi branch/division, ownership,
allowed-company/branch resolution, persona consolidated, admin exception,
aggregate visibility, purpose limitation, missing/ambiguous behavior, dan cache
invalidation saat scope berubah. G-04 menunggu keputusan dan negative isolation
cases.

## 4.5 ADR-10B-014 — Monitoring Evidence Retention and Incident Export

**Feature:** S10-C — Centralized Monitoring & Incident Readiness  
**Status:** `APPROVED` — Product Owner business approval recorded 2026-08-10
**Decision owner:** DevOps / Operations  
**Related approvers:** Security Owner, Technical Lead, Legal/Privacy bila berlaku  
**Blocking:** Yes — monitoring evidence is not audit-ready

### Why open

Retention dan export bergantung pada provider/channel ADR-10B-010. Format
timestamp, correlation ID, severity, owner, acknowledgement, mitigation,
recovery, escalation, redaction, access control, deletion, dan legal hold belum
final.

### Impact

Alert mungkin terkirim tetapi tidak menjadi retained evidence; incident review
tidak reproducible dan payload dapat disimpan terlalu lama atau terlalu luas.

### Options and risks

| Option | Description | Risk |
|---|---|---|
| A | Provider default retention/export | Residency, redaction, dan audit fields belum tentu sesuai. |
| B | Structured redacted incident evidence bundle | Memerlukan policy, tetapi paling portable dan audit-friendly. |
| C | Local-only manual notes | Tidak konsisten dan sulit dikorelasikan dengan alert/recovery. |

### Recommendation

Pilih **Option B**. Simpan minimum evidence yang timestamped, correlated,
owned, redacted, dan tidak memuat secret, token, raw prompt/output, raw
business payload, atau unnecessary PII. Provider default hanya transport
detail, bukan policy source of truth.

### Final action required

Setelah ADR-10B-010, DevOps/Operations menetapkan retention/review cadence,
structured redacted export, required fields, access/deletion/legal-hold,
evidence integrity, provider mapping, continuity path, dan sign-off bersama
G-03.

## 4.6 ADR-10B-015 — Persona-Level Model/Token/Cost Visibility

**Feature:** S10-D — AI Execution Audit Trail & Governance Dashboard  
**Status:** `APPROVED` — Product Owner business approval recorded 2026-08-10
**Decision owner:** Product Owner / Finance  
**Related approvers:** AI Owner, Security Owner, Data Owner  
**Blocking:** Yes — final governance DTO visibility is undefined

### Why open

Execution data dapat berisi model, token, cost, confidence, reasoning metadata,
dan summaries. Persona-level visibility, aggregate/detail-on-demand, serta
missing/unknown behavior belum ditentukan.

### Impact

Cost/token dapat terbuka ke persona yang tidak memerlukannya, model/version
dapat menjadi sensitive vendor detail, atau Finance tidak memperoleh cost
oversight yang dibutuhkan.

### Options and risks

| Option | Description | Risk |
|---|---|---|
| A | Semua authorized dashboard users melihat semua metadata | Overexposure, financial sensitivity, dan vendor/model leakage. |
| B | Persona-scoped approved summaries | Memerlukan role matrix, tetapi paling seimbang antara utility dan minimization. |
| C | Hide model/token/cost initially | Aman sementara, tetapi menunda cost oversight. |

### Recommendation

Pilih **Option B** sebagai final policy dengan **Option C** sebagai interim
fallback. Expose hanya authoritative, purpose-limited summaries. Credentials,
raw execution payload, raw prompt/output, dan unrestricted reasoning/context
tetap dilarang.

### Final action required

Product Owner/Finance menyetujui visibility matrix Finance/Ops/Security/Admin/
other roles, field-level model/token/cost/confidence/reasoning/summaries,
aggregate versus detail-on-demand, authoritative source, unknown behavior,
redaction, audit, retention, export, dan interim fallback. G-05 menunggu
visibility matrix yang konsisten dengan metric, classification, dan PII review.

## 5. Blocking Gate Resolution

### S10-A / G-01 — Release and QA prerequisite

**Owner:** Release Lead / DevOps  
**Status:** Blocking, separate from feature scope  
**Required evidence:** secret rotation owner verification; dedicated staging
identity/database; full HTTP E2E, tenant/security/accounting/SSE/cleanup;
backup/restore; rollback rehearsal; monitoring evidence; owner/Technical Lead
sign-off.

**Action:** Tutup S10-A sebagai release/QA epic terpisah. Jangan gunakan shared
development/production DB dan jangan menghitung S10-A sebagai feature delivery.

### G-02 — Security evidence gate

**Owner:** Technical Lead / Security Owner  
**Depends on:** S10-A environment  
**Required evidence:** frozen finding register, current reproduction atau
explicit non-PASS disposition, tenant proof, regression/DNB, rollback, owner
sign-off.

**Action:** Revalidate old findings; jangan blind-fix berdasarkan label lama.

### G-03 — Observability activation gate

**Depends on:** ADR-10B-010, ADR-10B-014, G-02  
**Required evidence:** provider/channel, owner roster, thresholds, test alert
acknowledgement, P0–P3 runbook/SLA, retention/export/redaction, dedup,
cooldown, recovery, escalation evidence.

**Action:** Monitoring tidak boleh disebut active sebelum evidence retained dan
reviewable.

### G-04 — Permission-aware context gate

**Depends on:** ADR-10B-012, ADR-10B-013, G-02  
**Required evidence:** actor/resource/company/branch/purpose contract,
classification/retention, tool/data allowlist, redaction, cross-company/
cross-branch/consolidated/missing-scope/stale-cache proof, access audit.

**Action:** Sensitive atau ambiguous context tetap denied/minimized.

### G-05 — Governance dashboard gate

**Depends on:** ADR-10B-011, ADR-10B-012, ADR-10B-013, ADR-10B-015, G-04  
**Required evidence:** scoped read contract, metric dictionary/denominator,
persona visibility, PII/redaction review, bounded pagination/filter/sort/date,
freshness/partial/error/denied states, read-only mutation guard, access audit,
dashboard acceptance.

**Action:** Dashboard boleh berupa design/IA draft, tetapi tidak boleh expose
data dari unapproved scope contract.

## 6. Decision Dependency Matrix

| Decision/Gate | Depends on | Parallel work | Blocks |
|---|---|---|---|
| ADR-10B-010 | Provider, cost, channel, owner review | ADR-10B-011/012/013/015 workshops | ADR-10B-014, G-03, S10-C activation |
| ADR-10B-011 | Product/Finance metric workshop, canonical source review | ADR-10B-010/012/013 | G-05 and trusted aggregates |
| ADR-10B-012 | Security/Product/Privacy classification review | Other policy workshops | G-04, AI context, redacted DTO |
| ADR-10B-013 | Product/Org authorization matrix | Other policy workshops | G-04, consolidated reads |
| ADR-10B-014 | ADR-10B-010 and Operations runbook | Other policy workshops | G-03 and audit evidence |
| ADR-10B-015 | Product/Finance persona/cost policy | ADR-10B-011/012/013 | G-05 and final DTO |
| S10-A / G-01 | Release/QA, staging, backup/rollback | Documentation resolution | Feature authorization |
| G-02 | S10-A environment and security review | Policy workshops, S10-C inventory | S10-C/S10-F/S10-D progression |
| G-03 | ADR-10B-010/014 and G-02 | None during activation | S10-C active status |
| G-04 | ADR-10B-012/013 and G-02 | G-03 design | AI context and S10-D reads |
| G-05 | ADR-10B-011/012/013/015 and G-04 | S10-I documentation | Dashboard data exposure |

```text
ADR-10B-010 → ADR-10B-014 → G-03
ADR-10B-012 + ADR-10B-013 → G-04
ADR-10B-011 + ADR-10B-015 + G-04 → G-05
S10-A / G-01 → G-02 → feature progression
```

## 7. Resolution Checklist

### Governance

- [x] Owner and approver named for ADR-10B-010 through ADR-10B-015.
- [x] Option, rationale, scope, date, and approval record recorded per decision.
- [x] Product Owner business approval recorded on 2026-08-10.

### S10-C — post-approval execution conditions

- [ ] Provider/channel, owner roster, P0–P3 SLA approved.
- [ ] Threshold, dedup, cooldown, recovery, escalation approved.
- [ ] Retention, incident export, redaction, and access policy approved.
- [ ] Test alert delivered and acknowledged.

### S10-F — post-approval execution conditions

- [ ] AI classification, retention, deletion/legal hold approved.
- [ ] Branch/division ownership and consolidated semantics approved.
- [ ] Allowed-company/branch, missing-scope, allowlist, and redaction approved.
- [ ] Negative isolation evidence retained.

### S10-D — post-approval execution conditions

- [ ] Metric dictionary and denominators approved.
- [ ] Unknown/partial/freshness semantics approved.
- [ ] Persona model/token/cost visibility approved.
- [ ] Scoped read, PII/redaction, and read-only acceptance approved.

### Release and evidence

- [ ] S10-A/G-01 closed separately.
- [ ] G-02 security gate passed.
- [ ] G-03 observability gate passed.
- [ ] G-04 context gate passed.
- [ ] G-05 dashboard gate passed.
- [ ] Sprint 09 boundaries verified unchanged.
- [ ] Production GO separately approved.

## 8. Final Recommendation

1. Business approval keenam ADR telah direkam; jangan menganggapnya sebagai
   technical implementation authorization.
2. Selesaikan provider/channel konkret dan ADR-10B-014 mapping sebelum G-03.
3. Tutup S10-A lalu kumpulkan G-02 sebelum progression S10-C/S10-F/S10-D.
4. Pertahankan default-deny/redact dan interim Opsi C sampai Opsi B
   diimplementasikan serta diverifikasi.
5. Jangan melakukan coding, migration, endpoint, service, workflow, runtime,
   test, atau implementasi Sprint 10 dalam phase governance ini.

### Final verdict

> ❌ **Sprint 10 Still Blocked for Authorization**
>
> Keenam business decisions telah disetujui Product Owner, tetapi S10-A/G-01
> release gate dan G-02 sampai G-05 technical gates belum ditutup. Sprint 10
> tetap **NOT IMPLEMENTED**.
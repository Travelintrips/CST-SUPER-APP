# Sprint 10 — Scope Lock & Prioritization

**Tanggal scope lock:** 2026-08-10
**Status:** ✅ Sprint 10 Scope Locked — implementation belum dimulai
**Sumber utama:** `docs/sprints/SPRINT-10_PLANNING_DISCOVERY.md`
**Boundary reference:** `docs/sprints/SPRINT-09.md` dan
`docs/release/SPRINT-09_FINAL_CLOSURE_REPORT.md`

> Dokumen ini mengunci scope dan prioritas. Dokumen ini bukan implementasi,
> bukan migration, bukan refactor, dan tidak mengubah source code, endpoint,
> service, database, test, atau workflow.

## 1. Executive Summary

Sprint 09 tetap ditutup sebagai **implementation complete** dan **development
complete**, dengan repository verification gap serta production readiness yang
masih **NO-GO**. Sprint 10 tidak boleh menyerap backlog verification Sprint 09
sebagai fitur baru.

Scope Sprint 10 dikunci sebagai satu rangkaian bounded governance dan
operational-safety work:

1. Re-validasi security delta dan hardening hanya untuk finding yang masih
   reproducible.
2. Aktivasi observability dan incident readiness setelah owner, provider,
   threshold, dan runbook tersedia.
3. Penyelesaian permission-aware operational context menggunakan
   `contextOrchestrator` yang sudah ada, tanpa membuat orchestrator kedua.
4. AI Governance Dashboard sebagai bounded vertical slice dengan permission-
   aware read contract.

S10-A pada planning discovery—release verification dan production readiness—
tetap merupakan **release/QA prerequisite terpisah**, bukan feature scope
Sprint 10. Implementasi feature Sprint 10 hanya dapat dimulai setelah gate
keamanan dan environment yang relevan dinyatakan siap oleh owner.

## 2. Sprint Goal

> Membangun baseline operational safety dan AI governance yang dapat diaudit,
> permission-aware, serta tenant-safe tanpa memperluas boundary Marketplace →
> Payment → Accounting → Reconciliation dari Sprint 09.

Hasil yang diharapkan:

- finding security lama tidak lagi diperlakukan sebagai fakta tanpa
  reproduksi;
- incident penting dapat dideteksi dan diarahkan kepada owner;
- AI context dibatasi oleh role, company, branch, dan data classification;
- Finance/Ops/Security dapat melihat execution dan approval AI tanpa membuka
  raw prompt/output atau data lintas company;
- semua perubahan memiliki acceptance evidence dan rollback path yang jelas.

## 3. Scope Classification

### 3.1 IN SCOPE

| Candidate | Nama | Priority | Status scope |
|---|---|---:|---|
| S10-B | Security Delta Audit & Tenant Isolation Hardening | P0/P1 | In scope, conditional gate |
| S10-C | Centralized Monitoring & Incident Readiness | P1 | In scope |
| S10-F | Permission-Aware Operational Context | P1 | In scope |
| S10-D | AI Execution Audit Trail & Governance Dashboard | P1 | In scope, bounded vertical slice |

Keempat item ini merupakan satu scope terarah, bukan mandat untuk membangun
platform baru. Setiap item harus tetap dibatasi oleh dependency, data scope,
owner, dan acceptance criteria pada dokumen ini.

### 3.2 OUT OF SCOPE

| Candidate/backlog | Keputusan | Alasan |
|---|---|---|
| S10-A | Out of feature scope; release/QA epic terpisah | Release verification Sprint 09, staging, secret rotation, HTTP E2E, backup/restore, rollback, monitoring evidence, dan sign-off adalah prerequisite produksi, bukan business feature Sprint 10. |
| M7 — Advance pre-production validation | Out of scope | Modul dan prioritas Finance terpisah dari bounded Marketplace Sprint 09 dan scope governance Sprint 10. |
| L2 — PPJK audit metadata enhancement | Out of scope | Low priority dan non-blocking; tidak mendukung Sprint Goal utama. |

S10-A tetap wajib ditutup sebelum production GO dan sebelum feature work yang
berisiko dimulai. “Out of feature scope” tidak berarti blocker tersebut
diabaikan.

### 3.3 FUTURE BACKLOG

| Candidate/backlog | Priority awal | Keputusan |
|---|---:|---|
| S10-E — Configurable Approval Deadline & Escalation | P1 | Ditunda sampai business policy, financial authority, escalation owner, dry-run, dan rollback policy disetujui. |
| S10-G — BI Operational KPI Foundation | P1/P2 | Ditunda sampai metric dictionary, source ownership, refresh SLA, dan reconciliation evidence tersedia. |
| S10-H — Async OCR Job Queue | P2 | Ditunda sampai queue primitive, job state machine, idempotency, storage lifecycle, retry budget, dan cost policy disepakati. |

Item future backlog tidak boleh masuk melalui scope creep tanpa perubahan
scope lock dan persetujuan Product Owner serta Technical Lead.

### 3.4 TECHNICAL DEBT

| Backlog | Keputusan | Alasan |
|---|---|---|
| L3 — Cleanup technical debt | Technical debt backlog | Dead code, naming inconsistency, hardcoded fallback, dan upload-hook duplication bersifat incremental dan tidak menjadi fokus Sprint 10. |

Technical debt hanya boleh dikerjakan bila berada di jalur perubahan in-scope,
tidak mengubah behavior secara tidak terkait, dan tidak mengurangi evidence
untuk acceptance criteria utama.

### 3.5 DOCUMENTATION

| Candidate/backlog | Keputusan | Alasan |
|---|---|---|
| S10-I — API Contract & Partner Documentation | Documentation backlog | OpenAPI/contract baseline bernilai tinggi, tetapi tidak menjadi feature commitment utama Sprint 10. Dapat berjalan paralel sebagai documentation work bila route owner dan versioning policy tersedia. |
| L1 — Documentation synchronization | Documentation backlog | Sinkronisasi `docs/sprints/README.md`, indeks Sprint 10–12, tautan closure report, dan pemisahan dokumen stale adalah hygiene dokumentasi. |

Dokumentasi tidak boleh mengklaim implementasi atau production readiness yang
belum memiliki evidence.

## 4. In-Scope Candidate Detail

### S10-B — Security Delta Audit & Tenant Isolation Hardening

| Aspek | Keputusan scope |
|---|---|
| Business value | Menutup vulnerability yang masih terbukti dan meningkatkan keyakinan terhadap auth, RBAC, company scope, rate limit, SSRF, dan duplicate protection. |
| Dependency | Source re-validation, dedicated staging, threat model, regression matrix, DNB validation, dan rollback plan. |
| Affected module | API routes, auth middleware, company/branch scope, ecommerce, logistics, webhooks, dan database constraints. |
| Risk | High; perubahan middleware atau constraint dapat memblokir POS, portal, atau legacy flow. |
| Complexity | High. |
| Priority | P0/P1; discovery gate dan hardening setelah evidence tersedia. |
| Reason | `MASTER_FIX_PLAN.md` memuat finding lama yang sebagian mungkin stale; hanya finding yang reproducible yang boleh menjadi defect atau hardening scope. |

**Boundary:** Tidak ada blind rewrite dari `MASTER_FIX_PLAN.md`. Setiap finding
harus memiliki reproduction, severity, affected scope, fix, regression evidence,
dan DNB result.

### S10-C — Centralized Monitoring & Incident Readiness

| Aspek | Keputusan scope |
|---|---|
| Business value | Mendeteksi downtime, payment failure, queue backlog, SSE degradation, database pressure, dan error rate sebelum berdampak luas. |
| Dependency | Monitoring provider, alert channel, ownership roster, retention policy, environment target, threshold approval, dan runbook. |
| Affected module | API, workers, database, payment callback, notification, SSE, dan deployment. |
| Risk | Medium; false positive, alert fatigue, serta credential/config exposure. |
| Complexity | Medium. |
| Priority | P1. |
| Reason | Monitoring matrix sudah memiliki threshold, tetapi monitoring eksternal dan operational ownership belum aktif. |

**Boundary:** Scope mencakup signal, alert routing, test alert, owner, SLA,
runbook, dan evidence. Tidak mencakup pembangunan observability platform baru
atau perubahan business logic yang tidak diperlukan.

### S10-F — Permission-Aware Operational Context

| Aspek | Keputusan scope |
|---|---|
| Business value | Memastikan AI dan operational assistant hanya menerima order, vendor, finance, dan operational context yang sesuai role dan company scope. |
| Dependency | `contextOrchestrator`, auth user-role contract, company/branch scope rules, data classification, tool/data allowlist, dan negative cross-company tests. |
| Affected module | `contextOrchestrator`, AI agent, auth/scope middleware, BizPortal assistant, dan audit trail. |
| Risk | High; data leakage atau context omission dapat menghasilkan keputusan yang salah. |
| Complexity | Medium–High. |
| Priority | P1; fondasi sebelum dashboard dan approval automation. |
| Reason | Repository sudah memiliki context orchestration; pekerjaan yang tepat adalah contract completion dan verification, bukan service duplikat. |

**Boundary:** Tidak membuat Unified Operational Context Builder kedua. Context
yang dikirim harus memiliki scope, classification, allowlist, dan auditability
yang dapat diverifikasi.

### S10-D — AI Execution Audit Trail & Governance Dashboard

| Aspek | Keputusan scope |
|---|---|
| Business value | Memberi Finance, Ops, dan Security visibilitas atas AI action, confidence, approval, reasoning metadata, error, dan cost. |
| Dependency | S10-F permission-aware read contract, role matrix, company scope, PII redaction, retention policy, pagination/filter contract, dan audit access log. |
| Affected module | BizPortal governance UI, API AI governance, `ai_agent_executions`, `ai_approval_queue`, audit/access control. |
| Risk | High; raw prompt/output dapat mengandung PII atau data lintas company. |
| Complexity | Medium–High. |
| Priority | P1; bounded first implementation slice. |
| Reason | Existing execution dan approval data memberi business value yang terlihat tanpa membuat payment/accounting boundary baru, sekaligus memaksa tenant-scope dan PII rules menjadi eksplisit. |

**Boundary:** Dashboard read-only terhadap execution/approval evidence pada fase
awal. Tidak mengubah approval authority, tidak mengeksekusi payment, tidak
menampilkan raw prompt/output secara default, dan tidak membuat AI platform baru.

## 5. Dependency Matrix

| Workstream | Depends on | Can run in parallel with | Must not start before |
|---|---|---|---|
| S10-A release/QA prerequisite | Staging owner, secret owner, DevOps, release lead | Documentation cleanup, source re-audit | Dedicated target identity dan cleanup safety terdefinisi |
| S10-B security hardening | Source re-validation, threat model, staging E2E | S10-C setup dan S10-I inventory | Finding direproduksi dan DNB list dibekukan |
| S10-C observability | Provider, alert channel, owners, runbooks | S10-B analysis, S10-I inventory | Threshold dan escalation ownership disetujui |
| S10-F context governance | Existing orchestrator, auth scope, data classification | S10-C, sebagian S10-D design | Tool/data allowlist per role tersedia |
| S10-D governance dashboard | S10-F read contract, AI schema, PII policy | S10-C, S10-I documentation | Permission-aware query contract dan audit access policy tersedia |

### Critical dependency chain

```text
S10-A release safety / staging prerequisite
  → S10-B security evidence and tenant proof
  → S10-C monitoring and incident readiness
  → S10-F permission-aware operational context
  → S10-D AI governance dashboard
```

S10-I dapat berjalan paralel sebagai documentation backlog. S10-E, S10-G, dan
S10-H tidak berada pada critical path Sprint 10 yang dikunci.

## 6. Risk Matrix

| Kategori | Risk | Probability | Impact | Mitigation | Owner |
|---|---|---:|---:|---|---|
| Technical | Scope berkembang menjadi platform rewrite atau membuat orchestrator/queue baru tanpa batas. | High | High | Gunakan bounded vertical slice, pertahankan service dan runtime yang sudah ada, serta lakukan scope review sebelum perubahan baru. | Product Owner / Technical Lead |
| Technical | Security finding lama ternyata stale atau fix merusak legacy flow. | High | High | Reproduce terhadap source/staging saat ini, regression matrix per finding, DNB validation, dan rollback plan. | Technical Lead |
| Technical | Dashboard/query governance membebani database atau menghasilkan data tidak konsisten. | Medium | High | Pagination, filter contract, read-only query review, index/query plan, dan metric definition yang disetujui. | Backend / Data Owner |
| Business | Approval atau AI governance menimbulkan ekspektasi bahwa Sprint 10 sudah memberi financial automation. | Medium | High | Nyatakan dashboard read-only dan tidak mengubah payment/accounting authority; approval escalation tetap future backlog. | Product Owner |
| Business | Prioritas owner tidak tersedia sehingga workstream conditional berhenti. | Medium | High | Kunci owner, acceptance authority, SLA, dan dependency exit sebelum implementation start. | Product Owner |
| Security | AI context atau dashboard membuka PII atau data lintas company/branch. | Medium | Critical | Permission-aware contract, server-side scope, redaction, data minimization, access audit, dan negative isolation tests. | Security Owner |
| Security | Shared dev/prod database dipakai untuk staging proof. | Medium | Critical | Verifikasi database identity dan schema secara read-only sebelum fixture/write; fail closed bila identitas tidak pasti. | DevOps |
| Operational | Monitoring menghasilkan alert fatigue atau tidak memiliki responder. | Medium | Medium | Threshold calibration, test alert, on-call roster, escalation SLA, runbook, dan review cadence. | Operations Owner |
| Operational | Release readiness disalahartikan sebagai feature completion. | High | High | Lacak S10-A sebagai release/QA epic terpisah dan pertahankan production gate fail-closed. | Release Lead |

## 7. Implementation Order

Urutan berikut adalah urutan scope yang telah dikunci, bukan bukti bahwa
implementasi telah dilakukan.

### Stage 0 — Release and safety prerequisite

1. Tutup S10-A secara terpisah: secret rotation owner verification, dedicated
   staging, full HTTP E2E, backup/restore, rollback rehearsal, monitoring
   evidence, cleanup, dan sign-off.
2. Pastikan staging tidak memakai database shared dev atau production.
3. Pertahankan production **NO-GO** sampai evidence release lengkap.

### Stage 1 — Security delta gate

1. Inventaris dan klasifikasikan finding terhadap source terkini.
2. Reproduce hanya critical/high candidate yang masih relevan.
3. Implementasikan hardening yang disetujui dengan regression test dan DNB
   evidence.
4. Bekukan hasil security delta sebelum melanjutkan ke governance UI.

### Stage 2 — Operational baseline

1. Setujui provider, environment, threshold, retention, alert channel, owner,
   dan escalation SLA.
2. Aktifkan dashboard/alerts untuk API, database, workers, payment callback,
   notification, SSE, CPU, memory, dan error rate sesuai matrix.
3. Jalankan test alert dan simpan evidence bersama runbook.

### Stage 3 — Governance foundation

1. Lengkapi permission-aware context contract pada orchestrator yang ada.
2. Verifikasi role/company/branch scope, data classification, tool allowlist,
   redaction, audit trail, dan negative cross-company behavior.
3. Bangun AI Governance Dashboard sebagai read-only bounded slice di atas
   contract tersebut.

### Stage 4 — Deferred review

Review S10-E, S10-G, S10-H, dan S10-I hanya setelah dependency dan owner
masing-masing tersedia. Review ini tidak otomatis memasukkan item tersebut ke
scope implementation.

## 8. Acceptance Criteria

### Scope-level acceptance

- [ ] Hanya S10-B, S10-C, S10-F, dan S10-D yang diperlakukan sebagai feature
  scope Sprint 10.
- [ ] S10-A memiliki tracking release/QA terpisah dan tidak dihitung sebagai
  feature delivery.
- [ ] S10-E, S10-G, dan S10-H tetap deferred.
- [ ] S10-I dan L1 tetap documentation backlog.
- [ ] L3 tetap technical debt dan tidak menjadi scope utama.
- [ ] Tidak ada overlap dengan business boundary Sprint 09.

### S10-B acceptance

- [ ] Setiap finding yang dikerjakan memiliki evidence reproduksi terhadap
  source/environment terkini.
- [ ] Tenant isolation, auth/RBAC, company scope, dan critical security
  behavior memiliki regression evidence.
- [ ] Tidak ada finding stale yang dimasukkan hanya berdasarkan label lama.
- [ ] DNB, rollback, dan owner sign-off tercatat.

### S10-C acceptance

- [ ] Threshold dan signal untuk komponen prioritas disetujui.
- [ ] Alert routing, responder, escalation SLA, dan retention policy aktif.
- [ ] Test alert berhasil dan memiliki timestamped evidence.
- [ ] Runbook incident tersedia dan dapat digunakan oleh on-call owner.

### S10-F acceptance

- [ ] Context contract menetapkan role, company, branch, dan data classification.
- [ ] Tool/data allowlist diterapkan server-side.
- [ ] Negative cross-company dan cross-branch tests membuktikan isolation.
- [ ] Context access dan decision-relevant metadata dapat diaudit.
- [ ] Tidak ada orchestrator kedua yang dibuat.

### S10-D acceptance

- [ ] Dashboard hanya membaca data governance yang diizinkan oleh role/scope.
- [ ] Pagination, filtering, error contract, dan access logging tersedia.
- [ ] PII/raw prompt/output diminimalkan atau direduksi sesuai policy.
- [ ] Dashboard menampilkan execution, approval, status/error, confidence atau
  metadata yang disetujui, dan cost bila tersedia secara authoritative.
- [ ] Dashboard tidak mengubah payment, accounting, approval authority, atau
  journal state.

## 9. Exit Criteria

Sprint 10 scope dinyatakan selesai untuk review apabila:

1. Semua in-scope workstream memiliki acceptance evidence yang dapat direview.
2. Security delta memiliki finding register final, regression result, DNB, dan
   rollback evidence.
3. Observability memiliki alert test, ownership, runbook, dan operational
   handoff.
4. Permission-aware context memiliki isolation proof dan audit evidence.
5. AI Governance Dashboard melewati permission, PII, pagination, dan read-only
   contract review.
6. Tidak ada perubahan pada boundary Marketplace → Payment → Accounting →
   Reconciliation tanpa scope baru yang disetujui.
7. Deferred, documentation, dan technical debt items tetap terpisah dari
   feature acceptance.
8. Production GO tetap mengikuti release evidence matrix; scope completion
   Sprint 10 tidak otomatis berarti production authorization.

## 10. Definition of Done

Sebuah in-scope item hanya dianggap Done apabila:

- implementation dan configuration yang diperlukan sudah direview;
- unit/integration/contract/regression evidence yang relevan tersedia;
- tenant isolation dan authorization behavior diverifikasi;
- PII, secret, retention, dan access logging policy diverifikasi;
- observability signal, alert, owner, dan runbook tersedia bila relevan;
- migration atau perubahan data, bila kelak diperlukan, memiliki plan,
  idempotency, backup/rollback, dan environment evidence;
- acceptance owner memberikan sign-off;
- dokumentasi scope dan evidence diperbarui;
- tidak ada klaim PASS yang hanya didasarkan pada keberadaan script tanpa
  retained, timestamped execution result.

## 11. Overlap Check dengan Sprint 09

Tidak ada overlap feature yang diizinkan dengan Sprint 09.

| Sprint 09 boundary | Perlakuan di Sprint 10 |
|---|---|
| Marketplace AP preparation sampai `waiting_payment` | Tidak diubah. |
| Payment lifecycle, retry, failure, cancellation, idempotency | Tidak diubah oleh scope governance. |
| Accounting handoff evidence-only | Tidak membuat journal atau posting baru. |
| Reconciliation reference link | Tidak mengubah bank mutation, settlement matching, atau accounting rows. |
| Runtime proof dan dedicated HTTP E2E yang belum lengkap | Tetap release/QA verification backlog, bukan feature Sprint 10. |
| Stale sprint index | Documentation hygiene backlog, bukan business implementation. |

Jika security audit menemukan defect yang secara langsung menyentuh route Sprint
09, defect tersebut harus dicatat dengan evidence dan boundary impact. Ia tidak
boleh menjadi alasan untuk mengubah kontrak payment/accounting/reconciliation
secara diam-diam.

## 12. Recommendation

1. Terima scope Sprint 10 sebagai **S10-B → S10-C → S10-F → S10-D** dengan
   dependency gate yang eksplisit.
2. Tutup S10-A lebih dahulu sebagai release/QA epic terpisah; jangan
   menggabungkan evidence production dengan feature acceptance.
3. Gunakan **AI Governance Dashboard + permission-aware read contract** sebagai
   first bounded implementation slice setelah prerequisite release dan
   security tersedia.
4. Jangan mengimplementasikan S10-E, S10-G, atau S10-H dalam scope ini.
5. Jalankan S10-I dan L1 hanya sebagai documentation work yang terpisah.
6. Pertahankan production fail-closed dan jangan menyatakan GO berdasarkan
   scope lock ini.

### Final verdict

> ✅ **Sprint 10 Scope Locked**
>
> ✅ In scope: S10-B, S10-C, S10-F, S10-D
> ⏸️ Deferred: S10-E, S10-G, S10-H
> 📚 Documentation: S10-I, L1
> 🧰 Technical debt: L3
> 🚧 Separate release/QA prerequisite: S10-A
> ❌ Sprint 10 implementation: **NOT IMPLEMENTED**

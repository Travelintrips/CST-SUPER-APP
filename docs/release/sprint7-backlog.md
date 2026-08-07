# Sprint 7 Release Disposition Backlog

**Decision date:** 2026-08-07  
**Scope:** Sprint 7 Marketplace vendor-invoice / 3-way-match release decision  

Temuan di bawah ini tidak mengubah business logic Sprint 7. Item yang tidak
mempengaruhi jalur invoice Marketplace tetap menjadi backlog lintas proyek.

## BL-S7-01 — Remaining dependency vulnerabilities

**Disposition:** Backlog lintas proyek — tidak memblokir Sprint 7.

The one vulnerable dependency on the Sprint 7 upload path, `multer`, was
upgraded from `2.1.1` to `2.2.0`, the available non-major security fix. The
remaining 15 High findings are in unrelated spreadsheet, mail, proxy, image,
tooling, or transitive dependency paths and are not exercised by the Sprint 7
vendor-invoice / 3-way-match flow.

**Follow-up:** Upgrade or replace the remaining affected packages in the
cross-project dependency-hardening backlog, then rerun the full security scan.

## BL-S7-02 — Critical SAST finding outside Sprint 7

**Disposition:** Backlog lintas proyek — tidak memblokir Sprint 7 functional
completion.

The Critical finding is reported in
`scripts/migrate-intercompany-advances.mjs`, an offline migration utility that
is not invoked by the Sprint 7 Marketplace invoice routes, service, migration,
or regression harness. It remains a genuine security issue for the broader
project and must not be treated as cleared for a general production security
GO.

**Follow-up:** Refactor the migration utility to use parameterized SQL and
rerun SAST before the next cross-project production security decision.

## BL-S7-03 — Legacy vendor quote regression harness

**Disposition:** Backlog lintas proyek — tidak memblokir Sprint 7.

The legacy `.mjs` harness fails before executing its assertions because it
imports the obsolete path `artifacts/lib/db/dist/index.js`; the current
workspace emits declaration-only output under `lib/db/dist`. The current
Marketplace runtime regression passes 62/62 and the relevant Vitest suite
passes 142/142, so this is a harness/layout defect rather than a Sprint 7
business regression.

**Follow-up:** Migrate the legacy quote harness to the current Vitest/runtime
setup. Do not change Sprint 7 application logic or add a compatibility shim
solely for the obsolete import.
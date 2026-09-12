---
name: Accounting gap fixes — Fase 3
description: Unified audit trail + NPWP/faktur validators implemented in Fase 3 of accounting gap plan.
---

## Files created
- `artifacts/api-server/src/lib/unifiedAudit.ts` — ergonomic wrapper over `writeAuditLog`. Exports `audit(req, opts)`, `auditSystem(opts)`, `auditStatusChange(req, opts)`.
- `artifacts/api-server/src/lib/npwpValidator.ts` — NPWP format + mod-11 checksum. Exports `validateNpwp()`, `validateNpwpLoose()`, `formatNpwp()`, `stripNpwp()`.
- `artifacts/api-server/src/lib/fakturPajakValidator.ts` — e-Faktur format KKK.SSS-TT.SSSSSSSS. Exports `validateFakturPajak()`, `formatFaktur()`.

## Routes updated
- `routes/tax.ts` — audit on POST/PUT/DELETE `/rules`; NPWP+faktur validation+normalization on `PATCH /transactions/:id/npwp`; new `POST /validate/npwp` and `POST /validate/faktur` endpoints.
- `routes/vendorPayments.ts` — audit on POST (payment create) and DELETE.
- `routes/accounting.ts` — audit on POST `/entries` (manual journal entries).

## Bug fixed
- `routes/oceanFreightVendorForm.ts` line 276 — duplicate `} catch (outerErr) {` with no matching `try`; removed the inner duplicate catch block.

**Why audit is non-fatal:** `writeAuditLog` is fire-and-forget; audit failures must never block the business operation that triggered them.

**NPWP algorithm:** mod-11 using weights [8,7,6,5,4,3,2,9] on digits 1-8; remainder = check digit (10+ → 0). Loose validation available via `validateNpwpLoose()` for historical data with possible wrong checksum.

**Faktur format:** 16 digits total — `KKK.SSS-TT.SSSSSSSS`. Valid kode transaksi: 010-013, 020-021, 030-031, 040, 050, 060, 070. Serial 00000000 is invalid. Year must be 10-99.

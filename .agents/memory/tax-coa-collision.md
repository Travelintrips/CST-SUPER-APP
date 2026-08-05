---
name: Tax COA collision fix
description: 2-1060 occupied by intercompany account; safe header 2-1090 chosen; 128 dev CRs created PENDING_APPROVAL
---

## Rule
Never use code `2-1060` for tax accounts — it is permanently occupied by "Hutang Intercompany - PT Diva Servis" (`is_postable=true`, `company_id=1`).

## Safe codes (collision-free)
| Header | Code | Children |
|--------|------|---------|
| KEWAJIBAN PAJAK | `2-1090` | `2-1091`–`2-1102` |
| ASET PAJAK | `1-1070` | `1-1071`–`1-1076` |
| BEBAN PAJAK | `5-3040` | `5-3041`–`5-3048` |

## Dev migration state (2026-08-02)
- 128 change requests in Supabase DEV, all `PENDING_APPROVAL`
- CRs #1–#32: CST (created in a prior session)
- CRs #33–#64: WS, #65–#96: DV, #97–#128: ER
- Maker: `system:coa-tax-migration-v1`
- Idempotency key prefix: `coa-tax-v1`

## How to run migration without starting the server
Use the vitest runner with `--testTimeout=120000` — the test env already has `SUPABASE_DATABASE_URL_DEV` injected and imports the migration function directly:
```
cd artifacts/api-server
node_modules/.bin/vitest run --testTimeout=120000 src/__tests__/<your-script>.test.ts
```

**Why:** The migration queries many accounts + change_requests per company across 4 companies — each call takes ~25–30 seconds. Default 30s vitest timeout is too short; use 120s.

## Intercompany account — must not be touched
- `2-1060-CST` code, name, parent, is_header, is_postable must remain unchanged
- References in `bankMutationImport.ts` (lines ~436–454) are correct — do not edit
- Regression test: `coa-tax-hierarchy.test.ts` Section 9b verifies this

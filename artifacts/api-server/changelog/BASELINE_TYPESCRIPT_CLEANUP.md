# Baseline TypeScript Cleanup — Non-Treasury Errors

## 1. Root Cause

### Category A — api-zod (3× TS6305)
`lib/api-zod` has a composite tsconfig (`composite: true`, `outDir: dist`) but its `dist/`
directory had never been built. The api-server's tsconfig references it as a project
reference, so TypeScript demanded the built output before it would type-check callers.

**Fix:** Built `lib/api-zod` via `pnpm exec tsc -p tsconfig.json` inside `lib/api-zod/`.
The generated `dist/` is now present and is produced by the official build pipeline.

### Category B — reconciliation (8× TS1340)
Eight reconciliation service files used a lazy-load pattern:
```ts
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as import("@workspace/db")["db"];   // ← TS1340
}
```
`import("@workspace/db")["db"]` in a type-assertion position is invalid when the referenced
symbol is a value export (not a TypeScript type). TypeScript 5.x requires `typeof` to
obtain the type of a value export.

**Fix:** Added `import type { db as DrizzleDb } from "@workspace/db"` at the top of each
file and changed the cast to `return _db as typeof DrizzleDb`.

### Category C — splitPaymentEngine (1× TS7006)
`db.transaction(async (tx) => { ... })` — because `getDb()` previously returned `any`
(due to the TS1340 cast failure), TypeScript could not infer the type of `tx`.

**Fix:** Resolved automatically once the TS1340 fix gave `getDb()` a proper return type.

### Category D — devTestRoutes (1× TS2440)
`SmokeResult` was imported from `integrationHealthService.ts` AND declared locally as an
`interface` on line 76. TypeScript does not allow two declarations with the same name in
the same scope.

**Fix:** Removed the redundant local `interface SmokeResult` block. The imported type from
`integrationHealthService.ts` is the authoritative definition.

---

## 2. Files Modified

| File | Change |
|------|--------|
| `src/lib/reconciliation/confidenceCalibrationService.ts` | Add `import type { db as DrizzleDb }`, fix cast |
| `src/lib/reconciliation/expectedCashFlowService.ts` | Add `import type { db as DrizzleDb }`, fix cast |
| `src/lib/reconciliation/partialPaymentEngine.ts` | Add `import type { db as DrizzleDb }`, fix cast |
| `src/lib/reconciliation/paymentAllocationEngine.ts` | Add `import type { db as DrizzleDb }`, fix cast |
| `src/lib/reconciliation/paymentRelationshipGraph.ts` | Add `import type { db as DrizzleDb }`, fix cast |
| `src/lib/reconciliation/reconDecisionStack.ts` | Add `import type { db as DrizzleDb }`, fix cast |
| `src/lib/reconciliation/reconMetricsService.ts` | Add `import type { db as DrizzleDb }`, fix cast |
| `src/lib/reconciliation/splitPaymentEngine.ts` | Add `import type { db as DrizzleDb }`, fix cast (TS1340 + TS7006) |
| `src/routes/devTestRoutes.ts` | Remove duplicate local `interface SmokeResult` |
| `src/routes/translations.ts` | Fix `path-to-regexp` v8 wildcard: `*` → `*key`, normalize array param |
| `lib/api-zod/dist/` *(generated)* | Built via `tsc -p tsconfig.json` inside `lib/api-zod` |

## 3. Files Deleted

None.

## 4. TypeScript Errors Before

```
13 errors in 12 files

src/lib/reconciliation/confidenceCalibrationService.ts:27   TS1340
src/lib/reconciliation/expectedCashFlowService.ts:21        TS1340
src/lib/reconciliation/partialPaymentEngine.ts:24           TS1340
src/lib/reconciliation/paymentAllocationEngine.ts:33        TS1340
src/lib/reconciliation/paymentRelationshipGraph.ts:27       TS1340
src/lib/reconciliation/reconDecisionStack.ts:35             TS1340
src/lib/reconciliation/reconMetricsService.ts:26            TS1340
src/lib/reconciliation/splitPaymentEngine.ts:29             TS1340
src/lib/reconciliation/splitPaymentEngine.ts:202            TS7006
src/routes/auth.ts:11                                       TS6305
src/routes/devTestRoutes.ts:25                              TS2440
src/routes/logisticOrders.ts:92                             TS6305
src/routes/storage.ts:7                                     TS6305
```

## 5. TypeScript Errors After

```
0 errors
```

## 6. Build

```
pnpm run build → exit 0
dist/index.mjs  16329.6 kb
Duration: 1.62s
```

## 7. Regression

```
Test Files:  1 failed (pre-existing) | 35 passed  (36 total)
     Tests:  1 failed (pre-existing) | 1327 passed (1328 total)
Duration: 34.37s
```

The 1 failing test (`e2e-safety-guard.test.ts` — payment status `"unconfigured"` vs
`"mocked"`) was already failing before these changes. Confirmed by running the test against
the stashed state. Root cause: `PAYLABS_PRIVATE_KEY` is not set in this environment.

## 8. Treasury Verification

```
git diff 34211fc3 -- src/routes/treasury.ts                      → no differences
git diff 34211fc3 -- src/lib/treasury/resolveCompanyStrict.ts    → no differences
git diff 34211fc3 -- src/__tests__/treasury-security.test.ts     → no differences
```

All locked Treasury files are unchanged.

## 9. Remaining Risks

- `e2e-safety-guard.test.ts` pre-existing failure: requires `PAYLABS_PRIVATE_KEY` secret
  to be configured to pass. Unrelated to TypeScript cleanup.
- `lib/api-zod/dist/` is a generated artifact. It must be rebuilt whenever
  `lib/api-zod/src/` changes (the official pipeline already does this via `pnpm run build`).

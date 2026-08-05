# Bank Allocation Phase 2 — Security Patch Notes

**Patch date:** 2026-07-06  
**Based on:** Runtime verification report + independent architect code review  
**Files modified:**
- `artifacts/api-server/src/lib/bankAllocationMigration.ts`
- `artifacts/api-server/src/lib/reconciliation/bankAllocationScoring.ts`
- `artifacts/api-server/src/routes/bankAllocationMatching.ts`

---

## P0 — Race Condition: Concurrent Duplicate Confirm

### Problem
The confirm handler read `bank_allocation_matches.status` **before** starting a transaction,
then opened the transaction to insert `allocation_headers` and update the status.
Two concurrent requests could both read `status='CANDIDATE'`, both pass the check,
and both commit — creating two `allocation_headers` rows for the same bank mutation.

No DB-level constraint prevented this. The existing unique index
`idx_bam_mutation_candidate_unique (bank_mutation_id, candidate_type, candidate_id)`
prevented duplicate *scoring* rows but not duplicate *confirmed* rows.

### Fix

**bankAllocationMigration.ts** — new partial unique index:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_bam_one_confirmed_per_mutation
ON bank_allocation_matches (bank_mutation_id)
WHERE status = 'CONFIRMED';
```
This is the DB-level backstop: only one `CONFIRMED` row may exist per `bank_mutation_id`.
Any concurrent transaction that attempts to create a second CONFIRMED row for the same
mutation will receive a unique constraint violation and be rolled back.

**bankAllocationMatching.ts** — all three state-transition handlers (confirm, split, merge)
now acquire a `SELECT ... FOR UPDATE` row lock *inside* `db.transaction()`:

```typescript
const headerId = await db.transaction(async (tx) => {
  // Row lock acquired here — concurrent confirms serialise at this point.
  const rows = await tx.execute<any>(sql`
    SELECT * FROM bank_allocation_matches WHERE id = ${matchId} FOR UPDATE
  `).then(r => r.rows);

  // Status check is now inside the transaction with the lock held.
  if (!["MATCHED", "CANDIDATE"].includes(m.status)) {
    throw Object.assign(new Error("Match sudah diproses sebelumnya"), { httpStatus: 400 });
  }
  // ... insert allocation_headers, update match status ...
});
```

With `FOR UPDATE`, the second concurrent request blocks at the lock until the first
transaction commits. It then observes `status='CONFIRMED'` and returns the idempotency
error — with **zero chance** of creating a duplicate allocation regardless of timing.

**Applies to:** `POST /match/:matchId/confirm`, `/split`, `/merge`

---

## P0b — SQL Injection in Merge Handler

### Problem
```typescript
// BEFORE (vulnerable):
const allMutIds = [primary.bank_mutation_id, ...other_mutation_ids];
await db.execute(sql`
  SELECT ... FROM bank_mutations
  WHERE id = ANY(${sql.raw(`ARRAY[${allMutIds.join(",")}]`)})
`);
```
`other_mutation_ids` came directly from `req.body` and was passed to `sql.raw()` without
sanitisation. A payload like `["1; DROP TABLE bank_mutations; --"]` would cause
`parseInt` to extract `1` silently, but the raw string embedding was the structural risk.

### Fix

**Two-layer defence:**

1. **Strict input validation** — each element must be either a JS `number` or a
   purely decimal string (`/^\d+$/`). Strings with extra characters (semicolons,
   spaces, SQL keywords) are rejected before any DB interaction:

```typescript
const isPlainNumber = typeof raw === "number" && Number.isFinite(raw);
const isPureDigitString = typeof raw === "string" && /^\d+$/.test(raw);
if (!isPlainNumber && !isPureDigitString) {
  return res.status(400).json({ error: `other_mutation_ids berisi nilai tidak valid: ${JSON.stringify(raw)}` });
}
// Also reject floats, negatives, zero
const n = Number(raw);
if (!Number.isInteger(n) || n <= 0) {
  return res.status(400).json({ error: `...` });
}
```

2. **Parameterized query** — `sql.raw()` is completely removed. Each ID is a
   separate drizzle bind parameter via `sql.join`:

```typescript
// AFTER (safe):
const idFragments = allMutIds.map((id) => sql`${id}`);
const idList = sql.join(idFragments, sql`, `);
await tx.execute(sql`
  SELECT ... FROM bank_mutations
  WHERE id = ANY(ARRAY[${idList}]::int[])
`);
```

**Rejected payloads (all return 400):**
- `"1; DROP TABLE bank_mutations; --"` → non-pure-digit string
- `3.14` → not an integer
- `-1` → not positive
- `null` → not a number or string
- `[]` → empty array

---

## P0c — Broken Access Control on Mutating Endpoints

### Problem
All five mutating endpoints (`select`, `confirm`, `split`, `merge`, `reject`) fetched
`bank_allocation_matches` by `id` only, with no check that the match's `company_id`
matches the requester's company. An admin who knew (or guessed) a `matchId` from another
company could confirm, reject, or merge it.

### Fix

A helper function `ownershipAllowed()` is evaluated in every mutating handler
**before any state change**:

```typescript
function ownershipAllowed(m: any, userCompanyId: number | null): boolean {
  if (!userCompanyId) return true;     // super-admin: no company bound
  if (!m.company_id) return true;      // legacy data without company — allow
  return Number(m.company_id) === userCompanyId;
}
```

Usage in every handler:
```typescript
const userCompanyId = (req as any).user?.companyId ?? null;
// ...fetch match row...
if (!ownershipAllowed(m, userCompanyId)) {
  return res.status(403).json({ error: "Akses ditolak" });
}
```

Returns **403** (not 404) to make the denial explicit without leaking match existence
to attackers from other companies. Super-admins (no bound `companyId`) pass through.

**Applies to:** `select`, `confirm`, `split`, `merge`, `reject`

---

## P1b — Split/Merge Accepts Zero or Negative Line Amounts

### Problem
Split and merge handlers only validated that `Σ(line.amount) == mutation.amount`.
A payload like `[{amount: 600000}, {amount: -300000}]` with sum = 300k passed validation
but would insert a negative `allocation_lines.amount` row, corrupting journal entries
when the allocation was later posted.

### Fix

Per-line validation runs **before** any DB access in the split handler:

```typescript
for (let i = 0; i < lines.length; i++) {
  const amt = Number(lines[i].amount ?? 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: `Line ${i + 1}: amount harus lebih dari 0` });
  }
}
```

**Rejected inputs (all return 400):**
- Negative amount: `{"error": "Line 2: amount harus lebih dari 0"}`
- Zero amount: `{"error": "Line 2: amount harus lebih dari 0"}`
- NaN / non-numeric string: `{"error": "Line 1: amount harus lebih dari 0"}`

---

## P1 — CONFIRMED+Draft Allocations Invisible in UI Tabs

### Problem
After a finance user confirmed a match, `bank_allocation_matches.status` became
`'CONFIRMED'`. The matched tab query only returned `status IN ('CANDIDATE','MATCHED')`,
so confirmed-but-not-yet-posted allocations disappeared from all tabs until the
allocation was posted via the Allocation Center (a separate manual step).

### Fix

**bankAllocationMatching.ts** — `GET /tabs/matched` SQL filter extended:

```typescript
// BEFORE:
statusFilter = sql`AND bam.status IN ('CANDIDATE', 'MATCHED') AND (bam.is_auto_suggested = FALSE OR bam.status = 'MATCHED')`;
// ...then JS post-filter removed rows with allocation_status=null (CANDIDATE rows)...

// AFTER:
statusFilter = sql`AND (
  (bam.status IN ('CANDIDATE', 'MATCHED') AND (bam.is_auto_suggested = FALSE OR bam.status = 'MATCHED'))
  OR (bam.status = 'CONFIRMED' AND (ah.status IS NULL OR ah.status NOT IN ('posted')))
)`;
// No JS post-filter on matched tab — SQL handles inclusion/exclusion.
```

**Result:**
- CANDIDATE/MATCHED rows → visible in matched tab (finance can pick)
- CONFIRMED+draft/submitted/approved → visible in matched tab with `alloc_status=draft`
- CONFIRMED+posted → visible in posted tab only
- Suggested (auto) → visible in suggested tab only

---

## P2 — Candidate Fetch: No Company Filter in SQL

### Problem
`fetchAllocationCandidates()` fetched candidates from `sales_documents` and
`cash_advances` **across all companies** without a `WHERE company_id = ?` clause.
Company isolation depended solely on the scoring floor (company mismatch = 0 company
points = -5 from max). A cross-company candidate with matching reference and amount
could score ≥ 50 (the floor) and appear in the matched tab.

### Fix

**bankAllocationScoring.ts** — function signature updated to accept `company_id`:

```typescript
export async function fetchAllocationCandidates(
  mutation: Pick<AllocationMutationInput, "amount" | "transaction_date" | "company_id">,
): Promise<AllocationCandidate[]>
```

Both source queries now include a conditional company filter:

```typescript
// Invoice source:
${company_id != null ? sql`AND sd.company_id = ${company_id}` : sql``}

// Advance source:
${company_id != null ? sql`AND ca.company_id = ${company_id}` : sql``}
```

`sql.raw()` is **completely eliminated** from this function — all queries use drizzle
parameterized `sql`` tagged templates.

Caller in `bankAllocationMatching.ts` passes `company_id`:
```typescript
const candidates = await fetchAllocationCandidates({
  amount: mutation.amount,
  transaction_date: mutation.transaction_date,
  company_id: mutation.company_id,
});
```

**Verification:** Mutation with `company_id=2` vs advance belonging to `company_id=1`:
- Before patch: advance scored 50 (amount+date) and appeared as CANDIDATE
- After patch: `exceptions=1` (no candidates at all — correct)

---

## P3 — Additional: /run Missing Company Filter

### Problem (code-review finding)
`POST /run` fetched `bank_mutations WHERE status='unmatched'` without filtering by
`company_id`. A company-bound admin could process (score + auto-suggest) mutations
belonging to other companies simply by calling `/run`.

### Fix
```typescript
const userCompanyId = (req as any).user?.companyId ?? null;
// ...in the SQL:
${userCompanyId ? sql`AND company_id = ${userCompanyId}` : sql``}
```
Super-admins (no bound companyId) retain access to all companies. ✅

---

## P4 — Additional: Merge UPDATE Multi-Row Regression

### Problem (code-review finding)
The merge handler updated `bank_allocation_matches` rows via:
```typescript
WHERE bank_mutation_id = ${mid} AND status IN ('CANDIDATE', 'MATCHED')
```
A mutation with multiple scored candidate rows would have **all** of them updated to
`CONFIRMED`, violating `idx_bam_one_confirmed_per_mutation` (only 1 CONFIRMED per
mutation_id). This caused a DB constraint error on any merge where `>1` candidate
had been scored for the same mutation.

### Fix
```typescript
// Primary match — updated by exact id:
WHERE id = ${matchId}

// Each "other" mutation — only the best-scored row, using subquery LIMIT 1:
WHERE id = (
  SELECT id FROM bank_allocation_matches
  WHERE bank_mutation_id = ${mid}
    AND status IN ('CANDIDATE', 'MATCHED')
  ORDER BY match_score DESC
  LIMIT 1
)
```

---

## P5 — Additional: Split Body Validation Before Ownership Check

### Problem (code-review finding)
The split handler evaluated `lines.length < 2` before the `FOR UPDATE` + ownership
check. A cross-company user sending a 1-line body received `"Split membutuhkan minimal
2 lines"` (400) instead of `"Akses ditolak"` (403) — revealing that the match ID
exists even though they have no access.

### Fix
Body validation (`lines.length`, per-line amounts) moved **inside** `db.transaction()`
**after** the ownership check:

```typescript
// BEFORE (leaked match existence via validation error):
if (!Array.isArray(lines) || lines.length < 2) { return 400; }
// ... then ownership check ...

// AFTER (ownership always evaluated first):
const m = await tx.execute(sql`SELECT … FOR UPDATE`);
if (!ownershipAllowed(m, userCompanyId)) throw 403;
// Body validation happens here — after ownership is confirmed:
if (!Array.isArray(lines) || lines.length < 2) throw 400;
```

---

## P6 — Additional: IDOR on GET /mutation/:id

### Problem (code-review finding)
`GET /mutation/:id` fetched any `bank_mutations` row by raw ID with no company check.
An admin knowing (or guessing) a mutation ID from another company could read its full
detail, match history, and audit log.

### Fix
```typescript
const mut = mutRows[0];
if (userCompanyId && mut.company_id && Number(mut.company_id) !== userCompanyId) {
  return res.status(403).json({ error: "Akses ditolak" });
}
```

Applied immediately after the row fetch, before any match/log data is loaded. ✅

---

## Summary of Changes

| File | Change |
|------|--------|
| `bankAllocationMigration.ts` | +1 partial unique index `idx_bam_one_confirmed_per_mutation WHERE status='CONFIRMED'` |
| `bankAllocationScoring.ts` | Added `company_id` param; both queries (invoice + advance) filter by `company_id` at SQL level; removed all `sql.raw()` |
| `bankAllocationMatching.ts` | `SELECT FOR UPDATE` inside `db.transaction()` on confirm/split/merge; `ownershipAllowed()` helper on 5 mutating endpoints + GET /mutation/:id; strict int validation (isPlainNumber\|isPureDigitString) in merge; per-line amount>0 in split; split body validation moved after ownership check; matched tab filter extended for CONFIRMED+non-posted; `/run` company filter; IDOR guard on GET /mutation/:id; merge UPDATE uses exact id + subquery LIMIT 1 |

---

*Patch applied 2026-07-07. All 16 test cases verified against live dev API.*
*See runtime-verification-after-patch.md for full test output.*

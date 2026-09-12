# AI Transaction Intelligence — Production Integration Guide

## Overview

Phase 10 adds persistent storage and REST API exposure for the AI Transaction Intelligence engine (Phases 1–9). All analysis results are stored atomically in PostgreSQL via Supabase.

---

## Architecture

```
Client Request
     │
     ▼
POST /api/ai-transaction/review-cases
     │
     ▼
aiTransactionPersistenceService
  ├── Phase 1: transactionUnderstanding (pure)
  ├── Phase 2: intentClassifier (pure)
  ├── Phase 3: coaPredictionEngine (pure)
  ├── Phase 4: explainabilityEngine (pure)
  ├── Phase 7: anomalyEngine (pure)
  ├── Phase 8: reviewOrchestrationEngine (pure)
  └── Phase 9: decisionPolicyEngine (pure)
     │
     ▼
DB Transaction (atomic)
  ├── INSERT ai_review_cases
  ├── INSERT ai_review_snapshots
  └── INSERT ai_review_audit_events (CASE_CREATED + QUEUED)
```

---

## Database Schema (6 Tables)

| Table | Purpose |
|-------|---------|
| `ai_review_cases` | Review case lifecycle, status, queue assignment |
| `ai_review_snapshots` | Immutable AI pipeline outputs (append-only) |
| `ai_reviewer_decisions` | Reviewer actions (APPROVE, CHANGE_COA, etc.) |
| `ai_review_audit_events` | Append-only audit trail |
| `ai_learning_feedback` | Feedback loop data for model improvement |
| `ai_rule_recommendation_packages` | Adaptive rule packages pending review |

All tables include `company_id` — cross-company access is impossible.

---

## API Endpoints

### Review Case Management
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ai-transaction/review-cases` | Create + analyze transaction |
| `GET` | `/api/ai-transaction/review-cases` | List queue (paginated, filtered) |
| `GET` | `/api/ai-transaction/review-cases/:id` | Get case + snapshots + decisions |
| `GET` | `/api/ai-transaction/review-cases/:id/snapshots` | List snapshot versions |
| `GET` | `/api/ai-transaction/review-cases/:id/audit` | Get audit trail |
| `POST` | `/api/ai-transaction/review-cases/:id/assign` | Assign reviewer |
| `POST` | `/api/ai-transaction/review-cases/:id/start-review` | Begin review |
| `POST` | `/api/ai-transaction/review-cases/:id/decision` | Record reviewer decision |
| `POST` | `/api/ai-transaction/review-cases/:id/reevaluate` | Re-run AI pipeline |

### Observability & Learning
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ai-transaction/observability` | Aggregate metrics by company |
| `GET` | `/api/ai-transaction/learning-feedback` | Pending learning feedback |
| `GET` | `/api/ai-transaction/rule-packages` | Pending rule packages |
| `POST` | `/api/ai-transaction/rule-packages/:id/review` | Approve/reject rule package |

---

## Security Invariants

- **Authentication**: All endpoints require internal session (`requireFinanceRole` or `requireAdmin`)
- **Company isolation**: Every DB query scopes on `company_id` — no cross-company leakage
- **No body companyId trust**: `companyId` always resolved from session via `resolveCompanyId(req)`
- **Error safety**: `toSafeErrorResponse()` strips SQL and stack traces from API responses
- **Sensitive data**: Recursive redaction via `redactSensitiveMetadata()` before any DB write
- **Account masking**: `maskAccountNumber()` masks counterparty accounts in snapshots

---

## Idempotency

- Review cases: `rc::{fnv1a_hash}::{companyId}::{transactionId}` — same transaction returns existing case
- Reviewer decisions: `rd::{fnv1a_hash}::{reviewerId}` — same decision returns existing record
- HTTP 409 on conflict (same key, different payload)
- No `Math.random()` or `Date.now()` in key generation

---

## Transaction Atomicity

Three service functions use `db.transaction()`:

1. **`analyzeAndCreateReviewCase()`**
   - INSERT ai_review_cases
   - INSERT ai_review_snapshots (version 1)
   - INSERT ai_review_audit_events (CASE_CREATED + QUEUED)

2. **`recordAIReviewerDecision()`**
   - INSERT ai_reviewer_decisions
   - UPDATE ai_review_cases status
   - INSERT ai_review_audit_events
   - INSERT ai_learning_feedback

3. **`reevaluateAIReviewCase()`**
   - INSERT ai_review_snapshots (new version)
   - UPDATE ai_review_cases (if allowed by state machine)
   - INSERT ai_review_audit_events (REEVALUATED)

Rollback on any failure — partial writes are impossible.

---

## Snapshot Immutability

- Snapshots are INSERT-only; no UPDATE or DELETE methods exist in the repository
- Each reevaluation creates a new snapshot version (monotonically increasing)
- `getNextVersion()` uses `MAX(snapshot_version) + 1`

---

## Production Deployment Notes

- **DO NOT** run `drizzle-kit push` or migration directly against production without change management approval
- Migration file: `lib/db/drizzle/0026_ai_review_persistence.sql`
- All `CREATE TABLE` / `CREATE INDEX` / `CREATE TYPE` use `IF NOT EXISTS` (idempotent)
- No `DROP TABLE`, `DROP TYPE`, or destructive `ALTER TABLE` in migration
- DB integration tests were not executed (Supabase not available in CI); all tests use in-memory mocks

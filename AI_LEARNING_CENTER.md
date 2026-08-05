# AI Learning & Recommendation Center

## Overview

The AI Learning & Recommendation Center exposes data from the existing Phase 5–11 AI engines via a read-only dashboard, API, and widgets. No new AI engines were created — this feature surfaces the data that the existing learning, rule, and review orchestration engines already produce.

**Phase 9 guarantee: AI never auto-applies rules, mapping changes, or COA changes. Every recommendation requires human approval.**

---

## Architecture

```
Existing Engines (unchanged)
  Phase 5 — Learning Engine (learningEngine.ts, feedbackAnalyzer.ts, feedbackReliability.ts)
  Phase 6 — Adaptive Rule Engine (adaptiveRuleEngine.ts, ruleSuggestionBuilder.ts)
  Phase 8 — Review Orchestration (reviewOrchestrationEngine.ts)
  Phase 9 — Decision Policy (decisionPolicyEngine.ts)
  Phase 11 — Reviewer Dashboard (existing ai-review pages)
          ↓
New: AI Learning Center API (/api/ai-review/*)
          ↓
New: Learning, Recommendations, Statistics tabs (bizportal)
```

---

## API Endpoints

All endpoints are **read-only** (GET). Prefix: `/api/ai-review`

| Endpoint | Description |
|---|---|
| `GET /learning` | Learning patterns grouped by (intent + COA) |
| `GET /learning/:id` | Single pattern with feedback records |
| `GET /recommendations` | Rule recommendation packages |
| `GET /recommendations/:id` | Single recommendation with full payload |
| `GET /statistics` | Aggregated accuracy and rule metrics |
| `GET /rules/suggestions` | Rule suggestions from pending packages |

### Authentication
All endpoints require `requireFinanceRole` (admin, finance, accounting, treasury, tax, payroll).

### Learning Patterns Response
```json
{
  "ok": true,
  "data": {
    "patterns": [
      {
        "id": "abc123",
        "description": "BANK_INTEREST_TAX → 6210.PPh",
        "occurrenceCount": 42,
        "confidence": 0.98,
        "companyId": 1,
        "intent": "BANK_INTEREST_TAX",
        "recommendedCoa": "6210.PPh",
        "reviewerAgreement": 1.0,
        "requiresApproval": true,
        "lastSeen": "2026-07-30T10:00:00.000Z",
        "createdAt": "2026-05-01T00:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

### Statistics Response
```json
{
  "ok": true,
  "data": {
    "accuracy": 97.5,
    "falsePositive": 2.5,
    "falseNegative": 0,
    "manualCorrections": 3,
    "approvedRules": 4,
    "pendingRules": 2,
    "ignoredRules": 1,
    "learningPatterns": 12,
    "averageConfidence": 97.5,
    "totalFeedback": 120,
    "trend": { "recentAccuracy": 98.1, "priorAccuracy": 96.9, "direction": "up" }
  }
}
```

---

## Data Sources

| Data | Source table |
|---|---|
| Learning patterns | `ai_learning_feedback` — grouped by (intent + ai_recommended_coa_code) |
| Recommendations | `ai_rule_recommendation_packages` |
| Statistics | Both tables, aggregated in-memory |
| Rule suggestions | `ai_rule_recommendation_packages` WHERE status = PENDING_REVIEW |

---

## Phase 9: No Auto-Learning

Per the system constraint, AI is **prohibited** from:
- Directly changing rules
- Directly changing COA mapping
- Directly changing policies
- Auto-approving any recommendation

All actions go through human approval via:
- `POST /api/ai-transaction/rule-packages/:id/review` — approve/reject only by authorized humans
- UI shows "Approve Rule" / "Reject" buttons gated by role (Finance Manager, Accounting Manager, Super Admin)

---

## Permissions (Phase 8)

| Role | Can View | Can Approve | Can Reject |
|---|---|---|---|
| Finance Staff | ✓ | — | — |
| Finance Manager (finance) | ✓ | ✓ | — |
| Accounting Manager (accounting) | ✓ | ✓ | ✓ |
| Super Admin / Admin | ✓ | ✓ | ✓ |

# WA/Fonnte Runtime Verification Report

## 1. Baseline

- Branch: `main`
- Commit: `93c11c1e5f8c7e67994ff3894857be202d625549`
- Working tree before verification: clean
- Working tree after verification: clean
- Scope: development-only audit and controlled runtime verification

No application source, configuration, schema, or production settings were changed.

## 2. Environment

- `APP_ENV=development`: **CONFIRMED**
- Secret loader: **PASS**
- Secret bundle: development bundle
- `FONNTE_TOKEN`: **AVAILABLE**
- Database target: Supabase development = **YES**
- Database target: `heliumdb` = **NO**
- Production environment/database: **NOT USED**

The official secret loader completed validation successfully and did not start
the application. Secret values were not printed.

The application database resolver prefers `SUPABASE_DATABASE_URL_DEV` in
development. After the development secret loader mapped the development
bundle, the read-only database check found:

- `notification_logs`: present
- `mkt_notification_queue`: present
- `app_config`: present
- `portal_content`: present

## 3. Fonnte Configuration

| Path | File | Resolver | Source |
|---|---|---|---|
| Normal send | `artifacts/api-server/src/lib/fonnte.ts` | `getFonnteToken()` | `portal_content.fonnte_token`, then `FONNTE_TOKEN` fallback |
| Retry worker | `artifacts/api-server/src/lib/waRetryWorker.ts` | `getAppConfig("FONNTE_TOKEN")` | environment first, then `app_config` |
| Manual retry route | `artifacts/api-server/src/routes/waNotificationLogs.ts` | `process.env.FONNTE_TOKEN` | process environment at module load |
| Canonical transport | `artifacts/api-server/src/lib/waTransport.ts` | delegates to `fonnte.ts` | Fonnte provider |

Configuration observations:

- `FONNTE_TOKEN` is available through the development Secret Manager load.
- `app_config` did not contain a configured `FONNTE_TOKEN` row.
- `portal_content` contains configured admin WhatsApp settings, but no explicit
  development/test recipient marker was found.
- The three resolver paths are not identical. A canonical resolver would reduce
  configuration drift risk, but no refactor was made in this verification phase.

## 4. Worker Safety

The API Server was **not started normally** because startup registers workers
that can send WhatsApp notifications.

Potential WA-producing workers identified include:

- `wa-retry-worker`
- `workflow-worker`
- `fleet-notification-worker`
- `daily-report-wa`
- `mkt-notification-queue`
- `vendor-invitation-approval-reminder`
- `fulfillment-expiry-notifier`
- `vmf-gap-notifier`
- `product-first-reminder`
- `product-first-exception`
- `rekonsiliasi-worker`

The existing safety controls are:

- `SAFE_DEV_TEST_MODE=true`: makes Fonnte sends simulated and disables all
  startup workers through the startup orchestrator.
- `E2E_TEST_MODE=true`: makes Fonnte sends simulated; the startup safety guard
  also requires dangerous outbound channels to be explicitly mocked/disabled.
- `MOCK_WHATSAPP=true` and `DISABLE_WHATSAPP=true`: recognized by the
  e2e-safety status guard, but they do not themselves short-circuit the
  `fonnte.ts` HTTP send implementation.
- `DISABLE_BACKGROUND_WORKERS=true`: disables all registered background workers.

For this phase, no API Server process or notification worker was started.

## 5. Database Baseline

Read-only baseline from Supabase development:

### `notification_logs`, channel `wa`

- Total: `21`
- `sent`: `16`
- `failed`: `5`
- `deduped`: `0`
- `simulated`: `0`
- Delivery status `sent`: `16`
- Delivery status NULL: `5`
- `delivered`: `0`
- `read`: `0`
- Rows with `wa_message_id`: `16`

The latest historical rows included both successful and failed notifications.
Recipients and message payloads were not displayed.

### `mkt_notification_queue`, channel `whatsapp`

- No rows were present in the development queue at verification time.

### Before/after delta

No controlled message was sent, so there is no test-message delta:

| Metric | Before test | After test | Delta |
|---|---:|---:|---:|
| WA notification logs | 21 | 21 | 0 |
| `sent` | 16 | 16 | 0 |
| `failed` | 5 | 5 | 0 |
| `simulated` | 0 | 0 | 0 |
| `delivered` | 0 | 0 | 0 |

## 6. Controlled Message Test

- Test message sent: **NO**
- Actual messages sent during this phase: `0`
- Test reference: not created
- Recipient: not selected

The phase requires an explicitly approved internal/development recipient.
The environment did not expose a dedicated development/test recipient. The
configured admin WhatsApp settings in `portal_content` are not explicitly
marked as development-only, so they were not used.

## 7. Provider Result

A non-sending provider connectivity check was performed against the Fonnte
`/device` endpoint.

- Endpoint: Fonnte device status endpoint
- HTTP status: `200`
- Provider response: success/unspecified
- Device count returned: `0`
- Active device available for self-test: **NO**

No Fonnte `/send` request was made.

## 8. Notification Log Evidence

No new test row was created because the controlled message was blocked before
the send phase.

Historical evidence shows:

- 16 rows with `status=sent`
- 16 rows with a `wa_message_id`
- 5 rows with `status=failed`
- 0 rows with delivery callback status `delivered`
- 0 rows with delivery callback status `read`

`status=sent` is treated as provider/application send success, not proof of
WhatsApp delivery.

## 9. Delivery Evidence

**NOT TESTED**

No controlled message was sent. Historical logs contain no `delivered` or
`read` delivery callback evidence.

## 10. Retry/Dedup Verification

Verified from source and safe tests, without sending a second real message:

- Deduplication is implemented using channel, recipient, context, reference,
  and a time bucket.
- Default deduplication window: 30 minutes.
- Retry worker interval: 5 minutes.
- Maximum retries: 3.
- Retry backoff: 5 minutes, 10 minutes, 20 minutes.
- Retry success updates the log to `sent` and stores the provider message ID.
- Marketplace queue lifecycle supports pending/sending/sent and
  failed/retrying/exhausted states.

## 11. Tests

Focused safe tests:

- `mktRfqNotificationMessages.test.ts`
- `e2e-safety-guard.test.ts`
- `release-gate.test.ts`

Result:

- 3 test files passed
- 21 tests passed
- No real WhatsApp message was sent by these tests

## 12. Typecheck

API Server typecheck:

- **PASS**

## 13. Config Resolver Inconsistency

1. Normal send, retry worker, and manual retry use different resolver paths:
   **YES**.
2. Risk that one path reads a different configuration source:
   **YES**.
3. Do all paths definitely resolve from the same GCP Secret Manager value at
   runtime:
   **NOT PROVEN**. Normal send and manual retry use the injected environment
   value; retry worker may fall back to a different database config row.
4. Canonical resolver recommended:
   **YES**, as a follow-up hardening item.

No refactor was performed because it was outside the verification scope and was
not needed to establish the safe stop condition.

## 14. Findings

### Positive findings

- Development environment selection is fail-closed and confirmed.
- Development Supabase target is reachable.
- Fonnte token is available through the official Secret Manager loader.
- Fonnte provider endpoint is reachable.
- Normal send, media send, logging, deduplication, retry, and queue code exist.
- Focused safety tests and API typecheck pass.

### Blocking findings

- Fonnte `/device` returned zero active devices.
- No explicitly approved development/internal recipient was available.
- API Server was intentionally not started to avoid automatic worker sends.
- No `/send` request was made.
- No provider message ID or delivery callback can be produced for this phase.

## 15. Final Verdict

## ⛔ WA/FONNTE RUNTIME TEST BLOCKED

No real WhatsApp message was sent.

Exact blocking reasons:

1. No active Fonnte device was returned by the non-sending device check.
2. No dedicated development/test recipient was explicitly configured.
3. Starting the normal API Server would activate multiple notification-capable
   workers and was therefore not safe without an approved test recipient and
   isolated worker configuration.

Evidence level reached:

1. Implemented in code: **PASS**
2. Configured: **PASS** for token and development secret loading
3. Provider accepted a message: **NOT TESTED**
4. Delivered to WhatsApp: **NOT TESTED**
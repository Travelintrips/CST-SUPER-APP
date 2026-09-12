---
name: FASE 5 Driver Assignment Analytics
description: Auto-cancel/reminder worker, analytics summary endpoint, analytics dashboard page, force-update dialog + SSE realtime toast in OrderDriverAssignmentPanel.
---

## Scope

FASE 5 — Enhancement & Analytics untuk Driver Assignment System CST Logistics.

## Files Created / Modified

**Backend:**
- `artifacts/api-server/src/lib/driverJobWorker.ts` — baru; auto-cancel stale jobs + WA reminder
- `artifacts/api-server/src/routes/driver.ts` — `GET /api/drivers/analytics/summary` ditambah di adminRouter sebelum `/performance`
- `artifacts/api-server/src/index.ts` — `startDriverJobWorker()` dipanggil setelah `startWorkflowWorker()`

**Frontend:**
- `artifacts/bizportal/src/pages/logistics/drivers-analytics.tsx` — baru; analytics dashboard
- `artifacts/bizportal/src/components/freight/OrderDriverAssignmentPanel.tsx` — rewrite total
- `artifacts/bizportal/src/routes.tsx` — route `/logistics/drivers/analytics` ditambah (HARUS sebelum `/logistics/drivers/:id/performance`)
- `artifacts/bizportal/src/components/layout/AppShell.tsx` — sidebar item "Analytics Driver" ditambah

## Worker Behavior

**`driverJobWorker.ts`** berjalan setiap 15 menit, delay awal 5 menit:
- Query semua job yang bukan COMPLETED/CANCELLED via `notInArray(driverJobsTable.status, TERMINAL)`
- Untuk setiap job, ambil `last log timestamp` dari `driverJobLogsTable` (order by timestamp DESC)
- Jika `hoursStale >= AUTO_CANCEL_HOURS (24)` → update status CANCELLED, insert log, WA ke adminGroupWa
- Jika `REMINDER_HOURS (6) <= hoursStale < AUTO_CANCEL_HOURS` → insert log reminder, WA adminGroupWa + WA driver internal (via driverPhoneOverride + waProgressToken)
- In-memory `REMINDED_JOBS` Set sebagai guard duplikasi dalam satu sesi server
- Double-check via log note contains "Auto-reminder:" untuk guard cross-restart

**Environment vars:** `DRIVER_AUTO_CANCEL_HOURS` (default 24), `DRIVER_REMINDER_HOURS` (default 6)

## Analytics Summary Endpoint

`GET /api/drivers/analytics/summary?days=30&driverType=INTERNAL|EXTERNAL|ALL`

Response shape:
```json
{
  "period": { "days": 30, "from": "...", "to": "..." },
  "summary": {
    "total", "completed", "delivered", "cancelled", "inProgress",
    "internalCount", "externalCount",
    "podSubmitted", "deliveredForPod", "podRate",
    "successRate", "avgDurationHours",
    "onTimeCount", "onTimeTotal", "onTimePct"
  },
  "statusDistribution": { "ASSIGNED": N, ... },
  "recentJobs": [{ id, jobNumber, status, driverType, driverName, assignedAt, completedAt, logisticOrderId }]
}
```

Uses dynamic `import("drizzle-orm")` alias (`gte2`, `lte2`) to avoid conflict with outer-scope `gte` import.

## OrderDriverAssignmentPanel Rewrite

Key features:
- `useDriverSSE(orderId, callback)` — EventSource ke `/api/drivers/events`, listen `job_status_changed`, invalidate query + toast
- **Force Update dialog** — Zap button per job card → dropdown (ALL_STATUSES) + note + force checkbox → PATCH `/api/drivers/jobs/:jobId/status`
- **Timeline filter** — `ALL | INTERNAL | EXTERNAL` filter, shown only when jobs have mixed types
- `JobTimeline` component — sequence step circles + collapsible per job (active & past)
- `PastJobRow` — collapsed row dengan expand toggle untuk timeline

## Route Order Warning

`/logistics/drivers/analytics` HARUS didefinisikan SEBELUM `/logistics/drivers/:id/performance` di routes.tsx. Wouter mencocokkan route pertama yang match, jadi "analytics" akan ter-capture sebagai `:id` jika urutannya terbalik.

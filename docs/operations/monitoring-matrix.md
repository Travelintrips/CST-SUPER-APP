# Monitoring Matrix

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Owner:** DevOps (setup) · Technical Lead (threshold approval)  
**Review Cadence:** Monthly; after every incident; after every production deployment

> All thresholds below are targets for production. Adjust after observing real-world baseline.
> Alerts must be routed to a designated on-call channel (not only email).
> Every alert must have a designated Owner who is responsible for response.

---

## Monitoring Matrix

### API Server

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 1 | **API** | HTTP error rate (5xx) | < 1% over 5 min | > 1% for 5 consecutive minutes | `curl /api/health` → `status: ok` | Technical Lead |
| 2 | **API** | HTTP response time (p95) | < 500 ms | p95 > 500 ms for 5 min | `curl -o /dev/null -w "%{time_total}" /api/health` < 0.5s | Technical Lead |
| 3 | **API** | HTTP error rate (4xx) | < 5% over 5 min | > 5% for 10 consecutive minutes (excluding 401 from unauthenticated probes) | Check log for pattern | Backend Engineer |
| 4 | **Health Endpoint** | `/api/health` availability | 100% | Any response != 200 for 2 consecutive checks (60-second interval) | Manual curl after alert | DevOps |
| 5 | **Health Endpoint** | `/api/health` latency | < 3 s | > 3 s for any single check | Check DB connection pool | DevOps |

### Database

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 6 | **Database** | Query response time (p95) | < 200 ms | p95 > 200 ms over 5 min | `psql $SUPABASE_DATABASE_URL -c "SELECT 1"` | Backend Engineer |
| 7 | **Database** | Query error rate | < 0.1% | > 0.1% over 5 min | Check `db-startup-cb.json`; check pgBouncer status | Backend Engineer |
| 8 | **Database** | Replication lag (if enabled) | < 5 s | > 5 s for 3 min | Supabase dashboard → Replication | DevOps |
| 9 | **Database** | Table row growth anomaly | Normal ± 3σ | > 3σ spike in any single table per hour | Query `pg_stat_user_tables` | Backend Engineer |

### Connection Pool

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 10 | **Connection Pool** | Active connections | < 80% of pool max (max=8) | > 6 active connections sustained for 5 min | `SELECT count(*) FROM pg_stat_activity` | Backend Engineer |
| 11 | **Connection Pool** | Connection wait time | < 1 s | > 1 s average over 2 min | Check API server pool log | Backend Engineer |
| 12 | **Connection Pool** | Connection refused errors | 0 | Any connection refused error | `rm -f /tmp/db-startup-cb.json`; restart Gateway | Backend Engineer |

### Supabase

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 13 | **Supabase** | Platform status | Operational | Any degradation on `status.supabase.com` | Check Supabase status page | DevOps |
| 14 | **Supabase** | Database disk usage | < 80% | > 80% disk usage | Supabase dashboard → Database → Usage | DevOps |
| 15 | **Supabase** | Database bandwidth | Within plan limits | > 90% of monthly bandwidth | Supabase dashboard → Usage | Owner, DevOps |
| 16 | **Supabase** | Auth service | Available | Auth endpoint returns non-200 | Test login flow | Technical Lead |

### Storage

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 17 | **Storage** | Bucket availability | 100% | Any `attachments` or `vehicle-images` bucket 503 | `curl <supabase-storage-url>/...` → 200 | DevOps |
| 18 | **Storage** | Storage bandwidth | Within plan limits | > 90% of monthly storage bandwidth | Supabase dashboard → Storage → Usage | Owner, DevOps |
| 19 | **Storage** | Upload success rate | > 99% | < 99% upload success rate over 1 hour | Check API server upload error logs | Backend Engineer |

### Queue & Worker

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 20 | **Queue** | Pending notification queue depth | < 100 | > 100 items in `mkt_notification_queue` with status='pending' for > 10 min | `SELECT COUNT(*) FROM mkt_notification_queue WHERE status='pending'` | Backend Engineer |
| 21 | **Queue** | Failed notification count | < 5 per hour | > 5 failed items per hour | Check `mkt_notification_queue` `status='failed'` with `attempts >= max_attempts` | Backend Engineer |
| 22 | **Worker** | Worker heartbeat | All workers scheduled | Any registered worker misses 3 consecutive heartbeat cycles | `/api/health` → `workers: running` | Backend Engineer |
| 23 | **Worker** | Worker error rate | < 1% | > 1% task failure rate per worker over 10 min | Check API server worker logs | Backend Engineer |

### SSE (Server-Sent Events)

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 24 | **SSE** | SSE endpoint availability | 100% | `/api/notifications/stream` returns non-200 | Manual SSE connection test | Backend Engineer |
| 25 | **SSE** | SSE event delivery latency | < 5 s | Event not delivered within 5 s of trigger | E2E SSE test on staging | Technical Lead |
| 26 | **SSE** | Active SSE connections | Monitor only (no threshold) | Sudden drop to 0 during business hours | Check Gateway connection count | DevOps |

### Payment Callback

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 27 | **Payment Callback** | Paylabs callback success rate | > 99% | < 99% success rate over 1 hour | Check API server `[paylabs]` logs | Technical Lead |
| 28 | **Payment Callback** | Callback processing time | < 5 s | > 5 s average callback processing | Check callback endpoint response time | Backend Engineer |
| 29 | **Payment Callback** | Signature validation failure | 0 | Any `[paylabs] signature INVALID` log entry | Check credential injection; verify Paylabs key config | Technical Lead, Owner |
| 30 | **Payment Callback** | Duplicate payment prevention | 0 duplicates | Any duplicate payment ID processed | Query `financial_outbox_events` for duplicate ref | Finance Owner |

### WhatsApp (Fonnte / WATI)

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 31 | **WhatsApp** | Message delivery success rate | > 95% | < 95% delivery rate over 1 hour | Check Fonnte/WATI dashboard delivery report | Owner |
| 32 | **WhatsApp** | API authentication status | Valid | Any 401/403 from Fonnte or WATI API | `curl .../validate` → `status: true` | Owner, DevOps |
| 33 | **WhatsApp** | Message queue depth | < 50 | > 50 queued messages pending delivery for > 15 min | Check notification queue table | Backend Engineer |

### SMTP

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 34 | **SMTP** | Email delivery success rate | > 99% | < 99% delivery rate over 1 hour | SMTP provider delivery dashboard | Owner |
| 35 | **SMTP** | SMTP connection status | Available | SMTP `EHLO` fails or connection refused | `node -e "nodemailer.createTransport(...).verify(cb)"` | DevOps |
| 36 | **SMTP** | SMTP quota remaining | > 20% of monthly quota | < 20% quota remaining | SMTP provider dashboard | Owner |

### Infrastructure — CPU, Memory, Latency, Error Rate

| # | Component | Metric | Threshold | Alert Condition | Verification | Owner |
|---|---|---|---|---|---|---|
| 37 | **CPU** | API server CPU usage | < 80% sustained | > 80% for 5 consecutive minutes | Check Replit resource usage | DevOps |
| 38 | **Memory** | API server memory usage | < 80% of available | > 80% for 5 consecutive minutes | Check Replit resource usage | DevOps |
| 39 | **Latency** | Gateway proxy latency | < 200 ms added | > 200 ms gateway overhead | Compare gateway vs direct API response time | DevOps |
| 40 | **Error Rate** | Overall application error rate | < 0.5% of all requests | > 0.5% over 10 min | Aggregate 5xx from all endpoints | Technical Lead |
| 41 | **Error Rate** | Authentication failure rate | < 5% of auth requests | > 5% auth failure rate (may indicate credential issue or attack) | Check login endpoint logs | Security Officer |

---

## Alert Routing

| Severity | Channel | Response SLA |
|---|---|---|
| P0 — Critical (data loss, security, total service down) | On-call phone + chat | 15 minutes |
| P1 — High (partial service down, payment failure) | Chat + email | 30 minutes |
| P2 — Medium (degraded performance, delivery failure) | Chat | 2 hours |
| P3 — Low (quota warning, non-critical feature failure) | Email | Next business day |

---

## Monitoring Stack Recommendation

> **Note:** The monitoring stack is not yet configured. Configure before production deployment.

| Tool | Purpose | Status |
|---|---|---|
| Uptime monitor (e.g. Better Uptime, UptimeRobot) | `/api/health` availability — 60-second interval | ⛔ Not configured |
| Log aggregator (e.g. Logtail, Papertrail) | Centralized API server + Gateway logs | ⛔ Not configured |
| Error tracker (e.g. Sentry) | Exception capture with stack traces | ⛔ Not configured |
| Supabase dashboard | DB metrics, storage, auth | ✅ Available (manual check) |
| SMTP provider dashboard | Email delivery and quota | ✅ Available (manual check) |
| Fonnte / WATI dashboard | WhatsApp delivery | ✅ Available (manual check) |

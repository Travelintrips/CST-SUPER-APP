# Release Risk Matrix

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Scope:** Production deployment of CST Super App  
**Review Cadence:** Before every production deployment; after every incident

> **Probability:** Low — unlikely under normal conditions · Medium — possible if precautions skipped · High — expected without mitigation  
> **Impact:** Low — no data loss, degraded non-critical feature · Medium — service disruption, recoverable · Critical — data loss, financial error, or unrecoverable state

---

## Risk Matrix

| # | Risk | Probability | Impact | Risk Level | Mitigation | Contingency | Owner |
|---|---|---|---|---|---|---|---|
| 1 | **Secret belum dirotasi sebelum deployment** | High | Critical | 🔴 HIGH | `pnpm run audit:secret-rotation` must exit 0; production gate blocks if incomplete | Abort deployment; complete rotation; re-run gate | Owner |
| 2 | **Salah inject credential** (wrong env, wrong secret name, placeholder value) | Medium | Critical | 🔴 HIGH | `pnpm run audit:secrets` → MISSING: 0, INVALID: 0; double-check via deployment secrets panel before deploy | Abort deployment; correct injection; restart services; verify health | Owner, Technical Lead |
| 3 | **Staging mismatch** (staging schema behind prod, or TEST_DATABASE_URL points to prod) | High | Critical | 🔴 HIGH | Verify staging project is isolated; `psql $TEST_DATABASE_URL -c "SELECT current_database()"` must return staging project name; run migration parity check | If mismatch found: stop E2E; fix staging; re-run E2E | DevOps |
| 4 | **Migration gagal di production** | Low | Critical | 🟠 MEDIUM-HIGH | All migrations must PASS on staging first; idempotent DDL (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS); no multi-statement pgBouncer calls | Execute rollback plan (database rollback to pre-migration backup); alert all roles | Backend Engineer, Technical Lead |
| 5 | **Payment callback gagal** (signature mismatch, wrong endpoint, network issue) | Medium | Critical | 🔴 HIGH | Sandbox verification before deploy; `[paylabs] signature OK` in API log; Paylabs webhook URL configured in merchant dashboard | Disable payment feature flag; rollback if data corrupted; contact Paylabs support | Technical Lead, Owner |
| 6 | **SSE gagal** (connection dropped, event not received, gateway timeout) | Medium | Medium | 🟡 MEDIUM | SSE E2E gate verified on staging; health check includes SSE probe; gateway timeout config reviewed | Degraded mode: polling fallback; non-blocking for deployment GO | Technical Lead |
| 7 | **Accounting imbalance** (debit ≠ credit after migration or during E2E) | Low | Critical | 🟠 MEDIUM-HIGH | Accounting E2E gate: journal immutability + period lock + balance validation; Finance Owner sign-off required | Stop deployment; do not proceed to production; audit journal entries; escalate to Finance Owner | Finance Owner, Backend Engineer |
| 8 | **Tenant leakage** (Company A data visible to Company B) | Low | Critical | 🔴 HIGH | Tenant isolation E2E gate; all queries include company_id filter; RLS verified; Security Officer audit | Immediate rollback; audit all cross-company queries; Security Officer incident review | Security Officer |
| 9 | **Rollback gagal** (Replit deployment history unavailable, backup corrupt, old secrets lost) | Low | Critical | 🟠 MEDIUM-HIGH | Rollback tested on staging before deploy; backup verified < 24h; old credentials kept in offline backup until rotation verified | Provision new Supabase project from backup; escalate to Owner + Technical Lead; maximum downtime 60 min | DevOps, Owner |
| 10 | **Storage permission salah** (bucket private when should be public, or vice versa) | Medium | Medium | 🟡 MEDIUM | Storage bucket policies verified in pre-production checklist (Phase D); smoke test vehicle images load after deploy | Correct bucket policy via Supabase dashboard; no app rollback needed | DevOps |
| 11 | **Deployment timeout** (Replit deployment takes too long, health check times out) | Medium | Medium | 🟡 MEDIUM | Health check endpoint responds < 3 seconds; DB pool sized correctly (max=8); deployment window not during peak traffic | Retry deployment; check Gateway logs; if > 2 retries: rollback | DevOps, Technical Lead |
| 12 | **Database unavailable** (Supabase downtime, pgBouncer CB, pool exhaustion) | Low | Critical | 🟠 MEDIUM-HIGH | DB pool max=8; ECB cooldown 2 min; `/tmp/db-startup-cb.json` cleared before deploy; Supabase status page monitored | Wait for Supabase recovery; abort deployment if downtime > 15 min; execute database rollback if corruption found | DevOps, Backend Engineer |
| 13 | **pgBouncer crash-loop amplification** | Low | Critical | 🟠 MEDIUM-HIGH | File-based CB shared across restarts; dev retry raised to 30s; production CB not affected by dev restarts | `rm -f /tmp/db-startup-cb.json`; restart Gateway; verify health | Backend Engineer |
| 14 | **WhatsApp notification failure** (Fonnte/WATI token expired or revoked) | Medium | Low | 🟢 LOW-MEDIUM | Fonnte/WATI tokens rotated and verified before deploy; `curl .../validate` → status true | Non-blocking; notifications queued; fix credential; no rollback needed | Owner, DevOps |
| 15 | **Google OAuth redirect URI mismatch** (login broken post-deploy) | Low | Medium | 🟡 MEDIUM | Production redirect URI registered in GCP before deployment; smoke test login flow | Add correct URI to GCP Console; no app rollback needed | Technical Lead |
| 16 | **SMTP quota exhausted** | Low | Low | 🟢 LOW | SMTP provider quota monitored; rate limiting on outbound email | Switch to backup SMTP provider; non-blocking for deployment | DevOps |
| 17 | **OpenAI API key quota exhausted** | Low | Low | 🟢 LOW | AI features degrade gracefully; non-blocking for deployment GO | AI features disabled; no rollback needed | Owner |
| 18 | **ADMIN_EMAIL_DOMAINS still set to example.com** | High | Medium | 🟠 MEDIUM-HIGH | Pre-production checklist Phase A requires this to be changed before deploy | Abort deployment; correct value; re-deploy | Technical Lead, Owner |

---

## Risk Level Summary

| Level | Count | Items |
|---|---|---|
| 🔴 HIGH | 4 | Secret belum dirotasi (#1), Salah inject credential (#2), Tenant leakage (#8), Payment callback gagal (#5) |
| 🟠 MEDIUM-HIGH | 5 | Staging mismatch (#3), Migration gagal (#4), Accounting imbalance (#7), Rollback gagal (#9), Database unavailable (#12), pgBouncer (#13), ADMIN_EMAIL_DOMAINS (#18) |
| 🟡 MEDIUM | 3 | SSE gagal (#6), Storage permission (#10), Deployment timeout (#11), Google OAuth (#15) |
| 🟢 LOW | 3 | WhatsApp failure (#14), SMTP quota (#16), OpenAI quota (#17) |

---

## Risk Review Procedure

1. This matrix must be reviewed by Technical Lead and Owner before every production deployment.
2. Any risk rated 🔴 HIGH or 🟠 MEDIUM-HIGH must have its mitigation confirmed DONE before deployment proceeds.
3. New risks identified during E2E or staging must be added before the deployment window closes.
4. After every incident, the corresponding risk entry must be updated with lessons learned.

# Release History

**Project:** CST Super App  
**Last Updated:** 2026-07-24

> **Instructions for use:**
> Fill one row per release event. Use the templates below.
> Do not enter fictional data. Enter only real events.
> Column definitions are at the bottom of this file.

---

## Release Log

| Date | Version | Type | Status | Deployer | Gate Result | Summary | Rollback? | Incident? | Link |
|---|---|---|---|---|---|---|---|---|---|
| _(date)_ | RC-1 | Release Candidate | _(status)_ | _(role)_ | _(result)_ | _(description)_ | _(Y/N)_ | _(Y/N)_ | _(link)_ |
| _(date)_ | RC-2 | Release Candidate | _(status)_ | _(role)_ | _(result)_ | _(description)_ | _(Y/N)_ | _(Y/N)_ | _(link)_ |
| _(date)_ | RC-3 | Release Candidate | _(status)_ | _(role)_ | _(result)_ | _(description)_ | _(Y/N)_ | _(Y/N)_ | _(link)_ |

---

## Release Event Templates

Use the template that matches the event type. Copy the template block, fill in all fields, and append it to the Release Log above.

---

### Template: Release Candidate

```
| Date       | [RC-N]          | Release Candidate | [Passed / Blocked / Aborted] | [Role] | [GO / NO-GO] | [Summary of what changed] | [Y/N] | [Y/N] | [link] |
```

**Required before appending:**
- `pnpm run audit:customer-production` output: GO or NO-GO
- Evidence path (e.g. `docs/release/evidence/rc-N-*.json`)
- Deployer role (not name)

---

### Template: Production Release

```
| Date       | [vX.Y.Z]        | Production        | [Live / Rolled Back]         | [Role] | GO           | [Summary of features shipped] | [Y/N] | [Y/N] | [link] |
```

**Required before appending:**
- All 12 gates PASS confirmed
- `docs/release/final-go-checklist.md` fully signed
- Owner sign-off date
- Post go-live T+1 hour check complete

---

### Template: Hotfix

```
| Date       | [vX.Y.Z-hotfixN]| Hotfix            | [Live / Rolled Back]         | [Role] | GO           | [Root cause and fix description] | [Y/N] | [Y/N] | [link] |
```

**Required before appending:**
- Root cause documented in `docs/security/incident-log.md`
- `pnpm run audit:customer-production` → GO before hotfix deploy
- Technical Lead authorization

---

### Template: Rollback

```
| Date       | [Rollback]      | Rollback          | [Complete / Partial]         | [Role] | —            | [What was rolled back and why] | Y | [Y/N] | [link] |
```

**Required before appending:**
- Rollback authorized by Owner
- Rollback decision tree path documented
- Incident log entry created
- Post-rollback health check PASS

---

### Template: Emergency Fix

```
| Date       | [vX.Y.Z-emg]    | Emergency Fix     | [Live / Failed]              | [Role] | —            | [Critical issue and emergency fix] | [Y/N] | Y | [link] |
```

**Required before appending:**
- P0 incident opened in `docs/security/incident-log.md`
- Owner and Technical Lead authorization recorded
- Post-emergency health check PASS

---

## Column Definitions

| Column | Description |
|---|---|
| **Date** | ISO 8601 date (YYYY-MM-DD) of the event |
| **Version** | RC-N for candidates; vX.Y.Z for production; vX.Y.Z-hotfixN for hotfixes |
| **Type** | One of: Release Candidate, Production, Hotfix, Rollback, Emergency Fix |
| **Status** | Live, Rolled Back, Blocked, Aborted, Complete, Partial, Failed |
| **Deployer** | Role (not name) who performed the deployment or rollback |
| **Gate Result** | Output of `pnpm run audit:customer-production`: GO or NO-GO; or — for rollbacks |
| **Summary** | One-sentence description of what changed or what happened |
| **Rollback?** | Y if a rollback was executed; N otherwise |
| **Incident?** | Y if a post-deployment incident was logged; N otherwise |
| **Link** | Link to evidence, incident log, or checklist (relative path or URL) |

---

## Release Cadence Policy

- **Release Candidates** must pass all 12 gates before being considered for production.
- **Hotfixes** require Technical Lead authorization and must pass `audit:customer-production` GO.
- **Emergency Fixes** require Owner + Technical Lead authorization; post-emergency full gate run is required within 24 hours.
- **Rollbacks** are logged as a separate row even if no code changed — the rollback event is the record.
- **Every production event** (deploy, rollback, hotfix) must have a log entry within 1 hour of the event.

# RACI Matrix — Release Operations

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Scope:** Production deployment of CST Super App

> **Definitions:**
> - **R — Responsible:** Does the work. May be multiple roles.
> - **A — Accountable:** One role only. Final decision authority. Signs off.
> - **C — Consulted:** Provides input before action. Two-way communication.
> - **I — Informed:** Notified of outcome. One-way communication.
>
> **Roles used in this matrix:**
> Owner · Technical Lead · DevOps · Backend Engineer · Security Officer · QA Engineer · Finance Owner

---

## Release Operations RACI

| # | Activity | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|---|
| 1 | **Secret Rotation** | Owner | Owner | Security Officer, Technical Lead | DevOps |
| 2 | **Secret Injection** (into Replit Secrets) | Owner | Owner | Technical Lead, DevOps | Backend Engineer |
| 3 | **Staging Provisioning** (Supabase staging project) | DevOps | Technical Lead | Backend Engineer | QA Engineer, Owner |
| 4 | **Database Migration** (apply to staging) | Backend Engineer | Technical Lead | DevOps | QA Engineer, Owner |
| 5 | **Database Migration** (apply to production) | DevOps, Backend Engineer | Technical Lead | Owner | Finance Owner, Security Officer |
| 6 | **Storage Provisioning** (bucket policies, staging) | DevOps | Technical Lead | Backend Engineer | Owner |
| 7 | **Payment Sandbox Verification** | QA Engineer | Technical Lead | Backend Engineer | Owner, Finance Owner |
| 8 | **HTTP E2E** (run on dedicated staging) | QA Engineer, Backend Engineer | Technical Lead | DevOps | Owner, Security Officer, Finance Owner |
| 9 | **Tenant Isolation Audit** | QA Engineer | Security Officer | Backend Engineer, Technical Lead | Owner |
| 10 | **Security Audit** | Security Officer | Security Officer | Technical Lead, Backend Engineer | Owner, QA Engineer |
| 11 | **Accounting Audit** | Finance Owner, QA Engineer | Finance Owner | Backend Engineer, Technical Lead | Owner |
| 12 | **SSE Verification** | QA Engineer | Technical Lead | Backend Engineer | Owner |
| 13 | **Backup** (pre-deployment) | DevOps | Owner | Technical Lead | Backend Engineer, Finance Owner |
| 14 | **Rollback** (execute) | DevOps, Backend Engineer | Technical Lead | Owner | Finance Owner, Security Officer |
| 15 | **Rollback** (authorize) | — | Owner | Technical Lead, Security Officer | Finance Owner, QA Engineer |
| 16 | **Production Deployment** | DevOps | Technical Lead | Owner | Finance Owner, QA Engineer, Security Officer |
| 17 | **Monitoring Setup** | DevOps | Technical Lead | Backend Engineer | Owner |
| 18 | **Incident Response** | On-call Backend Engineer, DevOps | Technical Lead | Security Officer | Owner, Finance Owner, QA Engineer |
| 19 | **GO Decision** | — | Owner | Technical Lead, Security Officer, Finance Owner | All roles |
| 20 | **Post Go-Live Verification** (0–1 hour) | QA Engineer, Backend Engineer | Technical Lead | DevOps | Owner |
| 21 | **Post Go-Live Verification** (24–72 hours) | QA Engineer | Technical Lead | Finance Owner, Security Officer | Owner |
| 22 | **Secret Rotation Status Report** | Security Officer | Owner | Technical Lead | All roles |
| 23 | **Release Evidence Collection** | QA Engineer | Technical Lead | DevOps, Backend Engineer | Owner |

---

## Role Definitions

| Role | Scope of Authority |
|---|---|
| **Owner** | Final business and financial authority. Signs GO decision. Authorizes rollback. Controls production secrets. |
| **Technical Lead** | Final technical authority. Accountable for deployment success. Escalation path for all technical decisions. |
| **DevOps** | Infrastructure, deployment, backup, monitoring, and rollback execution. |
| **Backend Engineer** | API server, database migration, service correctness. On-call for HTTP E2E defect fixes. |
| **Security Officer** | Secret rotation verification, tenant isolation audit, security gate, credential policy. |
| **QA Engineer** | HTTP E2E harness execution, post go-live verification, test evidence collection. |
| **Finance Owner** | Accounting gate sign-off. Journal immutability and period lock verification. Financial risk assessment. |

---

## Escalation Path

```
On-call Backend Engineer
       ↓ (15 min SLA)
Technical Lead
       ↓ (30 min SLA)
Owner
       ↓ (60 min SLA — P0 incidents)
External vendor / Supabase support
```

---

## RACI Rules

1. Every activity has exactly **one Accountable** role — never two.
2. The Accountable role may also be Responsible for the same activity (R+A).
3. The Owner is Accountable for GO Decision and Secret Rotation — these may not be delegated.
4. No external person (consultant, agent) may be Accountable for any production activity.
5. A role listed as Informed must receive written notification (email, chat record, or log entry) — not verbal.

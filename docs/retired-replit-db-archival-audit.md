# Retired Replit/Helium Database Archival Audit

**Audit date:** 2026-09-04  
**Status:** BLOCKED — no separately approved read-only snapshot or export was available

## Scope and safety boundary

This audit is intentionally limited to evidence that can be collected without
connecting to the live Replit/Helium workspace database. The application source
of truth is Supabase. The following targets were explicitly excluded:

- `DATABASE_URL`
- `REPLIT_DB_URL`
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`

The repository's legacy synchronization command remains fail-closed:
`scripts/db-sync-check.mjs` exits with code 1 and does not open a database
connection. `artifacts/api-server/load-secrets.mjs` also removes the built-in
database variables before starting an application child process.

No retired-database dump, export, SQLite file, PostgreSQL backup, or other
owner-approved archival source was found in the repository, workspace, `/tmp`,
or the available home-directory search area. The live workspace variables were
not used as a substitute.

## Approved environment checks

The project Secret Manager loader was run in validation-only mode for both
environments:

| Environment | Loader result | Database access |
|---|---|---|
| Development | Passed; development bundle selected | None during validation |
| Production | Passed; production bundle selected | None during validation |

The canonical Supabase URLs were then used for read-only metadata checks only.
Both targets reported the expected PostgreSQL `public` schema. These checks do
not inspect or compare the retired source.

### Current Supabase table inventory

This is a table inventory, not a retired-source row count. It is retained as
the target-side baseline for a later approved reconciliation.

| Schema | DEV base tables | PROD base tables |
|---|---:|---:|
| `ai_platform` | 197 | 176 |
| `auth` | 23 | 23 |
| `drizzle` | 1 | 1 |
| `menu_app` | 32 | 23 |
| `public` | 798 | 800 |
| `realtime` | 10 | 9 |
| `sport_center` | 95 | 88 |
| `storage` | 8 | 8 |
| `supabase_migrations` | 1 | 0 |
| `travelintrips` | 8 | 8 |
| `vault` | 1 | 1 |

These schema-level totals are not evidence that any corresponding retired
table has zero rows. They also are not a source-to-target reconciliation.

## Source-to-Supabase reconciliation status

| Reconciliation item | DEV | PROD | Result |
|---|---|---|---|
| Approved retired source available | No | No | Blocked |
| Retired-source table list | Not assessed | Not assessed | Do not infer empty |
| Retired-source row counts | Not assessed | Not assessed | Do not infer zero |
| Supabase target inventory | Available | Available, read-only | Baseline only |
| Source-to-target row/key comparison | Not run | Not run | Correctly deferred |
| Migration candidates | Undetermined | Undetermined | No migration approved |

## Migration decision

It is **not possible to confirm** that no rows require migration or that the
retired database can be archived. The safe conclusion is **undetermined**, not
zero. No row has been marked safe to discard, and no migration has been
performed.

Before any historical row is migrated or the retired source is archived, an
owner-approved archival package must be supplied and reviewed:

1. A read-only snapshot or export captured outside the application runtime.
2. A cryptographic checksum and capture timestamp for that package.
3. An isolated restore or parser that cannot resolve to `DATABASE_URL`,
   `REPLIT_DB_URL`, or any live application target.
4. Table-level source counts for the retired source.
5. A DEV and PROD reconciliation manifest covering table names, primary-key
   identities, and any source rows absent from the intended Supabase target.
6. A reviewed backup of any migration candidate before a write is authorized.
7. Explicit owner approval for each non-empty migration set; archival should
   remain blocked for unresolved or unmatched rows.

The existing `scripts/db-sync-check.mjs` must not be repurposed for this
work. Any future archival utility should accept only an explicit snapshot path
or isolated read-only connection and should fail closed when that input is
missing or resolves to a live application target.

## Conclusion

The application is protected from accidental Replit/Helium inspection and the
canonical DEV/PROD Supabase targets were validated without mutation. Because
no separately approved retired-database snapshot/export is present, a
table-level retired-source inventory and source-to-Supabase reconciliation
cannot be responsibly produced yet. The retired data therefore remains
**unclassified and not approved for deletion or migration**.
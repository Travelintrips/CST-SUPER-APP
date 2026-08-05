---
name: Shared key-value table secret leak pattern
description: Storing both public CMS content and admin app-secrets in the same generic key-value table risks leaking secrets through any unfiltered "select all" read path.
---

Pattern seen in this project: a single `portal_content` key-value table was used both
for CMS-editable public content (hero_bg, hero_title, ...) *and* for admin-configured
app secrets (Supabase service_role_key, WATI token, OpenAI key, etc. — see
`appSecrets.ts` SECRETS_CATALOG). A generic `getContent()` doing `SELECT * FROM
portal_content` was reused to back the public, unauthenticated `GET
/api/portal/content` endpoint — so it returned every secret ever saved via the admin
Settings page, in plaintext, to any visitor.

**Why:** whenever a table is shared between "safe to expose publicly" and "must never
leave the server" data, any future unfiltered read of that table becomes a live secret
leak, even if the original writer/reader pair was safe. The leak is invisible in normal
testing (loads fine, CMS content just includes some extra JSON keys nobody notices).

**How to apply:** when adding or auditing any public/unauthenticated endpoint that reads
from a shared settings/content KV table, always filter against the authoritative secret
catalog/allowlist rather than trusting "we only ever wrote content there." Prefer
deriving the exclusion set from the single source of truth (e.g. `SECRETS_CATALOG.map(s
=> s.key)`) so it can't drift out of sync as new secrets are added. Apply the same guard
on writes (CMS editors should not be able to clobber a secret key either).

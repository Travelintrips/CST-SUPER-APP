---
name: DO block parameterized query pitfall
description: Drizzle sql`` tag parameterizes every interpolation; PL/pgSQL DO $$ blocks don't accept parameters — use sql.raw() instead.
---

## Rule
Never use the `sql` template tag with interpolated values inside `DO $$ ... $$` PL/pgSQL blocks.

## Why
Drizzle's `sql` template literal turns every `${value}` into a `$1`, `$2` PostgreSQL parameter placeholder. `DO $$` blocks are anonymous PL/pgSQL programs — they have no parameter binding slot, so PostgreSQL throws:
```
bind message supplies 2 parameters, but prepared statement "" requires 0
```

## How to apply
Use `sql.raw(...)` with a plain template string for any migration that executes a `DO $$` block with variable values:

```typescript
// WRONG — Drizzle parameterizes 'vendor_no_response' as $1
await db.execute(sql`
  DO $$
  BEGIN
    IF NOT EXISTS (... AND e.enumlabel = ${v}) THEN
      ALTER TYPE exception_type ADD VALUE ${v};
    END IF;
  END $$;
`);

// CORRECT — sql.raw embeds the value directly
await db.execute(
  sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (... AND e.enumlabel = '${v}') THEN
        ALTER TYPE exception_type ADD VALUE '${v}';
      END IF;
    END $$;
  `)
);
```

Only use `sql.raw()` with trusted/hardcoded enum value strings. Never pass user input to `sql.raw()`.

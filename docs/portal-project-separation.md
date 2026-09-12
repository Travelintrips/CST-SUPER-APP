# Portal Project Separation

## Current safe boundary

BizPortal and Customer Portal are separate frontend packages inside the
workspace:

| Project | Package | Default path | Development port |
|---|---|---:|---:|
| BizPortal | `@workspace/bizportal` | `/bizportal/` | `18442` |
| Customer Portal | `@workspace/customer-portal` | `/` | `23434` |

Each portal has its own `package.json`, Vite configuration, development
startup script, build command, and typecheck command. Both portals communicate
with the shared API server through HTTP. They must not import each other's
source code.

The API server, database, authentication, and Gateway remain shared. This is
intentional: moving either frontend into another project must not duplicate
business rules, database credentials, session handling, or accounting code.

Run the boundary check with:

```bash
pnpm run verify:portals
```

## Moving to two physical Replit projects

The next migration can copy each portal package and the shared libraries it
actually uses into its own repository/project. The new projects should:

1. Keep the same API origin as `VITE_API_BASE_URL`, or use a public API origin
   when the Gateway is no longer the public entry point.
2. Keep `BASE_PATH=/bizportal/` for BizPortal and `BASE_PATH=/` for Customer
   Portal unless routing is intentionally changed.
3. Use only the required public frontend variables in the browser bundle.
   Database URLs, session secrets, GCP bootstrap credentials, and service
   account JSON must stay in the API project.
4. Verify the portal build and typecheck independently before changing
   Gateway routes.
5. Cut over one portal at a time and retain the existing monorepo path as the
   rollback target until the new project serves a verified preview.

This repository therefore provides the extraction boundary without performing
a destructive copy or deleting the working monorepo packages.
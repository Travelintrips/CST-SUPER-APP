---
name: Fresh import symlink fix pattern
description: Steps needed after fresh GitHub import to get all services running — broken pnpm symlinks and missing start-dev.sh
---

# Fresh Import Symlink Fix Pattern

## The rule
After a fresh GitHub import, pnpm symlinks are always broken. The workflow also fails with "No such file or directory" because it runs without a `cwd`, so the shell can't find relative scripts.

**Why:** Replit import does not run `pnpm install` automatically. The `.pnpm` store has the packages but top-level `node_modules/` symlinks don't exist. The Gateway workflow command must use an absolute path (`cd /home/runner/workspace && bash start-dev-all.sh`).

**How to apply:** On any fresh import of this project:
1. Fix workflow command: `cd /home/runner/workspace && bash start-dev-all.sh`
2. Run `pnpm install` root first (gets most symlinks)
3. Run `pnpm install --filter @workspace/api-server` (fixes esbuild)
4. Run `pnpm install --filter @workspace/bizportal` (fixes vite for bizportal)
5. Run `pnpm install --filter @workspace/customer-portal` (fixes vite)
6. Run `pnpm install --filter @workspace/logistic-order`
7. Run `pnpm install --filter @workspace/db`
8. Manually symlink `drizzle-orm` and `drizzle-zod` from `.pnpm` store if still missing
9. Manually symlink `pg` from `.pnpm` store for root-level watchdog service

## Packages that always need manual symlinks
- `node_modules/drizzle-orm` → `.pnpm/drizzle-orm@0.45.2_.../node_modules/drizzle-orm`
- `node_modules/drizzle-zod` → `.pnpm/drizzle-zod@0.8.3_.../node_modules/drizzle-zod`
- `node_modules/pg` → `.pnpm/pg@8.20.0/node_modules/pg`

## Missing file
`artifacts/logistic-order/start-dev.sh` does not exist in the repo — must be created. See the file in the repo now for the canonical content.

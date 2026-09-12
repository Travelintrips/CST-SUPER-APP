---
name: Git repo cleanup procedure
description: How to clean large blobs from git history in this monorepo, and what causes re-bloat.
---

## Rule
Run `git-filter-repo` to strip large paths whenever `.git` exceeds ~200 MB. After rewrite, re-add `origin` remote manually (git-filter-repo removes it as a safety measure).

**Why:** dist/ bundles (~8.7 MB each × many versions), attached_assets/, and .agents/outputs/ accumulate fast. They are already in .gitignore for new commits, but old commits keep the blobs in pack files.

## Paths to strip (run together)
```
git-filter-repo \
  --path artifacts/bizportal/dist --invert-paths \
  --path artifacts/customer-portal/dist --invert-paths \
  --path artifacts/logistic-order/dist --invert-paths \
  --path artifacts/api-server/dist --invert-paths \
  --path attached_assets --invert-paths \
  --path .agents/outputs --invert-paths \
  --path artifacts/customer-portal/public/images/gambar-baru.png --invert-paths \
  --force
```

Then: `git remote add origin https://github.com/Travelintrips/CST-SUPER-APP`

## After rewrite: conflict resolution
git-filter-repo rewrites history, causing Replit's internal subrepl remotes to diverge. Files that appear conflicted:
- `.gitignore`, `.replit`, `artifacts/api-server/src/routes/translations.ts`, `artifacts/customer-portal/src/i18n/translations.ts`, `artifacts/mockup-sandbox/src/.generated/mockup-components.ts`

Resolution: `git checkout --ours <files>` → `git add <files>` → `git commit`

## Gateway workflow name
The workflow was renamed from "Gateway" to "Start application" by the platform. The run command is:
`PORT=5000 API_PORT=18444 BIZPORTAL_PORT=6800 CUSTOMER_PORT=23434 LOGISTIC_ORDER_PORT=19368 node gateway.mjs`

If it fails with "Port 5000 busy", find and kill the old gateway.mjs process:
`ps aux | grep gateway` → `kill -9 <PID>`

## Install git-filter-repo
`python3 -m pip install git-filter-repo`

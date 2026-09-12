---
name: Sandbox background processes & multi-line bash
description: Quirks of running long-lived processes and scripts via the bash tool in this Replit sandbox.
---

**Background processes do NOT survive across separate bash tool calls.** A server started with `&` (even with `setsid ... & disown` or `nohup`) is killed when the bash tool invocation returns. Symptom: start server in call A, then call B hits ECONNREFUSED.
**How to apply:** when you need a one-off server plus a client/test against it, start the server, wait for ready, run the test, and kill the server all inside a SINGLE invocation — ideally a wrapper `.sh` file you call with `bash path/to/run.sh`.

**Raw newlines in a multi-line bash command are unreliable in this tool.** A heredoc-style multi-line `command` may execute only partially (e.g. the redirect/truncate line silently doesn't run). Symptom: a log file you redirected to with `>` still shows stale content, meaning the line never ran.
**How to apply:** chain steps with `;`/`&&` on one line, or put the logic in a `.sh` file and run that. Prefer the script-file approach for anything non-trivial.

**Bash tool timeout is 120s max.** Budget total wall time (server boot + test) under that. Write important output (reports) to a file so partial results survive a SIGTERM (exit code 143) on timeout.

**Running the api-server one-off:** `node artifacts/api-server/build.mjs` produces `dist/index.mjs`; run with `env E2E_TEST_MODE=true PORT=<free> NODE_ENV=development node dist/index.mjs`. It reads DB creds from env (SUPABASE_DATABASE_URL_DEV etc., already present). Dev admin login: `POST /api/dev-login {email:"admcst001@gmail.com"}` sets the internal session cookie that `requireClerkUser`/`requireAdmin` accept (that user has role=admin).

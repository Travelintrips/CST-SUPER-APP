---
name: BizPortal/CustomerPortal 40-second startup wait
description: start-dev.sh waited 40s for a separate artifact workflow whenever BIZPORTAL_PORT or CUSTOMER_PORT env vars were set — fixed to only yield if port is already occupied.
---

## Rule
`artifacts/bizportal/start-dev.sh` and `artifacts/customer-portal/start-dev.sh` had a 40-second loop:
```bash
if [ -n "${BIZPORTAL_PORT+x}" ]; then
  for i in $(seq 1 40); do
    if check_port "${GW_PORT}"; then yield; fi
    sleep 1
  done
fi
```
This was designed for a legacy Replit artifact system where a separate artifact workflow would own the port. With the current setup (`BIZPORTAL_PORT=6800` set globally), the script waited 40s for a process that never came. The gateway exhausted its retries during this wait → BizPortal served 503.

## Fix applied
Changed both scripts to: check-and-yield immediately if port is already occupied; otherwise start right away (no wait).
```bash
if [ -n "${BIZPORTAL_PORT+x}" ]; then
  if check_port "${GW_PORT}"; then
    echo "Port already bound — yielding"
    exec tail -f /dev/null
  fi
fi
```

Also required: set `BIZPORTAL_VITE_PORT=18442` env var so Vite binds on the port the Replit platform expects for the managed artifact workflow health check.

**Why:** The Replit artifacts platform hardcodes `waitForPort: 18442` for the bizportal artifact. With `BIZPORTAL_PORT` set, the script pushed Vite to 18443, making the platform mark the workflow FAILED even though the proxy was running on 6800.

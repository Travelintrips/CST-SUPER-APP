#!/bin/bash
# Replit artifact system injects PORT (e.g. 23434) as health-check port.
# Vite always runs on 3001. Dummy listener satisfies health-check on injected port.
# Port 5000 is owned by proxy5000 — never bind here.

ARTIFACT_PORT=${PORT:-3001}

export PORT=3001
export BASE_PATH=${BASE_PATH:-/}

fuser -k 3001/tcp 2>/dev/null || true

if [ "$ARTIFACT_PORT" != "3001" ] && [ "$ARTIFACT_PORT" != "5000" ]; then
  node -e "require('net').createServer().listen(${ARTIFACT_PORT}, '0.0.0.0')" &
  sleep 0.4
fi

exec vite --config vite.config.ts --host 0.0.0.0

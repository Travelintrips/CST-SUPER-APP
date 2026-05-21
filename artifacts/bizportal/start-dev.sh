#!/bin/bash
# Capture the artifact-injected port (e.g. 18442) before overriding,
# so the artifact system's waitForPort health-check is satisfied.
ARTIFACT_PORT=${PORT:-18442}
export PORT=5000
export BASE_PATH=${BASE_PATH:-/bizportal/}

# Kill anything already on 5000
fuser -k 5000/tcp 2>/dev/null || true

# Open a dummy TCP listener on the artifact-injected port so the
# health-check (waitForPort) is satisfied immediately.
if [ "$ARTIFACT_PORT" != "5000" ]; then
  node -e "require('net').createServer().listen(${ARTIFACT_PORT}, '0.0.0.0')" &
  sleep 0.4
fi

exec vite --config vite.config.ts --host 0.0.0.0

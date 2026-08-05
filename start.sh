#!/bin/bash
# Kill anything on our ports first
fuser -k 5000/tcp 2>/dev/null || true
fuser -k 8080/tcp 2>/dev/null || true
sleep 1

# Start API Server in background
(cd artifacts/api-server && PORT=8080 pnpm run dev) &
API_PID=$!

# Start Customer Portal dev server in foreground (port 5000 = webview preview)
cd artifacts/customer-portal && PORT=5000 BASE_PATH=/ pnpm run dev

# If customer portal exits, kill api server too
kill $API_PID 2>/dev/null

#!/usr/bin/env bash
# Start the customer-portal in POS (kasir) mode on port 3002
# The gateway (port 5000) routes /kasir/* and /menu-board/* here.

set -e

fuser -k 3002/tcp 2>/dev/null || true
sleep 0.2

export PORT=3002
export VITE_POS_MODE=true

exec pnpm --filter @workspace/customer-portal exec vite --config vite.pos.config.ts --host 0.0.0.0 --port 3002

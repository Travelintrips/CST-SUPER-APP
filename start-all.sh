#!/bin/bash
# Gateway only — artifact workflows (API Server, BizPortal, Customer Portal, etc.)
# dijalankan terpisah oleh Replit artifact runner.
node artifacts/api-server/kill-port.mjs 5000 2>/dev/null || true
sleep 0.3
export API_PORT=18444
export BIZPORTAL_PORT=18442
export CUSTOMER_PORT=23434
export LOGISTIC_ORDER_PORT=19368
export PORT=5000
exec node gateway.mjs

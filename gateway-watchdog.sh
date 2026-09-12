#!/bin/bash
# Gateway watchdog — auto-restart if the gateway process crashes or is killed.
# Backs off exponentially (2s, 4s, 8s, max 30s) so rapid crash-loops don't
# spam the system. Resets the backoff counter after a successful 60s uptime.

BACKOFF=2
MAX_BACKOFF=30
STABLE_THRESHOLD=60

while true; do
  echo "[watchdog] Starting Gateway on port ${PORT:-5000}…"
  START_TIME=$(date +%s)

  PORT=${PORT:-5000} API_PORT=${API_PORT:-18444} BIZPORTAL_PORT=${BIZPORTAL_PORT:-6800} CUSTOMER_PORT=${CUSTOMER_PORT:-23434} LOGISTIC_ORDER_PORT=${LOGISTIC_ORDER_PORT:-19368} node gateway.mjs
  EXIT_CODE=$?

  END_TIME=$(date +%s)
  UPTIME=$(( END_TIME - START_TIME ))

  if [ "$UPTIME" -ge "$STABLE_THRESHOLD" ]; then
    # Ran stably for a while — reset backoff
    BACKOFF=2
    echo "[watchdog] Gateway exited after ${UPTIME}s (code: ${EXIT_CODE}), restarting in ${BACKOFF}s…"
  else
    echo "[watchdog] Gateway exited after ${UPTIME}s (code: ${EXIT_CODE}), backing off ${BACKOFF}s…"
  fi

  sleep "$BACKOFF"

  BACKOFF=$(( BACKOFF * 2 ))
  if [ "$BACKOFF" -gt "$MAX_BACKOFF" ]; then
    BACKOFF=$MAX_BACKOFF
  fi
done

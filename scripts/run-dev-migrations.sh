#!/bin/bash
# Run all drizzle SQL migrations against the dev database (SUPABASE_DATABASE_URL_DEV)
# Errors like "relation already exists" are logged but do NOT abort — migrations are
# applied on a best-effort basis (same as drizzle-kit push behaviour).

if [ -z "$SUPABASE_DATABASE_URL_DEV" ]; then
  echo "ERROR: SUPABASE_DATABASE_URL_DEV is not set"
  exit 1
fi

MIGRATION_DIR="lib/db/drizzle"
DB_URL="$SUPABASE_DATABASE_URL_DEV"

echo "=== Running Drizzle SQL migrations against DEV database ==="
echo ""

# Create tracking table
psql "$DB_URL" -q -c "
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    created_at BIGINT NOT NULL
  );
" 2>&1

APPLIED=0
SKIPPED=0
ERRORS=0

for sql_file in $(ls "$MIGRATION_DIR"/*.sql | sort); do
  filename=$(basename "$sql_file")
  hash=$(echo "$filename" | sha256sum | awk '{print $1}')

  # Check if already applied
  already=$(psql "$DB_URL" -t -q -c "SELECT COUNT(*) FROM __drizzle_migrations WHERE hash = '$hash';" 2>/dev/null | tr -d ' \n')

  if [ "$already" = "1" ]; then
    echo "  [SKIP] $filename"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "  [RUN]  $filename ..."

  # Strip --> statement-breakpoint markers and run
  # Use ON_ERROR_STOP=0 so "already exists" errors don't abort the whole file
  OUTPUT=$(sed 's/^--> statement-breakpoint$/;/' "$sql_file" | psql "$DB_URL" -q 2>&1)
  EXIT_CODE=$?

  # Filter out benign "already exists" NOTICE/ERROR lines for display
  REAL_ERRORS=$(echo "$OUTPUT" | grep -i "^ERROR:" | grep -v "already exists" | grep -v "does not exist" || true)

  if [ -n "$REAL_ERRORS" ]; then
    echo "  [WARN] $filename had errors (non-fatal):"
    echo "$REAL_ERRORS" | sed 's/^/         /'
    ERRORS=$((ERRORS + 1))
  fi

  # Mark as applied regardless (idempotent re-run on next boot would skip it)
  psql "$DB_URL" -q -c "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('$hash', EXTRACT(EPOCH FROM NOW())::BIGINT) ON CONFLICT (hash) DO NOTHING;" 2>/dev/null
  echo "  [OK]   $filename"
  APPLIED=$((APPLIED + 1))
done

echo ""
echo "=== Migration run complete: $APPLIED applied, $SKIPPED skipped, $ERRORS with warnings ==="

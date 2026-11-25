#!/usr/bin/env bash
# Dump the live ml-course-v2 schema (structure only) into supabase/schema.sql.
#
# Usage (from the repo root):
#   SUPABASE_DB_PASSWORD='<db password>' bash scripts/dump-schema.sh
#
# The password is read ONLY from the environment — never write it in this
# file, in chat, or in any log. It is the same secret as the backup workflow
# (SUPABASE_DB_PASSWORD); if it is not set yet, set it first (proposal 1).
# Requires a local pg_dump (postgresql-client) — install it first if missing.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found — install postgresql-client first." >&2
  exit 1
fi
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "SUPABASE_DB_PASSWORD is not set — see supabase/README.md." >&2
  exit 1
fi

mkdir -p supabase
# --schema-only: no rows. --no-owner: owner names differ on rebuild.
# --schema=public: Supabase internal schemas (auth/storage/...) stay out.
PGPASSWORD="$SUPABASE_DB_PASSWORD" pg_dump \
  -h aws-0-eu-central-1.pooler.supabase.com -p 5432 \
  -U postgres.awznimzcsmpaadvqwodg -d postgres \
  --schema-only --no-owner --schema=public \
  -f supabase/schema.sql

echo "wrote supabase/schema.sql"
grep -c '^CREATE TABLE' supabase/schema.sql || true

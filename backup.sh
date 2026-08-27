#!/bin/bash
#
# backup.sh — take a full backup of the Betterservice Supabase database.
#
# Writes THREE files into ./backups/, dated:
#   <date>-schema.sql   structure only (tables, functions, policies, triggers)
#   <date>-data.sql     the data only
#   <date>-full.sql     both together — this is the one you restore from
#
# SETUP (once):
#   1. Supabase dashboard -> Project Settings -> Database -> Connection string
#      -> choose "URI", and copy it. It looks like:
#         postgresql://postgres.vdwssiefdhmepdgkuoxd:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
#   2. Put it in your shell profile so it isn't sitting in this file:
#         echo 'export BETTERSERVICE_DB_URL="paste-it-here"' >> ~/.zshrc
#         source ~/.zshrc
#
# RUN:
#   bash backup.sh
#
# Needs pg_dump. If you don't have it:  brew install libpq && brew link --force libpq
#

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$REPO/backups"
STAMP="$(date +%Y-%m-%d-%H%M)"

if [ -z "${BETTERSERVICE_DB_URL:-}" ]; then
  echo "❌ BETTERSERVICE_DB_URL is not set. See the SETUP notes at the top of this file."
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "❌ pg_dump not found. Install it with:  brew install libpq && brew link --force libpq"
  exit 1
fi

mkdir -p "$OUT"

echo "① Dumping schema (structure only)…"
pg_dump "$BETTERSERVICE_DB_URL" --schema=public --schema-only --no-owner --no-privileges \
  > "$OUT/$STAMP-schema.sql"

echo "② Dumping data…"
pg_dump "$BETTERSERVICE_DB_URL" --schema=public --data-only --no-owner --no-privileges \
  > "$OUT/$STAMP-data.sql"

echo "③ Dumping both together (restore from this one)…"
pg_dump "$BETTERSERVICE_DB_URL" --schema=public --no-owner --no-privileges \
  > "$OUT/$STAMP-full.sql"

echo
echo "④ Backing up files (storage buckets + externally-hosted photos)…"
if [ -n "${BETTERSERVICE_SERVICE_KEY:-}" ]; then
  node "$REPO/backup-storage.mjs" || {
    echo "❌ File backup failed. The database dumps above are fine, but your files are NOT backed up."
    exit 1
  }
else
  echo "   ⏭  Skipped — BETTERSERVICE_SERVICE_KEY not set."
  echo "      A database backup does NOT include invoice PDFs or photos."
  echo "      See the SETUP notes in backup-storage.mjs to switch this on."
fi

echo
echo "✅ Done. Written to $OUT:"
ls -lh "$OUT" | grep "$STAMP" | awk '{printf "   %-34s %s\n", $9, $5}'
echo
echo "⚠️  These files contain real customer data — keep them off public folders."
echo "   A backup you have never restored is not a backup. Test one occasionally:"
echo "     createdb bs_restore_test"
echo "     psql bs_restore_test < $OUT/$STAMP-full.sql"
echo "     psql bs_restore_test -c 'select count(*) from customers;'"

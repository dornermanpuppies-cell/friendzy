#!/usr/bin/env bash
# Concatenates all migrations (in order) into one file for the Supabase SQL editor.
set -euo pipefail
cd "$(dirname "$0")/.."
out=supabase/FRIENDZY_ALL_MIGRATIONS.sql
{
  echo "-- ============================================================================"
  echo "-- Friendzy — ALL database migrations in order (regenerate with: npm run db:combine)"
  echo "-- Paste into Supabase SQL Editor (project gwdpsrjmfrgcloacvdlg) and run once."
  echo "-- Idempotent where practical: re-running skips objects that already exist."
  echo "-- Source files: supabase/migrations/*.sql"
  echo "-- ============================================================================"
  echo
  for f in supabase/migrations/*.sql; do
    echo
    echo "-- ########## $(basename "$f") ##########"
    echo
    cat "$f"
    echo
  done
} > "$out"
echo "wrote $out ($(wc -l < "$out") lines)"

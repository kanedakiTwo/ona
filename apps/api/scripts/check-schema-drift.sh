#!/usr/bin/env bash
# Fail when apps/api/src/db/schema.ts has changes that no committed migration
# captures.
#
# Runs `drizzle-kit generate` (which diffs schema.ts against the latest
# snapshot in src/db/migrations/meta/) and expects "No schema changes". If
# drizzle-kit would generate a migration, the script prints it, removes
# exactly the files it generated (restoring _journal.json), and exits 1 — so
# it is safe to run locally without clobbering uncommitted migrations.
#
# No database needed. Used by the CI `test` job.
#
# Scope note: this proves snapshot ↔ schema.ts agreement. It cannot see SQL
# that lives only in hand-written migrations (partial indexes, CHECKs, FKs
# added in 0016/0025/0026 that schema.ts intentionally doesn't declare). CI
# applies the real migrations (`db:migrate`) to a fresh Postgres in the smoke
# and e2e jobs, which is what catches broken migration SQL.

set -euo pipefail

API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$API_DIR/src/db/migrations"
JOURNAL="$MIG_DIR/meta/_journal.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$JOURNAL" "$TMP/journal.json"
(cd "$MIG_DIR" && find . -type f | sort) > "$TMP/before.txt"

cd "$API_DIR"
set +e
# </dev/null: if drizzle-kit wants to ask "renamed or created?" it fails
# instead of hanging — an ambiguous diff is drift too.
if command -v timeout >/dev/null 2>&1; then
  timeout 180 npx drizzle-kit generate --name drift_check </dev/null > "$TMP/out.txt" 2>&1
else
  npx drizzle-kit generate --name drift_check </dev/null > "$TMP/out.txt" 2>&1
fi
status=$?
set -e

(cd "$MIG_DIR" && find . -type f | sort) > "$TMP/after.txt"
new_files="$(comm -13 "$TMP/before.txt" "$TMP/after.txt")"

drift=0
if [ "$status" -ne 0 ]; then
  echo "drizzle-kit generate exited with status $status:"
  drift=1
fi
if [ -n "$new_files" ] || ! cmp -s "$JOURNAL" "$TMP/journal.json"; then
  drift=1
fi
if ! grep -q "No schema changes" "$TMP/out.txt"; then
  drift=1
fi

if [ "$drift" -eq 0 ]; then
  echo "✅ No schema drift: schema.ts matches the latest migration snapshot."
  exit 0
fi

echo "❌ Schema drift: schema.ts has changes not captured by a committed migration."
echo "── drizzle-kit output ──"
tail -40 "$TMP/out.txt"
if [ -n "$new_files" ]; then
  while IFS= read -r f; do
    case "$f" in
      *.sql) echo "── would-be migration ${f#./} ──"; cat "$MIG_DIR/$f" ;;
    esac
    rm -f "$MIG_DIR/$f"
  done <<< "$new_files"
fi
cp "$TMP/journal.json" "$JOURNAL"
echo
echo "Fix: run \`pnpm --filter @ona/api db:generate\` and commit the migration."
exit 1

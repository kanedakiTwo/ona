#!/usr/bin/env bash
# E2E orchestrator (Tier 5). Boots Postgres + the API + the web dev server,
# runs Playwright against them, and tears everything down on exit.
#
# Usage:
#   pnpm --filter @ona/web e2e
# or, from anywhere:
#   ./apps/web/scripts/test-e2e.sh
#
# Requirements: Docker Desktop running. Ports 5433 (db), 8765 (api), 3001 (web)
# must be free. To run a single spec: pass it as an argument
#   ./apps/web/scripts/test-e2e.sh e2e/registration-onboarding.spec.ts

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

API_PORT="8765"
WEB_PORT="3001"
DB_PORT="5433"
COMPOSE="docker compose -f docker-compose.test.yml"

API_PID=""
WEB_PID=""

cleanup() {
  if [ -n "$API_PID" ]; then kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; fi
  if [ -n "$WEB_PID" ]; then kill "$WEB_PID" 2>/dev/null || true; wait "$WEB_PID" 2>/dev/null || true; fi
  $COMPOSE down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "── 1/6 Boot Postgres ────────────────────────────────────────────"
$COMPOSE up -d postgres
for i in $(seq 1 60); do
  status=$($COMPOSE ps --format json postgres 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  if [ "$status" = "healthy" ]; then break; fi
  if [ "$i" = "60" ]; then $COMPOSE logs postgres; exit 1; fi
  sleep 1
done

echo "── 2/6 Push Drizzle schema ─────────────────────────────────────"
export DATABASE_URL="postgresql://postgres:postgres@localhost:${DB_PORT}/onatest"
export JWT_SECRET="e2e-only-do-not-use-anywhere-else"
pnpm --filter @ona/api exec drizzle-kit push --force >/dev/null

echo "── 3/6 Seed minimal catalog ────────────────────────────────────"
# The recipes page needs at least one recipe for the catalog test. The
# regular dev seed is heavy; we use `db:seed` which seeds a sane minimum.
pnpm --filter @ona/api db:seed >/dev/null 2>&1 || echo "  (seed step failed or empty — non-fatal, recipe spec will skip)"

echo "── 4/6 Boot API on :${API_PORT} ─────────────────────────────────"
API_PORT="$API_PORT" pnpm --filter @ona/api exec tsx src/index.ts > /tmp/ona-e2e-api.log 2>&1 &
API_PID=$!
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then echo "  API died:"; tail -30 /tmp/ona-e2e-api.log; exit 1; fi
  sleep 1
done
echo "  API healthy."

echo "── 5/6 Boot Web on :${WEB_PORT} ─────────────────────────────────"
NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}" \
PORT="$WEB_PORT" \
  pnpm --filter @ona/web exec next dev --port "$WEB_PORT" > /tmp/ona-e2e-web.log 2>&1 &
WEB_PID=$!
for i in $(seq 1 90); do
  if curl -fsS "http://localhost:${WEB_PORT}/" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then echo "  Web died:"; tail -30 /tmp/ona-e2e-web.log; exit 1; fi
  sleep 1
done
echo "  Web healthy."

echo "── 6/6 Run Playwright ──────────────────────────────────────────"
WEB_URL="http://localhost:${WEB_PORT}" \
API_URL="http://localhost:${API_PORT}" \
  pnpm --filter @ona/web exec playwright test "$@"

echo
echo "✅ E2E suite passed."

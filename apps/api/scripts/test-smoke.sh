#!/usr/bin/env bash
# Smoke-test orchestrator (Tier 3). Boots Postgres in Docker, pushes the
# Drizzle schema, starts the API in the background, registers a throwaway
# user to mint a JWT, runs every `*.smoke.ts` test, and tears everything
# down on exit (success or failure).
#
# Usage:
#   pnpm --filter @ona/api smoke
# or, from anywhere:
#   ./apps/api/scripts/test-smoke.sh
#
# Requirements: Docker Desktop running, ports 5433 and 8765 free.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

API_PORT="${SMOKE_API_PORT:-8765}"
DB_PORT="5433"
COMPOSE="docker compose -f docker-compose.test.yml"
API_PID=""

cleanup() {
  if [ -n "$API_PID" ]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  $COMPOSE down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "── 1/5 Boot Postgres ────────────────────────────────────────────"
$COMPOSE up -d postgres

echo "── 2/5 Wait for Postgres healthcheck ────────────────────────────"
for i in $(seq 1 60); do
  status=$($COMPOSE ps --format json postgres 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  if [ "$status" = "healthy" ]; then
    echo "  Postgres healthy."
    break
  fi
  if [ "$i" = "60" ]; then
    echo "  Postgres never became healthy."
    $COMPOSE logs postgres
    exit 1
  fi
  sleep 1
done

echo "── 3/5 Push Drizzle schema ─────────────────────────────────────"
export DATABASE_URL="postgresql://postgres:postgres@localhost:${DB_PORT}/onatest"
export JWT_SECRET="smoke-only-do-not-use-anywhere-else"
export API_PORT
pnpm --filter @ona/api exec drizzle-kit push --force >/dev/null

echo "── 4/5 Boot API on :${API_PORT} ─────────────────────────────────"
pnpm --filter @ona/api exec tsx src/index.ts > /tmp/ona-smoke-api.log 2>&1 &
API_PID=$!

for i in $(seq 1 60); do
  if curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    echo "  API responding."
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "  API process died. Last log lines:"
    tail -30 /tmp/ona-smoke-api.log || true
    exit 1
  fi
  sleep 1
done

# Register a throwaway user — the auth-protected smoke tests need a token.
TS=$(date +%s)
SMOKE_USER="smoke_${TS}"
SMOKE_EMAIL="smoke_${TS}@test.local"
SMOKE_PASS="smokepass123"

REG=$(curl -fsS -X POST "http://localhost:${API_PORT}/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${SMOKE_USER}\",\"email\":\"${SMOKE_EMAIL}\",\"password\":\"${SMOKE_PASS}\"}")

SMOKE_USER_TOKEN=$(printf '%s' "$REG" | node -e 'let b=""; process.stdin.on("data",c=>b+=c).on("end",()=>{const j=JSON.parse(b); process.stdout.write(j.token||"")})')
SMOKE_USER_ID=$(printf '%s' "$REG" | node -e 'let b=""; process.stdin.on("data",c=>b+=c).on("end",()=>{const j=JSON.parse(b); process.stdout.write(j.user?.id||"")})')

if [ -z "$SMOKE_USER_TOKEN" ] || [ -z "$SMOKE_USER_ID" ]; then
  echo "  Could not register smoke user. Response: $REG"
  exit 1
fi

echo "  Registered smoke user: $SMOKE_USER ($SMOKE_USER_ID)"

echo "── 5/5 Run smoke vitest suite ───────────────────────────────────"
API_URL="http://localhost:${API_PORT}" \
SMOKE_USER_TOKEN="$SMOKE_USER_TOKEN" \
SMOKE_USER_ID="$SMOKE_USER_ID" \
  pnpm --filter @ona/api exec vitest run --reporter=default 'src/tests/*.smoke.ts'

echo
echo "✅ Smoke suite passed."

#!/usr/bin/env bash
# Pre-compile the routes the Playwright suite visits.
#
# `next dev` compiles each route on first request. On a cold runner that can
# take tens of seconds per route (we've seen 25–48 s for /recipes/[id]), and
# when it happens inside a spec it eats the 30 s test timeout and the spec
# fails for reasons unrelated to the code under test. Requesting every route
# once before Playwright starts moves that cost out of the specs.
#
# Usage: apps/web/scripts/warm-routes.sh <web-base-url>
# Used by .github/workflows/ci.yml (e2e job) and apps/web/scripts/test-e2e.sh.
# Never fails the caller: a route that errors here will fail its spec anyway,
# with a better message.

set -u

BASE="${1:?usage: warm-routes.sh <web-base-url>}"
# Dynamic segments only need *a* value to compile; the pages are client
# components that fetch their data after mount.
UUID="00000000-0000-0000-0000-000000000000"

ROUTES=(
  /
  /login
  /register
  /onboarding
  /menu
  /shopping
  /recipes
  /recipes/new
  "/recipes/${UUID}"
  "/recipes/${UUID}/edit"
  /profile
  /profile/casa
  /whatsapp/conectar
)

for route in "${ROUTES[@]}"; do
  start=$(date +%s)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 180 "${BASE}${route}" || echo "000")
  echo "  warm ${route} -> ${code} ($(( $(date +%s) - start ))s)"
done

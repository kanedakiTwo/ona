#!/usr/bin/env bash
# Smoke checks against a deployed Mimoia (staging or production).
#
#   scripts/smoke-remote.sh <api_url> <web_url> [--deep]
#
# Always: /health answers (with retries for a cold start), the auth gate is
# live, the public catalogue serves, /login rejects bogus credentials, and the
# web landing + login pages render.
#
# --deep (staging only — refused against production): registers a throwaway
# user, generates this week's menu and reads the shopping list, so a broken
# migration or matcher shows up before production does.
#
# Used by CI (post-deploy-smoke) and by the nightly Taller (docs/deploy.md).

set -u

API_URL="${1:?usage: smoke-remote.sh <api_url> <web_url> [--deep]}"
WEB_URL="${2:?usage: smoke-remote.sh <api_url> <web_url> [--deep]}"
DEEP=0
[ "${3:-}" = "--deep" ] && DEEP=1

fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" || echo 000; }

for i in $(seq 1 6); do
  c=$(code "$API_URL/health")
  [ "$c" = "200" ] && break
  echo "[try $i] API /health → $c"
  [ "$i" = "6" ] && fail "API /health never returned 200"
  sleep 10
done
ok "API /health"

c=$(code "$API_URL/user/smoke-probe"); [ "$c" = "401" ] || fail "expected 401 from /user/:id, got $c"
ok "auth gate (401 without token)"

c=$(code "$API_URL/recipes?perPage=1"); [ "$c" = "200" ] || fail "expected 200 from /recipes, got $c"
ok "public catalogue"

c=$(code -X POST "$API_URL/login" -H 'Content-Type: application/json' -d '{"username":"smoke-bogus","password":"smoke-bogus"}')
[ "$c" = "401" ] || [ "$c" = "400" ] || fail "expected 401/400 from /login, got $c"
ok "login route"

for path in / /login; do
  c=$(code "$WEB_URL$path"); [ "$c" = "200" ] || fail "expected 200 from web $path, got $c"
  ok "web $path"
done

[ "$DEEP" = "1" ] || exit 0

case "$API_URL" in
  *production*|*mimoia.com*) fail "--deep writes data: refused against production ($API_URL)" ;;
esac

stamp="$(date +%s)$RANDOM"
reg=$(curl -s --max-time 30 -X POST "$API_URL/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"smoke$stamp\",\"email\":\"smoke$stamp@example.com\",\"password\":\"smoke-$stamp\",\"ageConfirmed\":true}")
token=$(printf '%s' "$reg" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{}})')
user_id=$(printf '%s' "$reg" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).user.id||"")}catch{}})')
[ -n "$token" ] && [ -n "$user_id" ] || fail "register did not return a token and user id: ${reg:0:200}"
ok "register"

week=$(node -e 'const d=new Date();d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));process.stdout.write(d.toISOString().slice(0,10))')
c=$(code -X POST "$API_URL/menu/generate" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$user_id\",\"weekStart\":\"$week\"}")
[ "$c" = "200" ] || [ "$c" = "201" ] || fail "expected 200/201 from /menu/generate, got $c"
ok "menu generated ($week)"

c=$(code "$API_URL/shopping-list" -H "Authorization: Bearer $token")
[ "$c" = "200" ] || fail "expected 200 from /shopping-list, got $c"
ok "shopping list"

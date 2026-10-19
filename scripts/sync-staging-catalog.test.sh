#!/usr/bin/env bash
# PRO-206: reproduces «ingredient names in staging with a different id than
# production» on two LOCAL databases and checks that sync-staging-catalog.sh
# moves staging's references to production's id, drops the duplicate and ends
# with 0 (and that --no-remap still refuses). Never touches Railway.
#
#   ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
#     scripts/sync-staging-catalog.test.sh
#
# Needs psql, createdb/dropdb and the repo's pnpm workspace (migrations and
# the catalogue seed run against the throwaway "production" database).
set -euo pipefail
ADMIN="${ADMIN_DATABASE_URL:?set ADMIN_DATABASE_URL to a local Postgres (never staging or production)}"
case "$ADMIN" in *localhost*|*127.0.0.1*) ;; *) echo "refusing: ADMIN_DATABASE_URL must be local" >&2; exit 2 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
SUFFIX="$$"
PROD_DB="sync_test_prod_$SUFFIX"
STG_DB="sync_test_staging_$SUFFIX"
base="${ADMIN%/*}"
PROD_URL="$base/$PROD_DB"
STG_URL="$base/$STG_DB"
q() { psql "$ADMIN" -v ON_ERROR_STOP=1 -qAt -c "$1"; }
cleanup() { q "drop database if exists $PROD_DB" || true; q "drop database if exists $STG_DB" || true; }
trap cleanup EXIT
fail() { echo "✗ $*" >&2; exit 1; }

q "create database $PROD_DB"
(cd "$HERE/.." && DATABASE_URL="$PROD_URL" pnpm --filter @ona/api db:migrate >/dev/null && DATABASE_URL="$PROD_URL" pnpm --filter @ona/api db:seed >/dev/null 2>&1)
# Staging starts as the same catalogue.
q "create database $STG_DB template $PROD_DB"

P() { psql "$PROD_URL" -v ON_ERROR_STOP=1 -qAt -c "$1"; }
S() { psql "$STG_URL" -v ON_ERROR_STOP=1 -qAt -c "$1"; }

# Production publishes «miso» and «guanciale»; a test household in staging
# had already created both, with other ids, and uses them.
PROD_MISO=11111111-1111-1111-1111-111111111111
STG_MISO=22222222-2222-2222-2222-222222222222
PROD_GUAN=33333333-3333-3333-3333-333333333333
STG_GUAN=44444444-4444-4444-4444-444444444444
P "insert into ingredients (id, name, calories) values ('$PROD_MISO', 'miso', 199), ('$PROD_GUAN', 'guanciale', 655)"
CAT_RECIPE="$(P "select id from recipes where author_id is null order by id limit 1")"
P "insert into recipe_ingredients (recipe_id, ingredient_id, quantity, unit) values ('$CAT_RECIPE', '$PROD_MISO', 20, 'g')"
S "insert into ingredients (id, name, calories) values ('$STG_MISO', 'miso', 150), ('$STG_GUAN', 'guanciale', 600), (gen_random_uuid(), 'solo en staging', 10)"
S "insert into users (id, username, email, password_hash) values ('55555555-5555-5555-5555-555555555555', 'prueba', 'prueba@example.com', 'x')"
S "insert into households (id, owner_id) values ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555')"
S "insert into recipes (id, name, servings, author_id) values ('77777777-7777-7777-7777-777777777777', 'Carbonara de la familia', 2, '55555555-5555-5555-5555-555555555555')"
S "insert into recipe_ingredients (recipe_id, ingredient_id, quantity, unit) values ('77777777-7777-7777-7777-777777777777', '$STG_GUAN', 100, 'g'), ('77777777-7777-7777-7777-777777777777', '$STG_MISO', 10, 'g')"
S "insert into pantry_items (household_id, ingredient_id, name, quantity, unit) values ('66666666-6666-6666-6666-666666666666', '$STG_MISO', 'miso', 1, 'u')"
S "insert into shopping_lists (user_id, items, item_state) values ('55555555-5555-5555-5555-555555555555', '[{\"id\":\"menu:$STG_GUAN:g\",\"ingredientId\":\"$STG_GUAN\",\"name\":\"guanciale\",\"quantity\":100,\"unit\":\"g\"}]', '{\"$STG_GUAN|g\":{\"checked\":true,\"inStock\":false,\"pricePerUnit\":null}}')"

export PROD_DATABASE_URL="$PROD_URL" STAGING_DATABASE_URL="$STG_URL"

# --no-remap: refuses, as before PRO-206.
if "$HERE/sync-staging-catalog.sh" --no-remap >/dev/null 2>"$HERE/../.sync-test.err"; then fail "--no-remap should refuse"; fi
grep -q "different id than production" "$HERE/../.sync-test.err" || fail "--no-remap: unexpected error: $(cat "$HERE/../.sync-test.err")"
rm -f "$HERE/../.sync-test.err"

# --dry-run: lists the two, writes nothing.
dry="$("$HERE/sync-staging-catalog.sh" --dry-run)"
echo "$dry" | grep -q "= guanciale (1 recipe line(s), 0 pantry row(s))" || fail "dry run doesn't list guanciale: $dry"
echo "$dry" | grep -q "= miso (1 recipe line(s), 1 pantry row(s))" || fail "dry run doesn't list miso: $dry"
[ "$(S "select count(*) from ingredients where id in ('$STG_MISO','$STG_GUAN')")" = 2 ] || fail "dry run wrote"

# The real run: exit 0, same catalogue, references on production's ids.
"$HERE/sync-staging-catalog.sh" >/dev/null || fail "sync exited with $?"
[ "$(S "select count(*) from ingredients where id in ('$STG_MISO','$STG_GUAN')")" = 0 ] || fail "duplicates still in staging"
[ "$(S "select string_agg(ingredient_id::text, ',' order by quantity) from recipe_ingredients where recipe_id = '77777777-7777-7777-7777-777777777777'")" = "$PROD_MISO,$PROD_GUAN" ] || fail "test household's recipe not remapped"
[ "$(S "select ingredient_id from pantry_items")" = "$PROD_MISO" ] || fail "pantry not remapped"
S "select items::text || item_state::text from shopping_lists" | grep -q "$STG_GUAN" && fail "shopping list still has the old id"
[ "$(S "select count(*) from ingredients where name = 'solo en staging'")" = 1 ] || fail "a staging-only ingredient was removed"
[ "$(S "select calories from ingredients where name = 'miso'")" = 199 ] || fail "miso doesn't have production's values"
# A second run has nothing to do.
"$HERE/sync-staging-catalog.sh" | grep -q "nothing to do" || fail "second run should have nothing to do"
echo "✓ sync-staging-catalog: duplicates remapped, exit 0, catalogue equal to production"

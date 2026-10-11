#!/usr/bin/env bash
# Copy the Mimoia recipe catalogue from production to staging, so staging
# (and the "hogares de prueba" that test it every evening) sees the same
# recipes, photos, ingredients and steps as real users.
#
#   scripts/sync-staging-catalog.sh             # compare, then copy
#   scripts/sync-staging-catalog.sh --dry-run   # compare only, change nothing
#
# What is copied: the `ingredients` table, the catalogue recipes (author_id
# IS NULL), their `recipe_ingredients` and `recipe_steps`. Catalogue recipes
# that no longer exist in production are removed from staging.
# Never copied: users, households, user recipes (author_id set) or anything
# else that belongs to a person.
#
# Production is only read, inside a read-only transaction. Staging is written
# in one transaction (all or nothing). Refuses to run if both databases are
# not on the same migrations, or if an ingredient name exists in staging with
# a different id (a user-created ingredient would be clobbered).
#
# Database URLs come from Railway (service `Postgres`, DATABASE_PUBLIC_URL of
# each environment; needs a directory linked to the `ona-app` project) unless
# PROD_DATABASE_URL / STAGING_DATABASE_URL are set. They are never printed.
# Run it after a production deploy that touches recipes and after editing the
# catalogue in production (docs/deploy.md → Staging).

set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg (see --help)" >&2; exit 2 ;;
  esac
done

die() { echo "✋ sync refused: $*" >&2; exit 1; }
command -v psql >/dev/null || die "psql is not installed"

TOKEN_FILE="${MIMOIA_RAILWAY_TOKEN_FILE:-$HOME/.config/mimoia/railway-token}"
if [ -z "${RAILWAY_TOKEN:-}" ] && [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -r "$TOKEN_FILE" ]; then
  RAILWAY_API_TOKEN="$(cat "$TOKEN_FILE")"
  export RAILWAY_API_TOKEN
fi

# DATABASE_PUBLIC_URL of an environment, without echoing it (the Railway CLI
# may print the JSON on stderr, so both streams are parsed and discarded).
db_url() {
  railway variables --service Postgres --environment "$1" --json 2>&1 \
    | python3 -c 'import json,sys; t=sys.stdin.read(); print(json.loads(t[t.index("{"):]).get("DATABASE_PUBLIC_URL",""))' 2>/dev/null
}
PROD_URL="${PROD_DATABASE_URL:-$(db_url production)}"
STAGING_URL="${STAGING_DATABASE_URL:-$(db_url staging)}"
[ -n "$PROD_URL" ] || die "no production database URL (link a directory to ona-app: railway link --project ona-app)"
[ -n "$STAGING_URL" ] || die "no staging database URL"
[ "$PROD_URL" != "$STAGING_URL" ] || die "production and staging URLs are the same"

prod() { PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_URL" -v ON_ERROR_STOP=1 -qAt "$@"; }
staging() { psql "$STAGING_URL" -v ON_ERROR_STOP=1 -qAt "$@"; }

# 1) Same schema on both sides.
mig() { "$1" -c "select md5(string_agg(hash, ',' order by id)) from drizzle.__drizzle_migrations"; }
[ "$(mig prod)" = "$(mig staging)" ] || die "production and staging are on different migrations — deploy the same commit to both first"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Column lists come from staging, so the copy never depends on column order.
cols() { staging -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='$1'"; }
ING_COLS="$(cols ingredients)"
REC_COLS="$(cols recipes)"
RI_COLS="$(cols recipe_ingredients)"
ST_COLS="$(cols recipe_steps)"
# "a,b" → "t.a,t.b"
prefix() { echo "$2" | tr ',' '\n' | sed "s/^/$1./" | paste -sd, -; }

# 2) Read production (read-only).
prod -c "\copy (select $ING_COLS from ingredients) to '$WORK/ingredients.csv' csv"
prod -c "\copy (select $REC_COLS from recipes where author_id is null) to '$WORK/recipes.csv' csv"
prod -c "\copy (select $(prefix ri "$RI_COLS") from recipe_ingredients ri join recipes r on r.id = ri.recipe_id where r.author_id is null) to '$WORK/recipe_ingredients.csv' csv"
prod -c "\copy (select $(prefix s "$ST_COLS") from recipe_steps s join recipes r on r.id = s.recipe_id where r.author_id is null) to '$WORK/recipe_steps.csv' csv"

# 3) Compare (row content, ignoring timestamps).
fingerprint() {
  "$1" -c "select
    (select count(*) from recipes where author_id is null),
    (select md5(coalesce(string_agg((to_jsonb(r) - 'created_at' - 'updated_at')::text, '' order by id), '')) from recipes r where author_id is null),
    (select md5(coalesce(string_agg((to_jsonb(i) - 'created_at' - 'updated_at')::text, '' order by id), '')) from ingredients i),
    (select md5(coalesce(string_agg(to_jsonb(ri)::text, '' order by ri.id), '')) from recipe_ingredients ri join recipes r on r.id = ri.recipe_id where r.author_id is null),
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '' order by s.id), '')) from recipe_steps s join recipes r on r.id = s.recipe_id where r.author_id is null)"
}
before="$(fingerprint staging)"
target="$(fingerprint prod)"
echo "production: $(wc -l < "$WORK/recipes.csv" | tr -d ' ') catalogue recipes, $(wc -l < "$WORK/ingredients.csv" | tr -d ' ') ingredients"
if [ "$before" = "$target" ]; then
  echo "✓ staging already has the production catalogue — nothing to do."
  exit 0
fi

# Which recipes differ, by name (only the catalogue, so nothing personal).
staging -c "create temp table p_recipes as select $REC_COLS from recipes limit 0" \
  -c "\copy p_recipes from '$WORK/recipes.csv' csv" \
  -c "select '  ~ ' || p.name || coalesce(' (' || (select string_agg(k, ', ') from jsonb_each(to_jsonb(p) - 'created_at' - 'updated_at') e(k, v) where v is distinct from (to_jsonb(s) -> k)) || ')', '')
        from p_recipes p join recipes s on s.id = p.id
       where (to_jsonb(p) - 'created_at' - 'updated_at') <> (to_jsonb(s) - 'created_at' - 'updated_at')
      union all select '  + ' || p.name from p_recipes p where not exists (select 1 from recipes s where s.id = p.id)
      union all select '  - ' || s.name from recipes s where s.author_id is null and not exists (select 1 from p_recipes p where p.id = s.id)" \
  | head -60

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: staging differs from production (above). Nothing written."
  exit 0
fi

# 4) Write staging, all or nothing.
set_list() { echo "$1" | tr ',' '\n' | grep -v '^id$' | sed 's/.*/& = excluded.&/' | paste -sd, -; }
staging <<SQL
begin;
create temp table p_ingredients as select $ING_COLS from ingredients limit 0;
\copy p_ingredients from '$WORK/ingredients.csv' csv
create temp table p_recipes as select $REC_COLS from recipes limit 0;
\copy p_recipes from '$WORK/recipes.csv' csv
create temp table p_ri as select $RI_COLS from recipe_ingredients limit 0;
\copy p_ri from '$WORK/recipe_ingredients.csv' csv
create temp table p_steps as select $ST_COLS from recipe_steps limit 0;
\copy p_steps from '$WORK/recipe_steps.csv' csv

do \$\$
declare clash text;
begin
  select string_agg(s.name, ', ') into clash
    from ingredients s join p_ingredients p on p.name = s.name and p.id <> s.id;
  if clash is not null then
    raise exception 'ingredient names in staging with a different id than production: % (resolve by hand)', clash;
  end if;
end \$\$;

insert into ingredients ($ING_COLS) select $ING_COLS from p_ingredients
  on conflict (id) do update set $(set_list "$ING_COLS");

-- Catalogue recipes gone from production leave staging too (their children cascade).
delete from recipes where author_id is null and id not in (select id from p_recipes);
insert into recipes ($REC_COLS) select $REC_COLS from p_recipes
  on conflict (id) do update set $(set_list "$REC_COLS");

delete from recipe_ingredients where recipe_id in (select id from p_recipes);
insert into recipe_ingredients ($RI_COLS) select $RI_COLS from p_ri;
delete from recipe_steps where recipe_id in (select id from p_recipes);
insert into recipe_steps ($ST_COLS) select $ST_COLS from p_steps;
commit;
SQL

after="$(fingerprint staging)"
[ "$after" = "$target" ] || die "copied, but staging still differs from production — check by hand"
echo "✓ staging now has the production catalogue."

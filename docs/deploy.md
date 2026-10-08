# Deploy

ONA runs on Railway in two services + a Postgres:

- `ona-api` — Express API (`apps/api/`)
- `ona-web` — Next.js frontend (`apps/web/`, prod build via `next build`)
- `Postgres` — managed Postgres

Custom domain (since 2026-10-07): `mimoia.com` and `www.mimoia.com` → `ona-web` (port 3000), DNS at Namecheap (ALIAS `@` + CNAME `www` to the `*.up.railway.app` targets Railway gave, plus two `_railway-verify` TXT; MX records are Namecheap email forwarding for `hola@`). `www.mimoia.com` 308-redirects to the apex (`redirects()` in `apps/web/next.config.ts`, pinned by `e2e/canonical-host.spec.ts`). `ona-web-production.up.railway.app` still serves too; `ona-api` keeps its Railway URL. `WEB_PUBLIC_URL` on `ona-api` = `https://mimoia.com`.

There is **no GitHub-Railway repo connection**. Deploys are manual via the Railway CLI from your local machine. Both services are configured with **Railpack** (Railway's new builder); legacy `NIXPACKS_*` vars are no longer respected. Railpack takes the Node version from the root `package.json` `engines.node` (**22.x**; CI uses the same). `apps/*/Dockerfile` are not used by Railway (kept for local container experiments).

## One-time setup per machine

**Account (since 2026-10-08):** the `ona-app` project lives in Miguel's **personal** Railway workspace, «Miguel's Projects» (Hobby, `mmartinlacoma@gmail.com`). It was transferred from the AiKit company workspace, which no longer has access. On Miguel's laptop the CLI's own login is the AiKit company account (used for other projects), so don't `railway logout`. Run every Mimoia command with Miguel's personal account token in the environment instead; it overrides the login for that command only:

```bash
export RAILWAY_API_TOKEN="$(cat ~/.config/mimoia/railway-token)"   # personal account token, chmod 600, never in a repo
railway whoami                             # → Miguel (mmartinlacoma@gmail.com)
```

On a machine without another Railway account:

```bash
brew install railwayapp/railway/railway   # or `npm i -g @railway/cli`
railway login                              # opens browser, paste-back code
railway link                               # pick `ona-app` project
```

The Taller's project tokens (`taller-staging`, `taller-production`) belong to the project and survived the transfer.

## Deploy flow

**Use the guarded wrapper** from a checkout of `master`:

```bash
scripts/deploy.sh             # api, then web
scripts/deploy.sh api         # or just one service (api | web | all)
scripts/deploy.sh --dry-run   # run the checks + print the plan, deploy nothing
```

`railway up` uploads the local working directory as-is, so without a guard prod can end up running code that exists in no commit. The wrapper refuses to deploy unless:

1. the working tree is clean — no staged, unstaged **or untracked** files (they would be uploaded too);
2. `HEAD` equals `origin/master` after a fresh `git fetch` — i.e. the commit is pushed. If `HEAD` is *behind* `origin/master` it refuses as well, unless you pass `--allow-behind` for an intentional rollback.

It then prints the commit SHA + subject being deployed and runs the manual commands below (api first, then web). Prod therefore always maps to a pushed commit on `master`.

> **Gotcha:** `railway up` uploads the *linked project directory*, not the current directory. The clean checkout must live **outside** `/Users/alio/ona` (e.g. a scratchpad `git worktree add --detach <dir> origin/master`) and be linked there with `railway link --project ona-app --environment production`. Running the wrapper from a worktree *inside* the repo (`.claude/worktrees/…`) shipped the shared main tree instead of the commit (2026-10-08). After deploying, check the change is really live (a new string in the web chunk, the migration row in `drizzle.__drizzle_migrations`).

### Underlying manual commands

The wrapper is a thin guard around these; run them directly only when you know why the guard doesn't fit (e.g. an emergency hotfix from a dirty tree — and then commit + push it right after):

```bash
# 1) deploy api
railway up --service ona-api --detach

# 2) deploy web (do this AFTER api so the new endpoints exist when the new
#    UI tries to call them)
railway up --service ona-web --detach

# 3) sanity checks
curl -sf https://ona-api-production.up.railway.app/health        # → {"ok":true,…}
# /recipes/new renders a loading shell until client-side auth resolves, so
# check the route's JS chunk instead of the HTML:
B=https://ona-web-production.up.railway.app
for s in $(curl -s $B/recipes/new | grep -o '/_next/static/chunks/app/recipes/new/[^"]*\.js' | sort -u); do
  curl -s "$B$s" | grep -c "Importar desde URL"                   # → 1
done
# WhatsApp webhook handshake (needs WHATSAPP_VERIFY_TOKEN on ona-api):
curl -s "https://ona-api-production.up.railway.app/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$WHATSAPP_VERIFY_TOKEN&hub.challenge=ok"  # → ok
```

The API runs `pnpm --filter @ona/api db:migrate` on boot (set in `RAILPACK_START_CMD`), so committed Drizzle migrations apply automatically on the next deploy. Each deploy takes 2–4 minutes.

## Staging

Since 2026-10-08 the `ona-app` project has a second Railway environment, **`staging`**, duplicated from production: its own `ona-api`, `ona-web` and Postgres, at https://ona-api-staging.up.railway.app and https://ona-web-staging.up.railway.app. Differences from production:

- its own `JWT_SECRET` and `METRICS_READ_TOKEN`; WhatsApp is off (no access token, app secret, phone id or verify token), so it never messages anyone;
- `WEB_PUBLIC_URL` / `IMAGE_PUBLIC_URL_BASE` / `NEXT_PUBLIC_API_URL` point at the staging URLs;
- low spend caps (`USER_MONTHLY_SPEND_CAP_EUR=2`, `ADVISOR_MONTHLY_BUDGET_EUR=2`, `REALTIME_DAILY_MINUTES_PER_USER=5`);
- data: a copy of production's **catalogue only** (all `ingredients` + system recipes with `author_id IS NULL` and their `recipe_ingredients`/`recipe_steps`; 198 ingredients and 78 recipes on 2026-10-08, after 22 of Miguel's recipes moved to the catalogue), plus the throwaway `smoke…@example.com` users the deep smoke creates. Never copy user data (users, households, menus, personal recipes) here. To refresh the catalogue: `\copy` those four queries out of production and into staging after `truncate recipes, ingredients cascade` on **staging**.

Deploy to staging the same way, from a clean checkout of `master` linked to `staging` (or with the staging project token in `RAILWAY_TOKEN`), then run the deep smoke:

```bash
scripts/deploy.sh --wait                                  # linked to staging
scripts/smoke-remote.sh https://ona-api-staging.up.railway.app https://ona-web-staging.up.railway.app --deep
```

`--wait` waits for each new deployment to report `SUCCESS` (exit 1 on `FAILED`/`CRASHED` or after 15 min). `smoke-remote.sh` runs the production smoke checks; `--deep` also registers a user, generates the week's menu and reads the shopping list, and refuses to run against production.

**Nightly Taller (ONA HQ, D-018).** The routine "Mimoia HQ · Taller" (00:00 Madrid) merges the backlog tasks Miguel marked `lista` and deploys them: staging → deep smoke → production → smoke, rolling production back to the previous commit (`scripts/deploy.sh --allow-behind`) and reverting the merge if the production smoke fails. It uses two Railway project tokens (`taller-staging`, `taller-production`, one per environment), held only in the Taller's cloud environment. The protocol lives in `kanedakiTwo/ona-hq` → `loops/taller.md`.

## Required env vars

Both are configured in the Railway dashboard, not committed.

`ona-api` (only the non-obvious ones; the rest are documented in `.env.example`):

| Var | Notes |
|---|---|
| `RAILPACK_BUILD_CMD` | `pnpm install && pnpm --filter @ona/shared build && pnpm --filter @ona/api build` |
| `RAILPACK_START_CMD` | `pnpm --filter @ona/api db:migrate && pnpm --filter @ona/api menus:migrate-dishes && node apps/api/dist/index.js` |
| `DATABASE_URL` | Auto-injected via Railway service link to `Postgres` (uses internal hostname) |
| `JWT_SECRET` | Production secret, **≥ 32 chars** or the API refuses to boot (`openssl rand -base64 48`). Rotating it logs every user out once. |
| `ANTHROPIC_API_KEY` | For photo + URL recipe extraction |
| `OPENAI_API_KEY` | For Realtime voice mode |
| `USDA_FDC_API_KEY` | For ingredient auto-create |
| `METRICS_READ_TOKEN` | Read-only token for `GET /admin/metrics`, `GET /admin/errors` and `GET /admin/waitlist` (header `x-metrics-token`) used by the ONA HQ agents; unset = token access off. See `specs/metrics.md`, `specs/errors.md`, `specs/waitlist.md` |
| `COST_PRICE_OVERRIDES` | Optional JSON over the cost-ledger price table, e.g. `{"openai/gpt-realtime":{"perMinute":0.15}}` |

`ona-web`:

| Var | Notes |
|---|---|
| `RAILPACK_BUILD_CMD` | `pnpm install && pnpm --filter @ona/shared build && pnpm --filter @ona/web build` |
| `RAILPACK_START_CMD` | `node apps/web/.next/standalone/apps/web/server.js` |
| `NEXT_PUBLIC_API_URL` | `https://ona-api-production.up.railway.app` (no trailing slash) |
| `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` | From <https://console.picovoice.ai>; required for the "Hola Ona" wake word |
| `NEXT_PUBLIC_ERROR_REPORTING` | Optional. `false` switches the browser error reporter off (it is on in production builds by default); `true` turns it on under `next dev`. See `specs/errors.md` |
| `NEXT_PUBLIC_RELEASE` | Optional build label sent with client error reports. Unset → `RAILWAY_GIT_COMMIT_SHA` or `RAILWAY_DEPLOYMENT_ID` if Railway exposes them at build time, else none |
| `PORT` | `3000` |

## Schema migrations

Drizzle migrations live in `apps/api/src/db/migrations/`. Generate them with:

```bash
pnpm --filter @ona/api db:generate    # after editing apps/api/src/db/schema.ts
```

Apply them locally with:

```bash
pnpm --filter @ona/api db:migrate
```

CI applies the same migrations (`db:migrate`) to a fresh Postgres in the smoke and e2e jobs, and the `test` job runs `apps/api/scripts/check-schema-drift.sh`, which fails if `schema.ts` has changes no committed migration captures (`drizzle-kit generate` must say "No schema changes"). If it fails, run `db:generate` and commit the migration.

**Never run `drizzle-kit push` against a migrated database (prod or dev).** Some objects exist only in hand-written migration SQL because drizzle can't express them, and `push` would drop them: the partial unique index `uq_pantry_items_household_ingredient` (0016, relied on by the pantry upsert), the FK + partial index on `recipes.copied_from_recipe_id` (0025) and the `recipes_frequency_check` CHECK (0026). `push` also reports false-positive diffs for array defaults and the expression index `idx_unit_cache_key`.

In production, `db:migrate` runs automatically on every deploy as part of `RAILPACK_START_CMD`. If you ever need to run it manually:

```bash
DATABASE_URL=$(railway variables --service Postgres --kv | grep ^DATABASE_PUBLIC_URL= | cut -d= -f2-) \
  pnpm --filter @ona/api db:migrate
```

The `DATABASE_URL` injected into `ona-api` uses the internal hostname (`postgres.railway.internal`) which only resolves inside Railway's network. To run psql/migrate from your laptop you need the **public URL** instead:

```bash
railway variables --service Postgres --kv | grep ^DATABASE_PUBLIC_URL=
# → postgresql://…@interchange.proxy.rlwy.net:26066/railway
```

## Recipe seed

The seed (`apps/api/src/seed/index.ts`) inserts ingredients (idempotent via `onConflictDoNothing`) and the system recipe catalog. **It is intentionally NOT in `RAILPACK_START_CMD`** because for any system recipe whose `name` matches an existing row, the seed wipes its `recipe_ingredients` and `recipe_steps` and re-inserts them — overriding any local edits curators may have made on `/curator`.

Run it manually only when you've meaningfully changed `apps/api/src/seed/recipes.ts` or `apps/api/src/seed/ingredients.ts`:

```bash
DATABASE_URL=… pnpm --filter @ona/api db:seed
```

User-created recipes (`recipes.author_id IS NOT NULL`) and user-owned data (`users`, `user_favorites`, `menus`, `shopping_lists`) are never touched by the seed.

## Troubleshooting

### "No start command detected"
You're hitting Railway's old Nixpacks builder without Railpack vars. Check that both `RAILPACK_BUILD_CMD` and `RAILPACK_START_CMD` are set on the service (not just the legacy `NIXPACKS_*`).

### Build succeeds but old code keeps serving
- Check that the latest deploy actually finished (Railway dashboard → service → Deployments).
- `railway logs --build --service <name>` shows the most recent build.
- Hit `/health` directly (bypasses the CDN) to see live state.
- The Fastly edge in front of Railway can cache responses with long TTLs; a fresh deploy invalidates that cache automatically, but client-side service workers (`apps/web/public/sw.js`, generated by `next-pwa` during build) can serve stale chunks. Tell users to hard-refresh + DevTools → Application → Clear site data.

### Migration fails on production with `column "X" contains null values`
A `NOT NULL` column was added without a `DEFAULT`, and prod has rows that predate that column. Fix forward by editing the migration to use `ADD COLUMN X TYPE NOT NULL DEFAULT <value>` then `ALTER COLUMN X DROP DEFAULT`, OR backfill manually with `psql` against `DATABASE_PUBLIC_URL` before re-running migrate. **Never `DROP TABLE` — `users`, `menus`, and `shopping_lists` all reference `recipes.id` and you'll lose user data.**

If the prod DB is many migrations behind and a backfill is too risky to inline into the migrations folder (because dev DBs don't need it), you can hand-apply equivalent SQL inside a transaction and then mark the migrations as applied:

```sql
BEGIN;
-- run the migration SQL with backfill-aware ALTERs
-- e.g. ALTER TABLE recipes ADD COLUMN servings integer DEFAULT 4 NOT NULL;
--      ALTER TABLE recipes ALTER COLUMN servings DROP DEFAULT;

-- then record the migration as applied so drizzle skips it next deploy.
-- Hash is sha256 of the .sql file content, created_at is the `when`
-- field from apps/api/src/db/migrations/meta/_journal.json.
INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES
  ('<sha256-of-0001.sql>', <when-from-journal>);
COMMIT;
```

You can verify the hash with `shasum -a 256 apps/api/src/db/migrations/0000_smart_jamie_braddock.sql` — drizzle uses sha256 of the raw file bytes.

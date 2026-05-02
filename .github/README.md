# CI / CD

Two pieces wire ONA's pre-merge gate and post-deploy verification.

## 1. The workflow — `.github/workflows/ci.yml`

One file, four jobs (chained with `needs:`):

| Job | Trigger | What it does |
|---|---|---|
| `test` | every PR + push to master | Type-checks API + Web, runs the full Vitest unit suite (~260 tests, 3 s) |
| `smoke` | every PR + push to master, after `test` | Boots a Postgres 15 service container, pushes the Drizzle schema, starts the API in the background, registers a throwaway user, then runs every `*.smoke.ts` file with the resulting `SMOKE_USER_TOKEN` |
| `e2e` | every PR + push to master, after `test` | Same Postgres container + boots the API + boots Next dev on :3001, then runs Playwright (Chromium, mobile-only, 5 golden flows). Uploads the HTML report as an artifact on failure |
| `post-deploy-smoke` | push to master only, after `test` + `smoke` + `e2e` | Polls Railway until the new build is live (up to 5 min), asserts the API auth middleware, login route, and web landing/login pages return the expected HTTP code |

If `post-deploy-smoke` fails, the workflow turns red — Railway has already deployed but at least the team is notified.

**Local equivalents**:
- `pnpm --filter @ona/api smoke` — runs the smoke layer against a `docker-compose.test.yml` Postgres
- `pnpm --filter @ona/web e2e` — runs Playwright against a fresh Postgres + API + Web stack (also via `docker-compose.test.yml`). First run needs `pnpm --filter @ona/web e2e:install` to download Chromium

Both require Docker Desktop running.

## 2. Branch protection (GitHub UI step)

Workflows alone don't block merges. After landing this branch, configure on GitHub:

**Settings → Branches → Add rule → `master`**

Enable:
- ✅ Require a pull request before merging
  - Require approvals: at least 1 (or 0 for solo)
  - Dismiss stale approvals on push
- ✅ Require status checks to pass before merging
  - Require branches to be up to date before merging
  - Status checks: **`Lint + tests`**, **`Route smoke (Postgres + API)`**, and **`E2E (Playwright)`**
- ✅ Do not allow bypassing the above settings

Once enabled, anyone (including admins, with the last checkbox) is forced to:
1. Open a PR
2. Wait for `test` to go green
3. Merge

`post-deploy-smoke` is informational — it can't block a merge that already happened, but it surfaces deploy regressions on the master branch's check status within ~6 minutes of the merge.

## 3. Secrets to set on the repository

**Settings → Secrets and variables → Actions → Repository secrets**:

- `USDA_API_KEY` (optional) — required only for the `usdaClient.smoke.ts` test that hits live USDA. Without it, those 3 tests skip gracefully.

The other env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `JWT_SECRET`) live on Railway, not here. CI does **not** need them — unit tests don't hit external services or the DB.

## 4. Adding tests later

When new tests come online (Tier 4 web tests, Tier 5 Playwright), add their commands as new steps in the `test` job. Playwright will likely warrant its own job because it needs a running app + a longer timeout.

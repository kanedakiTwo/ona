# Menu probe (sonda diaria del menú)

Once a day, and after every publication, a GitHub Actions workflow signs in to staging and to production with a test account of its own, generates **next week's menu** and times it. It is **ROJO** (the job fails) if generating fails, the menu comes back empty, or it takes more than **30 s**. PRO-396, from the 18-nov audit (pattern P-4, «Hecho» no es «funciona»): the menu took 7 minutes for 8 days and nobody saw it until Miguel did.

Nothing changes for users. This spec is for the office, which reads the result.

## What it does

1. **Session.** With `PROBE_USERNAME` + `PROBE_PASSWORD` it logs in (`POST /login`, username or email). Without them, **staging only**, it signs up a throwaway `sonda<stamp>@example.com` with the staging smoke invitation (`SMOKE_INVITE_CODE`, default the campaign «smoke (prueba profunda)», like `scripts/smoke-remote.sh --deep`). Against production (by `PROBE_ENV` or by the URL: `production`, `mimoia.com`) it never signs anyone up: without credentials it is ROJO «faltan las credenciales…» without calling anything.
2. **Menu.** `POST /menu/generate { userId, weekStart }` with `weekStart` = Monday of next week in Madrid (`nextWeekStart`). Timed from request to full answer, cut at 180 s.
3. **Verdict** (`verdict`): ROJO if no answer, status other than 200/201, `days` empty, or seconds > tope. Otherwise VERDE.

The production account regenerates the same next week every day; the previous row stays as history like any regenerate ([menus.md](./menus.md)).

## Result

`menu-probe.json`, one per environment, **no personal data** (no email, id or token; a test checks it):

```json
{"entorno":"staging","segundos":9.1,"ok":true,"fecha":"2026-11-24T14:43:12.528Z","semana":"2026-11-30","topeSegundos":30,"motivo":null}
```

`segundos` = seconds of the generate request (null if it never got there: login or sign-up failed). `motivo` = why it is ROJO, in Spanish (`tardó 31 s (tope 30 s)`, `POST /menu/generate respondió 500`, `el login respondió 401`…), null when green. The script also prints one line (`VERDE staging: menú de 2026-11-30 en 9.1 s (tope 30 s)` / `ROJO …`) and exits 1 on ROJO.

In the workflow each job uploads it as the artifact **`menu-probe-staging`** / **`menu-probe-production`** (30 days), writes the line in the run summary and, on ROJO, an `::error` annotation (readable from the API without a token).

## Workflow

`docs/workflows/menu-probe.yml`, to be installed as `.github/workflows/menu-probe.yml` (the Taller can't write `.github/`). Triggers: `schedule` daily 06:00 UTC, `workflow_run` after **CI** completes on `master` (the publication), and `workflow_dispatch` with `max_seconds` (lower it to see the ROJO). Two jobs from a matrix, `fail-fast: false`, environments **`menu-probe-staging`** (no secrets) and **`menu-probe-production`** (secrets `PROBE_USERNAME`, `PROBE_PASSWORD`). Without those secrets the production job only warns «producción no se ha medido» and stays green, with no artifact.

## The production account

A Mimoia email (e.g. `sonda@mimoia.com`), plain user role (never admin: its password lives in GitHub), created through the normal sign-up with an invitation, its credentials only in the `menu-probe-production` environment. TODO(spec): marking it out of metrics — today metrics leave out only admin and suspended accounts (`countedUsers` and its copies), so its daily menu would count it as an active household. Pending a follow-up task once the branch that changes `growthReport.ts` / `usageReport.ts` (PRO-1310) is merged.

## Run by hand

```bash
PROBE_ENV=staging API_URL=https://ona-api-staging.up.railway.app \
  pnpm --filter @ona/api exec tsx scripts/menuProbe.ts --out=menu-probe.json [--max-seconds=2]
```

Behind an HTTP proxy, Node's `fetch` needs `NODE_USE_ENV_PROXY=1` (Node ≥ 24). Verified 2026-11-24 against staging: VERDE in 9.1 s; with `--max-seconds=2`, ROJO «tardó 6.1 s (tope 2 s)», exit 1.

## Related specs

- [Menus](./menus.md) — `POST /menu/generate`
- [Auth](./auth.md) — login, invitation sign-up
- [Metrics](./metrics.md) — who counts

## Source

- [apps/api/src/services/menuProbe.ts](../apps/api/src/services/menuProbe.ts) — `runMenuProbe`, `verdict`, `nextWeekStart`, `isProductionUrl`, `describe`, `PROBE_MAX_SECONDS`
- [apps/api/scripts/menuProbe.ts](../apps/api/scripts/menuProbe.ts) — the CLI the workflow runs
- [docs/workflows/menu-probe.yml](../docs/workflows/menu-probe.yml) — the workflow, to install under `.github/workflows/`
- Tests: `apps/api/src/tests/menuProbe.test.ts`

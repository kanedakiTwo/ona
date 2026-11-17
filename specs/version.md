# Version (deployed commit)

The API and the web say which commit they run, so whoever deploys (the HQ office on staging, Miguel on production) can check that each service really serves the commit it deployed, not just Railway's «SUCCESS» (PRO-365).

## The `VERSION_SHA` file

Before uploading, the deploy writes the full commit hash (40 hex characters) followed by a newline into `VERSION_SHA`, at the top of the tree. It is never committed (`.gitignore`). With no file (a local checkout, CI), or with anything other than a single 40-hex hash inside, both services answer `null`.

## On the API

- Path `/version`, method GET: public (no auth), no DB read, `Cache-Control: no-store`.
- Body: `{"sha": "<hash>"}` or `{"sha": null}`.
- The file is read once when the process starts (the route module resolves it from the repo top, whatever the working directory): it only changes with a new deploy, which is a new process.

## On the web

- Path `/version.json`, with the same body.
- It is a static route handler (`force-static`) rendered during `next build` from the file, so the standalone server never needs it at run time. Under `next dev` it reads the file on each request.

## After a deploy

Ask both services (the API on `/version`, the web on `/version.json`) and compare with the hash you deployed.

## Tests

- API unit test `version.test.ts`: the file rule (valid, missing, junk) and the route (no auth, `no-store`, null).
- e2e `version.spec.ts`: the web and the API give the same JSON shape and the same hash.

## Source

- [apps/api/src/routes/version.ts](../apps/api/src/routes/version.ts) — `readVersionSha` (the file rule) and `GET /version`, mounted in [apps/api/src/index.ts](../apps/api/src/index.ts)
- [apps/web/src/lib/versionSha.ts](../apps/web/src/lib/versionSha.ts) — the same file rule on the web
- [apps/web/src/app/version.json/route.ts](../apps/web/src/app/version.json/route.ts) — `/version.json` (`force-static`)
- [.gitignore](../.gitignore) — keeps `VERSION_SHA` out of git
- Tests: [apps/api/src/tests/version.test.ts](../apps/api/src/tests/version.test.ts), [apps/web/e2e/version.spec.ts](../apps/web/e2e/version.spec.ts)

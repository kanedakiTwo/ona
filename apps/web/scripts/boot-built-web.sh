#!/usr/bin/env bash
# Build the web (`next build`) and start the compiled server in the
# background, for the e2e suite (PRO-398).
#
# Under `next dev` every route compiled on its first hit: on a cold CI runner
# that ate the specs' 30 s timeouts (warm-routes.sh only softened it) and made
# the suite slow and flaky. The compiled server answers each route at once,
# and it is what production runs (start.sh: the standalone server.js).
#
# Usage: apps/web/scripts/boot-built-web.sh <port> [log-file] [pid-file]
# Reads NEXT_PUBLIC_API_URL (and the other NEXT_PUBLIC_* the job sets) at
# build time: they are inlined into the bundle. Used by the e2e job of
# .github/workflows/ci.yml.

set -euo pipefail

PORT="${1:?usage: boot-built-web.sh <port> [log-file] [pid-file]}"
LOG="${2:-/tmp/web.log}"
PID_FILE="${3:-/tmp/web.pid}"
WEB_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# blog.spec.ts reads the fixture articles. A production build ignores
# BLOG_CONTENT_DIR unless E2E_WEB_BUILD=1 (lib/blog/posts.ts); absolute,
# because the standalone server runs from .next/standalone/apps/web.
export E2E_WEB_BUILD=1
export BLOG_CONTENT_DIR="$WEB_DIR/e2e/fixtures/blog"

echo "Building the web (next build)…"
pnpm --filter @ona/web build > "$LOG.build" 2>&1 || { tail -80 "$LOG.build"; exit 1; }

PORT="$PORT" HOSTNAME=127.0.0.1 node "$WEB_DIR/.next/standalone/apps/web/server.js" > "$LOG" 2>&1 &
echo $! > "$PID_FILE"
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:$PORT/" >/dev/null 2>&1; then
    echo "Web (build) ready on :$PORT."
    exit 0
  fi
  sleep 1
done
echo "The compiled web never answered on :$PORT. Last log:"
tail -80 "$LOG"
exit 1

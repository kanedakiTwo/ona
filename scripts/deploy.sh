#!/usr/bin/env bash
# Guarded production deploy for Mimoia (Railway).
#
# There is no GitHub→Railway connection: `railway up` uploads THIS working
# directory, whatever is in it. This wrapper refuses to deploy anything that
# isn't exactly a commit already on origin/master, so "what's in prod" always
# maps to a commit in the repo:
#
#   1. the working tree must be clean (no staged, unstaged or untracked files
#      outside .gitignore — `railway up` would ship them);
#   2. HEAD must equal origin/master after a fresh fetch (pushed, and not
#      behind — deploying an older commit is a rollback; pass --allow-behind
#      if that is what you mean);
#   3. production only: CI must be green for this code — a successful CI run
#      of HEAD, or of any commit that differs from HEAD only in docs paths
#      (the same list as ci.yml's paths-ignore). The PR's run counts: after a
#      squash merge of an up-to-date PR, master has the same code, so there's
#      no need to wait for master's own run (2026-10-15). --skip-ci-check to
#      override (emergencies);
#   4. it prints the commit being deployed, then runs the same manual commands
#      documented in docs/deploy.md (api first, then web).
#
# Usage:
#   scripts/deploy.sh [api|web|all] [--dry-run] [--allow-behind] [--staging-branch] [--wait] [--skip-ci-check]
#     api|web|all     which service(s) to deploy (default: all)
#     --dry-run       run every check and print the plan, but don't deploy
#     --allow-behind  allow HEAD to be an ancestor of origin/master (rollback)
#     --staging-branch  allow HEAD to be any pushed commit (e.g. the nightly
#                     Taller's claude/taller-* branch) — staging only: refused
#                     when the linked/token environment is production (D-027)
#     --wait          wait until Railway reports each deploy SUCCESS (exit 1 on
#                     FAILED/CRASHED or after 15 min); used by the nightly Taller
#     --skip-ci-check production: deploy even without a green CI run for this
#                     code (emergencies only; say why in the commit/log)
#
# The target environment is the linked one, or the one a project token in
# RAILWAY_TOKEN belongs to (staging and production each have their own).

set -euo pipefail

# Miguel's laptop: the CLI's own login is another Railway account (AiKit), so
# Mimoia commands take his personal account token from a local file unless a
# token is already set (the Taller sets RAILWAY_TOKEN). docs/deploy.md → One-time setup.
TOKEN_FILE="${MIMOIA_RAILWAY_TOKEN_FILE:-$HOME/.config/mimoia/railway-token}"
if [ -z "${RAILWAY_TOKEN:-}" ] && [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -r "$TOKEN_FILE" ]; then
  RAILWAY_API_TOKEN="$(cat "$TOKEN_FILE")"
  export RAILWAY_API_TOKEN
fi

TARGET="all"
DRY_RUN=0
ALLOW_BEHIND=0
STAGING_BRANCH=0
WAIT=0
SKIP_CI=0
for arg in "$@"; do
  case "$arg" in
    api|web|all) TARGET="$arg" ;;
    --dry-run) DRY_RUN=1 ;;
    --allow-behind) ALLOW_BEHIND=1 ;;
    --staging-branch) STAGING_BRANCH=1 ;;
    --wait) WAIT=1 ;;
    --skip-ci-check) SKIP_CI=1 ;;
    -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg (see --help)" >&2; exit 2 ;;
  esac
done

die() { echo "✋ deploy refused: $*" >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
cd "$ROOT"

# 1) Clean tree — includes untracked files, since `railway up` uploads them.
dirty="$(git status --porcelain)"
if [ -n "$dirty" ]; then
  echo "$dirty" >&2
  die "working tree is dirty. Commit/stash (or .gitignore) the files above first."
fi

# 2) HEAD must be what origin/master points at.
git fetch --quiet origin master || die "could not fetch origin/master"
head_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/master)"
env_name="$(railway status 2>/dev/null | sed -n 's/^Environment:[[:space:]]*//p')"
if [ "$head_sha" != "$remote_sha" ] && [ "$STAGING_BRANCH" -eq 1 ]; then
  # The nightly Taller ships to staging from its own branch; production only
  # ever gets master, after Miguel's OK in /ona-dia (D-027).
  [ "$env_name" = "staging" ] || die "--staging-branch only deploys to staging (environment: ${env_name:-unknown})."
  git fetch --quiet origin || die "could not fetch origin"
  [ -n "$(git branch -r --contains "$head_sha" 2>/dev/null)" ] || die "HEAD ($(git rev-parse --short HEAD)) is not on any origin branch. Push it first."
  echo "⚠️  Staging from a branch: $(git rev-parse --short HEAD) is not master."
elif [ "$head_sha" != "$remote_sha" ]; then
  if git merge-base --is-ancestor "$head_sha" "$remote_sha"; then
    if [ "$ALLOW_BEHIND" -ne 1 ]; then
      die "HEAD ($(git rev-parse --short HEAD)) is behind origin/master ($(git rev-parse --short origin/master)). Pull first, or pass --allow-behind for an intentional rollback."
    fi
    echo "⚠️  HEAD is behind origin/master — deploying an older commit (rollback)."
  else
    die "HEAD ($(git rev-parse --short HEAD)) is not on origin/master. Push it to master first (deploys only ship pushed commits)."
  fi
fi

# 3) Production: a green CI run for this code (see the header).
DOCS_ONLY_RE='^(specs/|docs/|CLAUDE\.md$|plans/|reports/|(.*/)?README\.md$)'
if [ "$env_name" = "production" ] && [ "$SKIP_CI" -ne 1 ]; then
  command -v gh >/dev/null 2>&1 || die "production needs the gh CLI to check CI (or --skip-ci-check)."
  repo="$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
  green_shas="$(gh api "repos/$repo/actions/workflows/ci.yml/runs?status=success&per_page=60" --jq '.workflow_runs[].head_sha' 2>/dev/null)" \
    || die "could not read CI runs from GitHub (gh auth?). Use --skip-ci-check only in an emergency."
  green=""
  for sha in $green_shas; do
    git cat-file -e "$sha^{commit}" 2>/dev/null || git fetch --quiet origin "$sha" 2>/dev/null || continue
    changed="$(git diff --name-only "$sha" HEAD)"
    if [ -z "$changed" ] || ! printf '%s\n' "$changed" | grep -Evq "$DOCS_ONLY_RE"; then
      green="$sha"
      break
    fi
  done
  if [ -z "$green" ]; then
    running="$(gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$head_sha&per_page=5" --jq '[.workflow_runs[] | select(.status != "completed")] | length' 2>/dev/null || echo 0)"
    [ "${running:-0}" -gt 0 ] && die "CI is still running for $(git rev-parse --short HEAD): wait for it (or for the PR's run)."
    die "no green CI run for this code (HEAD $(git rev-parse --short HEAD)). Push and let CI pass, or --skip-ci-check in an emergency."
  fi
  if [ "$green" = "$head_sha" ]; then echo "✓ CI green for $(git rev-parse --short HEAD)"
  else echo "✓ CI green for $(git rev-parse --short "$green"), same code as HEAD (only docs differ, or none)"; fi
fi

case "$TARGET" in
  all) services=(ona-api ona-web) ;; # api first: new UI must find its endpoints
  api) services=(ona-api) ;;
  web) services=(ona-web) ;;
esac

echo "── Deploying ────────────────────────────────────────────────────"
echo "  commit:   $(git log -1 --format='%H')"
echo "            $(git log -1 --format='%s (%an, %ad)' --date=short)"
echo "  services: ${services[*]}"
echo "  env:      $env_name"

if [ "$DRY_RUN" -eq 1 ]; then
  for s in "${services[@]}"; do echo "  [dry-run] railway up --service $s --detach"; done
  echo "Dry run: all checks passed, nothing deployed."
  exit 0
fi

command -v railway >/dev/null 2>&1 || die "railway CLI not installed (see docs/deploy.md → One-time setup)"

deploy_ids=""  # "service=id" lines (bash 3.2 on macOS has no associative arrays)
for s in "${services[@]}"; do
  echo "── railway up --service $s --detach"
  out="$(railway up --service "$s" --detach 2>&1)" || { echo "$out"; die "railway up failed for $s"; }
  echo "$out"
  # The build-logs URL carries the new deployment id (…?id=<uuid>&).
  deploy_ids="$deploy_ids$s=$(printf '%s' "$out" | sed -n 's/.*[?&]id=\([0-9a-f-]*\).*/\1/p' | head -1)
"
done

if [ "$WAIT" -eq 1 ]; then
  for s in "${services[@]}"; do
    want="$(printf '%s' "$deploy_ids" | sed -n "s/^$s=//p")"
    [ -n "$want" ] || die "could not read the deployment id for $s"
    for i in $(seq 1 90); do
      status_out="$(railway service status --service "$s" 2>/dev/null)"
      cur="$(printf '%s' "$status_out" | sed -n 's/^Deployment: //p')"
      st="$(printf '%s' "$status_out" | sed -n 's/^Status: //p')"
      # Until Railway switches to the new deployment, the status is the old one's.
      [ "$cur" = "$want" ] || st="WAITING"
      case "$st" in
        SUCCESS) echo "✓ $s deployed"; break ;;
        FAILED|CRASHED|REMOVED) die "$s deploy ended $st (see Railway build logs)" ;;
      esac
      [ "$i" = "90" ] && die "$s still '$st' after 15 min"
      sleep 10
    done
  done
fi

echo
echo "Uploaded $(git rev-parse --short HEAD). Builds take 2–4 min; then check:"
echo "  curl -sf https://ona-api-production.up.railway.app/health"

#!/usr/bin/env bash
# PRO-OF-4: staging is shared with the Mimoia HQ office (it deploys the
# Taller's branches there and copies the catalogue). Before a staging deploy,
# scripts/deploy.sh asks the office who holds the staging lock:
#
#   ssh hq-lectura cerrojo  →  {"staging": null}
#                              {"staging": {"dueno": "miguel" | "oficina (…)", "hasta": "<ISO>"}}
#
# Exit 0: free, or held by Miguel (he takes it to deploy by hand:
#         ssh -t hq sudo hq cerrojo staging tomar).
# Exit 3: held by the office — wait until «hasta» (or take it yourself).
# No answer (this machine has no WireGuard, e.g. a cloud routine): warn, exit 0.
set -euo pipefail
SSH="${HQ_LOCK_SSH:-ssh}"
answer="$("$SSH" -o BatchMode=yes -o ConnectTimeout=5 hq-lectura cerrojo 2>/dev/null)" || answer=""
holder="$(printf '%s' "$answer" | node -e '
let s = ""
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    const l = JSON.parse(s).staging
    process.stdout.write(l ? `${String(l.dueno)}\t${String(l.hasta)}` : "free")
  } catch {}
})' 2>/dev/null || true)"
if [ -z "$holder" ]; then
  echo "⚠️  Could not ask the HQ office for the staging lock (ssh hq-lectura cerrojo): deploying without it." >&2
  exit 0
fi
[ "$holder" = free ] && exit 0
owner="${holder%%	*}"
until="${holder#*	}"
[ "$owner" = miguel ] && { echo "✓ Staging lock held by Miguel (until $until)."; exit 0; }
echo "✋ deploy refused: the HQ office holds the staging lock ($owner, until $until). Wait, or take it: ssh -t hq sudo hq cerrojo staging tomar" >&2
exit 3

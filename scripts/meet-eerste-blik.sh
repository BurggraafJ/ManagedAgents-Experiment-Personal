#!/usr/bin/env bash
# Meet het hoogte- en woordbudget van een bord (bouwproces.md stap 8) in plaats
# van het te schatten: bouwt het preview-harnas van één bord, dumpt de DOM met
# `?meet=1` en print het JSON-blok dat `<pre id="meet">` draagt.
#
# Gebruik: scripts/meet-eerste-blik.sh d1 [view] [breedte,hoogte]
#
# Waarom een eigen script naast capture.sh: die maakt PNG's met --screenshot, en
# een screenshot vertelt je niet of de eerste blik 224 of 236 px is. Zelfde
# harnas, andere uitvoer.
set -euo pipefail

BORD="${1:-d1}"
VIEW="${2:-desktop}"
GROOTTE="${3:-1440,900}"
DIST="${PREVIEW_DIST:-/tmp/meet-$BORD-dist}"
PORT="${PORT:-5261}"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY="./scripts/preview-$BORD/index.html" \
PREVIEW_SUPABASE_MOCK="./scripts/preview-$BORD/mock-supabase.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js >/dev/null

python3 -m http.server "$PORT" --directory "$DIST" >"$DIST.server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# Eigen profielmap per aanroep: zonder --user-data-dir hangt headless Chrome op
# deze machine stil (geheugen `headless-chrome-runner-pitfalls`).
rm -rf "$DIST.prof"
"$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --hide-scrollbars --virtual-time-budget=4000 --window-size="$GROOTTE" \
  --user-data-dir="$DIST.prof" --dump-dom \
  "http://localhost:$PORT/scripts/preview-$BORD/index.html?view=$VIEW&meet=1" 2>/dev/null \
  | python3 -c '
import sys, re, html
d = sys.stdin.read()
m = re.search(r"<pre id=\"meet\">(.*?)</pre>", d, re.S)
print(html.unescape(m.group(1)) if m else "GEEN MEETBLOK — harnas niet geladen?")
'

#!/usr/bin/env bash
# Meet wat elke kop-optie kost: hoogte van de kop, waar de eerste mailrij
# begint, en hoeveel hele rijen er op een telefoonscherm passen.
# Gebruik: bash scripts/preview-postvak/meet-kop.sh [breedte,hoogte]
set -euo pipefail

GROOTTE="${1:-430,932}"        # iPhone 15 Pro Max-achtig, CSS-px
DIST=/tmp/meet-postvak-dist
PORT="${PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-postvak/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-postvak/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAutoDraft=./scripts/preview-postvak/mock-useautodraft.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js >/dev/null

python3 -m http.server "$PORT" --directory "$DIST" >"$DIST.server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

for o in a b c; do
  rm -rf "$DIST.prof-$o"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=4000 --window-size="$GROOTTE" \
    --user-data-dir="$DIST.prof-$o" --dump-dom \
    "http://localhost:$PORT/scripts/preview-postvak/index.html?view=mobile&opt=$o&meet=1" 2>/dev/null \
    | python3 -c '
import sys, re, html
d = sys.stdin.read()
m = re.search(r"<pre id=\"meet\">(.*?)</pre>", d, re.S)
print(html.unescape(m.group(1)) if m else "GEEN MEETBLOK — harnas niet geladen?")
'
done

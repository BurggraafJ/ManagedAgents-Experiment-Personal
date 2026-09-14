#!/usr/bin/env bash
# Designshots Postvak-chrome: Prioriteit|Overige + overloop + veegacties.
# Drie kop-opties (a/b/c), elk desktop én mobiel, plus één shot van de
# veegstrook met de échte rij-component.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-postvak-prio-dist
# Vrije poort zoeken: op deze machine draaien meerdere jobs naast elkaar en een
# bezette poort gaf stilzwijgend zeven shots met "not found" erin.
PORT="${PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}"
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-postvak/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-postvak/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAutoDraft=./scripts/preview-postvak/mock-useautodraft.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-postvak-prio-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# $1 = querystring, $2 = window-size, $3 = bestandsachtervoegsel
shoot() {
  rm -rf "/tmp/chrome-prof-pvprio-$3"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=6000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-pvprio-$3" \
    --screenshot="$OUT/postvak-prio-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-postvak/index.html?$1" >/dev/null 2>&1
  echo "  $OUT/postvak-prio-$3-v$VERSION.png"
}

for o in a b c; do
  shoot "view=desktop&opt=$o" 1440,1000 "$o-desktop"
  shoot "view=mobile&opt=$o"  430,1100  "$o-mobiel"
done
shoot "view=swipe" 430,1100 "swipe"
shoot "view=menu"  430,1100 "menu"

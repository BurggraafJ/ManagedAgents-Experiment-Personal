#!/usr/bin/env bash
# Rendert de Agenda (desktop-week + mobiele dag) op een vaste fixture en
# schrijft de PNG's in docs/previews/. Gebruik: npm run preview:agenda
# Zelfde aanpak als scripts/preview-home: headless Chrome, geen sessie.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=${DIST:-/tmp/preview-agenda-dist}
PORT=${PORT:-5219}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-agenda/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-agenda/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAgenda=./scripts/preview-agenda/mock-hooks.js,useAutoDraft=./scripts/preview-agenda/mock-hooks.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-agenda-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() {
  rm -rf "/tmp/chrome-prof-agenda-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=4000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-agenda-$1" \
    --screenshot="$OUT/agenda-luchtlijn-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-agenda/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/agenda-luchtlijn-$3-v$VERSION.png"
}

shoot desktop 1440,1000 desktop-week
shoot mobile  430,1100  mobiel-dag

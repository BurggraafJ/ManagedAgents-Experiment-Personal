#!/usr/bin/env bash
# Rendert de mobiele onderbalk en de Meer-drawer voor de v1.204-navwissel
# (Agenda naar tab 2, Administratie naar Meer). Gebruik: npm run preview:nav
# Zelfde aanpak als scripts/preview-home en scripts/preview-agenda: headless
# Chrome op een vaste fixture, geen sessie en geen netwerk.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=${DIST:-/tmp/preview-mobile-nav-dist}
PORT=${PORT:-5221}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

# useAgenda komt uit het agenda-harnas — één fixture, niet twee die uit elkaar
# kunnen lopen. useAgendaWrite blijft echt en draait op de supabase-stub.
PREVIEW_ENTRY=./scripts/preview-mobile-nav/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-mobile-nav/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAgenda=./scripts/preview-agenda/mock-hooks.js,useAutoDraft=./scripts/preview-agenda/mock-hooks.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-mobile-nav-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() {
  rm -rf "/tmp/chrome-prof-mnav-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --lang=nl-NL --accept-lang=nl-NL,nl \
    --hide-scrollbars --virtual-time-budget=4000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-mnav-$1" \
    --screenshot="$OUT/mobile-nav-$1-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-mobile-nav/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/mobile-nav-$1-v$VERSION.png"
}

shoot home   430,932
shoot agenda 430,932
shoot meer   430,932

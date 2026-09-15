#!/usr/bin/env bash
# Rendert Taken (desktop + mobiel) voor de shots van v1.205: slepen tussen
# prio-groepen en het taakdetail.
#
# De sleep-shots zijn geen nagebouwde markup: het harnas stuurt échte
# drag-/pointer-events naar de échte componenten, en de supabase-stub is
# schrijfbaar. Wat er in de zwarte balk staat (?log=1) is wat de view
# daadwerkelijk heeft weggeschreven.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-taken-dist
PORT=${PORT:-5231}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-taken/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-taken/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-taken-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# $1 = querystring, $2 = window-size, $3 = bestandsachtervoegsel
shoot() {
  rm -rf "/tmp/chrome-prof-taken-$3"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=9000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-taken-$3" \
    --screenshot="$OUT/taken-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-taken/index.html?$1" >/dev/null 2>&1
  echo "  $OUT/taken-$3-v$VERSION.png"
}

shoot "view=desktop"                          1440,1000 desktop
shoot "view=desktop&act=drag"                 1440,1000 desktop-sleep
shoot "view=desktop&act=drop&log=1"           1440,1000 desktop-na-drop
shoot "view=desktop&act=backlog&log=1"        1440,1000 desktop-backlog
shoot "view=desktop&act=detail"               1440,1000 desktop-detail
shoot "view=mobile"                           430,1000  mobiel
shoot "view=mobile&act=drag"                  430,1000  mobiel-sleep
shoot "view=mobile&act=drop&log=1"            430,1000  mobiel-na-drop
shoot "view=mobile&act=backlog&log=1"         430,1000  mobiel-backlog
shoot "view=mobile&act=detail"                430,1000  mobiel-detail

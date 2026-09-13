#!/usr/bin/env bash
# Rendert Home (desktop + mobiel) + sidebar + Meer voor v1.179 D1–D10-shots.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-home-dist
PORT=${PORT:-5218}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-home/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-home/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-home-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() {
  rm -rf "/tmp/chrome-prof-home-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=4000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-home-$1" \
    --screenshot="$OUT/home-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-home/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/home-$3-v$VERSION.png"
}

shoot desktop 1440,1100 desktop
shoot sidebar 1280,900  sidebar
shoot mobile  430,1100  mobile
shoot meer    430,900   meer

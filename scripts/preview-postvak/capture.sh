#!/usr/bin/env bash
# Rendert Postvak (desktop + mobiel) voor de F0/F2-shots van spoor 10.
# De mobiele "oude regel"-shot is een reconstructie: hetzelfde component, maar
# gevoed met alleen de mails die de lijst van vóór v1.197 doorliet.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-postvak-dist
PORT=${PORT:-5221}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-postvak/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-postvak/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAutoDraft=./scripts/preview-postvak/mock-useautodraft.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-postvak-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# $1 = querystring, $2 = window-size, $3 = bestandsachtervoegsel
shoot() {
  rm -rf "/tmp/chrome-prof-postvak-$3"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=5000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-postvak-$3" \
    --screenshot="$OUT/postvak-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-postvak/index.html?$1" >/dev/null 2>&1
  echo "  $OUT/postvak-$3-v$VERSION.png"
}

shoot "view=desktop"            1440,1000 desktop
shoot "view=mobile"             430,1100  mobiel
shoot "view=mobile&rule=oud"    430,1100  mobiel-oude-regel

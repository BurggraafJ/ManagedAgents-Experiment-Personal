#!/usr/bin/env bash
# Rendert Organisatie › Rechten (matrix, beide assen) en › Usage op fixture-data
# en schrijft de PNG's in docs/previews/. Gebruik: npm run preview:rechten
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=${DIST:-/tmp/preview-rechten-dist}
PORT=${PORT:-5221}
OUT=${OUT:-docs/previews}

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

mkdir -p "$OUT"

PREVIEW_ENTRY=./scripts/preview-rechten/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-rechten/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-rechten-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# shoot <query> <window> <bestandsnaam>
shoot() {
  local prof="/tmp/chrome-prof-rch-$3"
  rm -rf "$prof"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=6000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="$prof" \
    --screenshot="$OUT/$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-rechten/index.html?$1" >/dev/null 2>&1
  echo "  $OUT/$3-v$VERSION.png"
}

# Bewust na elkaar: meerdere Chromes tegelijk gaven eerder stille witte PNG's.
shoot "view=rechten"           1900,2100 organisatie-rechten-matrix
shoot "view=rechten-open"      1900,2800 organisatie-rechten-alles-open
shoot "view=rechten-gedraaid"  1900,900  organisatie-rechten-gedraaid
shoot "view=usage"             1440,1250 organisatie-usage
shoot "view=usage-detail"      1440,1500 organisatie-usage-doorkijk
shoot "view=gebruikers"        1440,900  organisatie-gebruikers-nav

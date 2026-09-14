#!/usr/bin/env bash
# Rendert Organisatie › Platform (Config · Edge · Database) en › Pijplijn op
# fixture-data en schrijft de PNG's in docs/previews/. Plus de mobiele
# Organisatie-hub en de mobiele Instellingen-hub. Gebruik: npm run preview:organisatie
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=${DIST:-/tmp/preview-organisatie-dist}
PORT=${PORT:-5220}
OUT=${OUT:-docs/previews}

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-organisatie/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-organisatie/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-organisatie-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# shoot <query> <window> <bestandsnaam>
shoot() {
  local prof="/tmp/chrome-prof-org-$3"
  rm -rf "$prof"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=5000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="$prof" \
    --screenshot="$OUT/$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-organisatie/index.html?$1" >/dev/null 2>&1
  echo "  $OUT/$3-v$VERSION.png"
}

# Bewust na elkaar: drie Chromes tegelijk gaven eerder stille witte PNG's.
shoot "view=platform&seg=config"     1440,1000 organisatie-platform-config
shoot "view=platform&seg=edge"       1440,1000 organisatie-platform-edge
shoot "view=platform&seg=database"   1440,1100 organisatie-platform-database
shoot "view=pijplijn"                1440,900  organisatie-pijplijn
shoot "view=pijplijn&step=chunk"     1440,1100 organisatie-pijplijn-stap-chunk
shoot "view=hub-mobiel"              430,1000  organisatie-hub-mobiel
shoot "view=instellingen-mobiel"     430,1000  instellingen-mobiel

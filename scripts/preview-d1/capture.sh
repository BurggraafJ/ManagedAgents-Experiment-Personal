#!/usr/bin/env bash
# Rendert het D1-pipelinebord (echte view + echte hook, gestubte netwerklaag) en
# schrijft de PNG's in docs/previews/. Gebruik: npm run preview:d1
#
# Zelfde aanpak als scripts/preview-d9: headless Chrome, geen Playwright.
# Er is bewust geen echte-sessie-pad — inloggen vraagt 2FA en die mailt een
# code; een component-harnas is de enige weg naar een reproduceerbare shot
# (geheugen `headless-screenshots-dashboard`).
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-d1-dist
PORT=${PORT:-5211}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-d1/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-d1/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-d1-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() { # view · viewport · doelnaam
  rm -rf "/tmp/chrome-prof-d1-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=3000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-d1-$1" \
    --screenshot="$OUT/d1-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-d1/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/d1-$3-v$VERSION.png"
}

# Het bord is hoog: een venster van 1220 px toont alleen de eerste blik. De
# tweede shot is bewust 2400 px zodat forecast, win rate, ontleding, datastatus
# én werkbord op één plaatje staan — dat is de shot voor de MT-notulen.
# Bewust sequentieel: drie headless Chromes tegelijk op deze machine leverden
# twee lege shots op zonder foutmelding. Langzamer, maar een ontbrekende PNG is
# duurder dan twintig seconden.
shoot desktop          1440,1220 desktop
shoot desktop-werkbord 1440,2400 desktop-vol
shoot mobile           430,1900  mobile

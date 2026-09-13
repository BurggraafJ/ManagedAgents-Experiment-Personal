#!/usr/bin/env bash
# Rendert het D10-klantverliesbord (echte view + echte hooks, gestubte
# netwerklaag) en schrijft de PNG's in docs/previews/. Gebruik: npm run preview:d10
#
# Zelfde aanpak als scripts/preview-d1 en -d9: headless Chrome, geen Playwright.
# Er is bewust geen echte-sessie-pad — inloggen vraagt 2FA en die mailt een
# code; een component-harnas is de enige weg naar een reproduceerbare shot
# (geheugen `headless-screenshots-dashboard`).
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-d10-dist
PORT=${PORT:-5212}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-d10/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-d10/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-d10-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() { # view · viewport · doelnaam
  rm -rf "/tmp/chrome-prof-d10-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=3000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-d10-$1" \
    --screenshot="$OUT/d10-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-d10/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/d10-$3-v$VERSION.png"
}

# De eerste shot is de eerste blik: A · B · C · noemer plus de kernzin. De
# tweede is bewust hoog zodat trend, diagnose, werkbord en datastatus op één
# plaatje staan. Sinds v1.178 geen CS-dossierlaag meer op deze route.
# Bewust sequentieel: drie headless Chromes tegelijk op deze machine leverden
# twee lege shots op zonder foutmelding (IMPLEMENT-D1 §6).
shoot desktop         1440,1120 desktop
shoot desktop-verleng 1440,3000 desktop-vol
shoot mobile          430,2400  mobile

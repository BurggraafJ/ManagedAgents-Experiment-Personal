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
# PREVIEW_DIST overschrijfbaar: parallelle jobs delen /tmp en overschrijven
# elkaars dist en Chrome-profiel zonder foutmelding (v1.186).
DIST="${PREVIEW_DIST:-/tmp/preview-d1-dist}"
PORT=${PORT:-5211}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-d1/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-d1/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >"$DIST.server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() { # view · viewport · doelnaam
  rm -rf "$DIST.chrome-prof-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=3000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="$DIST.chrome-prof-$1" \
    --screenshot="$OUT/d1-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-d1/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/d1-$3-v$VERSION.png"
}

# Sinds v1.181 staat het bord op BordShell en scrollt de pagina niet meer: één
# venster van 1440 × 900 ís het bord. Een hogere shot zou de layoutregel juist
# verbergen die dit bord draagt — als er een scrollhoogte nodig was, was het
# bord kapot.
#
# Bewust sequentieel: drie headless Chromes tegelijk op deze machine leverden
# twee lege shots op zonder foutmelding. Langzamer, maar een ontbrekende PNG is
# duurder dan twintig seconden.
shoot desktop           1440,900  desktop
shoot desktop-drill     1440,900  desktop-drill
shoot desktop-werk      1440,900  desktop-werk
shoot desktop-ontbreekt 1440,900  desktop-ontbreekt
shoot desktop-strip     1440,900  desktop-strip      # C1 met één week in focus (tooltip)
shoot desktop-week      1440,900  desktop-week       # C1-staaf geklikt → week in zone 4 (G7)
shoot kwartaal          1440,1100 kwartaal
# Door de echte desktop-chrome (v1.189): `◂ Dashboard` in de topbalk en de witte
# standaardbalk van het bord eronder. Review-shot; `desktop` blijft de meetbasis.
shoot shell             1440,900  shell
shoot shell-sync        1440,900  shell-sync         # het Sync-paneel open (v1.190)
shoot shell-kwartaal    1440,1100 shell-kwartaal
shoot mobile            390,1500  mobile

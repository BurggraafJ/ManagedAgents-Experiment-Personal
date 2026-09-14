#!/usr/bin/env bash
# Rendert het D9-hygiënebord (echte view + echte hook, gestubte netwerklaag) en
# schrijft de PNG's in docs/previews/. Gebruik: npm run preview:d9
#
# Zelfde aanpak als scripts/preview-users: headless Chrome, geen Playwright.
# Er is bewust geen echte-sessie-pad — inloggen vraagt 2FA en die mailt een
# code; een component-harnas is de enige weg naar een reproduceerbare shot
# (geheugen `headless-screenshots-dashboard`).
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-d9-dist
PORT=${PORT:-5210}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-d9/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-d9/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-d9-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() { # view · viewport · doelnaam · [extra query, bv. "&trend=demo"]
  rm -rf "/tmp/chrome-prof-d9-$3"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=3000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-d9-$3" \
    --screenshot="$OUT/d9-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-d9/index.html?view=$1${4:-}" >/dev/null 2>&1
  echo "  $OUT/d9-$3-v$VERSION.png"
}

# 1440 × 900 is met opzet precies het venster uit het ontwerplock: de shot is
# daarmee zelf de toets op "de pagina scrollt niet". Zou het bord hoger worden,
# dan valt de vertrouwensregel van de shot af en zie je dat meteen.
# Mobiel 390 × 844 (iPhone-maat uit Research 2 §5 check 16); daar zakt het bord
# naar één kolom en scrollt de pagina wél, dus die shot is langer.
# Op pid wachten en niet met een kale `wait`: die wacht óók op de http.server
# in de achtergrond en komt dus nooit terug (v1.184).
shoot desktop           1440,900 desktop & P1=$!
shoot desktop-drill     1440,900 desktop-drill & P2=$!
shoot desktop-ontbreekt 1440,900 desktop-ontbreekt & P3=$!
shoot mobile            390,1500 mobile & P4=$!
wait $P1 $P2 $P3 $P4
# De C3-trendcel met een ILLUSTRATIEVE reeks (mock ?trend=demo): snap_hygiene_dag
# heeft nog geen acht weekstanden, dus op de echte stand staat overal `reeks
# start`. Deze twee shots tonen de vorm van de cel, niet de stand van vandaag.
shoot desktop           1440,900 desktop-trend-demo "&trend=demo" & P5=$!
shoot mobile            390,1500 mobile-trend-demo  "&trend=demo" & P6=$!
wait $P5 $P6
# Door de echte desktop-chrome (v1.189): `◂ Dashboard` in de topbalk en de witte
# standaardbalk van het bord eronder. Review-shot; `desktop` blijft de meetbasis.
shoot shell             1440,900 shell

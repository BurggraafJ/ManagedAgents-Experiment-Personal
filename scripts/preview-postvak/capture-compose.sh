#!/usr/bin/env bash
# Designshots Postvak mobiel — FAB, hamburger-menu met sync, het compose-vel
# (leeg, met taalcheck, met de verstuur-blokkade en met een extern adres), en
# sinds v1.205 de FAB-keuze, de mapkiezer en de mail met pin-knop. Alles
# mobiel: de FAB, de sheets en de veegstrook bestaan alleen daar.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-postvak-compose-dist
# Vrije poort zoeken: op deze machine draaien meerdere jobs naast elkaar en een
# bezette poort gaf stilzwijgend shots met "not found" erin.
PORT="${PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}"
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-postvak/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-postvak/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAutoDraft=./scripts/preview-postvak/mock-useautodraft.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-postvak-compose-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# $1 = querystring, $2 = bestandsachtervoegsel
shoot() {
  rm -rf "/tmp/chrome-prof-pvcompose-$2"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=6000 --window-size=430,1100 \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-pvcompose-$2" \
    --screenshot="$OUT/postvak-compose-$2-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-postvak/index.html?$1" >/dev/null 2>&1
  echo "  $OUT/postvak-compose-$2-v$VERSION.png"
}

shoot "view=mobile"    "fab"        # kop met hamburger, geen sync-tijd, FAB rechtsonder
shoot "view=menu"      "menu"       # menu open, sync-tijd + "Nu synchroniseren"
shoot "view=compose"   "sheet"      # het vel: Aan/Onderwerp/tekst + chips
shoot "view=taalcheck" "taalcheck"  # track changes in het schrijfvlak
shoot "view=verstuur"  "geblokkeerd" # Verstuur → Mail.Send ontbreekt + concept
# v1.205
shoot "view=fabmenu"   "fabmenu"    # de FAB-keuze: Concept | Mail
shoot "view=extern"    "extern"     # extern adres → geen Verstuur-knop, reden eronder
shoot "view=swipe"     "veeg"       # de strook: Verplaats (map) i.p.v. Uitstellen
shoot "view=mappen"    "mappen"     # de mapkiezer met de echte boomvorm
shoot "view=mail"      "mail"       # de mail met vastmaken + verplaatsen in de kop

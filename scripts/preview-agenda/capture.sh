#!/usr/bin/env bash
# Rendert de Agenda (desktop-week + mobiele dag) op een vaste fixture en
# schrijft de PNG's in docs/previews/. Gebruik: npm run preview:agenda
# Zelfde aanpak als scripts/preview-home: headless Chrome, geen sessie.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=${DIST:-/tmp/preview-agenda-dist}
PORT=${PORT:-5219}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-agenda/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-agenda/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAgenda=./scripts/preview-agenda/mock-hooks.js,useAutoDraft=./scripts/preview-agenda/mock-hooks.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-agenda-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# ⚠ LEES DIT VOORDAT JE EEN SHOT MET "09/14/2026" EN "11:00 AM" GELOOFT.
#
# Chrome leidt de weergave van `input[type=date|time]` af uit de ICU-locale van
# het systeem, niet uit het `lang`-attribuut in de HTML en niet uit `--lang`.
# Deze box heeft alleen `C.utf8` geïnstalleerd (`locale -a`), dus valt Chrome
# terug op en-US en toont elke datum- en tijdshot een Amerikaans formaat dat op
# Jelle's scherm nooit verschijnt — daar staat 14-09-2026 en 11:00.
#
# De vlaggen hieronder zijn de juiste knop en werken zodra er een nl-locale op de
# machine staat; vandaag veranderen ze niets. Het gevolg voor de LAYOUT is wel
# echt: "11:00 AM" is breder dan "11:00", dus de shots tonen de tijdvelden in hun
# krapste vorm. Passen ze daar, dan passen ze altijd.
# Gevonden bij het nalopen van de v1.202-shots (2026-09-15).
shoot() {
  rm -rf "/tmp/chrome-prof-agenda-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --lang=nl-NL --accept-lang=nl-NL,nl \
    --hide-scrollbars --virtual-time-budget=4000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-agenda-$1" \
    --screenshot="$OUT/agenda-luchtlijn-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-agenda/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/agenda-luchtlijn-$3-v$VERSION.png"
}

shoot desktop 1440,1000 desktop-week
shoot mobile  430,1100  mobiel-dag

# v1.200 — de schrijfbaan zit in de popover/sheet, niet in het week-grid.
shoot desktop-nieuw       1440,1000 desktop-nieuw
shoot desktop-wijzig      1440,1000 desktop-wijzig
shoot desktop-verwijder   1440,1000 desktop-verwijder
shoot desktop-geblokkeerd 1440,1000 desktop-geblokkeerd
shoot mobile-nieuw        430,1100  mobiel-nieuw
shoot mobile-wijzig       430,1100  mobiel-wijzig
shoot mobile-geblokkeerd  430,1100  mobiel-geblokkeerd

# v1.203 — het genodigden-veld met het suggestie-menu open (main.jsx typt de
# zoekterm na het renderen zelf in), plus de verwijder-kaart op mobiel.
shoot desktop-genodigden  1440,1000 desktop-genodigden
shoot mobile-genodigden   430,1100  mobiel-genodigden
shoot mobile-verwijder    430,1100  mobiel-verwijder

# v1.216 — Annuleren zoals Outlook: de detail-stand met de snelknop, de
# annuleer-kaart mét genodigden (met/zonder bericht), en de Teams-schakelaar
# aan (de `nieuw`-shots hierboven tonen de standaard: uit). De week-/dag-shots
# bovenaan tonen nu ook de scroll-naar-nu (de nu-lijn staat in het midden).
shoot desktop-detail      1440,1000 desktop-detail
shoot desktop-annuleer    1440,1000 desktop-annuleer
shoot desktop-teams       1440,1000 desktop-teams
shoot mobile-detail       430,1100  mobiel-detail
shoot mobile-annuleer     430,1100  mobiel-annuleer
shoot mobile-teams        430,1100  mobiel-teams

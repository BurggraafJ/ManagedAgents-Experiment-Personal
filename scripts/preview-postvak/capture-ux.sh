#!/usr/bin/env bash
# Designshots Postvak mobiel — UX-batch v1.217 (Jelle, 2026-09-15):
#   1. mapkiezer: boom dicht, één groep open (onthouden), top 3 meest gebruikt
#   2. de rij zonder ⋯ rechts (de veeg is de enige ingang)
#   3. mail: headers dicht → open na een tik op de afzender
#   4. mail: harde veeg omhoog → terug naar de lijst (vóór/ná, echte touch-events)
# Plus één desktop-shot als nulmeting: daar is in deze batch niets veranderd.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST="${DIST:-/tmp/preview-postvak-ux-dist-$$}"
PORT="${PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}"
OUT=docs/previews
PROF="${TMPDIR:-/tmp}/chrome-prof-pvux-$$"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-postvak/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-postvak/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAutoDraft=./scripts/preview-postvak/mock-useautodraft.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >"$DIST/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; rm -rf "$PROF"* 2>/dev/null || true' EXIT
sleep 2

# $1 = querystring, $2 = window-size, $3 = bestandsnaam (zonder -vN.png)
# Headless Chrome op deze box laat ~1 op 3 shots leeg of ontbrekend; daarom
# tot drie pogingen, en een eigen profielmap per shot.
shoot() {
  local file="$OUT/$3-v$VERSION.png"
  for poging in 1 2 3; do
    rm -rf "$PROF-$3"
    "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
      --hide-scrollbars --virtual-time-budget=6000 --window-size="$2" \
      --force-device-scale-factor=2 --user-data-dir="$PROF-$3" \
      --screenshot="$file" \
      "http://localhost:$PORT/scripts/preview-postvak/index.html?$1" >/dev/null 2>&1 || true
    if [ -s "$file" ] && [ "$(stat -c %s "$file")" -gt 20000 ]; then
      echo "  $file"
      return 0
    fi
    echo "  (poging $poging mislukt voor $3, opnieuw)"
  done
  echo "  !! $file bleef leeg na 3 pogingen"
  return 1
}

M=430,1100
shoot "view=mappen"       $M postvak-verplaats-folders-dicht
shoot "view=mappen-open"  $M postvak-verplaats-folders-open
shoot "view=mappen-top3"  $M postvak-verplaats-folders-top3
shoot "view=mobile"       $M postvak-row-no-ellipsis-mobiel
shoot "view=swipe"        $M postvak-row-no-ellipsis-veeg
shoot "view=mail"         $M postvak-headers-click-dicht
shoot "view=mail-headers" $M postvak-headers-click-open
shoot "view=mail"         $M postvak-swipe-up-back-voor
shoot "view=swipeup"      $M postvak-swipe-up-back-na
shoot "view=desktop"      1440,1000 postvak-desktop-ongewijzigd

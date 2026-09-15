#!/usr/bin/env bash
# Open-ervaring Postvak — v1.223 (spoor 10, brief load-speed 2026-09-16):
#   warm  de SWR-cache van de vorige sessie staat er → lijst meteen in beeld,
#         alleen een zacht "Bijwerken…"-chipje; géén boot-overlay, géén skeleton
#   koud  geen cache → skeleton, en op desktop de boot-overlay die pas op data
#         weggaat (in deze bevroren shot komt die data niet, dus hij blijft)
# Desktop én mobiel, elk door hun eigen code; alleen useAutoDraft is gestubt
# (?swr= wordt door mock-useautodraft.js gelezen).
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST="${DIST:-${TMPDIR:-/tmp}/preview-postvak-open-dist-$$}"
PORT="${PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}"
OUT=docs/previews
PROF="${TMPDIR:-/tmp}/chrome-prof-pvopen-$$"

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
      --hide-scrollbars --virtual-time-budget=3000 --window-size="$2" \
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

D=1440,1000
M=430,1100
shoot "view=desktop&swr=warm" $D postvak-open-desktop
shoot "view=mobile&swr=warm"  $M postvak-open-mobile
shoot "view=desktop&swr=koud" $D postvak-open-cold-desktop
shoot "view=mobile&swr=koud"  $M postvak-open-cold-mobile

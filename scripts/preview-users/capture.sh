#!/usr/bin/env bash
# Rendert de gebruikerspagina (echte componenten, mock-data) en schrijft de
# vijf PNG's in docs/previews/. Gebruik: npm run preview:users
#
# Headless Chrome i.p.v. Playwright: chrome staat al op de meeste machines en
# een screenshot-run hoeft geen extra browser-download te rechtvaardigen.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
DIST=/tmp/preview-users-dist
PORT=${PORT:-5200}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-users-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() { # view · viewport · doelnaam
  # Verse profielmap: een achtergebleven chrome houdt anders de singleton-lock
  # vast en de run hangt zonder iets te schrijven.
  rm -rf "/tmp/chrome-prof-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=2500 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-$1" \
    --screenshot="$OUT/member-ui-a-rust-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-users/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/member-ui-a-rust-$3-v$VERSION.png"
}

shoot desktop       1440,760  desktop-users &
shoot mobile-list   430,1560  mobile-list &
shoot mobile-invite 430,932   mobile-invite &
shoot mobile-create 430,932   mobile-create &
shoot mobile-edit   430,932   mobile-edit &
wait

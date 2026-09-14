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

shoot() { # view · viewport · doelnaam · optionele querystring
  # Verse profielmap per DOELNAAM (v1.198), niet per view: twee shots van
  # dezelfde scène (desktop-invite groen + rood) deelden anders één profiel en
  # de tweede chrome liep stuk op de singleton-lock — die shot ontbrak dan
  # zonder foutmelding. Geheugen `headless-chrome-runner-pitfalls`.
  rm -rf "/tmp/chrome-prof-$3"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=2500 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="/tmp/chrome-prof-$3" \
    --screenshot="$OUT/member-ui-a-rust-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-users/index.html?view=$1${4:-}" >/dev/null 2>&1
  echo "  $OUT/member-ui-a-rust-$3-v$VERSION.png"
}

shoot desktop       1440,760  desktop-users &
shoot mobile-list   430,1560  mobile-list &
shoot mobile-invite 430,932   mobile-invite &
shoot mobile-create 430,932   mobile-create &
shoot mobile-edit   430,932   mobile-edit &
# v1.198 (multi-user M2): het poortenpaneel boven Uitnodigen, in beide standen.
shoot desktop-invite 1440,980 desktop-invite &
shoot desktop-invite 1440,980 desktop-invite-rood '&rood=1' &
wait

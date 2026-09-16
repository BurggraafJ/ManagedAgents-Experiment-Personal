#!/usr/bin/env bash
# Rendert de vier Analyse-shots (v1.226): sessie-herstel + promptbibliotheek,
# desktop + mobiel. Zie main.jsx voor wat elke scène bewijst.
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
TMP="${CLAUDE_JOB_DIR:+$CLAUDE_JOB_DIR/tmp}"; TMP="${TMP:-/tmp}"
DIST="$TMP/preview-analyse-dist"
# Dynamische poort: een vaste poort botst met parallelle jobs en geeft stille
# 404-shots (geheugen headless-chrome-runner-pitfalls #7).
PORT="${PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}"
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-analyse/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-analyse/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >"$TMP/preview-analyse-server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

# shoot <view> <WxH> <scale> <bestandsnaam>
shoot() {
  local target="$OUT/$4-v$VERSION.png"
  local prof="$TMP/chrome-prof-analyse-$4"
  for attempt in 1 2 3 4; do
    rm -rf "$prof" "$target"
    timeout 60 "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
      --hide-scrollbars --virtual-time-budget=6000 --window-size="$2" \
      --force-device-scale-factor="$3" --user-data-dir="$prof" \
      --screenshot="$target" \
      "http://localhost:$PORT/scripts/preview-analyse/index.html?view=$1" >/dev/null 2>&1 || true
    [ -s "$target" ] && break
    echo "  poging $attempt mislukt voor $1"
  done
  [ -s "$target" ] || { echo "GEEN shot voor $1"; exit 3; }
  echo "  $target"
}

shoot desktop-restore 1440,900 1 analyse-session-restore-desktop
shoot mobile-restore  430,932  2 analyse-session-restore-mobile
shoot desktop-library 1440,900 1 analyse-prompt-library-desktop
shoot mobile-library  430,932  2 analyse-prompt-library-mobile

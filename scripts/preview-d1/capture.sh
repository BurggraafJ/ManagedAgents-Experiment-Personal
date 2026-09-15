#!/usr/bin/env bash
# Rendert het D1 Live-bord (echte view + echte hook, gestubte netwerklaag met de
# prod-rijen van 15-09-2026) en schrijft de PNG's in docs/previews/.
# Gebruik: npm run preview:d1 [-- <alleen-deze-view>]
#
# Zelfde aanpak als scripts/preview-d9: headless Chrome, geen Playwright.
# Er is bewust geen echte-sessie-pad — inloggen vraagt 2FA (en de mirror eist
# die ook, anders nul rijen); een component-harnas is de enige weg naar een
# reproduceerbare shot (geheugen `headless-screenshots-dashboard`).
set -euo pipefail

VERSION="$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)"
ALLEEN="${1:-}"
DIST="${PREVIEW_DIST:-/tmp/preview-d1-dist}"
PORT=${PORT:-5211}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-d1/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-d1/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js >"$DIST.build.log" 2>&1 || { tail -20 "$DIST.build.log"; exit 1; }

python3 -m http.server "$PORT" --directory "$DIST" >"$DIST.server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() { # view · viewport · doelnaam
  [ -z "$ALLEEN" ] || [ "$ALLEEN" = "$1" ] || return 0
  local doel="$OUT/d1-$3-v$VERSION.png"
  # ~1 op 3 headless shots op deze machine komt leeg terug (geheugen
  # `headless-chrome-runner-pitfalls`): tot drie pogingen, en een PNG onder
  # 20 kB telt als mislukt.
  for poging in 1 2 3; do
    rm -rf "$DIST.chrome-prof-$1"
    # --force-prefers-reduced-motion: de focus-split animeert de gridkolommen
    # (v1.210); met virtuele tijd landt een shot anders halverwege de transitie
    # en meet useMaat een tussenbreedte. Reduced motion = direct de eindstand.
    "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
      --force-prefers-reduced-motion \
      --hide-scrollbars --virtual-time-budget=4000 --window-size="$2" \
      --force-device-scale-factor=2 --user-data-dir="$DIST.chrome-prof-$1" \
      --screenshot="$doel" \
      "http://localhost:$PORT/scripts/preview-d1/index.html?view=$1" >/dev/null 2>&1 || true
    if [ -s "$doel" ] && [ "$(stat -c %s "$doel")" -gt 20000 ]; then break; fi
  done
  echo "  $doel"
}

# Het bord op BordShell scrollt niet: één venster van 1440 × 900 ís het bord.
# Bewust sequentieel: drie headless Chromes tegelijk leverden lege shots.
shoot desktop            1440,900  desktop
shoot licenties          1440,900  desktop-licenties
shoot focus-fase3        1440,900  desktop-focus-fase3
shoot focus-week         1440,900  desktop-focus-week
shoot focus-kanaal       1440,900  desktop-focus-kanaal
shoot focus-wissel       1440,900  desktop-focus-wissel
shoot focus-terug        1440,900  desktop-focus-terug
shoot focus-esc          1440,900  desktop-focus-esc
shoot focus-tweede-klik  1440,900  desktop-focus-tweede-klik
shoot focus-hover        1440,900  desktop-focus-hover
shoot hover              1440,900  desktop-hover
shoot shell              1440,900  shell
shoot shell-licenties    1440,900  shell-licenties
shoot shell-focus-fase3  1440,900  shell-focus-fase3
shoot shell-focus-week   1440,900  shell-focus-week
shoot shell-sync         1440,900  shell-sync
shoot shell-monthly      1440,1100 shell-monthly
shoot mobile             390,2400  mobile
shoot mobile-focus       390,1200  mobile-focus
shoot mobile-focus-terug 390,2400  mobile-focus-terug

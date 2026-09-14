#!/usr/bin/env bash
# Rendert het D10-klantverliesbord (echte view + echte hooks, gestubte
# netwerklaag) en schrijft de PNG's in docs/previews/. Gebruik: npm run preview:d10
#
# Zelfde aanpak als scripts/preview-d1 en -d9: headless Chrome, geen Playwright.
# Er is bewust geen echte-sessie-pad — inloggen vraagt 2FA en die mailt een
# code; een component-harnas is de enige weg naar een reproduceerbare shot
# (geheugen `headless-screenshots-dashboard`).
set -euo pipefail

VERSION="${1:-$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" src/version.js)}"
# PREVIEW_DIST overschrijfbaar: parallelle jobs delen /tmp (v1.186-les).
DIST="${PREVIEW_DIST:-/tmp/preview-d10-dist}"
PORT=${PORT:-5212}
OUT=docs/previews

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_ENTRY=./scripts/preview-d10/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-d10/mock-supabase.js \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js

python3 -m http.server "$PORT" --directory "$DIST" >"$DIST.server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

shoot() { # view · viewport · doelnaam
  rm -rf "$DIST-prof-$1"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --virtual-time-budget=3000 --window-size="$2" \
    --force-device-scale-factor=2 --user-data-dir="$DIST-prof-$1" \
    --screenshot="$OUT/d10-$3-v$VERSION.png" \
    "http://localhost:$PORT/scripts/preview-d10/index.html?view=$1" >/dev/null 2>&1
  echo "  $OUT/d10-$3-v$VERSION.png"
}

# Sinds v1.182 staat dit bord op BordShell en scrollt de pagina niet meer: één
# venster van 1440 × 900 ís het bord. De `desktop-vol`-shot van 3.000 px is
# daarom weg — hij zou de layoutregel verbergen die dit bord draagt. Had het
# bord een hogere shot nodig, dan was het kapot.
#
# Bewust sequentieel: drie headless Chromes tegelijk op deze machine leverden
# twee lege shots op zonder foutmelding (IMPLEMENT-D1 §6).
shoot desktop   1440,900 desktop      # zoals je binnenkomt — leeg detailpaneel
shoot drill     1440,900 drill        # een CS-lijst gekozen, records ernaast
shoot waarom    1440,900 waarom       # de snede waarom, twee bronnen gescheiden
shoot trend     1440,900 trend        # dertien maanden, C7 náást elkaar, één maand gekozen
shoot wanneer   1440,900 wanneer      # snede wanneer · B gekozen · C9 puntenrij in zone 4
shoot wanneerA  1440,900 wanneer-a    # snede wanneer · A gekozen · C9 histogram (n ≥ 30)
shoot maand     1440,900 maand        # paginafilter "deze maand" — F1/F7 in beeld
shoot leeg      1440,900 nietmaken    # de twee lege plekken in het paneel
shoot ontbreekt 1440,900 ontbreekt    # de disclosure van de vertrouwensregel
# Mobiel is het omgekeerde geval: dáár scrollt de pagina wél (de shell zakt
# onder 1000 px naar één kolom), dus een venster van 844 px zou precies de helft
# van het bord verzwijgen. 1.900 px toont het hele bord inclusief de
# vertrouwensregel; de horizontale maat van 390 is wat telt voor de toets.
shoot mobile    390,1900 mobile       # één kolom, pagina scrollt wél

#!/usr/bin/env bash
# Meet de re-render-kosten van de Agenda in het preview-harnas (v1.216).
#
# Bouwt het harnas, opent het met `&perf=1` (een React-Profiler om de hele
# agenda, zie main.jsx) en laat Chrome een VIRTUEEL tijdsbudget doorlopen —
# `--virtual-time-budget` spoelt timers vooruit, dus 95 virtuele seconden
# (drie klok-tikken van 30 s, één "nu"-tik per minuut) kosten echte seconden.
# Daarna leest `--dump-dom` de <title> waarin de stand staat:
#
#   PERF {"commits":N,"ms":M,"mounts":K,"t":…}
#
#   commits — updates NA de mount (klok, nu-lijn, realtime-stub …)
#   ms      — som van actualDuration over alle commits + mounts (React-tijd)
#
# Gebruik:  bash scripts/preview-agenda/perf.sh [desktop|mobile] [budget_ms]
# Draai hem NIET tegelijk met capture.sh: dezelfde Chrome-profielen en poort.
#
# ⚠ PREVIEW_PROFILING=1: in de productie-build van React is `Profiler.onRender`
# een no-op (gemeten: 0 commits, 0 mounts na 95 s — ook met `--mode
# development`, dat hier tóch de productiebundel gaf). vite.preview.config.js
# leidt `react-dom` dan om naar `react-dom/profiling`: productie-snelheid mét
# Profiler-timers. Vergelijk alleen metingen die allebei zo zijn gedaan.
set -euo pipefail

VIEW="${1:-desktop}"
BUDGET="${2:-95000}"
DIST=${DIST:-/tmp/preview-agenda-perf-dist}
PORT=${PORT:-5229}
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -n "$CHROME" ] || { echo "geen chrome/chromium gevonden"; exit 2; }

PREVIEW_PROFILING=1 \
PREVIEW_ENTRY=./scripts/preview-agenda/index.html \
PREVIEW_SUPABASE_MOCK=./scripts/preview-agenda/mock-supabase.js \
PREVIEW_HOOK_MOCKS="useAgenda=./scripts/preview-agenda/mock-hooks.js,useAutoDraft=./scripts/preview-agenda/mock-hooks.js" \
PREVIEW_OUT="$DIST" \
  npx vite build --config vite.preview.config.js --logLevel silent

python3 -m http.server "$PORT" --directory "$DIST" >/tmp/preview-agenda-perf-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

SIZE="1440,1000"; [ "$VIEW" = "mobile" ] && SIZE="430,1100"
rm -rf "/tmp/chrome-prof-agenda-perf-$VIEW"
"$CHROME" --headless=old --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --hide-scrollbars --virtual-time-budget="$BUDGET" --window-size="$SIZE" \
  --user-data-dir="/tmp/chrome-prof-agenda-perf-$VIEW" \
  --dump-dom "http://localhost:$PORT/scripts/preview-agenda/index.html?view=$VIEW&perf=1" 2>/dev/null \
  | grep -o '<title>PERF[^<]*</title>' | sed 's/<[^>]*>//g' || echo "geen PERF-titel gevonden (Chrome-crash? probeer opnieuw)"

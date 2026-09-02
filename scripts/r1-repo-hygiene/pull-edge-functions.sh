#!/usr/bin/env bash
# =============================================================================
# Fase R.1 — Edge Functions Pull
# =============================================================================
# Trekt live edge functions terug onder versie-controle.
# Gemaakt: 2026-05-03 in iteratie 2 van de Intelligence-architectuur.
#
# Vereist: SUPABASE_MANAGEMENT_TOKEN in environment of .env.local
# Project ref: ezxihctobrqoklufawim (Legal Mind)
#
# Wat dit script doet:
#   1. List alle edge functions in het Supabase project
#   2. Vergelijkt met wat al in supabase/functions/ staat
#   3. Pull elke ontbrekende function (metadata + body)
#   4. Schrijft per function: index.ts + README.md + deno.json (als die mist)
#   5. Logt resultaat naar pulled_log_<datum>.json
#
# Gebruik:
#   export SUPABASE_MANAGEMENT_TOKEN=<token>
#   bash scripts/r1-repo-hygiene/pull-edge-functions.sh
#
# Of in PowerShell:
#   $env:SUPABASE_MANAGEMENT_TOKEN="<token>"
#   bash scripts/r1-repo-hygiene/pull-edge-functions.sh
# =============================================================================

set -euo pipefail

PROJECT_REF="ezxihctobrqoklufawim"
API_BASE="https://api.supabase.com/v1/projects/${PROJECT_REF}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FUNCTIONS_DIR="${REPO_ROOT}/supabase/functions"
LOG_FILE="${REPO_ROOT}/scripts/r1-repo-hygiene/pulled_log_$(date +%Y%m%d).json"

# --- Token check ---------------------------------------------------------------
if [[ -z "${SUPABASE_MANAGEMENT_TOKEN:-}" ]]; then
  if [[ -f "${REPO_ROOT}/.env.local" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${REPO_ROOT}/.env.local"
    set +a
  fi
fi

if [[ -z "${SUPABASE_MANAGEMENT_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_MANAGEMENT_TOKEN niet gezet."
  echo "       Zet hem in environment of in .env.local (root van repo)."
  echo "       Token is in Supabase Vault als 'skill:global:supabase_management_token'."
  exit 1
fi

# --- Dependencies --------------------------------------------------------------
command -v jq >/dev/null 2>&1 || { echo "jq vereist — installeer eerst (npm i -g jq of choco install jq)"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl vereist"; exit 1; }

# --- Stap 1: list alle functions ----------------------------------------------
echo "→ Lijst edge functions ophalen..."
ALL_FUNCTIONS_JSON="$(curl -s -f \
  -H "Authorization: Bearer ${SUPABASE_MANAGEMENT_TOKEN}" \
  "${API_BASE}/functions")"

if [[ -z "${ALL_FUNCTIONS_JSON}" ]]; then
  echo "ERROR: lege response van /functions endpoint"
  exit 1
fi

# Extract slug + status
ALL_SLUGS="$(echo "${ALL_FUNCTIONS_JSON}" | jq -r '.[].slug')"
echo "  Gevonden $(echo "${ALL_SLUGS}" | wc -l) live functions:"
echo "${ALL_SLUGS}" | sed 's/^/    - /'
echo ""

# --- Stap 2: identificeer ontbrekende functions -------------------------------
declare -a MISSING=()
for slug in ${ALL_SLUGS}; do
  if [[ ! -d "${FUNCTIONS_DIR}/${slug}" ]]; then
    MISSING+=("${slug}")
  fi
done

if [[ ${#MISSING[@]} -eq 0 ]]; then
  echo "✓ Alle live functions zitten al in versie-controle."
  exit 0
fi

echo "→ Ontbrekend in repo (${#MISSING[@]}):"
printf '    - %s\n' "${MISSING[@]}"
echo ""

# --- Stap 3: pull elke ontbrekende function -----------------------------------
PULLED=()
FAILED=()

for slug in "${MISSING[@]}"; do
  echo "→ Pull ${slug}..."
  TARGET_DIR="${FUNCTIONS_DIR}/${slug}"
  mkdir -p "${TARGET_DIR}"

  # Metadata
  if ! META=$(curl -s -f \
    -H "Authorization: Bearer ${SUPABASE_MANAGEMENT_TOKEN}" \
    "${API_BASE}/functions/${slug}"); then
    echo "  ✗ Metadata pull faalde"
    FAILED+=("${slug}")
    continue
  fi

  # jq's `//` behandelt false als leeg, dus `.verify_jwt // true` maakte van
  # elke false een true in de README (gezien 2026-09-02 bij de F-14-pull).
  VERIFY_JWT=$(echo "${META}" | jq -r 'if has("verify_jwt") then .verify_jwt else true end')
  IMPORT_MAP=$(echo "${META}" | jq -r '.import_map // false')
  ENTRYPOINT=$(echo "${META}" | jq -r '.entrypoint_path // "index.ts"')
  CREATED_AT=$(echo "${META}" | jq -r '.created_at // ""')
  UPDATED_AT=$(echo "${META}" | jq -r '.updated_at // ""')
  VERSION=$(echo "${META}" | jq -r '.version // 1')

  # Source body (file bundle, returns multi-file JSON or single index.ts)
  if ! BODY_RESP=$(curl -s -f \
    -H "Authorization: Bearer ${SUPABASE_MANAGEMENT_TOKEN}" \
    -H "Accept: application/json" \
    "${API_BASE}/functions/${slug}/body"); then
    echo "  ✗ Body pull faalde"
    FAILED+=("${slug}")
    continue
  fi

  # Body is een EszipBundle of plain text — eerst proberen als JSON met files-array
  if echo "${BODY_RESP}" | jq -e '.files' >/dev/null 2>&1; then
    # Multi-file response
    echo "${BODY_RESP}" | jq -c '.files[]' | while IFS= read -r file_json; do
      file_name=$(echo "${file_json}" | jq -r '.name')
      file_content=$(echo "${file_json}" | jq -r '.content')
      file_path="${TARGET_DIR}/${file_name}"
      mkdir -p "$(dirname "${file_path}")"
      echo "${file_content}" > "${file_path}"
      echo "  + ${file_name}"
    done
  else
    # Single-file response — body is de raw source
    echo "${BODY_RESP}" > "${TARGET_DIR}/index.ts"
    echo "  + index.ts"
  fi

  # README.md
  cat > "${TARGET_DIR}/README.md" <<EOF
# ${slug}

> **Gepulled uit live Supabase op $(date '+%Y-%m-%d') als onderdeel van Fase R.1**
> (Repo-hygiëne — _Intelligence Architecture_ project, zie \`skills/datascience/references/current_architecture.md\`)

## Metadata bij pull

| Veld | Waarde |
|---|---|
| Slug | \`${slug}\` |
| Versie (Supabase) | ${VERSION} |
| Aangemaakt | ${CREATED_AT} |
| Laatste update (live) | ${UPDATED_AT} |
| verify_jwt | ${VERIFY_JWT} |
| import_map | ${IMPORT_MAP} |
| entrypoint | ${ENTRYPOINT} |

## Wat doet deze function?

> _TODO bij Jelle's review:_ vul deze sectie in met een korte beschrijving van wat de function doet, hoe vaak ze draait, en welke tabellen ze raakt.

## Cron / triggers

> _TODO_

## Schema-impact

> _TODO_

## Source-of-truth

Deze repo is per ${UPDATED_AT} (laatste live update) de source-of-truth.
Toekomstige wijzigingen: PR + deploy via Supabase Management API
(zie \`skills/agent-handbook/references/database.md\` voor het deploy-pattern).
EOF
  echo "  + README.md"

  # deno.json (als hij ontbreekt)
  if [[ ! -f "${TARGET_DIR}/deno.json" ]]; then
    cat > "${TARGET_DIR}/deno.json" <<'EOF'
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
  }
}
EOF
    echo "  + deno.json (default)"
  fi

  PULLED+=("${slug}")
  echo "  ✓ ${slug} klaar"
  echo ""
done

# --- Stap 4: log naar JSON ----------------------------------------------------
{
  echo "{"
  echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"project_ref\": \"${PROJECT_REF}\","
  echo "  \"total_live_functions\": $(echo "${ALL_SLUGS}" | wc -l),"
  echo "  \"missing_at_start\": ${#MISSING[@]},"
  echo "  \"pulled_count\": ${#PULLED[@]},"
  echo "  \"failed_count\": ${#FAILED[@]},"
  echo "  \"pulled\": [$(printf '"%s",' "${PULLED[@]}" | sed 's/,$//')]" ,
  echo "  \"failed\": [$(printf '"%s",' "${FAILED[@]}" | sed 's/,$//')]"
  echo "}"
} > "${LOG_FILE}"

# --- Samenvatting -------------------------------------------------------------
echo "================================================================"
echo "✓ R.1 edge function pull klaar"
echo "  Gepulled : ${#PULLED[@]} (${PULLED[*]:-})"
echo "  Gefaald  : ${#FAILED[@]} ${FAILED[*]:-}"
echo "  Log      : ${LOG_FILE}"
echo "================================================================"
echo ""
echo "Volgende stap: review elke nieuwe directory in supabase/functions/,"
echo "vul de README.md _TODO_-secties in, en commit naar main."
echo ""
echo "Daarna: bash scripts/r1-repo-hygiene/pull-rag-rpcs.sh"

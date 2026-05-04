#!/usr/bin/env bash
# =============================================================================
# Fase R.1 — RAG-RPC's documenteren als migration
# =============================================================================
# Trekt definities van match_all_sources, sync_health* en aanverwante RPC's
# uit de live Supabase database en schrijft ze naar een migration-bestand.
#
# Vereist: SUPABASE_MANAGEMENT_TOKEN (zie pull-edge-functions.sh).
#
# Doel: voorkomen dat RPC's "ghost"-versies in Supabase-console hebben zonder
# in versie-controle te staan. Na deze pull weet elke toekomstige sessie
# waar de bron-van-waarheid voor deze RPC's is.
# =============================================================================

set -euo pipefail

PROJECT_REF="ezxihctobrqoklufawim"
API_BASE="https://api.supabase.com/v1/projects/${PROJECT_REF}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATION_FILE="${REPO_ROOT}/migrations/rag_rpcs_documentation_$(date +%Y_%m_%d).sql"

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
  exit 1
fi

# --- RPC's om te documenteren -------------------------------------------------
# (Plus alle bekende varianten/legacy versies — voor volledigheid)
RPCS=(
  "match_all_sources"
  "match_chunks"            # bestaat nog niet, wordt R.4 — included voor toekomst
  "sync_health"
  "sync_health_all"
  "assert_freshness"
  "match_jellemind_lessons"
  "submit_jellemind_decision"
  "get_skill_secret_service"
  "search_contactpersonen"
  "suggest_task_project"
  "detect_task_completion_candidates"
)

# --- Helper: pgsql query via Management API -----------------------------------
query_pg() {
  local sql="$1"
  curl -s -f -X POST \
    -H "Authorization: Bearer ${SUPABASE_MANAGEMENT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"query\":${sql}}" \
    "${API_BASE}/database/query"
}

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

# --- Header van migration-file ------------------------------------------------
mkdir -p "$(dirname "${MIGRATION_FILE}")"
cat > "${MIGRATION_FILE}" <<EOF
-- =============================================================================
-- RAG RPC documentation snapshot
-- Gegenereerd op $(date -u +%Y-%m-%dT%H:%M:%SZ) door pull-rag-rpcs.sh
-- Onderdeel van Fase R.1 — Repo-hygiëne (zie current_architecture.md §7)
-- =============================================================================
--
-- DOEL: dit bestand is de single source of truth voor de RPC-definities
-- die de Intelligence-architectuur draaiend houden. Het wordt gegenereerd
-- door de live Supabase database te bevragen — als een RPC hier niet in
-- staat, hoort hij niet te bestaan; als hij hier WEL in staat maar live
-- afwijkt, run dit bestand opnieuw via supabase db push.
--
-- BEKENDE RPC's:
--   - match_all_sources              (RAG-retrieval; v2 gebruikt door rag-search + autodraft-rag-prefill)
--   - match_chunks                   (TOEKOMSTIG, fase R.4 — placeholder hier voor opzoeking)
--   - sync_health, sync_health_all   (freshness-check per source)
--   - assert_freshness               (guard-functie voor edge functions vóór retrieval)
--   - match_jellemind_lessons        (vector-search over jellemind_lessons)
--   - submit_jellemind_decision      (write-path voor lesson accept/reject/amend)
--   - get_skill_secret_service       (Vault-lookup voor edge functions)
--   - search_contactpersonen         (fuzzy contact-zoek; pg_trgm + JOIN)
--   - suggest_task_project, detect_task_completion_candidates  (task-organizer support)
--
-- HEROUTBARE GEBRUIK: dit bestand is idempotent — alle CREATE OR REPLACE.
-- Run \`supabase db push\` om het toe te passen op een ander environment.
-- =============================================================================

EOF

# --- Loop: per RPC, haal definitie op ----------------------------------------
for rpc_name in "${RPCS[@]}"; do
  echo "→ Documenteer ${rpc_name}..."

  # Query: alle overloads van de RPC in public schema
  SQL=$(cat <<SQL
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = '${rpc_name}'
ORDER BY p.oid;
SQL
)
  ESCAPED_SQL=$(echo "${SQL}" | json_escape)

  RESULT=$(query_pg "${ESCAPED_SQL}" 2>/dev/null || echo '[]')
  COUNT=$(echo "${RESULT}" | jq 'length' 2>/dev/null || echo 0)

  if [[ "${COUNT}" == "0" ]]; then
    echo "  ⚠ Geen definitie gevonden in public.${rpc_name} — skip"
    {
      echo ""
      echo "-- ============================================================================="
      echo "-- ${rpc_name} : NIET GEVONDEN op moment van pull ($(date -u +%Y-%m-%d))"
      echo "-- ============================================================================="
      echo ""
    } >> "${MIGRATION_FILE}"
    continue
  fi

  echo "  + ${COUNT} overload(s) gevonden"
  {
    echo ""
    echo "-- ============================================================================="
    echo "-- ${rpc_name}"
    echo "-- ============================================================================="
    echo "${RESULT}" | jq -r '.[] | "-- args: " + .args + "\n" + .definition + ";\n"'
  } >> "${MIGRATION_FILE}"
done

echo ""
echo "✓ Migration geschreven: ${MIGRATION_FILE}"
echo ""
echo "Volgende stap: review het bestand, commit naar main."
echo "Bij subsequent wijzigingen op een van deze RPC's: pas dit bestand AAN"
echo "(niet opnieuw genereren), commit, en run via supabase db push."

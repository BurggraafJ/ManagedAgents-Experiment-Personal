# R.1 Runbook — Repo-hygiëne

> **Fase 1 van het Intelligence-architectuur migratiepad (zie `current_architecture.md` §7).**
> Status: **klaar voor uitvoering** — scripts staan in `scripts/r1-repo-hygiene/`, wachten op Supabase Management Token.

## Waarom deze fase eerst?

Live edge functions en RPC's die niet in deze repo zitten zijn onaanraakbaar — geen code-review, geen rollback-pad, geen CI. Voor we _enige_ andere fase aanraken (chunks-tabel, hybrid retrieval, context-build), moeten alle bewegende delen onder versie-controle. Dit is letterlijk een prerequisite van R.2 t/m R.10.

## Wat wel/niet in repo zit (snapshot 2026-05-03)

**In `dashboard-react/supabase/functions/` (al onder versie-controle):**
- `mail-sync-etl-v2`
- `hubspot-sync-etl`
- `jira-sync-etl`
- `jellemind-embed`
- `task-organizer-fireflies`
- `km-distance-lookup`
- `km-excel-generate`
- `vercel-control`
- `grok-legal-ai-research`
- `grok-legal-ai-write`

**Live op Supabase, NIET in repo (te pullen)**:
- `mail-embed` — embedding-pipeline (cron */2 min, alle 8 truth-of-source tabellen)
- `autodraft-rag-prefill` — pre-compute rag_context (cron */3 min)
- `rag-search` — endpoint voor zoekpagina
- `outlook-calendar-sync-etl` — calendar mirror
- `mail-backfill` — mogelijk inactief; checken via `pull-edge-functions.sh`
- _Eventueel onbekend_ — script lijst alle functions en pullt wat ontbreekt

**RPC's in repo (`migrations/`)**:
- `search_contactpersonen` (in contactpersonen_f1_schema.sql)
- `suggest_task_project` + `detect_task_completion_candidates` (in task_organizer_rpcs.sql)
- Diverse autodraft-RPC's, jellemind-RPC's, etc. — in eigen migration-files

**RPC's NIET in repo (alleen in Supabase-console)**:
- `match_all_sources` v2 — hoofd-RAG-RPC
- `sync_health`, `sync_health_all`, `assert_freshness` — freshness-checks
- `match_jellemind_lessons` — vector-search over lessons (mogelijk wel in lokale migration, te checken)
- `submit_jellemind_decision` — write-path lesson-acceptatie
- `get_skill_secret_service` — Vault-lookup

## Stappen

### Stap 0: Supabase Management Token beschikbaar maken

Token zit in Vault: `skill:global:supabase_management_token`.

Pad-A — DB-toegang (postgres-rol):
```sql
SELECT decrypted_secret FROM vault.decrypted_secrets
 WHERE name = 'skill:global:supabase_management_token';
```

Pad-B — via service-role key + RPC (in een Supabase Studio SQL editor, ingelogd als service):
```sql
SELECT get_skill_secret_service('global', 'supabase_management_token');
```

Pad-C — vraag Jelle direct (snelst).

Schrijf de token tijdelijk naar `dashboard-react/.env.local`:
```env
SUPABASE_MANAGEMENT_TOKEN=sbp_...
```

> **`.env.local` is in `.gitignore`** — niet committen. PAT is gevoelig; rotatie via Supabase Account Settings → Access Tokens.

### Stap 1: Edge functions pullen

```bash
cd dashboard-react
bash scripts/r1-repo-hygiene/pull-edge-functions.sh
```

Wat gebeurt:
- Lijst alle live functions via Supabase Management API
- Vergelijkt met `supabase/functions/`
- Pullt alle ontbrekende: `index.ts` + `README.md` + `deno.json`
- Log naar `scripts/r1-repo-hygiene/pulled_log_<datum>.json`

### Stap 2: RPC-snapshot maken

```bash
bash scripts/r1-repo-hygiene/pull-rag-rpcs.sh
```

Wat gebeurt:
- Voor elke bekende RPC: `pg_get_functiondef()` ophalen via Management API
- Schrijven naar `migrations/rag_rpcs_documentation_<datum>.sql`
- Bevat `CREATE OR REPLACE FUNCTION` zodat het idempotent toegepast kan worden

### Stap 3: Review + commit

Per nieuwe edge function:
1. Open de gepulde `index.ts`. Lees door op:
   - **Hardcoded credentials** (zou niet mogen — alles via env-vars / Vault)
   - **Externe dependencies** die we niet kennen
   - **Schema-aannames** (welke tabellen leest/schrijft hij?)
2. Vul `README.md` _TODO_-secties in:
   - Wat doet deze function (1-2 zinnen)
   - Cron / triggers (uit `pg_cron.job` of `agent_schedules`)
   - Schema-impact (welke tabellen)
3. Update `agent-handbook/references/platform.md` als de function daar niet in genoemd wordt.

Per RPC-migration:
1. Lees `rag_rpcs_documentation_<datum>.sql` door.
2. Vergelijk met huidige `current_architecture.md` §2.5 — staan de signatures gelijk? Pas anders aan.
3. Toekomstige RPC-wijzigingen: edit dit bestand + `supabase db push`. **Niet meer in Studio direct.**

### Stap 4: Verifieer + commit

```bash
git status
git add supabase/functions/ migrations/rag_rpcs_documentation_*.sql scripts/r1-repo-hygiene/
git commit -m "R.1 repo-hygiene: pull live edge functions + RPC-snapshot

- 4-5 edge functions onder versie-controle gebracht
- match_all_sources + sync_health* gedocumenteerd in migration
- README's met TODO's voor enrichment
- Onderdeel van Intelligence-architectuur fase R.1

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Stap 5: `current_architecture.md` updaten

- Markeer R.1 als ✅ done in §7.
- Update §2.3 + §2.6 met file:line-verwijzingen naar de nu-geverioneerde edge functions.
- Update §2.5 met file:line naar de RPC-migration.
- Update audit-log §15 met datum + sessie-context.
- Werk de Intelligence Hub view (R.9) op TODO als die nog niet bestaat.

## Verwachte resultaten

| Output | Locatie | Grootte |
|---|---|---|
| 4-5 nieuwe edge function directories | `supabase/functions/<slug>/` | per function ~3-50 KB source |
| 1 RPC-migration file | `migrations/rag_rpcs_documentation_<datum>.sql` | ~20-50 KB tekst |
| 1 pull-log JSON | `scripts/r1-repo-hygiene/pulled_log_<datum>.json` | <1 KB |
| Updated platform.md | `skills/agent-handbook/references/platform.md` | +5-10 regels |
| Updated current_architecture.md | `skills/datascience/references/current_architecture.md` | +3-5 regels in audit-log + §7 |

## Tijdsverwachting

- Token regelen: 5 min (Jelle-afhankelijk)
- Edge functions pullen: 2-3 min (script-runtime)
- RPC-snapshot: 1-2 min
- README's invullen: 30-60 min (handmatig — depends op kennis van elke function)
- Review + commit: 15 min
- **Totaal: 1-2 uur**, met token in handen.

## Bij problemen

Zie `scripts/r1-repo-hygiene/README.md` § "Bij problemen" — error → diagnose → oplossing tabel.

## Wat na R.1?

R.2 — auto-draft `rag_context` laten lezen + mini-baseline-meting (~2-3 dagen werk). Dat is de eerstvolgende fase, en de eerste die _meetbaar_ effect oplevert. Pas daarna verder naar R.3 (chunks-tabel + chunkers).

## Audit-log van dit runbook

| Datum | Wijziging |
|---|---|
| 2026-05-03 | Eerste versie. Scripts in `scripts/r1-repo-hygiene/` klaar voor uitvoering. |

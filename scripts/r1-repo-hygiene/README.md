# R.1 — Repo-hygiëne scripts

Deze map bevat de tooling voor **Fase R.1** van het Intelligence-architectuur project (zie `skills/datascience/references/current_architecture.md` §7).

## Doel

Live edge functions en RPC-definities die op Supabase draaien maar niet in deze repo staan, terugtrekken onder versie-controle. Zonder dit kan geen enkele andere fase veilig worden uitgevoerd.

## Wat ontbreekt op moment van schrijven (2026-05-03)

**Edge functions** (per `agent-manager/references/state-queries.md` + memory-entries):
- `mail-embed` — embedding-pipeline, cron */2 min
- `autodraft-rag-prefill` — pre-compute van rag_context, cron */3 min
- `rag-search` — endpoint voor de zoekpagina
- `outlook-calendar-sync-etl` — calendar mirror
- `mail-backfill` — historische mail-import (mogelijk al afgerond/inactive)

**RPC's** (in Supabase-console aangemaakt, niet in `migrations/`):
- `match_all_sources` (v2) — hoofd-RAG-RPC
- `sync_health`, `sync_health_all`, `assert_freshness` — freshness-checks
- mogelijk anderen — `pull-rag-rpcs.sh` checkt automatisch

## Vereisten

1. **Supabase Management Token** — Personal Access Token. Plek: Supabase Vault als `skill:global:supabase_management_token`. Aliases: SUPABASE_MANAGEMENT_TOKEN, SUPABASE_ACCESS_TOKEN.
2. **CLI-tools**: `bash`, `curl`, `jq`, `python3` (voor json-escape).
3. **Schrijftoegang** in `dashboard-react/supabase/functions/` en `dashboard-react/migrations/`.

## Hoe gebruiken

### Stap 0: Token beschikbaar maken

Maak een `.env.local` in de root van `dashboard-react/`:

```env
SUPABASE_MANAGEMENT_TOKEN=sbp_...
```

Of zet hem in environment vóór de scripts:

```bash
export SUPABASE_MANAGEMENT_TOKEN=sbp_...
```

> **Veiligheid**: `.env.local` staat in `.gitignore`. Token is een PAT, geen anon-key — niet committen.

### Stap 1: Edge functions pullen

```bash
cd dashboard-react
bash scripts/r1-repo-hygiene/pull-edge-functions.sh
```

Output:
- Per ontbrekende function een nieuwe directory in `supabase/functions/<slug>/` met:
  - `index.ts` (source-code)
  - `README.md` (metadata + TODO-secties voor handmatige enrichment)
  - `deno.json` (default als die ontbreekt)
- Log-bestand `pulled_log_<datum>.json` in deze map.

### Stap 2: RPC's documenteren

```bash
bash scripts/r1-repo-hygiene/pull-rag-rpcs.sh
```

Output:
- `migrations/rag_rpcs_documentation_<datum>.sql` met `CREATE OR REPLACE FUNCTION` voor elke gevonden RPC.
- Bij ontbrekende RPC's: een commentaar-blok dat dat documenteert.

### Stap 3: Review + commit

Per nieuwe edge function:
1. Lees de gepulde `index.ts` door op rode vlaggen (hardcoded keys, vreemde dependencies).
2. Vul de `README.md` _TODO_-secties in (wat doet de function, hoe vaak, welke tabellen).
3. Voeg toe aan `agent-handbook/references/platform.md` als die nog niet de Edge Function noemt.

Per RPC-migration:
1. Open `rag_rpcs_documentation_<datum>.sql` en lees door.
2. Markeer dit als de single source of truth voor deze RPC's vanaf nu.
3. Toekomstige RPC-wijzigingen: edit deze migration + run `supabase db push`.

Daarna één commit voor alles, met als boodschap:
```
R.1 repo-hygiene: pull live edge functions + RPC-snapshot

- 4-5 edge functions onder versie-controle gebracht
- match_all_sources + sync_health* gedocumenteerd in migration
- README's met TODO's voor enrichment
- Onderdeel van Intelligence-architectuur fase R.1
```

## Wat dit script NIET doet

- **Geen deploy van wijzigingen.** Pure pull. Wijzigingen pushen gaat via reguliere `supabase functions deploy <slug>` (zie `agent-handbook/references/database.md`).
- **Geen secrets in repo.** Eventuele env-vars die de live function gebruikt blijven in Supabase. Dit script schrijft alleen source.
- **Geen runtime-test.** Of de gepulde code nog draait moet je via Supabase log-view checken.

## Bij problemen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| `401 Unauthorized` | Token ongeldig of geroteerd | Haal nieuwe token uit Vault — zie memory `supabase_management_token.md` |
| `403 Forbidden` op `/functions/{slug}/body` | Function bestaat maar token mist scope | Token moet `read:project` scope hebben |
| Multi-file response wordt single-file behandeld | Script-bug | Check in `pulled_log` welke functions `multi_file=false` zijn ondanks meerdere files |
| Body komt als geseerialiseerde Eszip-bundle | API-versie wijziging | Script aanpassen — nieuwe Supabase API kan andere format teruggeven |

## Audit-log

| Datum | Actie | Resultaat |
|---|---|---|
| 2026-05-03 | Scripts aangemaakt door datascience skill (iteratie 2) | Klaar voor uitvoering — wacht op token |

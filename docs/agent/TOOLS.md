# Tools en recepten van de Maestro-chat

> **GEGENEREERD BESTAND — niet met de hand bewerken.**
> `node scripts/agent_docs_generate.cjs` schrijft het opnieuw uit de bron:
> `TOOL_CATALOG` (analytics.ts), `toolSchemas()` (agentic.ts) en `context_intents`.
> `--check` faalt als dit bestand achterloopt. Een werkpakket is niet af tot het
> schoon hergenereert.

Bron-teller: 9 metric-tools · 8 agent-tools · 11 recepten.

## 1. Metric-tools (structured route)

Deterministisch: één RPC, één definitie, geen model tussen vraag en getal. De
`definition` hieronder is wat in het antwoord terechtkomt als verantwoording —
en straks als kolomtoelichting in een Excel-export.

| tool | RPC | definitie |
|---|---|---|
| `churned_in_window` | `analytics_churned_in_window` | Churn-administratie (churn_customers, zonder superseded records); venster op churned_at. |
| `uncontacted_since` | `analytics_uncontacted_since` | Actieve Customer Base-deals (Proeftijd/Actieve deals/Eenpitters/Self-service) met company-domein; laatste contact = nieuwste in- of uitgaande mail op domein-match. |
| `active_pilots` | `analytics_active_pilots` | Customer Base stage 'Proeftijd' plus Sales Pipeline '1-pitters in proefperiode (zonder ovk)'. |
| `count_by_stage` | `analytics_count_by_stage` | Niet-gearchiveerde HubSpot-deals, gegroepeerd op pipeline en fase-label. |
| `deals_over_amount` | `analytics_deals_over_amount` | HubSpot-deals met gevuld amount-veld (veld is in de praktijk vrijwel leeg — beperkte dekking). |
| `customers_by_price` | `analytics_customers_by_price` | Lopende Customer Base-deals (Proeftijd/Actieve deals/Eenpitters/Self-service) met licentieprijs-per-gebruiker of vaste maandprijs gelijk aan het gevraagde bedrag (HubSpot licentie-properties, W5-mirror). |
| `started_in_window` | `analytics_started_in_window` | Customer Base-deals op HubSpot-property startdatum (contractstart), ongeacht huidige fase. |
| `license_value` | `analytics_license_value` | Per lopende Customer Base-klant: vaste maandprijs, anders prijs-per-gebruiker × minimale licenties, met korting verrekend (HubSpot licentie-properties). |
| `no_data` | — | Geen databron beschikbaar voor dit veld. |

## 2. Agent-tools (agentic route)

Wat de onderzoeks-agent zelf mag aanroepen. Het onderzoek telt hier de grens waar
toolselectie meetbaar degradeert (15-20 tools) — zie WP8 voor het groeperen naar
ongeveer acht.

| tool | wat het doet |
|---|---|
| `calendar_search` | Doorzoek de Outlook-agenda op keyword-regex (case-insensitive, over onderwerp + omschrijving). |
| `notes_search` | Doorzoek HubSpot-notities/meetings/calls op keyword-regex, met gekoppelde bedrijven. |
| `semantic_search` | Semantisch zoeken in de volledige kennisindex (mail, meetings, notities, Jira én de gespiegelde Confluence-pagina's — vector + keywords). |
| `confluence_search` | Doorzoek alléén de gespiegelde Confluence-wiki (documentatie, handboeken, beleid, werkwijzen). |
| `confluence_get_page` | Haal één Confluence-pagina volledig op, op page_id of op (deel van) de titel. |
| `customer_timeline` | Volledige recente tijdlijn van één klant/bedrijf op naam (fuzzy): laatste mailthreads, HubSpot-notities en churn-status. |
| `mail_evidence_search` | Signaal-voorfilter over het mailarchief: kandidaten + snippets die de keywords/topics raken. |
| `my_mail_search` | Doorzoek de eigen, VERRIJKTE mailbox van de vrager${mirror.mailbox ? |

## 3. Retrieval-recepten (`context_intents`)

Elk recept is een rij, dus tunebaar zonder redeploy. `bm25_enabled: false` zet de
lexicale arm van `match_chunks` uit — gemeten 7 ms in plaats van 1-10 s, ten koste
van lexicale recall. Zie migratie `20260905180000_search_fast_intent.sql`.

| recept | strategie | top_k | min_sim | rerank | intel | anchors | bm25 | bronfilter |
|---|---|---:|---:|---|---|---:|---|---|
| `analyze_meeting` | match_chunks_for_entity | 10 | 0.3 | nee | entity | 4 | aan | — |
| `classify_mail_action` | hybrid | 5 | 0.45 | nee | off | 0 | aan | — |
| `compose_followup` | match_chunks_for_entity | 10 | 0.3 | nee | full | 4 | aan | — |
| `draft_reply` | hybrid | 5 | 0.6 | nee | off | 0 | aan | — |
| `enrich_record` | match_chunks_for_entity | 8 | 0.3 | nee | full | 4 | aan | — |
| `extract_actions` | match_chunks_for_entity | 10 | 0.3 | nee | full | 0 | aan | — |
| `learn_pattern` | match_chunks | 5 | 0.4 | nee | off | 0 | aan | — |
| `match_appointment` | match_chunks_for_entity | 5 | 0.3 | nee | off | 0 | aan | — |
| `search` | hybrid | 15 | 0.3 | ja | full | 4 | aan | — |
| `search_docs` | match_chunks | 10 | 0.42 | nee | off | 0 | aan | {confluence,kb_article} |
| `search_fast` | match_chunks | 40 | 0.30 | nee | entity | 0 | UIT | — |

## 4. Welk recept krijgt een chatvraag?

```
vraag → router (gpt-5.6-luna)
        ├── structured → metric-tool uit §1 (geen retrieval)
        ├── sweep      → mail-voorfilter + batched verdicts
        ├── agentic    → agent-tools uit §2 (semantic_search gebruikt `search`)
        └── semantic   → `search_docs` bij een documentatievraag, anders `search_fast`
```

Het zware `search`-recept is sinds v1.146 géén chatroute meer: het is alleen nog
bereikbaar als agent-tool, met een eigen budget van 30 s. Gemeten reden staat in
`docs/agent/DECISIONS.md` (2026-09-05).


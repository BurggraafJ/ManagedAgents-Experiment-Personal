---
name: jellemind
description: Cross-agent preference-learning agent voor Legal Mind. Eens per dag oogst correcties die Jelle deed op output van andere agents (autodraft_decisions amendments, agent_proposals amended, agent_feedback, hand-edited tasks, sales_on_road note rewrites). Clustert patronen en stelt max 5 voorzichtige lesson-voorstellen per dag voor in de JelleMind dashboard-tab. Pas na Jelle's accept landt een rij in jellemind_lessons (vector-searchable). Trigger bij 'draai jellemind', 'leer mijn voorkeuren', 'wat voor patronen zie je', of handmatig via dashboard. Trigger NIET om zelf lessons te schrijven (alleen Jelle accepteert) of om bestaande agents aan te passen (= fase F.6, niet in scope nu).
---

# JelleMind

Cross-agent leerling-redacteur. Kijkt waar Jelle de output van andere agents heeft gecorrigeerd, destilleert daaruit voorzichtige voorkeur-regels, en wacht op Jelle's bevestiging voor er iets in de lesson-store landt.

## Doel in één zin

Lees alle correcties die Jelle de afgelopen 24u heeft gemaakt op output van zes werk-agents, cluster patronen, en stel **maximaal 5 nieuwe** lesson-voorstellen voor — voor Jelle om te accepteren, te wijzigen of af te wijzen.

## Wat de skill NIET doet

- **Geen lessons schrijven.** Alle lessons komen tot stand via `submit_jellemind_decision(action='accept')` — door Jelle, niet door deze skill.
- **Geen andere agents aanpassen.** Auto-draft, daily-admin etc. lezen JelleMind nu nog niet. Dat is fase F.6, expliciet uit scope.
- **Geen mailen, HubSpot-mutaties, Slack-berichten.** Alle output landt in `jellemind_*` tabellen.
- **Geen retroactief patronen-bouwen op heel oude data.** Werk-window is afgelopen 14 dagen; ouder is voor de eerste run.

## Bronnen die de skill leest

| Tabel | Waarvoor |
|---|---|
| `public.autodraft_decisions` (action='amend') | mail-amendments — `source_draft_body` vs `final_body` |
| `public.agent_proposals` (status='amended') | proposal-amendments — `proposal` jsonb vs `amendment` text |
| `public.agent_feedback` (status='unprocessed') | direct-feedback van Jelle, vrije tekst |
| `public.tasks` (`ai_processed=false` na eerdere AI-keuze) | task-edits waar Jelle clustering/deadline/prioriteit overschreef |
| `public.sales_on_road_events` (status='processed', notes overschreven) | gespreks-notitie rewrites |
| `public.jellemind_signals` (`processed=false`) | signalen van vorige runs die nog onverwerkt liggen |
| `public.jellemind_lesson_proposals` (`status='amended'`) | door Jelle aangepaste voorstellen — re-emit als nieuwe pending proposal |
| `public.agent_config('openai','embedding_key')` | OpenAI-key voor embedden van geaccepteerde lessons |

## Wat de skill schrijft

| Tabel | Wanneer |
|---|---|
| `public.jellemind_signals` | per gevonden correctie, één rij (gededupliceerd op `signal_type+source_table+source_id`) |
| `public.jellemind_lesson_proposals` | max 5 nieuwe per run, uit clusters met ≥3 ondersteunende signalen |
| `public.jellemind_lessons` (UPDATE only) | bij pass 4 — vult `embedding`, `embedding_input_hash`, `embedded_at`, `embedding_model` |
| `public.agent_runs` | één run-rij met stats |

## De vier passes

### Pass 1 — Harvest (oogst signalen)

**Tijdvenster:** afgelopen 24u (eerste run: afgelopen 14 dagen, gecapped op 200 signalen).

**1a. Mail-amendments uit `autodraft_decisions`:**

```sql
SELECT id, mail_id, source_draft_body, final_body, amend_instructions, decided_at
  FROM autodraft_decisions
 WHERE action = 'amend'
   AND decided_at >= now() - interval '24 hours'
   AND source_draft_body IS NOT NULL
   AND final_body IS NOT NULL
   AND source_draft_body <> final_body;
```

Voor elk: insert rij in `jellemind_signals` met
`signal_type='autodraft_amended'`, `agent_name='auto-draft'`, `source_table='autodraft_decisions'`, `source_id=id::text`, `before_text=source_draft_body`, `after_text=final_body`, `delta_summary=<zie hieronder>`.

**1b. Proposal-amendments uit `agent_proposals`:**

```sql
SELECT id, agent_name, proposal, amendment, summary, reviewed_at
  FROM agent_proposals
 WHERE status = 'amended'
   AND reviewed_at >= now() - interval '24 hours'
   AND amendment IS NOT NULL;
```

`signal_type='proposal_amended'`, `before_text=summary || E'\n' || proposal::text`, `after_text=amendment`.

**1c. Direct feedback uit `agent_feedback`:**

```sql
SELECT id, agent_name, feedback_text, created_at
  FROM agent_feedback
 WHERE status = 'unprocessed'
   AND created_at >= now() - interval '24 hours';
```

`signal_type='direct_feedback'`, `before_text=NULL`, `after_text=feedback_text`. Markeer rij na verwerking als `status='processed', processed_at=now()`.

**1d. Task-edits.** Tasks waar Jelle de AI-keuze heeft overschreven (`ai_processed=true` maar daarna handmatig bewerkt). Detectie: `tasks.updated_at > tasks.ai_last_review + interval '5 minutes' AND tasks.updated_at >= now() - interval '24 hours'`.

`signal_type='task_edited'`, `before_text=ai_reasoning`, `after_text='[user edited project/priority/deadline]'`.

**1e. Sales-on-road note rewrites.** `sales_on_road_events` waar `status='processed'` en `notes_final <> notes_proposed`. Mappen naar `note_rewritten`.

**Dedup:** unique-constraint op `(signal_type, source_table, source_id)` voorkomt dubbele inserts. Doe `INSERT ... ON CONFLICT DO NOTHING`.

**Delta-summary genereren** (één zin, ≤120 tekens). Patroon:
- Voor before/after-paren: vergelijk en formuleer vanuit Jelle's perspectief — "Jelle veranderde 'u' in 'je' (3×)", "Jelle verkortte de afsluiting van 4 naar 1 zin".
- Voor direct-feedback: extracteer kern — "Jelle wil korter, geen formele aanhef".
- Houd het feitelijk. Geen interpretatie of psychologisering.

### Pass 2 — Cluster

Doel: groepeer onverwerkte signalen die op hetzelfde patroon wijzen.

**Werkset:**

```sql
SELECT id, signal_type, agent_name, before_text, after_text, delta_summary, occurred_at
  FROM jellemind_signals
 WHERE processed = false
   AND harvested_at >= now() - interval '14 days'
 ORDER BY occurred_at DESC;
```

**Twee clusterstrategieën — combineer ze:**

**A. Rule-based klassen** (snel, deterministisch). Tag elk signaal met één of meer van:

| Klasse | Detectie-heuristiek |
|---|---|
| `pronoun_je_vs_u` | regex match op `\b[Uu]\b` of `[Uu]w` in before, en `\b[Jj]e\b` of `[Jj]ouw` in after (of omgekeerd) |
| `length_shorter` | `length(after) < 0.7 * length(before)` |
| `length_longer` | `length(after) > 1.4 * length(before)` |
| `formal_to_casual` | greetings/sign-offs verschillen — "Geachte" → "Hoi", "Met vriendelijke groet" → "Groet" |
| `casual_to_formal` | omgekeerd |
| `deadline_added` | datum/tijd in after, niet in before |
| `terminology_swap` | specifieke woord-vervangingen (bv. "advocaten" ↔ "advocatenkantoor") — extraheer woord-paren |

**B. Delta-summary-keywords** voor signalen die geen rule-class hebben. Tokeniseer `delta_summary`, pak top-3 woorden ≥4 tekens, normaliseer (lowercase + verwijder accenten), groepeer signalen met overlap ≥2 keywords.

**Cluster-output:** een lijst van `(class_or_keyword_set, [signal_ids])`. Cluster met <3 signalen overslaan voor pass 3.

### Pass 3 — Propose

**Voor elk cluster met ≥3 signalen:**

1. **Check op contradicting evidence.** Een cluster `pronoun_je_vs_u` met "Jelle veranderde 'u' in 'je'" mag niet samen voorkomen met "Jelle veranderde 'je' in 'u'". Als er contradicties in dezelfde cluster zitten: skip dit cluster, log in run-stats.
2. **Check tegen bestaande lessons.** Als er al een actieve `jellemind_lessons.lesson_text` is die hetzelfde dekt (cosine-similarity ≥0.85 op embedding, OF rule-class match), skip — patroon is al bekend.
3. **Genereer lesson-voorstel** met deze velden:
   - `lesson_text` — declaratief, 1-3 zinnen, derde persoon over Jelle. Voorbeelden:
     - "Jelle gebruikt consistent 'je' en 'jij' in zakelijke mailen, ook bij eerste contact met advocaten en klanten."
     - "Jelle houdt mail-afsluitingen kort — hij vervangt formele groeten ('Met vriendelijke groet') door één-zin afsluitingen ('Groet, Jelle')."
   - `lesson_type` — kies uit `tone | terminology | format | preference | workflow`.
   - `applies_to` — heuristiek: als alle signalen één agent_name hebben → `[agent_name]`. Als ≥2 agents → `['*']`. Als specifiek mail-only → `['auto-draft']`.
   - `evidence_summary` — 1-2 fragments, comma-separated. Voorbeeld: `'"u zal" → "je zal" (3×). "Met vriendelijke groet" → "Groet" (2×).'`
   - `signal_ids` — alle ondersteunende signal-uuids.
   - `proposed_question` — vraag voor Jelle, beginnend met "Klopt het dat..." of "Wil je dat...". Voorbeeld: `'Klopt het dat je nooit "u" wilt schrijven, ook niet bij eerste contact met onbekende advocaten?'`.
   - `confidence` — `least(1.0, n_signals / 5.0)`. Onder 0.5: niet voorstellen.

4. **Cap van 5 nieuwe voorstellen per run.** Sorteer clusters op `n_signals DESC, recency DESC`, neem top 5. Rest blijft in `jellemind_signals` als `processed=false` voor volgende run.

5. **Re-emit van amended proposals.** Voor elk `jellemind_lesson_proposals` waar `status='amended'`:
   - Lees `amend_instructions`.
   - Genereer nieuwe `lesson_text` die de instructie verwerkt (kortere zin, verfijning, verandering van `applies_to`).
   - Insert nieuwe row met `status='pending'`, kopieer `signal_ids` van origineel, zet `created_by='jellemind-amend-redo'`.
   - Markeer origineel als `status='merged'` (niet `accepted` — dat is voor lessons-creation).
   - Re-emit-voorstellen tellen NIET tegen de cap van 5; ze zijn een vervolg, geen nieuwe.

### Pass 4 — Embed accepted lessons

**Werkset:** lessons zonder embedding.

```sql
SELECT id, lesson_text, lesson_type, applies_to, evidence_summary
  FROM jellemind_lessons
 WHERE active = true
   AND embedding IS NULL
 ORDER BY created_at ASC
 LIMIT 100;
```

**Embedding-input-bouwer** (data-scientist-keuze):

```
[<lesson_type>]
Toepassing: <applies_to comma-joined of "alle agents" als ['*']>
<lesson_text>
Voorbeeld: <eerste zin van evidence_summary, of leeg laten>
```

Strip HTML, truncate op 8000 chars (zou nooit moeten triggeren — lessons zijn kort).

**Hash-dedup:** `embedding_input_hash = sha256(input)`. Als de huidige hash gelijk is aan de opgeslagen hash en `embedding IS NOT NULL` → skip. (Bij eerste embed is `embedding_input_hash IS NULL` → altijd embed.)

**OpenAI call:**

```
Model: text-embedding-3-small
Dimensies: 1536
Batch-size: 100 (wij hebben er meestal 1-5 per run)
Endpoint: POST https://api.openai.com/v1/embeddings
Auth: Bearer <agent_config('openai','embedding_key')>
```

**Update per row:**

```sql
UPDATE jellemind_lessons
   SET embedding = $1::vector,
       embedding_input_hash = $2,
       embedded_at = now(),
       embedding_model = 'text-embedding-3-small'
 WHERE id = $3;
```

Bij OpenAI-error (429, 5xx): retry max 2× met exponential backoff (1s, 4s). Daarna log in run.errors en sla deze lesson over — volgende run pakt 'm op.

## Werk-volgorde per run

```
1. Acquire run-lock (zie agent_schedules.is_running)
2. Insert agent_runs row, status='running'
3. Pass 1 — Harvest                                  → +signals
4. Pass 2 — Cluster onverwerkte signals              → in-memory clusters
5. Pass 3 — Propose (cap 5) + re-emit amended        → +lesson_proposals
6. Pass 4 — Embed lessons zonder embedding           → +embeddings
7. Mark agent_feedback unprocessed → processed
8. Update agent_runs row met stats + summary, status='success' (of warning/error)
9. Release run-lock
```

## Run-resultaat naar Supabase

```sql
INSERT INTO agent_runs (agent_name, run_type, status, summary, stats)
VALUES ('jellemind', 'scheduled', $status, $one_sentence_summary, $stats);
```

Stats-jsonb voorbeeld:

```json
{
  "harvest": {
    "autodraft_amended": 4,
    "proposal_amended": 1,
    "direct_feedback": 0,
    "task_edited": 2,
    "note_rewritten": 0,
    "skipped_duplicate": 3,
    "total_new_signals": 7
  },
  "cluster": {
    "rule_classes_hit": ["pronoun_je_vs_u", "length_shorter"],
    "keyword_clusters": 2,
    "clusters_with_min_3": 3,
    "clusters_with_contradiction": 0
  },
  "propose": {
    "new_proposals": 2,
    "skipped_already_known": 1,
    "skipped_below_confidence": 0,
    "amended_re_emitted": 0,
    "cap_reached": false
  },
  "embed": {
    "lessons_embedded": 0,
    "lessons_skipped_unchanged": 0,
    "openai_errors": 0
  },
  "window": {
    "harvest_from": "2026-04-28T22:00:00Z",
    "harvest_to": "2026-04-29T22:00:00Z"
  }
}
```

Summary-zin (NL, één regel):
- Met voorstellen: `"7 nieuwe signalen → 2 voorstellen klaar voor review (cap 5 niet gehaald)."`
- Zonder voorstellen: `"3 nieuwe signalen, geen cluster bereikte drempel van 3 — lessons stabiel."`
- Bij errors: `"Run met 1 OpenAI-error op embedden — voorstel-flow OK."`

## Veiligheidsklep

- **Cap van 5 nieuwe voorstellen per run.** Hard-coded.
- **Drempel van 3 signalen per cluster.** Hard-coded.
- **Confidence < 0.5 → niet voorstellen.** Hard-coded.
- **Eerste-run window is gecapped op 200 signalen.** Voorkomt overflow op week-1.
- **Re-emit van amended proposals telt niet tegen cap** — anders kan Jelle's amend-feedback nooit landen.
- **OpenAI-key ontbreekt → pass 4 skippen, status='warning', niet 'error'.** Voorstellen zijn waardevol ook zonder embedding (dashboard tab Voorstellen werkt).

## Stop-condities

Stop direct en log een waarschuwing als:
- Geen Supabase service-role beschikbaar → "skill_secret missing".
- `jellemind_signals` heeft >5000 onverwerkte rijen → er gebeurt iets vreemds (bug in dedup?). Skip pass 1, log in `agent_feedback` met vraag aan Jelle.
- Pass 2 produceert >50 unieke clusters → cluster-logica te zwak, log in run-stats; pass 3 pakt nog steeds top-5.

## Custom instructions (optioneel, in agent_config)

Sleutel: `agent_config('jellemind', 'custom_instructions')`. Als gevuld, lees als jsonb met velden:

| Veld | Effect |
|---|---|
| `daily_proposal_cap` (int) | Override van 5 |
| `min_signals_per_cluster` (int) | Override van 3 |
| `min_confidence` (float) | Override van 0.5 |
| `harvest_window_hours` (int) | Override van 24 |
| `excluded_agents` (text[]) | Skip signals voor deze agents |

Custom instructions kunnen invariants NIET omzeilen (cap kan níet >50, drempel kan níet <2). Als custom-waarden buiten safe-range vallen: log warning en gebruik default.

## Hoe de orchestrator deze skill triggert

1. Orchestrator leest `agent_schedules` elke 15 min.
2. Voor `jellemind` is cron `0 22 * * *` — elke dag om 22:00 NL-tijd.
3. Manueel triggeren via dashboard-knop "Draai jellemind" → RPC `trigger_jellemind_run()` zet `manual_run_requested_at = now()`. Orchestrator pakt 'm op binnen 15 min.

## Iteratie — wat in v1 NIET zit

- Vector-cluster van signal-embeddings (nu rule-based + keyword-overlap).
- Per-recipient lessons via `scope_value` veld (nu alleen via `applies_to` per agent).
- Automatische retire bij `times_contradicted > times_applied / 2` — vereist eerst F.6 (consumers die tellers updaten).
- Multi-language — alleen Nederlands.
- UI om handmatig lessons toe te voegen zonder agent-signaal — kan in fase 2.

## Locaties

- **SKILL.md:** dit bestand (`C:\Users\LM\.claude\skills\jellemind\SKILL.md`).
- **DB-schema:** migration `jellemind_v1_schema` (apply_migration log).
- **Dashboard:** tabblad `JelleMind` (component `JelleMindView.jsx`).
- **Project-page:** Confluence — Project — JelleMind (id 417005570).
- **Concept-page:** Confluence — JelleMind, een notitieboekje dat zichzelf schrijft (id 417038337).

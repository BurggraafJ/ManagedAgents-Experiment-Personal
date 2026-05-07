---
name: jellemind
description: Cross-agent preference-learning agent voor Legal Mind. Eens per dag oogst correcties die Jelle deed op output van andere agents (autodraft_decisions amendments, agent_proposals amended, agent_feedback, hand-edited tasks, sales_on_road note rewrites) EN extraheert lessons uit Fireflies meeting-transcripten (sinds v3, 2026-05-05). Clustert patronen en stelt 15 cluster-voorstellen + tot 30 meeting-voorstellen per dag voor — automatisch toegekend aan een van drie mind-scopes (jelle/skill/legalmind). Pas na Jelle's accept landt een rij in jellemind_lessons (vector-searchable). Trigger bij 'draai jellemind', 'leer mijn voorkeuren', 'wat voor patronen zie je', of handmatig via dashboard. Trigger NIET om zelf lessons te schrijven (alleen Jelle accepteert) of om bestaande agents aan te passen (= fase F.6, niet in scope nu).
---

# JelleMind (v3 — drie minds + Fireflies-extractie)

Cross-agent leerling-redacteur. Sinds 2026-05-01 werkt deze skill als **dunne orchestrator**: harvesting, clustering, dedup, scope-bepaling en cap-toepassing draaien als RPC's in Supabase. De skill formuleert alleen de natuurlijke `lesson_text` en `proposed_question` per cluster — dat blijft LLM-werk.

**v3 (2026-05-05)** — Fireflies meeting-extractie als 6e signaal-bron. Niet via clustering (transcripten zijn geen before/after-correcties) maar via directe LLM-extractie: per niet-verwerkte meeting genereert de skill 5-10 lesson-voorstellen op basis van transcript + summary + action_items. Caps: regulier 15/dag (was 5), meeting-extractie tot 10 per meeting en 30 per run.

## Drie mind-scopes

| Scope | Bedoeling | Voorbeeld |
|---|---|---|
| `jelle` | Persoonlijke voorkeur (toon, stijl) | "Jelle gebruikt 'je' i.p.v. 'u'." |
| `skill` | Procesinstructie aan agents | "Voor een proposal eerst mail-historie + HubSpot + KvK checken." |
| `legalmind` | Organisatie-waarheid | "Trial duurt standaard 14 dagen." |

## Wat de skill NIET doet

- **Geen lessons schrijven.** Lessons komen tot stand via `submit_jellemind_decision(action='accept')`.
- **Geen agents aanpassen.** Lezen van JelleMind door agents = fase F.6, expliciet uit scope.
- **Geen mailen, HubSpot-mutaties, Slack-berichten.** Alle output landt in `jellemind_*` tabellen.

## Architectuur — wat doet wat

| Component | Verantwoordelijkheid |
|---|---|
| **RPC `harvest_and_cluster_jellemind(p_window_hours)`** | Pass 1: harvest signalen uit 5 bronnen + dedup via UNIQUE-constraint. Pass 2: rule-based clustering (regex op pronouns/length/formality/deadlines). Returns clusters met `n_signals`, `agent_names`, `signal_ids`, `evidence_fragments`. |
| **Skill (LLM)** | Per cluster: formuleer `lesson_text` (1-3 zinnen NL, derde persoon) en `proposed_question` ("Klopt het dat..."). Optioneel `mind_scope` overschrijven (RPC heeft default heuristic). |
| **RPC `finalize_jellemind_proposals(p_candidates, p_cap, p_min_signals, p_min_confidence)`** | Pass 3: dedup tegen bestaande lessons (trigram), bepaalt mind_scope/lesson_type/applies_to als skill geen override gaf, berekent confidence, past cap toe, insert in `jellemind_lesson_proposals`. Markeert signalen als `processed=true`. |
| **Edge Function `jellemind-embed`** | Pass 4: OpenAI **text-embedding-3-large (3072d, halfvec)** voor accepted lessons (lessons zonder `embedding`). Sinds B.2-cutover 2026-05-03 — was eerder 3-small. Triggered via pg_cron of na `submit_jellemind_decision(action='accept')`. |

## De passes — uitvoering

### Pass 1+2 — Harvest + Cluster (RPC)

```sql
SELECT public.harvest_and_cluster_jellemind(
  p_window_hours := 24,
  p_max_signals_first_run := 200
);
```

Returns:
```json
{
  "harvest": {
    "autodraft_amended": 4, "proposal_amended": 1, "direct_feedback": 0,
    "task_edited": 2, "note_rewritten": 0, "total_new_signals": 7
  },
  "cluster": {
    "unprocessed_signals_in_window": 80,
    "unique_rule_classes": 3,
    "clusters_with_min_3": 2
  },
  "candidates": [
    {
      "rule_class": "pronoun_je_vs_u",
      "n_signals": 5,
      "agent_names": ["auto-draft", "daily-admin"],
      "signal_ids": ["uuid1", "uuid2", ...],
      "evidence_fragments": ["Jelle veranderde 'u' in 'je'", ...],
      "first_at": "...", "last_at": "..."
    }
  ],
  "window": { "harvest_from": "...", "harvest_to": "..." }
}
```

Bij eerste run: pass `p_window_hours := 24*14 = 336` voor 14-dagen-backfill.

### Pass 1.5 — Fireflies meeting-extractie (sinds v3, 2026-05-05)

**Waarom apart:** correctie-signalen (autodraft amend, proposal amended, etc.) zijn before/after-paren waar regex-clustering werkt. Een meeting-transcript is observed knowledge — daar pas je geen rule-classes op toe. In plaats daarvan extraheert de skill **direct** lesson-voorstellen per meeting via een Claude-call.

**Wat te doen per run, vóór finalize:**

1. Selecteer alle ongelezen meetings van de laatste 7 dagen:

```sql
SELECT id, fireflies_id, title, date_time, duration_min,
       transcript_text, summary_text, action_items, attendees
  FROM fireflies_meetings
 WHERE jellemind_processed_at IS NULL
   AND date_time >= now() - interval '7 days'
   AND length(coalesce(transcript_text,'')) > 500   -- skip lege/korte transcripten
 ORDER BY date_time DESC
 LIMIT 5;   -- max 5 meetings per run om Claude-budget te beperken
```

2. Per meeting: stuur de inhoud naar Claude met de volgende **prompt-structuur** (gebruik `claude-sonnet-4-6` of `claude-opus-4-7`, max_tokens 2500):

```
SYSTEM:
Je analyseert een meeting-transcript voor Jelle Burggraaf van Legal Mind. Je taak: trek 4-7 lesson-voorstellen uit deze meeting voor het JelleMind-systeem (cross-agent kennis-laag). Een lesson is een **blijvende, generaliseerbare** observatie of regel die agents zoals auto-draft, sales-followups, daily-admin moeten weten — geen ad-hoc actie en geen besluit dat alleen voor deze meeting/klant/deal geldt.

GENERALISATIE-TEST (cruciaal — pas elke lesson hierop toe):
- Zou deze regel ook gelden in een andere week, voor een andere klant, in een ander gesprek? Zo niet → niet voorstellen.
- Is dit een patroon dat zich vaker zal voordoen, of een eenmalige beslissing? Eenmalig → niet voorstellen.
- Zit "voor deze klant" / "deze deal" / "deze keer" / een eigennaam in de strekking? Bijna altijd te smal — niet voorstellen.
- Voorbeeld GOED: "Tijdens trial worden alle features (incl. premium add-ons) beschikbaar gemaakt." → patroon, geldt voor alle trials.
- Voorbeeld FOUT: "Voor vakgroep X houden we twee webinars in mei." → één deal, geen blijvende kennis.
- Twijfel? Liever weglaten dan voorstellen. Het is acceptabel om 4 lessons te leveren in plaats van 7 als de meeting weinig blijvende kennis bevat.

PER LESSON:
- Bepaal de mind_scope: 'jelle' (toon/persoonlijke voorkeur), 'skill' (procesinstructie aan agents), 'legalmind' (organisatie-waarheid: feiten over hoe Legal Mind werkt, prijsstellingen, klantsegmenten).
- Bepaal lesson_type: 'tone' | 'terminology' | 'format' | 'preference' | 'workflow'.
- Schrijf lesson_text in 1-3 zinnen NL, derde persoon, scherp en handelbaar — formuleer als algemene regel, niet als één-keer-besluit.
- Schrijf proposed_question waarop Jelle 'klopt' / 'klopt niet' kan antwoorden.
- evidence_summary: 1 zin met de specifieke quote of moment uit het transcript — dit is het bewijs, niet de regel zelf.

GEEN LESSON ALS:
- Het puur ad-hoc is (specifieke deadline, persoon, klant) → geen blijvende kennis
- Het al een bestaand action item is in fireflies_action_items
- Het een eenmalig besluit is over één klant of één deal (te smal)
- De regel niet voorbij deze meeting/dit kwartaal generaliseert
- Je het concrete voorbeeld uit deze meeting niet kunt vervangen door een ander voorbeeld zonder dat de regel onzin wordt

Output ALLEEN JSON-array, geen omringende tekst:
[
  {
    "mind_scope": "legalmind",
    "lesson_type": "preference",
    "lesson_text": "...",
    "proposed_question": "Klopt het dat...?",
    "evidence_summary": "..."
  },
  ...
]

USER:
TITEL: <title>
DATUM: <date_time>
DUUR: <duration_min> min
DEELNEMERS: <attendees jsonb>

SUMMARY:
<summary_text>

ACTION ITEMS (Fireflies):
<action_items>

TRANSCRIPT (cap 80k chars):
<transcript_text[:80000]>
```

3. Parse de JSON-array. Per lesson, schrijf direct in `jellemind_lesson_proposals` (bypass clustering — de RPC `finalize_jellemind_proposals` is voor cluster-paden):

```sql
INSERT INTO jellemind_lesson_proposals (
  rule_class, n_signals, signal_ids, agent_names,
  lesson_text, proposed_question, evidence_summary,
  mind_scope, lesson_type, applies_to,
  confidence, status, source_kind, source_meeting_id
)
VALUES (
  'meeting_extracted', 1, ARRAY[]::uuid[], ARRAY['fireflies'],
  $1, $2, $3,
  $4, $5, ARRAY['*']::text[],
  0.7, 'pending', 'meeting', $meeting_id
);
```

4. Markeer de meeting als verwerkt:

```sql
UPDATE fireflies_meetings
   SET jellemind_processed_at = now()
 WHERE id = $meeting_id;
```

**Caps voor Fireflies-extractie** (uit `agent_config.jellemind.custom_instructions`):

| Sleutel | Default | Effect |
|---|---|---|
| `meeting_proposal_cap_per_meeting` | 10 | Max lessons uit één meeting |
| `meeting_proposal_cap_per_run` | 30 | Max lessons over alle meetings in deze run |

Stop met meetings verwerken zodra `cap_per_run` is bereikt. Markeer overgebleven meetings NIET als verwerkt — volgende run pakt ze op.

**Telemetrie in stats.passes**: voeg een entry `{ "name": "fireflies_extract", "ms": <int>, "status": "success", "extra": { "meetings_processed": N, "lessons_proposed": M } }` toe.

### Pass 3 — Propose (skill formuleert + RPC valideert)

Voor elk cluster met `n_signals >= 3`, schrijf de skill een lesson_text en proposed_question. Voorbeelden:

| rule_class | lesson_text (skill schrijft) | proposed_question |
|---|---|---|
| `pronoun_je_vs_u` | "Jelle gebruikt consistent 'je' en 'jij' in zakelijke mailen, ook bij eerste contact." | "Klopt het dat je nooit 'u' wilt schrijven, ook niet bij eerste contact?" |
| `length_shorter` | "Jelle houdt mail-afsluitingen kort — vervangt formele groeten door één-zin afsluitingen." | "Wil je dat agents standaard kortere afsluitingen gebruiken?" |
| `length_longer` | "Jelle voegt vaak feitelijke correcties + zelf-aangemaakte taken toe aan voorstellen." | "Wil je dat agents zelf vervolgtaken aanmaken na contract-events?" |

Bouw candidate-array (per cluster één entry, voeg de skill-velden toe):

```json
{
  "rule_class": "<van RPC>",
  "n_signals": <van RPC>,
  "signal_ids": [...],
  "agent_names": [...],
  "lesson_text": "<skill formuleert>",
  "proposed_question": "<skill formuleert>",
  "evidence_summary": "<skill formuleert: 1-2 fragments uit evidence_fragments>",
  "mind_scope": "<optioneel — RPC heeft heuristic>",
  "lesson_type": "<optioneel — RPC mapt rule_class default>"
}
```

Roep dan de finalize-RPC aan:

```sql
SELECT public.finalize_jellemind_proposals(
  p_candidates := <candidate_array>::jsonb,
  p_cap := 15,                      -- v3: opgeschaald van 5; meetings hebben aparte caps (Pass 1.5)
  p_min_signals := 3,
  p_min_confidence := 0.5,
  p_dedup_similarity_threshold := 0.55
);
```

Lees `p_cap` uit `agent_config.jellemind.custom_instructions.daily_proposal_cap` (default 15).

Returns:
```json
{
  "inserted": 2, "skipped_dup": 1, "skipped_low_conf": 0, "skipped_few_signals": 0,
  "merged_amended": 0, "by_scope": { "jelle": 1, "skill": 1, "legalmind": 0 },
  "cap_reached": false, "proposal_ids": [...]
}
```

### Re-emit van amended proposals

Voor elke `jellemind_lesson_proposals` waar `status='amended'` met `amend_instructions`:

1. Lees `amend_instructions`.
2. Schrijf nieuwe `lesson_text` die de instructie verwerkt.
3. Voeg toe aan candidate-array met extra veld `_replaces_proposal_id` = origineel UUID.
4. RPC merged automatisch het origineel naar `status='merged'` als de nieuwe insert lukt.

Re-emit telt **niet** tegen de cap.

### Pass 4 — Embed (Edge Function)

Wordt getriggerd door pg_cron of na een `accept`-decision. **Niets doen vanuit deze skill** — de Edge Function pakt het op.

Voor manuele trigger: `POST https://<ref>.supabase.co/functions/v1/jellemind-embed` met `Authorization: Bearer <cron_secret>`.

## Werkvolgorde per run

```
1. Acquire run-lock via agent_schedules (orchestrator regelt dit).
2. INSERT agent_runs row, status='running'.
3. SELECT harvest_and_cluster_jellemind(24)         -> candidates_array
4. Per candidate (n_signals >= 3): formuleer lesson_text + proposed_question (LLM).
5. Verwerk re-emit van amended proposals (formuleer nieuwe text).
6. SELECT finalize_jellemind_proposals(candidates)  -> inserted_count + by_scope
7. PASS 1.5 — Fireflies meeting-extractie:
   a. SELECT meetings WHERE jellemind_processed_at IS NULL (max 5).
   b. Per meeting: Claude-call → JSON-array van 5-10 lesson-voorstellen.
   c. INSERT direct in jellemind_lesson_proposals (source_kind='meeting').
   d. UPDATE fireflies_meetings.jellemind_processed_at = now().
   e. Stop als meeting_proposal_cap_per_run is bereikt — overgebleven meetings volgende run.
8. UPDATE agent_runs status='success' met stats + summary.
```

## Run-resultaat — stats jsonb

v1-contract — lees `agent-handbook/references/logging.md` voor de volledige spec.

```jsonc
{
  "schema_version": "1",              // STRING "1" — nooit integer
  "skill_version": "jellemind-v2.0",  // update bij backwards-incompatibele wijziging
  "mode": null,
  "triggered_by": "orchestrator",     // of "manual_run_request" bij dashboard-knop
  "triggered_at": "<ISO-8601>",
  "passes": [
    { "name": "harvest+cluster",  "ms": 2160, "status": "success" },
    { "name": "propose",          "ms": 12400, "status": "success" },
    { "name": "fireflies_extract","ms": 18500, "status": "success",
      "extra": { "meetings_processed": 3, "lessons_proposed": 18 } },
    { "name": "embed",            "ms": 0, "status": "skipped", "reason": "no accepted lessons" }
  ],
  "warnings": [],
  "counts": {
    "signals_new": 7,
    "proposals_created": 2,
    "proposals_amended_re_emitted": 0,
    "by_scope": { "jelle": 1, "skill": 1, "legalmind": 0 }
  },
  "extra": {
    "harvest": { "...RPC-output..." },
    "cluster": { "...RPC-output..." },
    "finalize": { "...RPC-output..." },
    "window": { "harvest_from": "...", "harvest_to": "..." }
  }
}
```

**Toelichting structuur:**
- `passes[]` = timing + status per stap (voor Health-pagina). Pass `harvest+cluster` is één RPC-call dus één entry.
- `counts{}` = summary-getallen voor dashboard. Altijd aanwezig, ook als alle waarden 0 zijn.
- `extra{}` = volledige RPC-terugkoppeling voor debugging. Niet in counts omdat het schema RPC-versie-afhankelijk is.

Summary-zin (NL):
- Met voorstellen: `"7 nieuwe signalen → 2 voorstellen klaar voor review."`
- Zonder voorstellen: `"3 nieuwe signalen, geen cluster bereikte drempel — lessons stabiel."`

## Veiligheidsklep (invariants — hardcoded in RPC's)

- **Cap van 15 cluster-voorstellen per run** (RPC clamp [0, 50]; v3 default opgeschaald van 5).
- **Drempel van 3 signalen per cluster** (RPC clamp [2, 100]).
- **Confidence < 0.5 → niet voorstellen** (RPC clamp [0, 1]).
- **Eerste-run window cap 200 signalen** (RPC parameter `p_max_signals_first_run`).
- **Re-emit telt NIET tegen cap** — Jelle's amend-feedback moet altijd kunnen landen.

**Pass 1.5 (Fireflies)** heeft eigen caps — niet gedeeld met cluster-cap:
- **Per meeting max 10 voorstellen** (custom_instructions `meeting_proposal_cap_per_meeting`).
- **Per run max 30 voorstellen over alle meetings** (custom_instructions `meeting_proposal_cap_per_run`).
- **Skip meetings met `length(transcript_text) < 500`** (te kort voor zinvolle extractie).

## Custom instructions (optioneel)

Sleutel: `agent_config('jellemind', 'custom_instructions')` — jsonb met velden:

| Veld | Effect |
|---|---|
| `daily_proposal_cap` (int) | Override van 15 (max 50) |
| `meeting_proposal_cap_per_meeting` (int) | Override van 10 (max 20) |
| `meeting_proposal_cap_per_run` (int) | Override van 30 (max 100) |
| `min_signals_per_cluster` (int) | Override van 3 (min 2) |
| `min_confidence` (float) | Override van 0.5 |
| `harvest_window_hours` (int) | Override van 24 |

RPC clamps zorgen dat invariants niet kunnen worden omzeild.

## Hoe orchestrator triggert

1. `agent_schedules`-cron: `0 22 * * *` (dagelijks 22:00 NL).
2. Manueel via dashboard: RPC `trigger_jellemind_run()` zet `manual_run_requested_at`.

## Locaties

- **SKILL.md:** dit bestand (`C:\Users\LM\.claude\skills\jellemind\SKILL.md`).
- **DB-RPC's:** `harvest_and_cluster_jellemind`, `finalize_jellemind_proposals`, `submit_jellemind_decision`, `match_jellemind_lessons`, `trigger_jellemind_run`, `edit_jellemind_lesson`, `retire_jellemind_lesson`.
- **Edge Function:** `jellemind-embed` (auto-deployed, getriggerd via cron of na accept).
- **Dashboard:** tabblad `JelleMind` (component `JelleMindView.jsx`).
- **Project-page:** Confluence — Project — JelleMind (id 417005570).

## Wat in v1 NIET zit

- Vector-cluster van signal-embeddings (nu rule-based + keyword-overlap in RPC).
- Per-recipient lessons via `scope_value` veld.
- Automatische retire bij `times_contradicted > times_applied / 2` (vereist eerst F.6).
- Multi-language — alleen Nederlands.

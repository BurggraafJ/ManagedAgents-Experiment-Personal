---
name: jellemind
description: Cross-agent preference-learning agent voor Legal Mind. Eens per dag oogst correcties die Jelle deed op output van andere agents (autodraft_decisions amendments, agent_proposals amended, agent_feedback, hand-edited tasks, sales_on_road note rewrites). Clustert patronen en stelt max 5 voorzichtige lesson-voorstellen per dag voor - automatisch toegekend aan een van drie mind-scopes (jelle/skill/legalmind). Pas na Jelle's accept landt een rij in jellemind_lessons (vector-searchable). Trigger bij 'draai jellemind', 'leer mijn voorkeuren', 'wat voor patronen zie je', of handmatig via dashboard. Trigger NIET om zelf lessons te schrijven (alleen Jelle accepteert) of om bestaande agents aan te passen (= fase F.6, niet in scope nu).
---

# JelleMind (v2 — drie minds)

Cross-agent leerling-redacteur. Sinds 2026-05-01 werkt deze skill als **dunne orchestrator**: harvesting, clustering, dedup, scope-bepaling en cap-toepassing draaien als RPC's in Supabase. De skill formuleert alleen de natuurlijke `lesson_text` en `proposed_question` per cluster — dat blijft LLM-werk.

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

## De vier passes — uitvoering

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
  p_cap := 5,
  p_min_signals := 3,
  p_min_confidence := 0.5,
  p_dedup_similarity_threshold := 0.55
);
```

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
7. UPDATE agent_runs status='success' met stats + summary.
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
    { "name": "harvest+cluster", "ms": 2160, "status": "success" },
    { "name": "propose",         "ms": 12400, "status": "success" },
    { "name": "embed",           "ms": 0, "status": "skipped", "reason": "no accepted lessons" }
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

- **Cap van 5 nieuwe voorstellen per run** (RPC clamp [0, 50]).
- **Drempel van 3 signalen per cluster** (RPC clamp [2, 100]).
- **Confidence < 0.5 → niet voorstellen** (RPC clamp [0, 1]).
- **Eerste-run window cap 200 signalen** (RPC parameter `p_max_signals_first_run`).
- **Re-emit telt NIET tegen cap** — Jelle's amend-feedback moet altijd kunnen landen.

## Custom instructions (optioneel)

Sleutel: `agent_config('jellemind', 'custom_instructions')` — jsonb met velden:

| Veld | Effect |
|---|---|
| `daily_proposal_cap` (int) | Override van 5 (max 50) |
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

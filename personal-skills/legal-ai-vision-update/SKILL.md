---
name: legal-ai-vision-update
description: "Verwerkt voice-notes / text-notities die Jelle heeft achtergelaten op Legal AI-artikelen of stellingen. Zet ze om in voorgestelde visie-updates op `legal_ai_theses` (confidence aanpassen, nieuwe stelling toevoegen, retire). Schrijft NOOIT direct in `legal_ai_theses` — altijd via `agent_proposals` met status='pending' zodat Jelle accept/reject. Trigger: trigger-based bij nieuwe rij in `legal_ai_voice_notes` (status='pending') of manueel via 'verwerk legal AI feedback', 'verwerk mijn voice-notes', 'check legal AI notities'. Trigger NIET voor research (= legal-ai-research) of writing (= legal-ai-write)."
---

# legal-ai-vision-update — v1

> **Doel.** Voice-notes en text-feedback die Jelle achterlaat op Legal AI-artikelen vertalen naar voorgestelde visie-updates. Propose-only — Jelle accept/reject in dashboard.

**Auth:** voor Supabase DB-toegang (lezen `legal_ai_voice_notes`, schrijven `agent_proposals`): zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md). DB-only skill — geen Composio/externe API. Edge Function gebruikt service_role automatisch; Claude-sessies gebruiken Supabase MCP of `vault-read-proxy` voor cron_secret.

## Trigger

| Mode | Cron / signaal |
| --- | --- |
| Trigger-based | Nieuwe rij in `legal_ai_voice_notes` met `status='pending'` (gevuld door dashboard voice/text-input) |
| Manueel | "verwerk legal AI feedback", "verwerk mijn voice-notes", "check legal AI notities" |

## Architectuur

```
   Dashboard "Legal AI"-tab
     │ Jelle drukt 🎤 of typt feedback
     │ INSERT INTO legal_ai_voice_notes (article_id?, thesis_id?, track, transcript, status='pending')
     ▼
   Skill leest pending voice-notes (max 10 per run)
     │ Per note:
     │   - Pak context: article + theses van die track
     │   - LLM-classify: target ('thesis_X' | 'new_thesis' | 'discard'),
     │                    action ('strengthen' | 'weaken' | 'replace' | 'add'),
     │                    proposed_confidence + reason
     │   - Schrijf naar agent_proposals (agent_name='legal-ai-vision-update', status='pending')
     │   - UPDATE legal_ai_voice_notes SET status='processed', ai_interpretation=<jsonb>
     ▼
   Dashboard toont voorstellen — Jelle accept/reject/amend
     │ Bij accept: RPC apply_legal_ai_thesis_update(proposal_id) past `legal_ai_theses` aan
     │ Bij reject: agent_proposals.status='rejected'
```

## Werkwijze per run

### Stap 0 — Self-provisioning

* Tabellen `legal_ai_voice_notes`, `legal_ai_theses`, `legal_ai_visions`, `agent_proposals` bestaan? → bij ontbreken: log `_diagnose` en RETURN.
* RPC `apply_legal_ai_thesis_update` bestaat? → bij ontbreken: log warning (skill werkt nog, maar Jelle kan voorstellen niet automatisch toepassen).

### Stap 1 — Pak pending voice-notes

```sql
SELECT id, article_id, thesis_id, track, transcript, created_at
FROM legal_ai_voice_notes
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 10;
```

Token-budget: max 10 notes/run × ~$0.01 per call = ~$0.10/run.

### Stap 2 — Per note: classify + voorstel

Voor elke note:

1. **Pak context:**
   * Bijbehorend artikel (uit `legal_ai_articles WHERE id = note.article_id`) — alleen `title`, `tldr`, eerste 2000 chars `body_md`
   * Top-5 actieve theses van die track (`SELECT FROM legal_ai_theses WHERE track=note.track AND status='active' ORDER BY confidence × evidence_count DESC LIMIT 5`)
   * Eventuele eerdere voorstellen op dezelfde thesis (laatste 7 dagen)

2. **LLM-call (Claude Sonnet 4.7, mini-call):**
   System-prompt: "Je analyseert Jelle's feedback op een Legal AI-artikel. Output JSON:
   ```
   {
     "target": "thesis_<id>" | "new_thesis" | "discard",
     "action": "strengthen" | "weaken" | "replace_statement" | "add",
     "proposed_confidence": <0..1, alleen voor strengthen/weaken/add>,
     "proposed_statement": "<nieuwe formulering, alleen voor replace_statement/add>",
     "reason": "<1-2 zinnen waarom>",
     "discard_reason": "<alleen bij discard: bv. 'observatie geen visie-impact'>"
   }
   ```
   Regels: `discard` is OK; niet alle voice-notes hoeven thesis-impact te hebben. Bij `add`: kort en toetsbaar formuleren.

3. **Schrijf voorstel:**
   * Bij `discard`: UPDATE voice_note status='discarded', ai_interpretation=<reason>, geen agent_proposal
   * Anders: INSERT in `agent_proposals`:
     ```sql
     INSERT INTO agent_proposals (agent_name, payload, status)
     VALUES ('legal-ai-vision-update', jsonb_build_object(
       'voice_note_id', note.id,
       'article_id', note.article_id,
       'track', note.track,
       'target', target,
       'action', action,
       'current_thesis', <thesis-row-snapshot>,
       'proposed_confidence', confidence,
       'proposed_statement', statement,
       'reason', reason
     ), 'pending');
     ```
   * UPDATE voice_note: status='processed', proposal_id=<new>, ai_interpretation=<full LLM output>

### Stap 3 — Logging v1-contract

```json
{
  "schema_version": "1",
  "skill_version": "legal-ai-vision-update-v1",
  "notes_pending_at_start": 7,
  "notes_processed": 7,
  "proposals_created": 5,
  "notes_discarded": 2,
  "notes_failed": 0,
  "tokens_used": 4200,
  "cost_usd_estimate": 0.025,
  "_diagnose": {
    "tables_present": true,
    "rpc_apply_present": true,
    "active_theses_advocatuur": 3,
    "active_theses_bedrijfsleven": 2
  }
}
```

## Inputs

| Bron | Tabel | Voor wat |
|---|---|---|
| Voice-notes | `legal_ai_voice_notes WHERE status='pending'` | Te verwerken feedback |
| Articles | `legal_ai_articles` | Context bij elke note |
| Theses | `legal_ai_theses WHERE status='active'` | Wat is de huidige visie |
| Eerdere proposals | `agent_proposals WHERE agent_name='legal-ai-vision-update'` (laatste 7d) | Voorkomen van dubbele voorstellen |
| Config | `agent_config WHERE agent_name='legal-ai-vision-update'` | LLM-model, custom_instructions |

## Outputs

| Tabel | Wat |
|---|---|
| `legal_ai_voice_notes` | UPDATE status + ai_interpretation + proposal_id |
| `agent_proposals` | INSERT (1 per non-discarded note) met `agent_name='legal-ai-vision-update'` |
| `agent_runs` | 1 rij stats + _diagnose |

**Geen mutaties** in: `legal_ai_theses`, `legal_ai_visions`. Die worden alleen aangepast door RPC `apply_legal_ai_thesis_update` op accept van Jelle.

## Veiligheidsnetten

* **Cap 10 notes per run** — voorkomt cost-explosie bij grote backlog.
* **Discard is OK** — niet alle feedback heeft thesis-impact. Voorbeelden: "leuk artikel", "interessant idee maar al bekend".
* **Duplicate-protection**: bij voorstel op dezelfde `thesis_id` met `status='pending'` of `status='accepted` van laatste 7d → skip + voice-note status='processed_duplicate'.
* **LLM-fout / parse-error**: voice-note status='failed', `ai_interpretation.error=<msg>`. Niet retry; Jelle kan handmatig her-trigger.

## Custom instructions

`agent_config WHERE agent_name='legal-ai-vision-update' AND config_key='custom_instructions'`. Voorbeelden:
* "Wees voorzichtiger met confidence-bumps; niet boven 0.85 zonder ≥3 evidence."
* "Voor stelling-toevoeging: vereis minstens 2 expliciete redenen in note."

## Self-provisioning

* DB-schema: vereist migration `legal_ai_thought_leadership_2026_05_02.sql` (`legal_ai_voice_notes` tabel) + RPC `apply_legal_ai_thesis_update` (in `legal_ai_phase2_2026_05_03.sql`).
* Geen Edge Function nodig — skill voert LLM-call zelf uit (Claude Sonnet via Anthropic API).

## Niet in scope

⛔ Direct `legal_ai_theses` muteren (alleen via RPC op accept) · ⛔ Voice → Text transcribe (dashboard-laag doet dat via `useVoiceInput`) · ⛔ Article-writing (= `legal-ai-write`) · ⛔ LinkedIn-drafts.

## Versiehistorie

* **v1 — 2026-05-03** — Initiële versie. Trigger-based; LLM-classify + propose-only via agent_proposals.

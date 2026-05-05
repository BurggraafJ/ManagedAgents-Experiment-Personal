---
name: legal-ai-write
description: "Schrijft een Legal AI thought-leadership-artikel voor Jelle Burggraaf op basis van findings die `legal-ai-research` al verzameld heeft + Jelle's brief deze week (focus, sentiment, leeskeuzes, anchor-bronnen). Wekelijks (zaterdag 08:00 NL) of on-demand. Twee tracks (advocatuur + bedrijfsleven/MKB) of combined. Architectuur: Claude verzamelt context (relevante findings + theses + Jelle's notities), roept Edge Function `grok-legal-ai-write` aan, Grok schrijft artikel met de meegegeven context als ruggengraat. Output: artikel + voorgestelde vision-updates. Trigger: orchestrator zaterdag 08:00, of manueel via 'schrijf legal AI artikel', 'schrijf artikel over [onderwerp]', 'maak een thought leadership post', 'schrijf het wekelijkse artikel'. Trigger NIET voor research (= legal-ai-research, dagelijks, findings-only)."
---

# legal-ai-write — v1 (split-architectuur 2026-05-02)

> **Doel.** Op een gekozen moment (wekelijks of op afroep) een artikel schrijven over de Legal AI-markt. De findings-database is dan al gevuld door `legal-ai-research`. Deze skill kiest de relevante findings, voegt Jelle's input toe (brief, leeskeuzes, anchor-URLs), en laat Grok schrijven.

> **Why split:** Research is goedkoop + frequent (kennis-opbouw). Schrijven is duurder + zeldzaam (publicatiemoment). Door het te scheiden kan Jelle het schrijfmoment kiezen op basis van wat hij die week gelezen heeft.

## Trigger

| Mode | Cron / signaal |
| --- | --- |
| Wekelijks | orchestrator `0 8 * * 6` (zaterdag 08:00 NL) — disabled tot Jelle akkoord is |
| On-demand | "schrijf legal AI artikel", "schrijf artikel over [onderwerp]", "maak een thought leadership post", "schrijf het wekelijkse artikel" |

## Architectuur

```
   Claude (skill = deze SKILL.md)
     │ Verzamelt context:
     │   - relevante findings (laatste 7d, gefilterd op track + Jelle's focus)
     │   - actieve theses (top-5 op confidence × evidence_count)
     │   - Jelle's notities + anchor-URLs (uit gebruikersbericht of `legal_ai_voice_notes`)
     │   - custom_instructions
     │ Bouwt claude_brief: 2-3 alinea's wat het artikel moet doen
     ▼
   Edge Function `grok-legal-ai-write`
     │ POST /functions/v1/grok-legal-ai-write
     │   { track, claude_brief, context_findings, context_theses, ... }
     ▼
   xAI Grok (warmer temperature, search_mode = auto)
     │ Schrijft artikel met findings als ruggengraat,
     │ mag verifyen via search-tools indien nodig
     ▼
   Skill schrijft naar:
     legal_ai_articles      (1 rij per call — title, body_md, sections, vision_id_at_compose)
     legal_ai_findings      (UPDATE used_in_article_id voor verbruikte findings)
     agent_proposals        (per suggested_thesis_update)
     agent_runs             (logging v1-contract)
```

## Werkwijze per run

### Stap 0 — Self-provisioning

* Tabellen + Edge Function-config + Vault-key check.
* Als `legal_ai_findings` minder dan 5 rijen heeft van laatste 14 dagen → log warning maar continue (Grok mag dan zelf via search-tools aanvullen).

### Stap 1 — Bepaal mode + track

| Mode | Trigger | Track-keuze |
|---|---|---|
| `weekly_default` | Cron zaterdag 08:00 | Combined-overview (advocatuur + bedrijfsleven samengebracht) |
| `track_focus` | "schrijf legal AI artikel over advocatuur" | advocatuur |
| `topic_focus` | "schrijf artikel over [onderwerp]" | track wordt afgeleid uit onderwerp; default advocatuur als ambig |
| `manual_full` | Jelle in dashboard met expliciete brief + tone | wat Jelle aangeeft |

### Stap 2 — Verzamel context

1. **Relevante findings (max 25):**
   * `SELECT FROM legal_ai_findings WHERE track IN (...) AND created_at >= now() - interval '14 days' AND used_in_article_id IS NULL`
   * Sorteer: recency_score DESC, then created_at DESC
   * Max 25 (anders te veel context voor Grok). Als `topic_focus`: filter ook op tag-match.

2. **Actieve theses (max 5 per track):**
   * `SELECT FROM legal_ai_theses WHERE track=<track> AND status='active'`
   * Sorteer op confidence × evidence_count DESC.
   * Voor `combined`: top-3 per track.

3. **Jelle's notities (uit user-bericht of voice-notes):**
   * On-demand: gebruikersbericht is de input.
   * Wekelijks: `SELECT transcript FROM legal_ai_voice_notes WHERE created_at >= now() - interval '7 days' AND status='processed'`. Concat met scheidingsregel.
   * Anchor-URLs: parse user-bericht voor URLs (regex `https?://\S+`).

4. **Custom instructions:**
   * `agent_config WHERE agent_name='legal-ai-write' AND config_key='custom_instructions'`.

5. **Tone (default 'analytisch'):**
   * Voor wekelijkse cron: 'analytisch'.
   * On-demand: detecteer uit Jelle's bericht of expliciet meegegeven (mag in het bericht staan: "schrijf provocerend artikel over X").

### Stap 3 — Roep Edge Function aan

**Auth-pointer:** voor `cron_secret` (Vault-leesroute) + Grok API key (zit in Edge Function via gedeelde `skill:legal-ai-research:grok_api_key`): zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md). In Claude-sessie zonder Supabase MCP: gebruik `LM_CRON_SECRET` env-var → `vault-read-proxy` Edge Function (sectie 2.3 Pad 4).

```ts
const resp = await fetch(`${SUPABASE_URL}/functions/v1/grok-legal-ai-write`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cron_secret}`,  // uit Vault — skill:global:cron_secret
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    track,
    claude_brief,                    // 2-3 alinea's: wat moet het artikel doen?
    context_findings,                // [{title, summary, source_url, ...}, ...]
    context_theses,                  // [{thesis_id, statement, confidence, ...}]
    anchor_urls,                     // optioneel
    jelles_notes,                    // optioneel
    custom_instructions,
    min_words: agent_config.min_word_count, // default 500
    max_words: agent_config.max_word_count, // default 900
    model: agent_config.grok_model,         // default 'grok-4'
    search_mode: 'auto',                    // Grok mag verifyen
    tone,
  }),
});
```

Timeout: 130s. Bij error: log run + Slack-notificatie naar `feedback`.

### Stap 4 — Persisten

1. **INSERT `legal_ai_articles`:**
   * `article_date = CURRENT_DATE`
   * `track = <track>` (mag 'combined' zijn)
   * `engine = 'grok'`
   * `title, body_md, tldr, reading_time_min, sections` uit response
   * `focus_brief = <claude_brief>` (audit-trail)
   * `vision_id_at_compose` = laatste `legal_ai_visions.id WHERE track=<track>` (kan NULL)
   * `source_finding_ids` = array van finding-IDs die in `sections` voorkomen

2. **UPDATE findings:** `UPDATE legal_ai_findings SET used_in_article_id=<new_article_id> WHERE id IN (<used_finding_ids>)`.

3. **INSERT `agent_proposals`:**
   * Voor elke `suggested_thesis_update`: één rij met `agent_name='legal-ai-vision-update'`, `payload={thesis_id, current_confidence, proposed_confidence, reason}`, `status='pending'`.

4. **Log run** in `legal_ai_research_runs`:
   * `engine='grok'`, `status='success'`, `article_id=<new>`, `track=<track>`
   * **NB:** dezelfde tabel wordt door beide skills gebruikt; `engine` + `article_id IS NOT NULL` onderscheidt write-runs van research-runs.
   * Optionele kolom-update later: `run_type` ('research'|'write') voor cleaner querying. Voor nu: `article_id IS NULL` = research, `article_id IS NOT NULL` = write.

### Stap 5 — Logging v1-contract

```json
{
  "schema_version": "1",
  "skill_version": "legal-ai-write-v1",
  "engine": "grok",
  "mode": "weekly_default",
  "track": "combined",
  "article_id": 42,
  "context_findings_count": 23,
  "context_theses_count": 6,
  "anchor_urls_count": 1,
  "jelles_notes_chars": 412,
  "tegengeluid_in_article": true,
  "tokens_in": 8200,
  "tokens_out": 1500,
  "cost_usd_estimate": 0.05,
  "_diagnose": {
    "tables_present": true,
    "vault_key_present": true,
    "findings_in_window": 23,
    "active_theses_count": 6
  }
}
```

## Inputs

| Bron | Tabel / signaal | Voor wat |
|---|---|---|
| Findings | `legal_ai_findings` (laatste 14d, niet-geconsumeerd) | Ruggengraat van het artikel |
| Theses | `legal_ai_theses WHERE status='active'` | Visie-context + bias-tracking |
| Voice notes | `legal_ai_voice_notes WHERE created_at >= now() - interval '7 days' AND status='processed'` | Jelle's input voor weekly mode |
| User-bericht | (chat) | On-demand mode: brief, anchor-URLs, tone |
| Config | `agent_config WHERE agent_name='legal-ai-write'` | Tuning |
| Vault | `skill:legal-ai-research:grok_api_key` (gedeeld) | Grok API key |

## Outputs

Zie Stap 4. Geen mutaties in `legal_ai_topics`, `legal_ai_players`, `legal_ai_visions` (die laatste alleen via `legal-ai-vision-update` skill).

## Veiligheidsnetten

* **Findings-too-few-fallback:** als <5 findings in window → laat Grok zelf web-search doen (`search_mode='on'` ipv 'auto'). Markeer in stats `findings_too_few_fallback=true`.
* **Cost-cap per run:** ~$0.10 verwacht. Stop bij tokens_out > 5k (overschrijdt max_words ruimschoots).
* **Edge Function timeout:** 130s.
* **Empty article:** als body_md.length < min_words / 2 → mark draft, log warning.
* **Bias-quality-gate:** als `tegengeluid_in_article=false` én er waren contradicts-findings beschikbaar → Slack-warning + `_diagnose.tegengeluid_skipped_warning=true`.

## Custom instructions

`agent_config WHERE agent_name='legal-ai-write' AND config_key='custom_instructions'`. Voorbeelden:
* "Bij wekelijkse mode: focus op cross-track-patronen (advocatuur + bedrijfsleven combineren)."
* "Vermijd zinnen langer dan 25 woorden."
* "Gebruik Jelle's voorkeuren-stem: nuchter, concreet, geen marketingtaal."

## Self-provisioning

* DB-schema: vereist `legal_ai_thought_leadership_2026_05_02.sql` + `legal_ai_grok_pivot_2026_05_02.sql` + `legal_ai_write_addendum_2026_05_02.sql` (deze laatste voegt schedule + config toe).
* Edge Function-deploy: zie `agent-handbook/references/platform.md`. Slug `grok-legal-ai-write`.

## Eerste run — bootstrap

1. Self-provision check.
2. Wachten tot er findings zijn (research-skill heeft minimaal 1 dag gedraaid). Anders fallback met `search_mode='on'`.
3. Manuele eerste run via "schrijf legal AI artikel" — review output, tune custom_instructions indien nodig.
4. Pas daarna wekelijkse schedule aanzetten (zaterdag 08:00).

## Niet in scope

⛔ Research / findings-collectie (= `legal-ai-research`, dagelijks) · ⛔ Vision-updates auto-applien (= `legal-ai-vision-update` propose-only) · ⛔ LinkedIn-drafts (= `legal-ai-linkedin-draft`, F.6) · ⛔ Auto-publish naar LinkedIn / blog · ⛔ Embedding van findings (= F.8 RAG-integratie via aparte embed-pass).

## Versiehistorie

* **v1 — 2026-05-02 (avond, split)** — Nieuwe skill, gesplitst van `legal-ai-research`. Wekelijks/on-demand schrijven met DB-context + Jelle's brief.

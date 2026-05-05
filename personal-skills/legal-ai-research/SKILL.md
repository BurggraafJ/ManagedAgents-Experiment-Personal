---
name: legal-ai-research
description: "Dagelijkse Legal AI markt-research voor Jelle Burggraaf — verrijkt de findings-database met feitelijke observaties. Twee tracks (advocatuur + bedrijfsleven/MKB). Architectuur: Claude bepaalt focus + topic-rotation per track, roept Edge Function `grok-legal-ai-research` aan, Grok zoekt + levert findings (geen artikel). Skill persisteert findings + citations in legal_ai_findings. Schrijven gebeurt apart via skill `legal-ai-write` (wekelijks of on-demand). Trigger: orchestrator dagelijks 06:30 NL, of manueel via 'draai legal-ai-research', 'check legal AI markt', 'research advocatuur', 'research MKB'. Trigger NIET voor schrijven (= legal-ai-write)."
---

# legal-ai-research — v3 (split-architectuur 2026-05-02)

> **Doel.** Dagelijks de Legal AI-database verrijken met feitelijke findings via Grok-search. Geen artikel-schrijven — dat doet `legal-ai-write` apart, wekelijks of op afroep.

> **Belangrijke architectuur-keuze (2026-05-02 avond):** Research en writing zijn gescheiden. Research is goedkoop + frequent (kennis-opbouw). Writing is duurder + zeldzaam (publicatiemoment, met Jelle's leesgedrag verwerkt).

## Trigger

| Mode | Cron / signaal |
| --- | --- |
| Dagelijks | orchestrator `30 6 * * *` (NL, dagelijks) — agent_schedules.enabled toggle door Jelle |
| Manueel | "draai legal-ai-research", "research advocatuur", "research MKB", "research [topic]" |

## Architectuur

```
   Claude (skill = deze SKILL.md)
     │ Bepaalt per track: topic-rotation, focus_brief
     ▼
   Edge Function `grok-legal-ai-research` (research-only)
     │ POST /functions/v1/grok-legal-ai-research
     ▼
   xAI Grok (search-mode = on, lage temperature)
     │ Verzamelt 8-12 feitelijke findings, geen narratief
     ▼
   Skill schrijft naar:
     legal_ai_research_runs   (run-meta + tokens + duration)
     legal_ai_findings        (1 rij per finding — title, summary, source_url, key_quote, tags)
     legal_ai_topics          (UPDATE last_researched_at + depth_score)
     agent_runs               (logging v1-contract)
```

## Werkwijze per run

### Stap 0 — Self-provisioning

* Bestaan `legal_ai_*`-tabellen? Bestaat config + Vault-key? → bij ontbreken: log `_diagnose` en RETURN.
* Edge Function reachable? Test met OPTIONS-call.

### Stap 1 — Bepaal mode + scope

| Mode | Trigger | Scope |
|---|---|---|
| `daily` | Cron of "draai legal-ai-research" zonder topic-arg | Beide tracks |
| `track_only` | "research advocatuur" / "research MKB" | Eén track |
| `targeted` | "research [topic]" | Eén of beide tracks, focus_brief gebouwd uit topic |

### Stap 2 — Topic-rotatie + focus_brief per track

Per track in scope:

1. **Kies 2-3 topics** uit `legal_ai_topics WHERE track=<track>`. Mix:
   * 1 recency-driven (topic gelinkt aan player met `last_news_at >= now() - interval '7 days'`)
   * 1-2 depth-gap (laagste `depth_score`, `last_researched_at` ≥ 14 dagen oud)
   * Skip topics waarvoor er een research-run was in laatste 24u

2. **Bouw `focus_brief` (1-2 alinea's, NL):**
   * "Verzamel findings over [topic 1], [topic 2], [topic 3] in track [track]."
   * "Speciaal: laatste persberichten/blogposts van [recent player(s)]."
   * Eventuele custom_instructions doorgeven.

3. **topics_in_scope:** lijst van topic-titels.

### Stap 3 — Roep Edge Function aan

**Auth-pointer:** voor `cron_secret` (Vault-leesroute) + Grok API key (zit in Edge Function via `skill:legal-ai-research:grok_api_key`): zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md). In Claude-sessie zonder Supabase MCP: gebruik `LM_CRON_SECRET` env-var → `vault-read-proxy` Edge Function (sectie 2.3 Pad 4).

```ts
const resp = await fetch(`${SUPABASE_URL}/functions/v1/grok-legal-ai-research`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cron_secret}`,  // uit Vault — skill:global:cron_secret
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    track,
    focus_brief,
    topics_in_scope,
    model: agent_config.grok_model,            // default 'grok-4'
    search_mode: agent_config.grok_search_mode, // default 'on'
    max_search_results: parseInt(agent_config.grok_max_search_results, 10),
    max_findings: 12,
  }),
});
```

Timeout: **240s** (Supabase Pro tier wallclock = 400s — we benutten ruim met marge). Bij timeout: log de **werkelijke** fout + duur (`grok_timeout`, `grok_http_503`, `fetch_timeout`); doe géén aanname dat het de platform-limiet is. Bij error op track 1: log run + continue track 2 (niet skippen — capacity-issues zijn track-onafhankelijk).

### Stap 4 — Persisten van findings

Voor elke succesvolle response:

1. **INSERT findings** (1 rij per finding in response):
   * `text` = `<title> — <summary>` (gecombineerd voor leesbaarheid)
   * `source_urls` = `[{url: source_url, title: source_title}]`
   * `track` = track
   * `recency_score` = berekend uit `published_at` (1.0 voor <7d, 0.5 voor 7-30d, 0.2 voor >30d, 0.1 als NULL)
   * `embedding` = NULL (apart embed-pass later via F.8)
   * Andere fields uit response in `metadata` jsonb (key_quote, tags, source_title, published_at)

2. **Duplicate-detection:** voor elke finding: `md5(source_url + title)` tegen findings van laatste 14d → skip insert bij hit.

3. **INSERT `legal_ai_research_runs`:**
   * `engine='grok'`, `status='success'`
   * `tokens_in / tokens_out / search_results_count` uit response.usage
   * `cost_usd` (~$0.05/run schatting voor grok-4)
   * `focus_brief = <verstuurde brief>`
   * `article_id = NULL` (geen artikel in research-fase)

4. **UPDATE topics:** `last_researched_at = now()`, `depth_score = depth_score + 1`.

### Stap 5 — Logging v1-contract

```json
{
  "schema_version": "1",
  "skill_version": "legal-ai-research-v3-split",
  "engine": "grok",
  "mode": "daily",
  "tracks_attempted": ["advocatuur", "bedrijfsleven"],
  "tracks_success": ["advocatuur", "bedrijfsleven"],
  "tracks_error": [],
  "findings_inserted": 18,
  "findings_skipped_duplicate": 3,
  "topics_touched": 5,
  "tokens_in": 2400,
  "tokens_out": 3100,
  "search_results_total": 28,
  "cost_usd_estimate": 0.10,
  "_diagnose": {
    "tables_present": true,
    "vault_key_present": true,
    "edge_function_reachable": true,
    "topics_active":  { "advocatuur": 10, "bedrijfsleven": 8 }
  }
}
```

## Inputs

| Bron | Tabel | Voor wat |
|---|---|---|
| Topics-pool | `legal_ai_topics WHERE active` | Topic-rotatie |
| Players-news | `legal_ai_players` | Recency-bias |
| Eerdere runs | `legal_ai_research_runs` (laatste 24u) | Voorkom dubbel-run |
| Eerdere findings | `legal_ai_findings` (laatste 14d) | Duplicate-detection |
| Config | `agent_config WHERE agent_name='legal-ai-research'` | Engine-tuning |
| Vault | `skill_secrets_registry` + `vault.decrypted_secrets` | Grok API key (gelezen door Edge Function) |

## Outputs

Zie Stap 4. Geen mutaties in `legal_ai_articles`, `legal_ai_voice_notes`, `legal_ai_linkedin_posts`, `legal_ai_visions`, `legal_ai_theses` — die zijn voor `legal-ai-write` resp. andere skills.

## Veiligheidsnetten

* **Cost-cap per run:** stop bij cumulatief tokens_out > 50k.
* **Edge Function timeout:** 240s (Pro tier wallclock 400s; Edge Function `DEFAULT_TIMEOUT_MS=240_000`); bij timeout markeer run `status='error'` en continue. **Loggen:** schrijf de echte error-string van de fetch (`grok_timeout`/`grok_http_503`/etc.), niet een verzonnen "150s platform-limiet"-tekst — dat klopt niet voor Pro plan en stuurt diagnose op dwaalspoor.
* **Empty findings:** als 0 findings terug → log warning, continue (niet fatal).
* **Citations gating:** als 0 source_urls → mark run `status='error'` (Grok zou altijd bronnen moeten hebben in research-mode).

## Custom instructions

`agent_config WHERE agent_name='legal-ai-research' AND config_key='custom_instructions'`. Voorbeelden:
* "Focus deze week op AI Act-implementatie."
* "Negeer Harvey-news tot Q3."
* "Voor MKB-track: prioriteer NL-bronnen."

Wordt doorgegeven aan Grok via Edge Function.

## Self-provisioning + code-change-trail

* DB-schema: vereist migrations `legal_ai_thought_leadership_2026_05_02.sql` + `legal_ai_grok_pivot_2026_05_02.sql`.
* Edge Function-deploy: zie `agent-handbook/references/platform.md` (multipart deploy via Management API). Slug `grok-legal-ai-research`.
* Vault-secret: `_grok_secret_seed_2026_05_02.sql` (eenmalig + niet-committen).

## Eerste run — bootstrap

1. Self-provision check.
2. Bij ontbrekende key: skill faalt met heldere error → Slack notificatie.
3. Met key + Edge Function deployed: één daily-run, beide tracks. ~$0.05-0.10 per run totaal.

## Niet in scope

⛔ Article-writing (= `legal-ai-write` skill, wekelijks/on-demand) · ⛔ Vision-updates auto-applien (= `legal-ai-vision-update` propose-only) · ⛔ LinkedIn-drafts (= `legal-ai-linkedin-draft`, F.6) · ⛔ Embedding van findings (= F.8 RAG-integratie via aparte embed-pass) · ⛔ Real-time alerts.

## Versiehistorie

* **v3 — 2026-05-02 (avond, split)** — Schrijven afgesplitst naar `legal-ai-write`. Deze skill is nu findings-only — verrijkt database, geen narratief. Edge Function herschreven naar findings-only output (geen artikel-shape).
* **v2 — 2026-05-02 (avond, eerder)** — Pivot Perplexity → Grok. Eén-call architectuur (research + writing in één). [VERVANGEN door v3]
* **v1 — 2026-05-02 (middag)** — Initiële versie met Perplexity. [VERVANGEN]

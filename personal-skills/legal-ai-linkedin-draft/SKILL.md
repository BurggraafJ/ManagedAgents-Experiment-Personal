---
name: legal-ai-linkedin-draft
description: "Genereert LinkedIn-post-drafts (analytisch + provocerend) op basis van een Legal AI-artikel + Jelle's actieve visie. Op afroep vanuit dashboard ('maak LinkedIn-post', knop bij artikel) of manueel via 'maak LinkedIn-post over [onderwerp]', 'schrijf LinkedIn van laatste artikel'. Hergebruikt `grok-legal-ai-write` Edge Function met `mode='linkedin'` parameter — kortere output, scherpere haak, geen JSON-meta. Schrijft naar `legal_ai_linkedin_posts`. Geen auto-publish — Jelle plaatst handmatig en markeert daarna `status='posted_externally'`. Trigger NIET voor article-writing (= legal-ai-write) of research."
---

# legal-ai-linkedin-draft — v1

> **Doel.** Op afroep een LinkedIn-post-draft maken van een gekozen artikel, in 2 varianten zodat Jelle kan kiezen welke toon past.

**Auth:** voor Edge Function call (`grok-legal-ai-write` met `mode='linkedin'`) gebruik je `cron_secret` uit Vault. Voor DB-toegang (lezen `legal_ai_articles`, schrijven `legal_ai_linkedin_posts`): zelfde route. Volledige uitleg: [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md). Grok API key (`skill:legal-ai-research:grok_api_key`) wordt gedeeld met legal-ai-research/legal-ai-write — staat in de Edge Function, skill hoeft 'm niet zelf te lezen.

## Trigger

| Mode | Cron / signaal |
| --- | --- |
| On-demand vanuit dashboard | INSERT in `legal_ai_skill_requests` met `request_type='linkedin_draft'` + `article_id` |
| Manueel | "maak LinkedIn-post", "schrijf LinkedIn van laatste artikel", "maak LinkedIn-post over [onderwerp]" |

## Architectuur

```
   Dashboard knop "Maak LinkedIn-post" bij artikel
     │ INSERT legal_ai_skill_requests (request_type='linkedin_draft', article_id, requested_at)
     ▼
   Skill leest pending request
     │ Pakt artikel + actieve theses + Jelle's tone-voorkeur
     │ Roept grok-legal-ai-write aan met mode='linkedin', tone='analytisch'
     │ Roept tweede keer met tone='provocerend'
     ▼
   2 INSERTS in legal_ai_linkedin_posts (variant='analytisch' + variant='provocerend')
     │ Status 'draft', source_article_id gevuld
     ▼
   Dashboard toont beide varianten in modal — Jelle kiest, kopieert, post handmatig
     │ Markeert na posten: status='posted_externally', posted_at=now()
```

## Werkwijze per run

### Stap 0 — Self-provisioning

* `legal_ai_articles`, `legal_ai_linkedin_posts`, `legal_ai_theses` aanwezig?
* `legal_ai_skill_requests` tabel? (zie phase2 migration)
* Edge Function `grok-legal-ai-write` reachable?

### Stap 1 — Pak request + context

```sql
SELECT id, article_id, payload
FROM legal_ai_skill_requests
WHERE request_type = 'linkedin_draft' AND status = 'pending'
ORDER BY requested_at ASC LIMIT 5;
```

Voor elke request:

* Pak artikel: `SELECT title, body_md, tldr, sections, track, focus_brief FROM legal_ai_articles WHERE id = request.article_id`
* Top-3 actieve theses van die track
* Custom instructions (optioneel)

### Stap 2 — Roep Edge Function 2× (per variant)

Voor elke `tone` ∈ `['analytisch', 'provocerend']`:

```ts
POST /functions/v1/grok-legal-ai-write
{
  "track": <article.track>,
  "claude_brief": "Maak een LinkedIn-post (NL, max 250 woorden, met haak in eerste regel) op basis van dit artikel...",
  "context_findings": [],            // niet nodig — artikel is bron
  "context_theses": <top-3>,
  "anchor_urls": [],
  "jelles_notes": "<artikel.body_md eerste 2000 chars>",
  "min_words": 100,
  "max_words": 250,
  "tone": tone,
  "mode": "linkedin"                 // signaalt EF om kortere LinkedIn-prompt te gebruiken
}
```

(De `mode` parameter is in EF v3 toegevoegd — zie `grok-legal-ai-write/index.ts`. Bij `mode='linkedin'` gebruikt de EF een kortere system-prompt: geen 4-secties-eis, wel "haak in regel 1, max 250 woorden, geen hashtag-spam".)

### Stap 3 — Persisten

Per variant:

```sql
INSERT INTO legal_ai_linkedin_posts
  (source_article_id, track, variant, body_md, hashtags,
   vision_id_at_compose, status, created_at)
VALUES (..., 'draft', now())
RETURNING id;
```

UPDATE `legal_ai_skill_requests SET status='completed', completed_at=now()`.

### Stap 4 — Logging

```json
{
  "schema_version": "1",
  "skill_version": "legal-ai-linkedin-draft-v1",
  "requests_processed": 1,
  "drafts_created": 2,
  "tokens_total": 3400,
  "cost_usd_estimate": 0.04,
  "_diagnose": {
    "tables_present": true,
    "ef_reachable": true
  }
}
```

## Hashtag-policy

Skill voegt **geen hashtags** toe by default — Jelle plakt zelf zijn vaste set. Custom instructions kunnen overrulen ("voeg #LegalAI #LegalTech toe").

## Inputs

| Bron | Tabel | Voor wat |
|---|---|---|
| Requests | `legal_ai_skill_requests WHERE request_type='linkedin_draft' AND status='pending'` | Pending opdrachten |
| Article | `legal_ai_articles` | Bron-content |
| Theses | `legal_ai_theses WHERE status='active'` | Visie-context |
| Vault | `skill:legal-ai-research:grok_api_key` (gedeeld) | Via Edge Function |

## Outputs

| Tabel | Wat |
|---|---|
| `legal_ai_linkedin_posts` | 2 rijen per request (analytisch + provocerend) |
| `legal_ai_skill_requests` | UPDATE status='completed' |
| `agent_runs` | 1 rij stats |

## Veiligheidsnetten

* **Niet auto-publishen** — alleen draft. Jelle plaatst handmatig.
* **Cap 5 requests/run** — voorkomt cost-explosie.
* **Article-bestaat-check**: bij ontbrekend article_id → mark request 'failed', geen EF-call.
* **EF-fout**: één variant fout → ander variant blijft draft, log warning.

## Self-provisioning

* DB-schema: vereist `legal_ai_thought_leadership_2026_05_02.sql` (linkedin_posts) + `legal_ai_phase2_2026_05_03.sql` (skill_requests + EF mode).
* Edge Function: `grok-legal-ai-write` v3+ met `mode='linkedin'` support.

## Niet in scope

⛔ Auto-publish op LinkedIn (Jelle plaatst handmatig) · ⛔ Hashtag-suggesties (Jelle's eigen set) · ⛔ Image-generatie · ⛔ Comment-schrijven onder posts.

## Versiehistorie

* **v1 — 2026-05-03** — Initiële versie. On-demand via `legal_ai_skill_requests`. 2 varianten per artikel.

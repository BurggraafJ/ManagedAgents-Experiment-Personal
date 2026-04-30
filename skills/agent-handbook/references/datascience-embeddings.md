# Embeddings — model-keuze, input-design, kosten

## Huidige stand (2026-04-28)

| Setting | Waarde | Reden |
|---|---|---|
| Model | OpenAI `text-embedding-3-small` | 1536 dim, $0.02/1M tokens, prima recall op NL |
| Dimensies | 1536 | Standaard voor 3-small. Niet truncaten, geeft alleen recall-verlies. |
| Indextype | HNSW (cosine) | Sneller dan ivfflat bij ~10-50k rows, geen rebuild nodig bij groei |
| Batch-size | 100 | OpenAI accepteert tot 2048 maar 100 geeft kleine retry-blast bij 429 |
| Wall-time | 90s | Edge Function limit; veilig met 15s margin |
| Coverage | 18.764+ entities (mail/engagement/jira/deal/company/contact) | Alle 6 truth-of-source tabellen |

## Input-design per source — hoe je de embed-tekst opbouwt

De `mail-embed` Edge Function heeft per source een `buildInput()` functie. Verkeerde input = slechte embeddings, ook al klopt de pipeline. Patronen:

### Mail (`mail_messages`)
```
[folder_path]
From: <from_email>
Subject: <subject>
<body_preview>
<body_text || strip_html(body_html)>
```
**HTML strippen voor body_html**. `body_text` is meestal cleaner — gebruik die als die er is.

### Engagement (`hubspot_engagements`)
```
[engagement_type]
Subject: <subject>
<strip_html(body_text)>
```
HubSpot logs hebben vaak embedded HTML uit de email-thread — strippen is verplicht.

### Jira (`jira_issues`)
```
[<project_key>/<issue_key>]
<issue_type> · <priority> · <status>
Assignee: <assignee_name>
Summary: <summary>
<strip_html(description)>
Labels: <labels>
Components: <components>
```

### Deal (`hubspot_deals`)
```
[Deal]
Name: <dealname>
Stage: <dealstage>
Type: <dealtype>
Amount: €<amount>
<properties.description>
Last contact: <properties.notes_last_contacted>
```

### Company / Contact
Zie `mail-embed` source. Houd het kort — namen, industry/jobtitle, korte description.

## Truncate, niet padden

Max input is **8192 tokens** (~32k chars), maar wij truncaten op `MAX_INPUT_CHARS = 8000` (~2k tokens) voor:
1. Snelheid (kleinere payload = snellere call)
2. Cost-controle
3. Mails > 8k chars zijn vrijwel altijd email-threads — de eerste 8k bevat de relevante context

**Nooit padden met whitespace** — embeddings zijn semi-orthogonaal, padding verzwakt het signaal.

## Hash-based dedup

Elke rij krijgt `embedding_input_hash text`. SHA256 van de input-tekst. Als content niet veranderd → hash gelijk → re-embed skippen. Voorkomt onnodige API-calls bij delta-syncs.

```sql
-- Forceer re-embed van een bron (bv. na input-design verbetering)
UPDATE mail_messages
SET embedding = NULL,
    embedded_at = NULL,
    embedding_model = NULL,
    embedding_input_hash = NULL
WHERE embedding_input_hash = '<oude_hash>';
-- mail-embed cron pakt 'm op binnen 2 min
```

## Kosten

- text-embedding-3-small: $0.02 / 1M input tokens = ~€0.018
- 18.764 entities × ~500 tokens avg = ~9.4M tokens = **~€0.17 totale eenmalige kost**
- Lopend: ~50-200 nieuwe records/dag × 500 tokens = ~€0.001-0.003/dag
- **Niet je grootste cost.** Claude Opus voor de skills die de embeddings gebruiken kost ordes van grootte meer.

## Wanneer naar text-embedding-3-large?

- 3072 dim, $0.13 / 1M tokens (6.5× duurder)
- ~10-15% recall-verbetering op MTEB benchmarks
- **Schema-migration** vereist (dim verandering = nieuwe kolom + re-embed alle 18k records ~€2)

**Evalueer-criteria** (uit RAG Quality Engineering project):
- Doe F.6 A/B-meting éérst met 3-small + alle quality-features (MMR/recency/citation)
- Pas naar 3-large overstappen als acceptance-rate plateau bereikt en marginal-cost-per-acceptable-draft het rechtvaardigt
- Niet doen "omdat het kan"

## OpenAI sub-key strategie

PE token in `agent_config(openai, embedding_key)`. Aparte key voor whisper (`agent_config(openai, whisper_key)`). Reden: rate-limit isolation, audit trail, rotatie zonder andere services te raken.

Bij key-rotatie:
1. Genereer nieuwe key in OpenAI dashboard
2. Update `agent_config` row
3. Test: `SELECT net.http_post(url := '.../mail-embed', ...);` — moet success geven
4. Revoke oude key

## Edge cases die we al hebben opgelost

| Probleem | Oplossing |
|---|---|
| Lege body (mail = subject only) | `if text.length < 5 → skip` (skipped count in stats) |
| HTML in body_preview | `stripHtml()` in buildInput; daarnaast `strip_html_inline()` RPC server-side bij retrieval |
| Composio body-cap 200KB | mail-sync-etl-v2 truncate vóór storage, mail-embed truncate nogmaals voor zekerheid |
| 1536-dim payload bulk-update timeout | Updates in slices van 50, niet één bulk |
| Cycle-error mid-run | `try { ... } catch (cycleErr) { warnings.push; break; }` — geen failed run, wel partial-result |

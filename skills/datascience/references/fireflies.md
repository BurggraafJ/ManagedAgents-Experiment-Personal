# Fireflies — chunking, categorisatie & retrieval

> **Levend playbook voor de rijkste én moeilijkste bron in de stack.** Aanvullend op
> `current_architecture.md` §11 (drie-laags strategie, op tekst) en §10 (intent-recepten).
> Dit document gaat over de Fireflies-specifieke invulling: welke metadata, welke
> categorieën, welke chunk-vorm, welke filter per intent — en het concrete
> migratiepad om dat te bouwen.
>
> | Veld | Waarde |
> |---|---|
> | Owner | `datascience` skill (architectuur) — `agent-manager` (orkestratie) |
> | Audit | 2026-05-05 — eerste versie n.a.v. Jelle's vraag _"Fireflies kennis veel beter overal toepasbaar"_ |
> | Status | **voorstel — niet uitgevoerd**. Wacht op akkoord op richting (§9) |
> | Update-trigger | nieuwe chunk-laag · nieuwe categorie · nieuwe intent die meetings raakt · schema-wijziging op `fireflies_meetings` of `chunks` |

---

## 0. Hoe dit document te lezen

Sectie 1-3 beschrijven **wat er nu staat** (feiten). Sectie 4 is **eerlijke kritiek**:
waarom de huidige Fireflies-pipeline 90% van de informatie laat liggen. Sectie 5
geeft de **ontwerpprincipes**. Sectie 6-8 zijn de **doelarchitectuur en het
migratiepad in fasen**. Sectie 9 zijn de **open vragen voor Jelle** voor we bouwen.

---

## 1. Wat staat er nu

### 1.1 Sync — `fireflies-sync-etl` v1.1

Edge function trekt elke 15 min via Fireflies GraphQL alle transcripten van de
laatste 72 uur binnen, upsert in `fireflies_meetings` + `fireflies_action_items`.
Schema:

```
fireflies_meetings
├── id uuid (PK)
├── fireflies_id text (uniek)
├── title text
├── date_time timestamptz
├── duration_min integer
├── organizer_email text
├── attendees jsonb        -- [{email, name}, …]
├── transcript_text text   -- "Speaker N: …\nSpeaker M: …" gecapt op 200KB
├── summary_text text      -- Fireflies' overview/short_summary, ~500-1000 chars
├── action_items jsonb     -- ruwe markdown van Fireflies, soms nested
├── meeting_url text
├── raw jsonb              -- volledige GraphQL-response
├── created_at, updated_at, jellemind_processed_at
```

**Wat ontbreekt op de truth-of-source**:
- Geen `audience` (intern/extern/persoonlijk)
- Geen `category` (sales/MT/strategie/klant-kennismaking/evaluatie/persoonlijk/onbekend)
- Geen `deal_id` of `company_id` (entity-koppeling)
- Geen `topic_summary` boven `summary_text`
- Geen privacy-flag voor persoonlijke meetings (kerk, familie, sport)

### 1.2 Chunking — `chunker` v1.1, functie `chunkMeeting`

Per meeting wordt **precies één chunk** gemaakt:

```
[Meeting]
Title: <title>
Organizer: <organizer_email>
Attendees: <max 10 namen>
<summary_text || transcript_text>     ← getruncated op 8000 chars
```

`chunk_type='macro'`, geen parent, geen topics, geen saillante zinnen.
Plus contextual prefix via gpt-5-nano. Embedding via text-embedding-3-large
(3072 dim halfvec).

### 1.3 Live state (2026-05-05)

| Bron | # chunks | Avg content | Max content |
|---|---:|---:|---:|
| mail | 10.704 | 2.122 chars | 8.000 |
| engagement | 6.157 | 1.822 | 8.000 |
| event | 1.450 | 425 | 8.000 |
| jira | 838 | 231 | 4.743 |
| deal/company/contact | 1.763 | ~62 | 154 |
| **meeting** | **4** | **2.682** | **8.000** |
| lesson | 2 | 463 | 498 |

**4 meetings × 1 chunk** is statistisch onbeduidend, maar het patroon is
fataal: bij 50 meetings/maand (Jelle's schatting) krijg je **600 macro-chunks
per jaar** terwijl de echte signaaldichtheid ergens tussen de 5.000 en 30.000
relevante zinnen ligt. Wat we niet chunken, kunnen we niet vinden.

### 1.4 Retrieval — wat wél al werkt

- `match_chunks(query_embedding, query_text, top_k, filter_sources, filter_after, filter_entity_id, min_similarity, recency_weight, recency_decay_days)` — **hybrid live**: vector + BM25 (FTS) + recency-decay, gemixt via combined_score. RPC retourneert `out_vector_score`, `out_bm25_score`, `out_recency_score`, `out_combined_score`.
- `match_chunks_for_entity(p_entity_type, p_entity_id, …, p_hop_depth)` — entity-laag actief; expandeert via `v_entity_edges_full` over mails/engagements/deals/meetings.
- `context-build` v1.2 edge function (Context-as-a-Service) leest `context_intents`-config, embed query, optioneel entity-resolve, roept de juiste match_chunks-RPC aan, optioneel Haiku-rerank, plus JelleMind lesson-injection per scope.
- Acht intents geregistreerd in `context_intents`: `analyze_meeting`, `compose_followup`, `draft_reply`, `enrich_record`, `extract_actions`, `learn_pattern`, `match_appointment`, `search`. Allemaal `hybrid` of `match_chunks_for_entity` als strategy.

**Conclusie laag retrieve+bundle**: de architectuur kan al goed met meeting-chunks
omgaan. Het ontbreekt niet aan retrieval-machinerie; het ontbreekt aan
**fijnkorrelige chunks om iets uit te halen**.

---

## 2. Echte categorieën — wat ik in de live data zie

Een steekproef van de 4 meetings die nu in DB staan, met de eerste 600 chars
van summary/transcript:

| Datum | Titel | Duur | Wie spraken | Wat het werkelijk is |
|---|---|---:|---|---|
| 04-mei 13:49 | "May 04, 01:49 PM" | 39 min | Jelle solo (Fireflies miste rest) | **Strategie / vision** — LegalMind drie-lagen architectuur, financieringsronde €10-15M, ARR-doelen serie A |
| 04-mei 10:25 | "May 04, 10:25 AM" | 110 min | Jelle + minimaal 3 anderen | **Organisatie / team** — sollicitaties, JelleMind/LegalMind vector DB, productowner Jayce, team-rond. Geen summary. |
| 03-mei 11:19 | "May 03, 11:19 AM" | 46 min | meerdere | **Persoonlijk / kerk** — Jezus, getuigenissen, Hiskia, Roemenië, voedselpakketten. **Hoort niet in werk-RAG.** |
| 30-apr 10:00 | "Sales Meeting [Weekly]" | 101 min | Jelle, Jay Alberts, Tarik El Hamdaoui, Sander | **Sales-team intern** — Sociale Advocatuur Vereniging korting, websiteleads, deals, recaptcha-storing |

In één steekproef van vier meetings vind je dus **vier wezenlijk verschillende
gebruikspatronen**:

| Categorie | Extern? | Auto-draft hint? | HubSpot-note bron? | JelleMind-relevant? | Zoekprivacy |
|---|---|---|---|---|---|
| `client_call` (kennismaking, demo, evaluatie) | ja | **ja** — toon, vraag-stelling, taalstijl klant-specifiek | **ja** — feitelijke uitkomsten, datums, prijzen | matig | werk |
| `sales_team` (intern over deals + klanten) | nee | nee — geen klant ontvangt dit | indirect — strategie per deal kan helpen | ja — sales-style + categorisatie | werk |
| `mt_meeting` (management, beleid) | nee | nee | nee | **ja** — strategie, prioriteiten, leiderschap | werk |
| `strategy_vision` (architectuur, lange termijn) | nee | nee | nee | **ja, sterk** — fundament-keuzes | werk |
| `org_team` (HR, sollicitaties, team-rond) | nee | nee | nee | matig | werk + HR-gevoelig |
| `1on1` (kort intern gesprek) | nee | soms | soms | matig | werk |
| `partner_call` (advocatenkantoor over partnership, niet als klant) | ja | soms | als HubSpot-deal partnerships-board | beperkt | werk |
| `personal` (kerk, familie, sport, training) | n.v.t. | **nooit** | **nooit** | **nooit** | **persoonlijk — uit alle werk-intents geweerd** |
| `unknown` | — | conservatief: geen | conservatief: geen | nee | werk-default |

Dit zijn **negen categorieën, drie audience-niveaus, en twee privacy-niveaus**.
De huidige stack ziet ze als één homogene meeting-stroom.

---

## 3. Wat de huidige naïeve chunking weggooit — een rekensom

Neem de Sales Meeting van 30 april:
- transcript_text: 105.807 chars (ruwweg 17.000 woorden, 22.000 tokens)
- summary_text: 847 chars (~140 woorden)
- chunker pakt `summary_text || transcript_text` → **summary wint** (~0,8% van de informatie)
- Plus prefix gpt-5-nano. Eind-embedding draagt dus 1 vector voor 100 minuten gesprek.

Voor de organisatie-meeting van 4 mei (110 min):
- transcript_text: 125.462 chars
- summary_text: NULL (Fireflies leverde geen summary)
- chunker pakt transcript_text getruncated op 8.000 chars → **6,4% van de informatie**, en het zijn de eerste 6,4 minuten

In beide gevallen is "wat heeft Veerle gezegd over de prijs" via deze chunk
vrijwel onvindbaar. De query matcht op surface-similarity met een blokje
samenvatting/openingsminuten. De rest is digitale donkere materie.

---

## 4. Eerlijke kritiek — wat klopt niet (Fireflies-specifiek)

### 4.1 Eén-vector-per-meeting is de hoofdoorzaak
Zie §3. Iedere lange meeting wordt **één gemiddelde**. Topic-shifts onzichtbaar,
saillante zinnen onvindbaar, cross-meeting-thema's niet aggregeerbaar. Dit is
niet een meeting-probleem — het is hetzelfde "1 record = 1 vector" probleem
uit `current_architecture.md` §4.3, maar voor meetings is de pijn 50× groter
omdat één meeting 50× langer is dan één mail.

### 4.2 Geen categorisatie → privacy-lek + ruis
Een persoonlijke kerk-meeting komt nu evenredig op in `match_chunks` zoekers
als sales-meetings. Voor een query "wat hebben we over evangelisatie besproken"
zou die meeting zelfs HOOG kunnen scoren — maar die query is hypothetisch; het
échte risico is omgekeerd: in een onverwachte query zou kerk-content kunnen
opduiken in een prompt naar `auto-draft` of `daily-admin`. Zonder
audience-classification is dat alleen door geluk vermeden.

### 4.3 Geen audience-routering
- `daily-admin` zou alleen externe meetings moeten zien (klant-kennismakingen,
  partner-calls).
- `sales-on-road` idem.
- `auto-draft` idem voor reply-context.
- `jellemind` mag intern + extern zien (strategie + style learnen), maar niet
  persoonlijk.
- De Fireflies-bron is nu open voor allemaal. Geen filter mogelijk omdat het
  filter-veld niet bestaat.

### 4.4 Geen deal/entity-koppeling op meeting-record
We hebben `cross_link_calendar_fireflies(window_min)` — die linkt een
`fireflies_meeting` aan een `calendar_event` via 15-min window. En
`calendar_events` worden via attendees gelinkt aan deals. **Maar die
ketting wordt nergens dichtgetrokken naar `chunks.entity_ids`.** Resultaat:
`match_chunks_for_entity('company', X)` vindt mails en engagements over X,
maar de meeting-transcripten over X niet. Dat is een aansluitings-bug, geen
ontwerp-bug — maar wel feitelijk een groot gat.

### 4.5 Action_items zijn rauwe markdown, geen gestructureerde feiten
Fireflies levert action_items als één string (markdown met bullets, soms
`**Naam**` headers). `task-organizer-fireflies` parseert ze al voor zijn
eigen doel (taken naar Jelle), maar die parse-resultaten landen niet in
`chunks` als saillante feit-chunks. Een vraag "welke afspraak is er gemaakt
over de proefperiode" valt nu terug op transcript-similarity, terwijl het
antwoord vaak letterlijk in action_items staat.

### 4.6 De drie-laags strategie staat geschreven maar niet gebouwd
`current_architecture.md` §11.1 beschrijft uitvoerig macro/topic/salient.
§11.6 geeft de prefix-templates 11.6.9-11.6.11 voor die drie lagen. Maar
`chunker.ts` doet alleen `chunkMeeting` met `chunk_type='macro'`. **De
specificatie is af, de implementatie 1/3.** Dat is precies wat Jelle's eis
"1× de kans dit goed te doen" probeert te voorkomen — niet half doen, één
keer goed.

---

## 5. Ontwerpprincipes — Fireflies-specifiek

### Principe F-1 — Categoriseren vóór chunken
Een meeting krijgt eerst een `audience` ∈ {`internal`, `external`, `personal`}
en een `category` (zie §2 tabel). Pas daarna besluiten we _hoe_ te chunken
en met welke privacy. Een `personal` meeting krijgt **geen chunks**;
truth-of-source blijft (Jelle wil zijn kerk-meetings kunnen terugzoeken via
de Fireflies-app), maar de RAG-laag negeert hem volledig.

### Principe F-2 — Drie lagen, mits zinvol
Niet elke meeting verdient saillante-zin-extractie:
- **`personal`** → 0 chunks
- **`unknown`** → 1 macro-chunk (huidige gedrag), uitgesteld tot user de
  categorie corrigeert in dashboard
- **`1on1`, kort `client_call` <30 min** → macro + 2-4 topics, geen saillant
  (kosten/baten te laag)
- **`client_call` 30-90 min, `partner_call`** → macro + 5-8 topics + 10-30 saillanten
- **`sales_team`, `mt_meeting`, `strategy_vision`, `org_team` ≥30 min** →
  macro + 6-12 topics + 15-50 saillanten
- **`strategy_vision` >2u** → macro + 8-15 topics + tot 80 saillanten (de
  4-uur-organisatiemeeting die Jelle noemde verdient deze rijke decompositie)

### Principe F-3 — Eén vector-DB, intent-recepten filteren
**Dit is mijn belangrijkste data-science-keuze**, en het antwoord op Jelle's
vraag _"categorie-aware queries vs één vector DB"_:

> Niet aparte vector-databases per categorie. WEL sterkere chunk-metadata +
> intent-recepten die op die metadata filteren.

Reden: vector-similarity is gradueel. Een sales-meeting kan strategische
besluiten bevatten die voor MT relevant zijn. Hard splitsen op categorie
verbreekt cross-categorie ontdekkingen. Maar je wil wel kunnen sturen, en
dat doet de bestaande `context-build` met `context_intents` al. We voegen
twee dingen toe aan de filter-set:

- `filter_audience text[]` — `['external']` voor `draft_reply`, `['internal','external']` voor `analyze_meeting`, etc.
- `filter_meeting_category text[]` — wanneer een intent een specifieke meeting-soort wil (bv. `extract_actions` filtert op `['client_call','sales_team']`).

Dan blijft het een **enkele vector-DB met één retrieval-API**, maar met
intent-precisie. Datascience-norm: principe van **shared substrate, partial
ordering** (cross-discovery > rigide silo).

### Principe F-4 — Saillante zinnen zijn typed
Niet "alle zinnen die belangrijk lijken", maar typed feiten:
- `commitment` — toezegging ("ik zorg ervoor", "wij regelen", "dat doe jij")
- `date` — datum/deadline ("voor 1 juni", "volgende week donderdag")
- `price` — bedrag/voorwaarde ("€125 korting", "5 licenties à 200")
- `name` — entiteit-mentioning, kan voor entity-resolution gebruikt
- `decision` — gemaakt besluit ("we doen het zo", "no-go op X")
- `objection` / `rejection` — bezwaar of afwijzing
- `agreement` — bevestigde uitkomst
- `risk` / `concern` — geuit risico
- `question_to_followup` — open vraag voor later

`chunks.fact_type` kolom bestaat al in schema (`current_architecture.md`
§11.7) — alleen niet gevuld omdat saillant-laag nog niet bestaat. Met
typed facts kan een intent als `extract_actions` filteren op
`fact_type IN ('commitment','date')` — daarmee verslaat een saillant-zin-
chunk een halve transcript-paragraaf in retrieval.

### Principe F-5 — Privacy is een eerste-klas filter, niet een opt-in
Persoonlijke meetings worden **niet gechunkt**. Niet "we filteren ze later".
Niet chunken = onvindbaar via RAG = geen lek. De Fireflies-app blijft de
authoritative store voor de gebruiker zelf. Dit is de enige veilige default
voor een privé-werk-vermenging zoals Jelle die heeft.

---

## 6. Doelarchitectuur — wat we bouwen

```
                        Fireflies → Chunks doelarchitectuur
─────────────────────────────────────────────────────────────────────────────
Stap            │ Wat                                                  │ Eigenaar
─────────────────────────────────────────────────────────────────────────────
1 Sync          │ fireflies-sync-etl v1.1 (ongewijzigd)                │ functions
2 Categorize    │ fireflies-categorize edge fn (NIEUW)                 │ functions
                │   Haiku 4.5 — leest title + attendees + summary +    │
                │   eerste 4k transcript → audience + category +       │
                │   confidence + reasoning. Schrijft naar              │
                │   fireflies_meetings.{audience, category, …}         │
                │   Skip als < confidence-threshold → 'unknown'.       │
3 Cross-link    │ trigger / RPC propagate_meeting_entities (NIEUW)     │ DB
                │   Voor elke meeting: vind matchende calendar_event   │
                │   via cross_link_calendar_fireflies(15), pak         │
                │   event-attendees → contacts/companies → deals.      │
                │   Schrijf naar nieuwe kolom                          │
                │   fireflies_meetings.linked_entity_ids text[].       │
4 Chunk         │ chunker-meeting v2 (UITBREIDING bestaande chunker)   │ functions
                │   Drie lagen volgens Principe F-2.                   │
                │   Macro-laag bestaat al; topic + salient zijn nieuw. │
                │   Aparte LLM-passes per laag (Haiku voor topic-      │
                │   detectie en feit-extractie; gpt-5-nano voor        │
                │   prefix). Skip personal.                            │
5 Embed         │ tekst-embedding-3-large per chunk (bestaand patroon) │ functions
6 Retrieve      │ match_chunks + match_chunks_for_entity met twee      │ DB
                │   nieuwe parameters: filter_audience text[],         │
                │   filter_meeting_category text[]                     │
7 Bundle        │ context-build leest filter_audience/category uit     │ functions
                │   recipe + options en geeft door aan match_chunks    │
8 Consume       │ Skills declareren intent + audience + category-set;  │ skills
                │   geen eigen meeting-SQL meer.                       │
─────────────────────────────────────────────────────────────────────────────
```

Verschillen met huidige stack:
- 2 nieuwe edge functions (`fireflies-categorize`, `fireflies-link-entities` als RPC)
- Drie nieuwe kolommen op `fireflies_meetings`: `audience`, `category`,
  `category_confidence`, `category_reasoning`, `linked_entity_ids`
- Twee nieuwe kolommen op `chunks` voor meeting-chunks: `audience text` (gemirrord van meeting), `meeting_category text`
- Twee nieuwe filter-parameters op `match_chunks` + `match_chunks_for_entity`
- Drie velden in `context_intents`: `default_filter_audience text[]`, `default_filter_meeting_category text[]`, plus `meeting_category_priority` voor weighting
- `chunker-meeting` extension met topic + salient passes
- `chunker.ts` `chunkMeeting` lest categorisatie en stuurt aan-of-uit per laag

---

## 7. Migratiepad — fasen, geen code

Volgorde gekozen op **risicoplanning + Jelle's eis "1× goed"**: eerst de
fundamenten (categorisatie + entity-link) zodat élke daaropvolgende fase
direct waarde heeft, en backfill maar één keer hoeft.

> **Niet uitvoeren tot Jelle akkoord is op richting** (zie §9 open vragen).

### Fase F-1 — Categorisatie-laag (1-2 dagen)

**Doel**: elke meeting krijgt audience + category vóór hij wordt gechunkt.

- Migration: `fireflies_meetings` kolommen toevoegen
  ```sql
  ALTER TABLE fireflies_meetings
    ADD COLUMN audience text CHECK (audience IN ('internal','external','personal','unknown')),
    ADD COLUMN category text,
    ADD COLUMN category_confidence numeric,
    ADD COLUMN category_reasoning text,
    ADD COLUMN categorized_at timestamptz,
    ADD COLUMN categorized_by text;            -- 'llm-haiku-4-5' | 'jelle-override'
  ```
- Edge function `fireflies-categorize` (Haiku 4.5):
  - Leest title + attendees + summary (of head van transcript) + Jelle's
    bekende externe domeinen (uit `partner_domains` + `hubspot_companies.domain`)
  - Output JSON: `{audience, category, confidence (0-1), reasoning}`
  - Confidence < 0.6 → `category='unknown'` (laat Jelle in dashboard corrigeren)
  - Skip al-gecategoriseerde meetings tenzij `categorized_by='llm-haiku-4-5'` én > 30 dagen oud (re-classificeer als modellen veranderen — niet vaak)
- Cron: `*/15 * * * *` direct na fireflies-sync
- Cost: ~$0.005 per meeting → bij 50/maand = $0.25/maand. Eenmalig backfill 4 meetings = niets
- Dashboard-knop "Corrigeer categorie" op meeting-detail → schrijft `categorized_by='jelle-override'`

**Resultaat na F-1**: alle meetings gelabeld. Niets aan retrieval verandert
nog — maar we hebben de basis voor F-2.

### Fase F-2 — Entity-link propagatie (0,5-1 dag)

**Doel**: meeting weet welke deals/companies/contacts erbij horen, vóór chunking.

- Migration: `linked_entity_ids text[]` op `fireflies_meetings`
- RPC `propagate_meeting_entities(meeting_id uuid)`:
  ```
  1. cross_link_calendar_fireflies → vind calendar_event_id (15min window)
  2. Voor elke calendar_attendee (van event): kijk hubspot_contacts.email exact
  3. Voor elke contact: pak associated_company_ids + associated_deal_ids
  4. Voor elke meeting-attendee email die geen calendar-match had: idem
  5. Schrijf de gevonden contact-/company-/deal-ids als `entity:contact:UUID` / `entity:company:UUID` / `entity:deal:DEAL_ID` strings naar linked_entity_ids
  ```
- Trigger: na fireflies-categorize (in dezelfde edge function, of als follow-up)
- `chunks.entity_ids` voor toekomstige meeting-chunks krijgt deze waarden

**Resultaat na F-2**: `match_chunks_for_entity('company', X)` vindt
straks ook meeting-chunks die over X gaan. Eindelijk.

### Fase F-3 — Topic-laag (2-3 dagen)

**Doel**: meeting wordt opgesplitst in 5-12 onderwerpsblokken.

- chunker-meeting extensie: na macro-chunk, voor non-personal meetings:
  - Haiku 4.5 pass: input is volledig transcript (truncate op 100KB ≈ 1,5u
    gesprek), output is JSON-array van `{start_min, end_min, topic_title,
    speakers[]}`
  - Per topic-segment: nieuwe chunk met `chunk_type='topic'`, `parent_chunk_id`
    = macro chunk, gevuld `topic_title`, `topic_speakers`, en als content
    de transcript-fragment van die minuten
  - Contextual prefix volgens template §11.6.10 van current_architecture
- Cost: ~$0.014 per meeting (Haiku-segmentation) + embed = ~$0.02/meeting
- Backfill: 4 meetings × 4-12 topics = ~30 chunks. Eenmalig <$1.

**Resultaat na F-3**: zoekvraag "wat hebben we besproken over de proefperiode
bij Houthoff" landt op een topic-chunk uit de relevante meeting i.p.v. het
gemiddelde over 100 minuten.

### Fase F-4 — Saillante-laag (3-4 dagen)

**Doel**: typed feiten zijn directe chunks.

- chunker-meeting extensie: per topic-segment Haiku-pass:
  - Input: topic-segment-tekst
  - Output: array van `{ts, speaker, sentence, fact_type}` waarbij fact_type
    uit de set in §5 Principe F-4
  - Skip als geen feit > confidence-threshold (Haiku zegt zelf "geen feit hier")
- Voor elk feit: chunk met `chunk_type='salient'`, `parent_chunk_id` = topic
  chunk, vul `speaker`, `fact_type`, `timestamp_in_source`
- Plus: parse `fireflies_action_items` als feit-bron — elk action_item dat
  nu naar `task-organizer-fireflies` gaat krijgt dezelfde behandeling als
  Haiku-extracted feit (dedup op tekst-similarity binnen meeting)
- Cost: ~$0.05 per meeting. Bij 50/maand = $2,5/maand
- Backfill: 4 meetings × ~25 saillanten = ~100 chunks. <$1.

**Resultaat na F-4**: "wat heeft Veerle gezegd over de prijs" → top-1 hit
is letterlijk de zin van Veerle, met topic-context als parent en macro-meeting
als grootouder. Citation-format kan: _"Veerle (Houthoff) op 12-mrt-2026, in
topic 'contractverlenging': 'we tekenen voor 1 juni'."_

### Fase F-5 — Audience- en category-filters in retrieval (1-2 dagen)

**Doel**: intent-recepten kunnen sturen welke meeting-soort terug komt.

- Migration: `match_chunks` en `match_chunks_for_entity` krijgen
  `filter_audience text[] DEFAULT NULL`, `filter_meeting_category text[] DEFAULT NULL`
- `context_intents` krijgt `default_filter_audience text[]`,
  `default_filter_meeting_category text[]`. Defaults:

| Intent | filter_audience | filter_meeting_category |
|---|---|---|
| `draft_reply` | `['external']` | `['client_call','partner_call','sales_team']` (sales_team voor toon-context) |
| `enrich_record` (HubSpot-note) | `['external']` | `['client_call','partner_call']` |
| `extract_actions` | `['external','internal']` | `['client_call','sales_team','mt_meeting','partner_call']` |
| `compose_followup` | `['external']` | `['client_call','partner_call']` |
| `analyze_meeting` | `['external','internal']` | NULL — alle relevant |
| `match_appointment` | NULL | NULL — gebruikt agenda, niet meeting |
| `learn_pattern` (jellemind) | `['external','internal']` | NULL — leert van alles behalve persoonlijk |
| `search` | NULL — gebruiker filtert | NULL |

- `personal` audience wordt **nooit** in default-filters; alleen als gebruiker
  in `RagSearchView` expliciet aanvinkt zou je het kunnen tonen — maar omdat
  we ze niet chunken (Principe F-5) is dat moot.

### Fase F-6 — chunker.ts integratie + dashboard-uitbreiding (1-2 dagen)

- `chunker.ts` `chunkMeeting` herschrijven om de drie passes aan te roepen
  (resp. macro / topic / salient), audience-filter op `personal`, category
  uit DB lezen
- Dashboard: meeting-detail-pagina toont audience + category + correctie-knop;
  topic + saillanten als sub-tabs onder transcript
- IntelligenceHubView (R.9 in current_architecture) krijgt teller "meetings
  met drie-laags chunks vs alleen macro" als pipeline-health-signal

### Fase F-7 — Quality-loop verlengen naar meeting-chunks (parallel)

- `rag_outcomes` linkt al chunk_id's aan accepted drafts. Filter per chunk_type:
  hoeveel saillante-zin-chunks worden in geaccepteerde drafts gebruikt? Bij
  acceptance van een sales-followup met meeting-saillanten als context →
  signaal dat de drie-laags strategie zijn werk doet
- Eerste eval-run na 4 weken live: vergelijken acceptance-rate
  voor/na drie-laags meeting-chunks, op (a) `enrich_record` (HubSpot-notes
  vanuit klant-call) en (b) `compose_followup` (sales-follow-up na call)

---

## 8. Kosten + risico's

### 8.1 Kosten lopend (bij 50 meetings/maand, ~30 niet-persoonlijk)

| Stap | Per meeting | Per maand |
|---|---:|---:|
| Categorisatie (Haiku 4.5) | $0.005 | $0.25 |
| Topic-segmentatie (Haiku 4.5) | $0.014 | $0.42 |
| Saillante-extractie (Haiku 4.5) | $0.05 | $1.50 |
| Embedding (gemiddeld 30 chunks/meeting × $0.000065) | $0.002 | $0.06 |
| Contextual prefix (gpt-5-nano × 30 chunks) | $0.0021 | $0.06 |
| **Totaal Fireflies-tax** | **~$0.073/meeting** | **~$2.30/maand** |

Verwaarloosbaar. Past binnen de €10-15/maand intelligence-budget uit B.5.

Eenmalige backfill (4 huidige meetings + de nieuwe meetings tot acceptatie):
~$0.30. Verwaarloosbaar.

### 8.2 Risico's

| Risico | Mitigatie |
|---|---|
| Haiku misclassificeert privé-meeting als werk → prive-content lekt | Confidence-threshold 0.7 voor `personal`; Jelle krijgt UI-knop voor correctie; al-gechunkte meeting kan retroactief uit `chunks` gegooid worden |
| Topic-detectie fragmenteert te grof of te fijn | Begin met defaults (5-12 topics per meeting); meet via acceptance-rate; tune Haiku-prompt iteratief; topic-titel max 80 tokens |
| Saillanten geven hallucinaties | Haiku krijgt expliciet "alleen letterlijk uit transcript" + `fact_type` enum (typed JSON); validatie: feit-zin moet substring zijn van transcript |
| Cross-link via 15-min window mist meetings zonder calendar-event | Fallback: meeting-attendees direct matchen op hubspot_contacts.email (al opgenomen in F-2 stap 4) |
| Re-chunk bij prefix-template wijziging is duur | Hash-dedup op `content_with_context`; alleen meetings met gewijzigd template re-embedden |
| 4-uur-meeting splitst niet goed | Haiku heeft 200k context — past. Maar response-token-budget (8k) kan beperkend worden bij >15 topics — splitsen we de transcript over twee Haiku-calls bij >120 min meeting |
| `personal` mis-detectie in andere richting (werk-meeting als privé) | Jelle ziet ze in dashboard ("Personal — niet gechunkt"); 1 klik om te overrulen → re-trigger pipeline |

### 8.3 Privacy-architectuur (kerk-meeting case)

Deze case verdient extra aandacht omdat de fout-mode **lekken naar werk-context** is:

1. Categorisatie-prompt voor Haiku krijgt expliciet de hint dat
   meetings met religieus/familiair/sport-vocabulaire zonder werk-context
   `personal` zijn.
2. Bij `audience='personal'`: chunker **slaat alle drie de lagen over**.
   `fireflies_meetings`-rij blijft staan (Jelle wil 'm in zijn Fireflies-app
   kunnen vinden); `chunks` krijgen 0 rijen.
3. Migration plaatst deze regel als CHECK constraint:
   ```sql
   -- chunks tabel
   CONSTRAINT chk_no_personal_meeting_chunks CHECK (
     NOT (source = 'meeting' AND metadata->>'audience' = 'personal')
   )
   ```
   Belt-and-braces — als ergens in code de filter wordt vergeten, faalt de
   insert luid in plaats van stilletjes te lekken.
4. Als Jelle in de toekomst een prive-RAG wil ("kerk-Mind"): aparte audience
   `personal_indexed`, eigen retrieval-pad, separate intent-set. Niet nu
   bouwen.

---

## 9. Open vragen voor Jelle — vóór we bouwen

Mijn aanbeveling is dit hele plan uit te voeren in volgorde F-1 → F-7. Maar
er zijn beslismomenten die jouw input nodig hebben:

### 9.1 Categorie-set definitief?
Ik stel deze 9 voor (§2): `client_call`, `sales_team`, `mt_meeting`,
`strategy_vision`, `org_team`, `1on1`, `partner_call`, `personal`, `unknown`.
Mis ik een categorie die jij vaak hebt? `recruitment_interview`? `vendor_call`?
`internal_training`? Hoe meer categorieën, hoe meer ruis in classificatie —
dus echt alleen toevoegen als die meeting-soort zich materieel anders gedraagt
qua retrieval-gebruik.

### 9.2 Audience-grens "intern/extern"
Definitie-vraag: zit Jay Alberts (intern werknemer Legal Mind) in een
sales-meeting → `internal`. Maar als Jay met een externe advocate praat
in een tweede meeting? Dan `external`. Mijn classifier-prompt gaat als volgt
besluiten: **als minstens 1 attendee een email-domein heeft buiten
`legal-mind.nl`/`burggraafgroup.nl` én niet in `partner_domains` staat → external**.
Akkoord?

### 9.3 Is een persoonlijke meeting echt 0 chunks, of alleen geïsoleerd?
Optie A (mijn voorstel): 0 chunks. Niet vindbaar via RAG, alleen via
Fireflies-app.
Optie B: chunks met `audience='personal'` + harde filter in alle work-intents.
Iets minder veilig (één bug in filter → lek), maar voorbereidt op een
toekomstige privé-mind als die er komt.
**Mijn voorkeur: A**. Veilig is beter dan toekomstvast.

### 9.4 Wie corrigeert? Jij alleen, of ook team?
Sollicitatie-meeting valt in `org_team` — wil je dat _alleen jij_ die kunt
zien in JelleMind-context, of ook dat anderen (later wanneer team-toegang
komt) er bij kunnen? Voor nu lijkt **alleen jij** veilig — maar dat heeft
implicaties voor RLS op `chunks.metadata.audience='internal'` zodra het
dashboard multi-user wordt.

### 9.5 Begin small of fundament?
Optie X: alleen F-1 + F-3 doen (categorisatie + topics), saillante-laag een
half jaar later na meten.
Optie Y: hele F-1 t/m F-6 in één migratie-sprint van 2 weken.
**Mijn voorkeur: Y**, gegeven Jelle's eis "1× goed" en de lage absolute
cost. Half doen creëert het patroon dat je nu juist wil voorkomen.

### 9.6 Andere bronnen ook categorisatie-laag?
De keuze "categorisatie als first-class metadata" past in principe ook op
mail (audience-classifier draait al impliciet via `for_you`/`not_for_you` in
auto-draft) en op events. Voorstel: pas dit Fireflies-patroon eerst af, leer,
en plan dan een **F.x — categoriseren op alle bronnen** als die patroon-laag
in de praktijk werkt. Niet preventief.

---

## 10. Hoe dit document up-to-date blijft

Update-protocol (analoog aan `current_architecture.md` §9):

| Trigger | Sectie bij te werken |
|---|---|
| Nieuwe meeting-categorie toegevoegd | §2 + §5 Principe F-3 + §7 F-5 (intent-recepten) |
| Schema-wijziging op `fireflies_meetings` | §1.1 |
| Nieuwe chunk-laag (bv. summary-of-summary boven macro) | §1.2 + §5 Principe F-2 + §6 |
| Acceptance-rate eerste resultaten | §7 F-7 + nieuwe sectie 11 _Quality-meetingen_ |
| `match_chunks` API-uitbreiding voor meetings | §1.4 + §6 + §7 F-5 |
| Privacy-architectuur wijziging | §5 Principe F-5 + §8.3 |
| Categorie-correctie-mechaniek (jelle-override) verandert | §7 F-1 |
| Nieuwe consumer-skill leest meeting-chunks | §7 F-5 tabel |

Bij elke wijziging: ook `current_architecture.md` §1 (de stack-tabel) en §11
(drie-laags strategie) bijwerken zodat hoofd-architectuur en deze deep-dive
nooit divergeren.

---

## 11. Audit-log

| Datum | Wijziging | Door |
|---|---|---|
| 2026-05-05 | Eerste versie. Diagnose huidige Fireflies-pipeline + projectvoorstel F-1 t/m F-7. Wacht op akkoord §9. | Claude (sessie tijdens onderzoek Fireflies-RAG) |
| 2026-05-06 | **F-1 + F-2 + F-5 + F-6 LIVE.** Migration `fireflies_categorization_and_entity_link_2026_05_06` deployed (audience/category/confidence/reasoning/categorized_at/categorized_by/linked_entity_ids op `fireflies_meetings`). RPC `propagate_meeting_entities` live. Edge Function `fireflies-categorize-v2` live (gpt-4.1-nano i.p.v. gpt-5-nano omdat reasoning-model alle tokens at; key uit `skill:openai:embedding_key`). Cron `5,25,45 6-21 * * *` geplant. **Backfill 4/4 succesvol**: strategy_vision + org_team + sales_team + **personal (kerk-meeting, 0 entity-links)**. Migration `f5_audience_category_filters_2026_05_06`: `match_chunks` krijgt `filter_audience text[]` + `filter_meeting_category text[]`; chunks-metadata backfilled met audience+category; `context_intents` defaults gevuld (draft_reply/enrich_record/extract_actions/compose_followup/analyze_meeting/learn_pattern). Migration `f6_privacy_no_personal_meeting_chunks_2026_05_06`: kerk-chunk verwijderd + CHECK constraint `chunks_no_personal_meeting_chunks` actief. `chunker/index.ts` lokaal aangepast met skip-logic + audience+category propagatie naar metadata (deploy openstaand i.v.m. MCP deploy-update bug op live slugs). | Claude (uitvoersessie F-1..F-6 fundament-sprint) |
| 2026-05-06 | **F-3 + F-4 + F-5b LIVE — drie-laags chunking compleet.** RPC `fetch_meetings_for_v2_chunking` live (kandidaten zonder topic-chunk, skip personal). Edge Function `chunker-meeting-v2` v1.2 live: Grok 4-fast-reasoning (key uit `skill:legal-ai-research:grok_api_key`) doet topic-segmentatie + saillante-zin-extractie in ÉÉN pass; gpt-4.1-nano contextual prefix (gedropt in v1.1 ten gunste van directe meta_context-prefix voor snelheid); text-embedding-3-large 3072 dim halfvec; batched embed (80 chunks/call) + batched insert (25 rows/slice). **Backfill 3/3 succesvol** in totaal ~2 min: strategy_vision (11 topics + 43 salients), org_team (9 topics + 77 salients), sales_team (7 topics + 34 salients) = **27 topics + 154 salients = 184 nieuwe chunks** vs voorheen 4 macro's. fact_type-distributie rijk: name (37), decision (31), date (25), price (24), commitment (13), objection (8), agreement (7), rejection/risk (3 ea), question/question_followup (3). Migration `f4_extend_fact_type_check_2026_05_06`: CHECK constraint uitgebreid met decision/objection/risk/question_followup. Cron `15,35,55 6-21 * * *` geplant. Migration `f5b_match_chunks_for_entity_audience_filter_2026_05_06`: `match_chunks_for_entity` krijgt filter_audience+filter_meeting_category. Edge Function `context-build` v1.4 live: leest `default_filter_audience`+`default_filter_meeting_category` uit recipe en geeft door aan beide RPC-calls. End-to-end smoke-test geverifieerd: `analyze_meeting` retrieves saillante-zin-chunks bovenaan, met audience-filter intact. **Cost**: ~$0.04/meeting (Grok ~$0.005 + embed ~$0.002 + per-chunk ~$0.0007), ~$2/maand bij 50 meetings. **MCP deploy-update bug**: `fireflies-categorize` (v1) bleef onbruikbaar; werkende slug is `fireflies-categorize-v2` met cron erop. Test-fn `fireflies-categorize-test` blijft staan tot delete-tool beschikbaar. **Openstaand**: chunker/index.ts (mail+andere bronnen) deploy met skip-logic, `RagSearchView` UI-update voor audience/category-toggles. | Claude (vervolgsessie F-3..F-5b) |

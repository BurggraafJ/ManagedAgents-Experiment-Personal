# Changelog — Maestro-chat

Alleen wijzigingen die het gedrag van de chat raken. Voor het waaróm: `DECISIONS.md`.

---

## v1.152 — 2026-09-07 · Artefacten v2 (spoor 05)

**PDF is een bestand geworden**
- Nieuw `agent-artifact-build/pdf.ts` (`pdf-lib` via esm.sh): A4 landschap zodra
  er een tabel is, staand voor een rapport; kop per pagina, herhaalde kopregel,
  getallen rechts, cellen geknipt op de échte tekstbreedte; laatste pagina is de
  *Verantwoording* inclusief kolomdefinities. Gemeten na de deploy: 3.000 bytes
  in 32 ms; lokaal 5.000 rijen → 137 pagina's in 721 ms. Kosten $0,00.
- `sanitizeWinAnsi()` vraagt de encoder zelf per codepoint om zijn oordeel en
  telt de vervangingen in de verantwoording. Zonder dat gooit één teken buiten
  CP1252 de hele export om (gemeten: `WinAnsi cannot encode "日"`).
- `ArtifactBar`: de PDF-knop bouwt nu een echt bestand langs dezelfde weg als
  xlsx/csv — ook op de telefoon, waar een printdialoog niets doet. *Afdrukken*
  blijft bestaan op desktop.

**Twee termijnen die eerst één naam deelden**
- De respons geeft `url_expires_at` (handtekening, 24 u) én `expires_at`
  (bestand, bewaartermijn). v1 gaf alleen `expires_at` — met de waarde van de
  handtekening, terwijl de kolom met diezelfde naam de bewaartermijn is.
- De bewaartermijn staat in `agent_config('agent-artifacts','retention_days')`,
  default 30. Wijzigen kost geen deploy.
- Onder de knoppen staat het nu ook gewoon: *link 24 uur geldig · bestand 30
  dagen bewaard*.

**Meerdere tabbladen en kolomdefinities**
- `sheets: [{name, columns, rows}]` → één werkblad per maand (AR06), met
  `safeSheetName()`: verboden tekens eruit, 31 tekens, uniek, en
  *Verantwoording* gereserveerd.
- `column_defs: [{key, label, definition, type, format, width}]` stuurt de
  Excel-getalnotatie, de uitlijning in de pdf, en vult het blok *kolom →
  definitie* op de verantwoording (AR09, AR32).

**De bewaartermijn krijgt een uitvoerder**
- Nieuwe functie `agent-artifact-cleanup` (`verify_jwt: false`) + cron
  `agent-artifact-cleanup-nightly` (`45 3 * * *`). Bestand eerst, rij daarna,
  harde limiet van 500 per run, droogloop met `{"dry_run":true}`.
- Wezensweep in beide richtingen ná 24 uur respijt, en een `security_findings`
  -regel zodra er werk blijft liggen. Vóór v1.152 noemde geen van de 42 cronjobs
  `agent_artifact*`.

**Lijn tussen twee bestanden**
- `params.period`, `source_artifact_id` en RPC `agent_artifact_recent()`
  (`SECURITY INVOKER`) voeden de *"Zelfde als …"*-keuze. Bewezen negatief: een
  tweede persona ziet 0 van de 14 rijen van de eerste, en anoniem geeft
  `permission denied`.

**Afdrukken**
- Eerste globale `@media print` in `src/index.css`: sidebar, mobiele topbar,
  tabbar en docks gaan eruit, de schil wordt één kolom, papier wit. Tot nu toe
  bestond er precies één printregel in de hele frontend, in een CSS-module van
  één view — de sidebar ging dus mee op papier.

**De envelop biedt de pdf nu ook aan (WP8, `rag-chat` v66)**
- `artifacts_available` heeft twee takken: met rijen `["xlsx","csv","pdf"]`,
  zonder rijen `["pdf"]` — een antwoord zonder tabel kan wél een rapport-pdf
  zijn. Noch antwoord noch tabel: dan maakt `finishRun` de lijst leeg.
- De regel staat in `run.ts` (`prepareCompose` + `finishRun`), niet in
  `index.ts`: de v6.0-splitsing van spoor 02 heeft de envelop-opbouw verplaatst
  en `finishEnvelope` omgedoopt tot `finishRun`.
- Gemeten op de live functie, want de evallane kan envelop-velden niet bewijzen:
  twee semantische vragen zonder tabel gaven `["pdf"]` (402 en 1.426 tekens
  antwoord, 0 rijen), twee vragen mét tabel `["xlsx","csv","pdf"]`. De oude
  tweewaardige lijst komt niet meer voor.

**De pdf-assert is niet langer onmeetbaar (vork F5, `rag-eval-cron` v14)**
- `expect_artifact_type: pdf` werd afgevangen vóór de echte controle en op
  `pending` gezet — zolang de knop een browserafdruk was, viel er niets te
  bouwen. Nu loopt pdf langs dezelfde poort als xlsx/csv: aangeboden + gebouwd
  + HEAD 200, met `body_markdown` als er geen rijen zijn.
- AR03 en AR08 gingen daarmee van `pending` naar **pass**, met twee echte
  pdf-rijen in `agent_artifacts` (2.926 en 2.770 bytes, 33 en 43 ms).

**Meten**
- `agent_artifact_smoke.cjs` van 10 naar **20** asserties: pdf per formaat, een
  tweede negatieve eigenaarstest (anon-JWT), tabbladen, kolomdefinities,
  WinAnsi-sanering, niets over zijn vervaldatum, geen wezen, en
  bytes/`build_ms`/`build_cost_usd` per rij.
- De bank is opnieuw gemeten nu er weer OpenAI-krediet is: `artefact` van
  20,8 % (onder de storing) naar **46,2 % / 53,8 %** in twee runs, `vorm` van
  35,7 % naar **50 % / 57,1 %**, `n_pending` van 2 naar **0**. Twee runs, want
  op identieke code slaan er 3 van de 40 items om — zie `DECISIONS.md`.

## v1.151 — 2026-09-07 · Spoor 02 I2: de browser volgt de run (rag-chat v6.1)

I1 zette het antwoord op de server; I2 laat de browser er naar kijken. **Wat je merkt:**
een vraag verdwijnt niet meer als je de tab sluit, je ziet in welke fase Maestro is, wat de
run tot nu toe kostte, en je kunt hem stoppen. Onderzoek en poorten:
`/workspace/security/maestro-agent-architecture/02-long-running-runs/`.

**Browser**
- `src/hooks/useRunFollow.js` (nieuw): per run één realtime-kanaal via
  `createRealtimeChannel('agent-run')` met filter `id=eq.<run_id>`, één `select` bij
  `SUBSCRIBED` (wat vóór het abonnement gebeurde gaat niet verloren), een poll elke 5 s als
  vangnet, en `removeChannel` bij een eindtoestand én bij unmount.
- `src/hooks/ragChatRunRow.js` (nieuw): rij → chatbericht. `answer_md ?? answer_partial`
  wordt de tekst, `envelope`/`citations`/`analytics`/`spent` komen bij de eindtoestand.
- `useRagChat.js`: `send()` is één korte POST `{run:true}` die binnen ~0,3–3 s een `run_id`
  geeft; het SSE-pad en de `invokeFallback` zijn weg. De assistent-stub met `run_id` wordt
  **direct** bewaard (de oude "niet opslaan tijdens streaming"-uitzondering is verdwenen) —
  dat is precies wat het opnieuw aanhaken na een reload mogelijk maakt.
- `RunControls.jsx` (nieuw): budgetregel in de meta-rij (`high · $0,0061 · 2 hops`),
  stopknop zolang de run loopt, `needs_input` als vraag + antwoordveld (vork V4),
  "opnieuw proberen" bij `failed` (hervat — herhaalt geen tool-calls), en een regel bij een
  geannuleerde run zodat een half antwoord niet als compleet leest.
- `ReasoningTrace`: toont `phase_label` van de rij en rekent de live-teller vanaf
  `created_at`, zodat hij na een reload niet opnieuw bij 0,0 s begint.
- Mobiel (`MobileZoeken.jsx`): dezelfde hook — fase, kosten en stopknop in de bubble-kop.
- Twee bugs onderweg: de tijdregel in het debug-paneel las `timing_ms` als getal terwijl het
  een object is (toonde "NaN s"), en de mobiele bubble las `timing_ms.total_ms` — een veld
  dat nooit heeft bestaan, dus die regel bleef altijd leeg.

**Motor (rag-chat v6.1)**
- Nieuwe kolom `agent_chat_runs.meta` (migratie `20260907120000`): de compacte UI-payload
  die tot nu toe alleen in het SSE-`meta`-frame zat — `entity_used`, `retrieval_strategy`,
  `bundle_id`, `debug_pipeline`, `model`, `web_citations`, `tokens.retrieval`, `grok_ms`,
  `finish_reason`. Zonder die kolom levert de run-modus een stillere UI dan het oude pad:
  geen entity-badge, leeg debug-paneel, geen web-tab, feedback zonder model.
- **Vork V7 gesloten:** `stream:true|false` bestaan niet meer. Een body zonder `run:true`
  krijgt `400 run_required` met een hint naar de rij. De inline hop-plumbing binnen `run.ts`
  is daarmee onbereikbaar; ze blijft nog even staan omdat ze in de budget- en
  hopgrens-logica zit die net groen gemeten is (zie DECISIONS).

**Meten**
- `scripts/agent_chat_smoke.cjs` meet nu de run-modus (via `scripts/lib/chat-run.cjs`) en
  kreeg S7–S11: run-contract, **disconnect 3×**, owner-only op tabel én publicatie mét
  positieve controle, run-dekking, en de waakhond. 58 asserties.
- `rag-eval-cron` v3.3: `{run:true}` + poll op `agent_chat_runs`; time-out is
  `budget.wall_ms + 30 s` in plaats van de oude clamp op 170 s, `cost_usd` is `spent.usd`
  (de som over alle leveranciers), `expect_effort_at_least` is geen `pending` meer, en
  `envelope_compact` draagt `run_id`, `effort`, `budget`, `spent` en `hops`.

## 2026-09-07 · Spoor 06b: de HubSpot-kaarten dragen hun eigen feiten (chunker v1.7)

Backend-only, geen `APP_VERSION`-bump. `rag-chat` en `context-build` zijn niet aangeraakt.
Onderzoek en poorten: `/workspace/security/maestro-agent-architecture/06-rag-per-source/06b/`.

**Index — de dubbele HubSpot-mailkopieën eruit (data-job)**
- 4.888 `source='engagement'`-chunks verwijderd: e-mails waarvan dezelfde mail, met dezelfde
  afzender, binnen dezelfde dag óók in `mail_messages` staat. Sleutel = genormaliseerd
  onderwerp + `hs_email_from_email` + ±1 dag (onderwerp alleen zou 6.057 geven en is te ruim).
  De HubSpot-rijen blijven staan; alleen de dubbele zoek-chunk gaat weg en een her-chunk
  haalt hem terug. Plus 2 dubbele `source_id`'s opgeruimd.

**Recept `search_fast` — e-mail-engagements gecapt, niet uitgesloten (migratie `20260907051000`)**
- `source_overrides = {"engagement":{"max_per_source":3}}`. Gemeten op 8 echte vragen:
  `search_ms` p50 1.572 → 628 ms, engagement-chunks 48 → 15, top-1-bron per vraag identiek.
  Uitsluiten was langzamer (1.916 ms) en verplaatste de flooding naar meeting-stubs.

**Entity-graaf — `engagement → company` via het e-mailDOMEIN (migraties `20260907052000`,
`20260907054000`, `20260907055000`)**
- Nieuwe arm op `v_entity_edges_full`, `edge_type='email_domain'`, confidence 0,7:
  from/to/cc-domein tegen `hubspot_companies.domain`, eigen domein uitgesloten. 4.250 edges
  over 276 bedrijven en 3.463 engagements. E-mail-engagements hebben hun associatie-arrays
  leeg op 9.783 van 9.783 rijen, dus vanuit een klant was de HubSpot-correspondentie
  onzichtbaar; de enige edge die ze hadden was `engagement → owner`.
- **De eerste vorm rekende die arm in de view uit en liet `match_chunks_for_entity`
  timeouten** (6 van 18 probe-aanroepen, edge-CTE 8.883 ms tegen 1.445 ms vóór): de view
  wordt bij élke entity-aanroep geëvalueerd en dit was de eerste arm die
  `hubspot_engagements` binnentrok. De ACL bleef daarbij groen (17/17) — het was latency,
  geen zichtbaarheid. Nu staat de afbeelding in
  `hubspot_engagement_company_domain` (4.250 rijen, index op `company_id`, RLS met dezelfde
  `is_admin_or_higher()`-qual als de mirrors) met een trigger op `hubspot_engagements` en
  `hs_engagement_company_domain_refresh()` voor de volledige herbouw; de view-arm joint
  erop. Terug op **1.610 ms**.

**Chunker v1.7 — masters her-chunkbaar en inhoudelijk gevuld (migratie `20260907050000`)**
- Drie chunk-source-views (`v_hubspot_deal/company/contact_chunk_source`) die het fase-LABEL
  uit `hubspot_pipelines.stages`, de bedrijfsnaam en `version` (epoch van
  `hs_lastmodifieddate`, terugval `hs_created_at`) meeleveren.
  `fetch_unchunked_source_ids` vergelijkt op die versie — hetzelfde patroon als Confluence.
- `SOURCES` deal/company/contact: `replace: true`. Was write-once, waardoor 98,6 % van de
  deal-chunks de fase van het moment van chunken droeg.
- Deal-kaart: `Fase` (label, nooit het ruwe id), `Pipeline`, `Bedrijf`, `Sluitdatum`,
  `Bedrag`, en `Contract`/`Licentie`/`Proefperiode`/`DMS`-regels uit de licentie-properties.
  Company-kaart: `Lifecycle`, `Locatie`, `Medewerkers`, `Deals`, `Contactpersonen`.
  Contact-kaart: `Company` (via `associated_company_id`, 3,4 % → 88,3 %) en `Lifecycle`.
- `chunkContact.occurred_at` gebruikt `hs_created_at` in plaats van `new Date()`:
  `hs_lastmodifieddate` is op alle 1.507 contacten null, dus elke contact-chunk kreeg de
  datum van het chunken — bij een her-chunkbare bron zou dat elke ronde "vandaag" worden.
- Backfill-knoppen op de request-body (`sources`, `batch`, `prefix_concurrency`,
  `max_cycles`). pg_cron post `{}` en houdt dus exact het gedrag van v1.6.

**Recepten `enrich_record` + `compose_followup` — `entity_anchor_top_n` 4 → 0
(migratie `20260907058000`)**
- Gemeten op de named-entity-arm: `search_ms` **2.857 → 1.212** (−58 %). En het tweede,
  zwaardere argument: met vier ankers erin verdringen die de **company-master-kaart** en
  twee engagement-chunks, en is de top-1-chunk een anker **zonder** vectorscore. Met de
  ankers uit staat de kaart waar de vraag over gaat wél in het bundel, met een echte
  treffer (0,598) als kop. De ankerinjectie compenseerde stub-masters; WP2 heeft die
  verrijkt, dus de pleister kan eraf.
- `analyze_meeting` (06c) en `search` (06f-β) houden hun 4.
- **`bm25_enabled` blijft AAN op beide recepten.** Uitzetten is 20-45 % sneller en het
  chunk-*aantal* blijft gelijk — maar de samenstelling niet: zonder de lexicale arm
  verdwijnen **alle deal-chunks** (6 → 0 en 12 → 0) en alle mail, en vullen
  engagement-chunks de plekken op. De deal-kaart is precies wat WP2 verrijkte; de
  vectorarm vindt hem op deze vraagvorm niet en de lexicale arm wel. 06a's
  `bm25_enabled=false` was juist op `draft_reply` (14,6 % van de chunks droeg een
  bm25-score) en is hier niet te kopiëren.

**`analytics_notes_search` — breder en zonder gematerialiseerde scope (migratie `20260907053000`)**
- `hubspot_engagements.body_clean` (STORED, dezelfde twee `regexp_replace` die de RPC per
  aanroep per rij deed) + `gin_trgm_ops` op `body_clean` en `subject`.
- `p_types`-default `{note,meeting,call}` → `{note,meeting,call,email,task}`: de oude default
  dekte 1.244 van 11.586 rijen en `agentic.ts` geeft `p_types` niet door.
  `~*` blijft de matcher — `websearch_to_tsquery('dutch', …)` verloor 26-39 % recall.
- `scanned_total` is een losse count geworden; hij maakte de scope-CTE twee-keer-gerefereerd
  en dus gematerialiseerd, waardoor elke aanroep alle bodies las.
- Samen: **41 ms** op een populatie van 11.586 rijen, tegen 4.560-5.478 ms ongeïndexeerd en
  1.292-2.050 ms op de oude, kleine populatie.
- `p_types => null` gaf **nul** rijen (`= any(NULL)` is NULL) waar de default 40 gaf — een
  stil leeg resultaat. Nu `coalesce(nullif(p_types,'{}'), <default>)` in het lichaam.
  `agentic.ts` geeft `p_types` niet door, dus dit was nog niet bijtend.

## 2026-09-07 · Spoor 06c + 06e: meetings hangen nu aan hun klant, en de agenda geeft antwoord

Backend-only, geen versie-bump. Zes migraties `20260907060000`–`20260907066000`,
`chunker-meeting-v2` v5. Waarom: `DECISIONS.md`; poorten en metingen:
`/workspace/security/maestro-agent-architecture/06-rag-per-source/06c/IMPLEMENT-NOTES.md`.

**Wat de gebruiker merkt**
- Een vraag over een klant kan nu fragmenten uit eerdere **meetings** met die klant
  terugkrijgen. Dat kon niet: er was geen koppeling van een meeting naar een bedrijf, dus het
  entity-pad haalde er nooit één op (gemeten 0 van 8 gelinkte bedrijven, nu 8 van 8).
- Een **agenda**-vraag die niets vond, verbreedt zichzelf: eerst zonder de eis "alleen
  externe deelnemers", daarna zonder het datumvenster. Van de 40 lege agenda-antwoorden in
  90 dagen verdwijnen er 35 (leegte 21,7 % → 2,7 %). Prijs: soms komt er een interne
  vergadering terug waar je alleen klantgesprekken verwachtte; het antwoord kan dat zien in
  de nieuwe kolom `widened`.
- Meetings liggen minder vaak "overal bovenop": van de 902 saillante uitspraken is de
  zoek-tekst ingekort (meetingtitel en topic-onderwerp eruit). De uitspraak zelf is
  ongewijzigd. Gemeten: fragmenten uit dezelfde meeting halen elkaar nu in 30 % van de
  gevallen mee in plaats van 66,5 %.

**Schema en data**
- `meeting_entity_link` (160 rijen) + arm `meeting -[involves]-> company|contact|deal` in
  `v_entity_edges_full` (22 → 25 families), confidence 0,95. Gematerialiseerd, met index,
  RLS, refresh-RPC, trigger op `fireflies_meetings`, cron `meeting-entity-link-refresh`
  (`40 3 * * *`) en de live controle-view `v_meeting_entity_link_health`.
- `context_intents.analyze_meeting`: `max_per_record` 1, `source_overrides
  {"meeting":{"max_per_source":3}}`, `default_top_k` 14, `default_filter_audience` NULL.
  `entity_anchor_top_n` blijft 4 — een A/B draaide dat voorstel om.
- `analytics_calendar_search`: verbredingsladder, extra outputkolom `widened`
  (`null|attendees|window`), `p_limit`-default 60 en **`p_caller_user_id uuid DEFAULT NULL`**
  als scope-parameter. `agentic.ts` geeft die nog niet mee, dus de tool levert vandaag nog
  aan iedere aanroeper de hele agenda — zie DECISIONS, overdracht 03/04.
- `match_appointment` staat `BUITEN GEBRUIK` (de rij kan niet weg: `context_bundles.intent`
  heeft er een FK naar).
- Bank: MA24, KL41 en RO48 van de chat- naar de retrieval-lane (hun assert was op de
  agentische route per definitie onhaalbaar), E30 gedeactiveerd, MA48/MA49 toegevoegd als
  permanente identiteitscontrole op de agenda.

**Edge**
- `chunker-meeting-v2` v5 (`verify_jwt:false`), gesplitst in `index.ts` / `chunking.ts` /
  `reembed.ts` (was 413 LOC, cap is 400). Nieuwe modus
  `POST {"mode":"reembed_salients"}`: zelf-drainend op `metadata.prefix_version`, met een
  tokenplafond. 902 chunks her-embed voor $0,0051.

---

## v1.149 — 2026-09-06 · Spoor 02 I1: een vraag is nu een run (rag-chat v6.0)

Zichtbaar voor de gebruiker verandert er in I1 nog niets — de browser-hook volgt in I2.
Onder water is elke chatvraag nu een rij in `agent_chat_runs` met toestand, budget,
stappenlog en het antwoord zelf, afgewerkt in hops van ≤ 170 s. Onderzoek en poorten:
`/workspace/security/maestro-agent-architecture/02-long-running-runs/`.

**Schema (migratie `20260906190000_agent_chat_runs`, prod 12:40 UTC)**
- `agent_chat_runs` (klein, in de realtime-publicatie, owner-only `select` met
  `session_mfa_ok()`) en `agent_chat_run_state` (zwaar: lus-berichten, evidence,
  compose-payload; service-only, geen policies). Kolommen `rag_chat_query_log.run_id`
  en `claude_api_calls.chat_run_id` (+ index; bedrading in 03a).
- RPC's: `agent_chat_run_claim_hop` (atomaire lease, fencing-token), `agent_chat_run_cancel`
  en `agent_chat_run_answer_input` (eigenaar, `SECURITY DEFINER`), `agent_chat_runs_watchdog`
  (hop_lost/budget_wall, opruimen 7 d state / 90 d runs, `security_findings`).
- View `v_agent_chat_runs_health` (per dag × verkeer: done/failed per code, hops, p95
  t.o.v. budget, kosten); cron `agent-chat-runs-watchdog` elke minuut met `WHERE EXISTS`.
- `agent_config('rag-chat','run_budgets')` (per effort `{tool_calls, wall_ms, usd, hops_max}`,
  RESEARCH §3.4) en `agent_config('rag-chat','pricing')` (één prijstabel; constanten blijven fallback).

**Motor (rag-chat v6.0, 6 bestanden)**
- `index.ts` gesplitst: `run.ts` (toestandsmachine, hops, lease, budget, spent, alle
  retrieval-helpers) en `compose.ts` (prompt, dekkingszinnen, prijzen, Grok-stream → rij).
- Body-modes: `run:true` → direct `200 {run_id}`, hop 1 in `EdgeRuntime.waitUntil`;
  `{_run_id,_hop}` (service-key, zelf-fetch); `{_run_id,resume:true}` (eigenaar of service);
  compat `stream:true|false` maakt óók een run-rij en draait de hops inline (≤ 140 s) met
  het v5.8-antwoordcontract — vork V7, weg zodra hook (I2) en runner v3.1 op `run:true` staan.
- Hop: geen nieuwe agent-beurt na 60 s (`HOP_SOFT_MS`), hard 170 s (`HOP_HARD_MS`); elke
  UPDATE eist `hop_lease = <token>`; `beforeunload` schrijft de reden en geeft de lease vrij.
- Effort: uit de body, anders route (structured/sweep → low, semantic → medium, agentic →
  high, "grondig/rapport/per klant" → xhigh); zelfheling naar de agent tilt een route-effort
  naar `high`. `spent` per hop over OpenAI (in/cached/out), router, Grok, embed, Cohere;
  `rag_chat_query_log.est_cost_usd = spent.usd`.
- Providerfouten (429/5xx van router, context-build, agent-lus, Grok) → één nieuwe poging na
  2 s, daarna `failed{provider_error, provider, http_status}` mét `spent`; de state-rij blijft
  voor `resume`. Geen stille `not_tracked` meer door een storing.
- `envelope` v1 ongewijzigd; additief blok `budget {effort, limits, spent, exhausted_by, hops}`.
- `agentic.ts`: alleen een hervat-punt (`opts`: budget, hopDeadlineAt, resume, onIteration,
  price, throwProviderErrors); tools, `execTool` en prompt-tekst ongewijzigd.
- Grok-stream met `stream_options.include_usage`: zonder die vlag stuurt xAI géén usage-chunk
  (gemeten) — het oude stream-pad logde daardoor nooit Grok-tokens voor browservragen.

**Gemeten (I1)**: `run:true` structured → done in 12 s (hop 10,3 s); agentic `xhigh` → done in
80 s over 2 hops (65,1 s + 12,7 s), 19 tool-calls, $0,163; smoke 24/24; SSE-compat groen;
100 % van de querylogrijen sinds de deploy draagt `run_id`.

**Nog niet (I2)**: `useRunFollow` op `createRealtimeChannel('agent-run')`, disconnect-test
S8, realtime-RLS-test S9, runner v3.1 leest de rij, `needs_input`-producent (ask_user-tool, 03b).

## 2026-09-07 · Spoor 06d — Confluence en de kennisbank (backend-only, geen `APP_VERSION`-bump)

Geen frontend-bestand geraakt, dus geen versiebump; wel ander gedrag voor élke documentatie-
vraag in de chat en voor elk kennisbank-artikel dat van status wisselt. Besluiten en metingen:
`DECISIONS.md` 2026-09-07 (06d) en `06-rag-per-source/06d/IMPLEMENT-NOTES.md`.

**Recept (migratie `20260907031000_06d_search_docs_max_per_record`)**
- `max_per_record = 2` op `search_docs`. 06f-α had de kolom aangelegd en alleen `search_fast`
  gevuld; het recept dat élke documentatievraag gebruikt bleef NULL. Gemeten op vijf echte
  documentatievragen, top_k 40: **23,2 → 28,4 pagina's** per bundel van 40 chunks, max per
  pagina **9 → 2**, top-1 vectorscore gelijk (0,540 → 0,538), zoektijd 742 → 742 ms op het
  chatpad. De chat houdt daarna 24 van de 40, dus ook die 24 komen uit meer pagina's.
  Terugdraaien is de kolom op NULL.

**Kennisbank (migratie `20260907030000_06d_kb_article_chunks_follow_status`)**
- Nieuwe trigger `trg_kb_article_chunks_follow_status` (`AFTER UPDATE OF status ON
  kb_articles`, `WHEN old.status IS DISTINCT FROM new.status`). Status weg van
  gevalideerd/gepubliceerd → de chunk gaat er direct uit; status terug ín die verzameling →
  `embedded_at` op NULL plus dezelfde http-post naar `kb-article-embed` die de insert-trigger
  doet, zodat concept → gevalideerd niet tot vier uur op `kb-article-embed-4h` wacht.
- Waarom: de embed-pijplijn kende alleen de "erheen"-richting (`kb_articles_fetch_dirty`
  filtert op gevalideerd/gepubliceerd, de enige trigger stond op INSERT). Het ene
  gearchiveerde artikel hield zijn chunk van 11 juni tot de 06f-α-reconcile van 6 september.
  Zonder trigger is de bleed maximaal 24 uur (`rag-chunks-reconcile-daily`, 03:50 UTC); die
  reconcile blijft het vangnet.
- Geen lus met de embedder: die schrijft alleen `embedding`/`embedded_at`/`embedding_model`
  terug en raakt `status` nooit, en een `AFTER UPDATE OF status`-trigger vuurt alleen als
  `status` in de SET-lijst staat. Rollback-test op prod (één transactie, vier overgangen):
  gevalideerd → gearchiveerd = chunk weg; gearchiveerd → verworpen = niets; verworpen →
  gevalideerd = één http-post en `embedded_at` NULL; gevalideerd → gepubliceerd = géén
  tweede post.

**Chat (`rag-chat` v63, `verify_jwt: true`)**
- `confluence_search` en `semantic_search` sturen geen `min_similarity` meer mee: het recept
  is de waarheid. Voor `intent=search` verandert niets (dat recept staat zelf op 0,30, exact
  de verwijderde hardcode); voor `search_docs` gaat de lat naar 0,42, gemeten een no-op omdat
  `bm25_enabled=true` elke chunk met een lexicale treffer doorlaat. Gecontroleerd ná de
  deploy: jelle en cron houden 8 van 8 rijen. `top_k: 8` blijft — dat is het toolbudget.
- Een leeg toolresultaat draagt nu zijn reden. `execTool` heeft naast `error` (de tool is
  stuk) een `note` (de tool draaide en gaf niets, met de reden): `acl_filtered` →
  "deze gebruiker heeft geen zichtbare Confluence-spaces", `truly_empty`, `below_threshold`,
  `timeout`, `not_tracked`. De note gaat mee **naast** de rijen, staat in de UI-trace
  ("0 resultaten — …") en in de agent-trace. Nooit een space- of paginanaam.
- Onder de kop van elk Confluence-fragment staat één herkomstregel `Confluence: <space> ›
  <pad> · v<versie> · <url>`, en `envelope.sources` draagt een `url`-veld (null voor elke
  andere bron; envelope-versie blijft 1). De titel van een Confluence-bron komt nu uit
  `metadata.title` in plaats van uit `deriveSubject`, dus zonder het
  "(deel i/n)"-achtervoegsel van de chunker.

**Wat 06d bewust niet doet:** `inject_kb` blijft uit op `search_fast` (injectie op 0,42 zou
op 1 van 12 gewone vragen een marginaal artikel toevoegen — het lek van juni; echte
kennisbankvragen halen hun artikel al met 0,48–0,56 via de bron-agnostische pool),
`min_similarity 0,42` blijft staan maar is op dit recept een no-op (drempelbeleid hoort bij
de reranker), en `kennisbank` komt niet in `DOCS_QUESTION_RE` (0 echte vragen met dat woord
in 60 dagen).

---

## 2026-09-06 · Spoor 06a — mail en de eigen mailbox (backend-only, geen `APP_VERSION`-bump)

Geen frontend-bestand geraakt, dus geen versiebump; wel ander gedrag voor mailbox-vragen in
de chat en voor elke `draft_reply`-bundel. Besluiten en metingen: `DECISIONS.md` 2026-09-06
(06a) en `06-rag-per-source/06a/IMPLEMENT-NOTES.md`.

**Recepten (migratie `20260906220000_06a_draft_reply_bm25_off`)**
- `bm25_enabled = false` op `draft_reply` en `classify_mail_action`. Een inkomende mail ís de
  zoekvraag; onder de 500-tekencap van `match_chunks` liet de lexicale arm een derde tot vier
  vijfde van de index ranken. A/B op dezelfde embedding en receptparameters: **9.924 ms met de
  arm, 563 ms zonder**, dezelfde vijf treffers. Vóór: `draft_reply`-bundels (auto-draft, 60 d)
  search p95 8.047 ms, 21 van 438 leeg.
- Nieuw recept `my_mail` (migratie `20260906223000_06a_my_mail_intent`): `match_chunks`,
  top_k 10, min_sim 0,30, recency 0,30/90, bm25 uit, `filter_sources ['mail']`,
  `max_per_record 1`, jellemind/kb uit.

**Chat (`rag-chat` v61, `verify_jwt: true`)**
- `my_mail_search` heeft een tweede arm. Naast `rag_search_my_mail` (regex, nieuwste eerst)
  loopt nu een `context-build`-call met `intent: my_mail` en `owner_user_id` = de vrager.
  Samengevoegd op mail-id: letterlijke treffers jonger dan 7 dagen eerst, dan de semantische
  op score, dan de oudere letterlijke; ≤ 12 rijen, elk met `gevonden_via` (`recent` of
  `relevantie`). Faalt de semantische arm, dan is het antwoord wat het ervoor was.
- Route-override ná `classifyRoute`: heeft de vrager een spiegel én gaat de vraag over zijn
  eigen mailbox (`mijn mail/inbox/mailbox/postvak/verzonden items/map`, of "X stuurde mij"),
  dan gaat `semantic`/`sweep` naar `agentic` — anders wordt `my_mail_search` nooit
  aangeboden. Zichtbaar als `dbg.route_override` en `rag_chat_query_log.meta.route_override`.
  De routerprompt zelf is niet aangeraakt (die is van spoor 03).

**Index (migraties `20260906221000_06a_chunker_mail_hardening`, `20260906222000_06a_mail_entity_ids`, `chunker` v12)**
- `fetchUnchunked` staat binnen de per-bron `try`: één bron die valt is een waarschuwing, geen
  run-fout. Gemeten met dezelfde fout die 2026-09-06 07:15 UTC een hele run liet vallen.
- Mail-tak van `fetch_unchunked_source_ids` kijkt eerst in een venster van 30 dagen:
  26,5 ms / 2.825 buffers tegen 63,5 ms / 15.973 warm.
- Partiële unieke index `chunks_mail_one_per_message`; een 23505 daarop is een waarschuwing.
- `v_mail_chunk_source` levert `entity_ids`/`primary_entity_id` voor de **externe** deelnemers
  (from/to/cc, eigen domein eruit); backfill 3.886 van 3.886 extern-resolvable mails, 0 met een
  intern contact, geen re-embed. Let op: `context-build` geeft `filter_entity_id` vandaag hard
  `null` mee, dus dit filter is alleen bereikbaar bij een directe `match_chunks`-aanroep.

**Vragenbank** — MA47 (eigen-mailbox, chat): relevantie boven recency, `expect_tools_include
my_mail_search` + `expect_no_empty`.

## 2026-09-06 · Spoor 06f-α — mechanica en hygiëne in `match_chunks` (backend-only, geen `APP_VERSION`-bump)

Geen UI-wijziging; wel ander retrieval-gedrag voor élke aanroeper van `match_chunks`
(rag-chat, autodraft, daily-admin, meeting-briefing). Besluiten en metingen:
`DECISIONS.md` 2026-09-06 (06f-α) en `06-rag-per-source/IMPLEMENT-NOTES.md`.

**Retrieval (migratie `20260906210000_06f_alpha_match_chunks_mechanics`)**
- `match_chunks` is plpgsql en zet `hnsw.ef_search` zelf: 80 op het vector-only pad en onder
  de iteratieve scan, 40 op het ongefilterde hybride pad (BM25 zit daar tegen de 8 s-timeout,
  gemeten onder de 6-parallelle evallane); bij een hard filter
  (`filter_sources`, `filter_after`, `filter_entity_id`, audience/category/enrichment-filters,
  uitgesloten bronnen) ook `hnsw.iterative_scan=relaxed_order` met `max_scan_tuples=4000`.
  Gemeten: mail + 90 d gaf 1 van 40 rijen, alleen meeting 0 → nu 40/40. Echte pad (8 vragen):
  meeting-filter mediaan 0 → 40, confluence+kb-filter 0 → 40.
- LIMIT in de vector-arm: `top_k*10` alleen met `query_text`; `top_k*2` bij caps; anders
  `top_k`. rag-chat krijgt nu de gevraagde 60 kandidaten (was stil 40).
- Nieuwe parameters `max_per_record`, `max_per_source`, `source_overrides` (match_chunks) en
  `p_max_per_record`, `p_source_overrides` (match_chunks_for_entity). Default NULL = uit.
- Recency-klem: een `occurred_at` in de toekomst telt met zijn afstand tot nu in plaats van
  1,0; `event` blijft `future_ok` (default, per recept uit te zetten).
- proacl beide functies hersteld op `{postgres,authenticated,service_role}` (geen PUBLIC).

**Recepten (migratie `20260906211000_06f_alpha_recipe_caps`, `context-build` v2.10)**
- `context_intents.max_per_record / max_per_source / source_overrides`; `search_fast` = 2 / 12.
  Gemeten vóór op 20 benchvragen: max 40 meeting-chunks per bundel, max 11 chunks van één
  record. `context-build` v2.10 geeft de kolommen door en logt ze in `retrieval_meta`.

**Hygiëne (migratie `20260906212000_06f_alpha_rag_chunks_reconcile`)**
- Onder de iteratieve scan is de vector-LIMIT begrensd op `greatest(top_k, 120)`: met 450
  kostte een mail-gefilterde hybride call 2,1 s extra en liep de BM25-arm in de 8 s-timeout.
- `chunks` krijgt een eigen autovacuum-drempel (200 dode tuples, scale 0): verwijderde chunks
  blijven anders als tombstones in de HNSW-graaf meetellen in `ef_search` (probe 80 → 60 levende
  rijen). Een VACUUM-cron faalt op de 120 s `statement_timeout` van de cron-sessie.
- `rag_chunks_reconcile(p_dry_run, p_max_fraction)` + cron `rag-chunks-reconcile-daily`
  (03:50 UTC): chunks van verwijderde mails, race-dubbelen per mail, gearchiveerde
  deals/engagements, geannuleerde of soft-deleted events, niet-gevalideerde kb-artikelen,
  gearchiveerde Confluence-pagina's, personal meetings, inactieve lessons, actions zonder
  besluit, verdwenen company/contact/jira. Vangnet > 50 én > 25 % per bron. Logt in `agent_runs`
  (`rag-chunks-reconcile`, run_type `pg_cron`).
- `fetch_unchunked_source_ids('event')` slaat soft-deleted events over.

**Evalbank**
- Runner `rag-eval-cron` v3.2: `expect_min_chunks`, `max_chunks_per_record`, `top1_not_future`,
  `expect_sources_live` (DB-check op `mail_messages.is_deleted`), `options.filter_after_days`.
- Items RO51–RO54 (= 06F-R01..R04): gefilterde recall, flooding, wezen, toekomstdatum.

---

## v1.148 — 2026-09-06 · Answer-stack S3b, stap 1: Sol op de lus, Luna op de hulpmodellen, echte tarieven

Geen zichtbare wijziging: Grok 4.3 schrijft nog elk antwoord, ook de navertelling
van de agent-conclusie. Stap 2 (Terra semantisch, Sol streamt zelf) volgt in een
eigen PR met een blokkerende A/B. Beslissing: `ANSWER-STACK-RESEARCH.md` §8.

**Modelpins**
- `agent_config('rag-chat','agentic_model')` → `gpt-5.6-sol` via migratie
  `20260906170000_s3b_step1_agentic_model_sol` (prod + Dev). `agentic.ts` kent nu
  sol/terra/luna in `PRICE_PER_M`; een onbekend model valt terug op gpt-5.5 en
  meldt dat in `dbg.agentic_model_fallback` in plaats van stil.
- De gpt-5.6-familie accepteert function-tools op `/v1/chat/completions` alleen
  met `reasoning_effort: "none"` (live gemeten, HTTP 400 anders). Sol draait op de
  lus dus zonder redeneer-tokens; redenerend Sol vraagt de Responses API = stap 2.
- Router en sweep-verdicts (`analytics.ts`), HyDE-rewrite en LLM-rerank
  (`context-build` v2.9) en de evaljudge (`rag-eval-cron` v3.1) → `gpt-5.6-luna`.
- De agent-lus roept in zijn eerste beurt verplicht een tool aan
  (`tool_choice: "required"`, daarna `auto`). De eerste rookronde onder de Luna-router
  liet vijf vage vragen op de agentic route eindigen met een wedervraag zonder tool;
  via het 0-rijen-blok en de Grok-navertelling werd dat vijf stille leegtes en één
  verzonnen bevestiging (NE08). Zie `DECISIONS.md`.

**Kosten eerlijk**
- `PRICE_USD` grok 3,00/15,00 → 1,25/2,50 (xAI-lijstprijs); `PRICE_PER_M` gpt-5.5
  1,25/10 → 5/30, gpt-5.4-mini 0,15/0,60 → 0,75/4,50. Semantische vragen waren
  2,4-6× te duur gelogd, agentische ~3× te goedkoop.
- `usage.prompt_tokens_details.cached_tokens` wordt gelogd en tegen het
  cache-tarief geprijsd: `analytics.cost.tokens_cached` (agent-lus) en
  `rag_eval_results.envelope_compact.judge_usage` (judge).
- G5 (kosten) is hiermee opnieuw geijkt: runs van vóór v1.148 zijn op `cost_usd`
  niet vergelijkbaar met runs erna. `rook-s3b-step1` is de nieuwe kostenbasis.

## v1.147 — 2026-09-06 · Spoor 01: evalbank + validatiepoort

**Bank geladen (WP1/WP2)**
- Migratie `20260906120000_agent_eval_bank_v1`: `rag_eval_questions` krijgt `lane`,
  `category`, `persona`, `history`, `ground_truth_status`, `tags`, `bank_version`,
  `source_hash`; `rag_eval_results` krijgt `latency_ms`, `cost_usd`, `route`,
  `caller_identified`, `sources`, `coverage_reason`, `tools_used`, `pending_asserts`,
  `envelope_compact`; `rag_eval_runs` krijgt `status`, `suite`, `params`,
  `persona_check`, `gates`, kosten en latency. Nieuw: `rag_eval_personas`,
  `rag_eval_run_items`, views `v_agent_eval_by_category` / `_core_trend` / `_runs`,
  RPC's `rag_eval_start_run`, `rag_eval_claim_batch`, `rag_eval_persona_check`,
  `rag_eval_finish_if_done`, `rag_eval_compare` (G1–G7).
- `scripts/agent_eval_load.cjs`: 364 bankitems geladen (435 actief, 22 `is_core`
  byte-gelijk, 0 placeholders over). Bank v1.1: `wiki-acl` meet bronnen per space
  (`expect_sources_include_space` / `exclude_space`) in plaats van
  `coverage.reason`; WI36/WI37 op `search_docs`; RO31 hoort groen.

**Runner (WP3)**
- `rag-eval-cron` v3.0: werk wordt uit de DB geclaimd (3 chat / 16 retrieval / solo
  voor `kosten` en `max_latency_ms > 100 s`), geen `MAX_CHAIN` meer; pomp-modus
  `{"_pump":true}` pakt gestrande runs op. Persona-JWT per hop via `generate_link`
  + `token_hash`, uitloggen na de hop, nooit opgeslagen. Preconditie
  `rag_eval_persona_check` → `invalid_persona`. Alle assert-keys van `rubrics.md`;
  onbekend of niet meetbaar = `pending`. Eerste rookronde: 36 items, 310 s, $0,76,
  `n_identity_unreliable` 0.

**Evalverkeer herkenbaar (WP4)**
- `rag-chat` v5.7 (2 regels): `body.eval_run_id` → `rag_chat_query_log.meta.eval_run_id`.
- Migratie `20260906130000_agent_chat_health_exclude_eval`: `v_agent_chat_health`,
  `v_agent_chat_by_route`, `v_agent_chat_coverage` en `agent_chat_health_check()`
  sluiten `meta ? 'eval_run_id'` uit.

**CLI en cadans (WP5/WP6)**
- `scripts/agent_eval_run.cjs`: kick / poll / `--status` / `--compare` / `--gate [strict]`
  / `--json`; weigert bij een lopende run. CLAUDE.md pre-flight punt 8 krijgt de rookronde.
- Crons: `rag-eval-weekly` → zondag 04:30 CEST, suite `full`; nieuw `rag-eval-pump`
  (elke minuut 06–23); `rag-eval-nightly` bestaat maar staat uit via
  `agent_config('rag-eval-cron','nightly_enabled') = false`.
- `scripts/confluence_acl_eval.cjs` schrijft zijn run-rij nu met `suite = 'acl'`,
  `status = 'done'` en `started_at`/`finished_at`: sinds `status` een default `queued`
  heeft, bleef elke ACL-ronde anders als `queued` in `v_agent_eval_runs` staan (twee
  rijen van 2026-09-06 met de hand op `done` gezet).

---

## v1.146 — 2026-09-05 · WP0 t/m WP4

**Retrieval (WP1)**
- Nieuw recept `context_intents.search_fast`: vector-only, geen HyDE, geen
  entity-anchors, geen rerank in `context-build`. De gewone chatvraag gaat
  hierheen; documentatievragen blijven op `search_docs`.
  Gemeten p50 13.282 → 2.370 ms, p95 23.318 → 3.071 ms, 90 % → 0 % boven de
  6 s-grens, 2 → 0 lege bundels.
- `context_intents.bm25_enabled` (default `true`, dus geen enkel bestaand recept
  verandert). `false` = `query_text` gaat als NULL naar `match_chunks`, waarmee
  de lexicale arm zichzelf overslaat.
- `context-build` v2.8: de drie opstart-RPC's parallel, de JelleMind-scopes
  parallel, en `options.async_bundle` schrijft de bundelrij ná de response.
  Samen ~1,5 s van het kritieke pad.
- `rag-chat` stuurt `enable_rerank: false` — de eerste van twee Cohere-rondes
  was een pure herordening die de tweede meteen overschreef.
- `CHAT_CONTEXT_CHUNKS = 24`: de reranker krijgt weer een pool om uit te kiezen.

**Leegte (WP2)**
- `coverage.reason` (`timeout | acl_filtered | below_threshold | truly_empty |
  not_tracked`) van `context-build` → `rag-chat` → het antwoord → het querylog.
- Nieuw blokje in de chat (`CoverageNote`) dat de reden in gewone taal toont.
- Eén tweede poging bij < 3 fragmenten: `min_similarity` 0,15 en geen bronfilter.
- ILIKE-entityresolutie verwijderd; alleen `rag_resolve_entity` blijft.
- Zelfheling kijkt naar bruikbare context (`matches.length < 3`) in plaats van
  naar `!entityHint`.

**Meten (WP3)**
- `v_agent_chat_health`, `v_agent_chat_by_route`, `v_agent_chat_coverage`.
- `agent_chat_health_check()` + cron `agent-chat-health-guard` (25 7-22):
  meldt in `security_findings` bij een leeg antwoord zónder reden (high) en bij
  een leeg-ratio boven 25 % (medium).
- `est_cost_usd` wordt nu op **elke** route gevuld, ook semantisch. `meta.usage`
  bewaart de ruwe tokens per leverancier.

**Antwoord en artefacten (WP4)**
- Antwoordcontract `envelope` v1 naast de vrije markdown.
- `agent_artifacts` + private bucket `agent-artifacts` (eigenaar-only).
- Edge function `agent-artifact-build` (verify_jwt: true): Excel/CSV met een
  tabblad "Verantwoording", signed URL van 24 uur.
- Downloadknoppen onder een antwoord met een tabel; PDF via `window.print()` met
  een print-stylesheet.

**Documentatie en eval**
- `docs/agent/` — dit bestand plus `ARCHITECTURE.md`, `DECISIONS.md`,
  `TOOLS.md` (gegenereerd), `SKILLS.md`.
- `docs/agent/vragenbank/` — 364 vragen met placeholders, klaar om te laden.
- Nieuwe scripts: `agent_retrieval_bench.cjs`, `agent_chat_smoke.cjs`,
  `agent_artifact_smoke.cjs`, `agent_docs_generate.cjs`, `lib/user-jwt.cjs`.

---

## v1.145 — 2026-09-05

- Per-user Confluence-space-ACL in `match_chunks` (`p_caller_user_id`).
- `search_docs`-recept voor documentatievragen.
- `vector_error` / `vector_timed_out` / `vector_fetch_ms` in het querylog — de
  telemetrie die de v1.146-diagnose mogelijk maakte.

## v5.5 en eerder

Zie de kopcommentaren in `supabase/functions/rag-chat/index.ts`.

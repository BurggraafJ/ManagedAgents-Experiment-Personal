# Besluitenlogboek — Maestro-chat

Gedateerd, met de meting erbij. Eén regel per besluit dat later iemand doet
denken "waarom staat dit zo?". Nieuwste bovenaan.

Regel: **een werkpakket is niet af tot hier een regel bij staat.** Zonder dat
wordt dit een archief van goede voornemens.

---

## 2026-09-06 — 06a: de mailbox-vraag bereikte zijn eigen tool niet, en een korte mail liet BM25 de halve index rangschikken

**Spoor 06a (Maestro Agent Architecture), model claude-opus-5 (effort max), job `3dbccdcf`.**
Onderzoek: `06-rag-per-source/06a/RESEARCH.md`; meting en poorten:
`06-rag-per-source/06a/IMPLEMENT-NOTES.md`. Backend-only: geen frontend-bestand geraakt, dus
geen `APP_VERSION`-bump.

**De meting die de sessie omdraaide.** De nulmeting (39 bankitems, ná de merge van #56 en #57)
liet **negen** items falen op één en dezelfde assert: `tools(missing=my_mail_search)`. MA01,
MA02, MA03, MA05, MA07, MA08, MA09 (eigen-mailbox) en MA34, MA35 (org-mail) kregen allemaal
route `semantic` van de router — en op die route wordt de mailbox-tool niet eens aangeboden.
Het onderzoek had er zes gezien; vandaag waren het er negen. Aan een tool die niet gebeld
wordt valt niets te verbeteren: de route was het probleem, niet de retrieval.

**Besluiten, elk met de reden:**

1. **`bm25_enabled = false` op `draft_reply` en `classify_mail_action`.** `match_chunks` zet de
   tsquery op NULL boven 500 tekens, dus juist de kórte inkomende mails lieten de OR-arm de
   index rangschikken. A/B op prod, dezelfde opgeslagen mail-embedding, exact de
   receptparameters, hetzelfde moment: **9.924 ms** met de arm tegen **563 ms** zonder, met
   dezelfde vijf treffers; de OR-tsquery van die tekst matchte 16.186 van 46.382 chunks. Vóór
   (60 d, `audience='auto-draft'`, n=438): build p95 8.668 ms, search p95 8.047 ms, 21 lege
   bundels; op de eval-lane droeg 13 van 38 `draft_reply`-bundels `vector_errors`. Een
   inkomende mail ís de zoekvraag — de lexicale arm voegt daar niets aan toe dat de
   entity-route (afzender → contact) en de MetaRAG-leader in de embedding niet al leveren.
   Terugdraaien is één UPDATE.
2. **`my_mail_search` krijgt een tweede arm in plaats van een betere RPC.**
   `rag_search_my_mail` is `ORDER BY received_at DESC LIMIT 10` over een regex; gemeten in de
   spiegel matcht `nda|geheimhouding` 1.440 mails (104 in de laatste 90 dagen),
   `offerte|voorstel` 1.070, `demo` 541. De tool toonde daarvan de tien nieuwste, dus alles wat
   relevanter maar ouder was bestond niet. Ranking ín de RPC bouwen zou een SECURITY-DEFINER-
   lichaam mét identiteitspredicaat raken; een tweede arm via `context-build` (recept `my_mail`,
   `owner_user_id` = de vrager) niet. `rag_owner_scope_ids(<vrager>)` geeft `ARRAY[<vrager>]`,
   dus `match_chunks` ziet exact dezelfde mail als `m.user_id = p_user_id`. Gemeten: zes
   bundels, search p50 838 ms, 10 chunks per bundel, **alles `source='mail'` en alles van één
   eigenaar**, 0 leeg. De semantische arm faalt zacht.
3. **Een mailbox-vraag mag de router overrulen, maar alleen mét spiegel.** `MAILBOX_RE` na
   `classifyRoute`: heeft de vrager een `mail_accounts`-rij én gaat de vraag over zijn eigen
   mailbox, dan wordt `semantic`/`sweep` `agentic`. Drie probes met zinnen die in de nulmeting
   semantic kozen gingen daarna naar agentic mét `my_mail_search`; **dezelfde zin als collega
   zonder spiegel kreeg géén override en géén tool**. De regex raakt 0 van de 368 overige
   bankitems. De routerprompt zelf blijft van spoor 03; de override staat als
   `dbg.route_override` in de run en in `rag_chat_query_log.meta.route_override`, zodat 03 hem
   ziet zonder de prompt te lezen.
4. **De regex wijkt af van RESEARCH §3 en is bewust breder.** De voorgestelde vorm
   (`mijn mail|inbox|…`) dekt MA03/05/07/08/34/44/45 maar niet MA02 en MA09 ("X schreef mij",
   "X heeft mij gestuurd") — terwijl poort a0 juist 6/6 op MA02/03/05/07/08/09 vraagt. Daarom
   twee extra alternatieven voor de "iemand mailde mij"-vorm. MA01 ("waar wacht nog een
   antwoord van mij op?") en MA35 ("is er iets binnengekomen…") blijven buiten de regex: die
   twee zijn routerwerk, geen regexwerk, en een clausule die precies één bankitem matcht is
   bankfitting.
5. **`entity_ids` op mail is extern-only.** Het koepelplafond van 60–67 % telde
   `mail_enrichment.related_contact/company` mee, en 8.318 van die 9.670 rijen wijzen naar een
   intern contact; `entity:contact:<collega>` zou aan 8.303 mails hangen en het filter tot ruis
   maken. Alleen deelnemers op het bericht zelf (from/to/cc) met een domein buiten
   `mail_accounts.own_domains`: **3.886 van 14.334 mails (27,1 %)**, backfill 3.886 van 3.886
   (100 %), 8.895 paren, **0 mailchunks met een intern contact**, geen re-embed.
6. **Maar `filter_entity_id` is vandaag onbereikbaar — dat is nieuw en het corrigeert de
   aanname onder besluit 5.** Het onderzoek las "0 van 4.060 bundels gebruikten
   `filter_entity_id` in 90 dagen" als "dood omdat mail geen entity_ids had". De echte reden:
   **`context-build` geeft in álle vier zijn `match_chunks`-aanroepen `filter_entity_id: null`
   mee.** Er is dus geen pad — niet vanuit rag-chat, niet vanuit autodraft, niet vanuit de
   evalrunner — dat de parameter kan zetten. Direct op de RPC werkt het wél: een extern contact
   geeft nu 20 mailtreffers waar het er vóór de backfill 0 waren. De data staat er dus goed en
   bewezen bij, maar de consument moet nog gebouwd worden: één regel in `context-build`
   (`options.filter_entity_id` doorgeven), buiten de schrijfscope van deze kick. Daarom is het
   voorgestelde bankitem MA46 **niet** geladen — een item dat per definitie rood staat hoort
   niet in de bank. Overdracht: 06b/06f.
7. **Eén bron die valt is een waarschuwing, geen run-fout.** `fetchUnchunked` stond buiten de
   per-bron `try`, dus één mail-timeout maakte de hele chunker-run `error` en sloeg álle
   bronnen over — precies wat 2026-09-06 07:15 UTC gebeurde (de enige fout in 30 dagen).
   Gemeten met een gecontroleerde injectie van diezelfde fout (ERRCODE 57014, alleen de
   mail-tak): de echte run van vanochtend was `error` met een leeg `warnings[]`; dezelfde fout
   op v1.6 geeft `warning`, twee waarschuwingen en een andere bron die gewoon doorchunkt.
8. **Venster-eerst op de mail-tak van `fetch_unchunked_source_ids`.** In steady state las de
   vraag elke vijf minuten 15.973 buffers (≈ 125 MB) naast een HNSW van 382 MB in 256 MB
   `shared_buffers`. Warm gemeten, drie herhalingen: volledig 62,5/66,3/63,6 ms bij 15.973
   buffers, venster van 30 dagen 26,9/26,2/26,5 ms bij 2.825. De volledige scan blijft en
   draait alleen als het venster de LIMIT niet vult; de takken zijn disjunct op `received_at`
   (NULL valt in de tweede). `CREATE OR REPLACE`, geen `DROP` — `proacl` vóór en ná identiek.
9. **Partiële unieke index in plaats van een run-lock, en zonder `CONCURRENTLY`.**
   `chunkMail` levert precies één chunk per mail; `chunks_mail_one_per_message` maakt de
   race-dubbelen die 06f-α opruimde structureel onmogelijk (vooraf geteld: 0 dubbelen over
   14.338 mailchunks). Geen `CONCURRENTLY`, tegen RESEARCH §3 in: de repo draait migraties via
   `supabase db push` in één transactie en daar mag dat niet (zie
   `20260518_get_sender_history_rpc.sql`); de partiële index dekt 14.338 rijen en bouwde binnen
   de seconde. Een 23505 erop is voortaan een waarschuwing en de rest van de batch landt wél.
10. **Geen `party_type`-autofilter, geen recency-expansie, geen owner-unie.** F12 blijft nee
    (er is nog geen assert die de partij van de bronnen meet); de recency-geordende
    graph-expansie (`v_entity_edges_full` + `match_chunks_for_entity`) en de owner-unie voor
    mailbox #2 (`rag_owner_scope_ids` = `org ∪ {caller}`) raken allebei de identiteitsas en zijn
    bewust buiten dit spoor gehouden.

**Poorten.** ACL 17/17 vóór én ná (blokkerend, groen). Getallen per poort in
`06a/IMPLEMENT-NOTES.md` §7.

**Open (niet in 06a):** `options.filter_entity_id` doorgeven in `context-build` + bankitem MA46
(06b/06f); MA01 en MA35 naar de agentische route krijgen zonder regex (spoor 03); de a2-poort
op `draft_reply` heeft zeven dagen echte auto-draft-bundels nodig — in het meetvenster van deze
sessie kwam er geen nieuwe mail binnen.

## 2026-09-06 — 06f-α: de gefilterde HNSW-scan sneed stil af, en `match_chunks` zet nu zelf zijn knoppen

**Spoor 06f-α (Maestro Agent Architecture), model claude-fable-5-1 (F!, effort max), job
`188f0b52`.** Onderzoek: `06-rag-per-source/RESEARCH.md` §3.1; meting en poorten:
`06-rag-per-source/IMPLEMENT-NOTES.md`. Alleen mechanica en hygiëne — geen drempel, geen
reranker, geen BM25-wijziging (dat is 06f-β en wacht op twee vragen aan Jelle).

**De meting die het besluit droeg.** De vector-arm van `match_chunks` is een HNSW-scan die
hoogstens `hnsw.ef_search` (40) kandidaten teruggeeft en dáárna pas de WHERE toepast. Door de
functie gemeten met een opgeslagen embedding: `filter_sources=['mail']` + 90 dagen → **1** rij
van 40, alleen mail → **7**, alleen meeting → **0**. Op het echte pad (context-build, echte
vragen, 8 stuks): mail + 90 d mediaan **2** (4 van 8 leeg), meeting-filter mediaan **0** (7 van
8 leeg), confluence+kb-filter mediaan **0** (5 van 8 leeg). Dat is de mechaniek achter "een
tijdscue op mail geeft één fragment" én achter `search_docs` als agent-tool met 9/9 lege
bundels: geen drempel-, maar een scanprobleem. Ná: 40/40/40 door de functie; echte pad
mail + 90 d mediaan 40, meeting 40, docs 40.

**Besluiten, elk met de reden:**

1. **`match_chunks` is plpgsql en zet zijn GUC's zelf** (`set_config(..., is_local=true)`):
   `hnsw.ef_search=80` altijd; `hnsw.iterative_scan=relaxed_order` + `max_scan_tuples=4000`
   alleen als een hard filter meegaat. Geen wrapper (tweede ingang naar een functie met de
   space-ACL erin — DECISIONS 2026-09-05), geen verzoek aan Supabase (vraag 24 beantwoord).
   Gemeten: zonder grens kostte de iteratieve scan koud 11,6 s (over de 8 s PostgREST-timeout);
   met ef 80 + 4000 tuples 372 ms koud / 28 ms warm. `plan_cache_mode=force_custom_plan` zodat
   de planner de filterwaarden ziet (`= ANY($4)` zonder waarde kiest de HNSW-post-filter, ook
   voor een kleine bron).
2. **LIMIT-regel:** `top_k*10` alleen met `query_text` (het diende de RRF-fusie), `top_k*2` bij
   caps, anders `top_k`. Bijvangst: rag-chat vroeg top_k 60 en kreeg altijd 40 (ef-grens); nu
   krijgt het 60. Bundels worden groter (rag-chat gebruikt er 24), zoektijd p50 878 → 1.007 ms.
3. **Caps als recept-kolommen, default NULL.** `max_per_record` (PARTITION BY source,
   source_id) en `max_per_source` op `match_chunks`, `p_max_per_record` op het entity-pad.
   RESEARCH zei default 2; NULL gekozen omdat een kolom-default `draft_reply`, `analyze_meeting`
   en `enrich_record` stil zou veranderen (poort K8). Alleen `search_fast` = 2 / 12. Gemeten
   vóór op 20 benchvragen: max 40 meeting-chunks in één bundel, max 11 chunks van één record.
   `max_per_source` is een nieuwe kolom naast `default_max_per_source` — die is al de cap van
   het entity-pad (3), en dezelfde knop hergebruiken zou `search_fast` tot 3 mailchunks per
   bundel brengen.
4. **`source_overrides` jsonb** (`{"src":{"exclude","future_ok","max_per_record","max_per_source"}}`);
   `exclude` geldt niet voor een bron die de aanroeper expliciet vraagt. Klaar voor 06b
   (e-mail-engagements, stub-masters) en 06e — geen recept zet het nu.
5. **Recency-klem = symmetrische afstand, niet "tellen als vandaag".** RESEARCH §3.1(d) stelde
   "toekomst telt als vandaag" voor; vandaag is recency 1,0 en dat is precies de klem die 65
   HubSpot-taken met een deadline in 2027 bovenaan zette. Nu telt een toekomstige datum met
   zijn afstand tot nu (gemeten 1,000 → 0,994 voor een taak van morgen; een taak in 2027
   krijgt ~0,05); `event` blijft `future_ok` (een afspraak volgende week ís relevant), per
   recept uit te zetten. Toekomstige chunks worden **niet** verwijderd: het zijn echte records
   en `fetch_unchunked_source_ids` zou ze binnen vijf minuten opnieuw laten chunken.
6. **`match_chunks_for_entity` blijft LANGUAGE sql** (afwijking van RESEARCH §3.5): het
   kandidatenpad loopt via de edges en een exacte sortering — geen HNSW, dus geen GUC om te
   zetten. Wel de cap, de overrides en de klem; oud vs nieuw gaf op de testentity 10/10
   dezelfde chunks.
7. **`rag_chunks_reconcile()` dagelijks (03:50 UTC), met vangnet.** Gemeten vóór: 1.480 chunks
   van verwijderde mails, 389 mails met twee chunks, 128 van gearchiveerde deals, 130 van
   geannuleerde/soft-deleted events, 1 kb, 1 action. De dubbelen bleken **race-dubbelen**
   (beide MetaRAG, 0,02–15 s uit elkaar, zelfde versie), niet oud-vs-MetaRAG; dedupe houdt de
   oudste, alleen bij `parts = 1`. Vangnet: > 50 én > 25 % van een bron → klasse overgeslagen,
   `warning` in `agent_runs` — een half-gesyncte waarheidstabel mag de index niet leegtrekken.
   De event-tak van `fetch_unchunked_source_ids` kent nu ook `is_deleted`, anders was het
   verwijderen van 124 chunks een herchunk-lus. Eerste run: zie IMPLEMENT-NOTES §3.
8. **Bankitems RO51–RO54 (= 06F-R01..R04)** en runner v3.2 met `expect_min_chunks`,
   `max_chunks_per_record`, `top1_not_future`, `expect_sources_live` en
   `options.filter_after_days` (een relatief venster veroudert anders stil). Het id-patroon van
   de bank laat `06F-…` niet toe; de nummers staan in `notes`/`tags`.
9. **Onder de iteratieve scan is de vector-LIMIT ≤ 120.** De eerste ná-run van de
   retrieval-lane liet zeven legacy-items op het `search`-recept (hybride, HyDE) naar 0 chunks
   vallen: alle HyDE-varianten in de 8 s PostgREST-timeout. A/B oud/nieuw op precies die
   items (zelfde embedding, echte vraagtekst): zonder filter gelijk (≈ 200 ms warm), mét
   `filter_sources=['mail']` 287 → **2.135 ms** — de iteratieve scan zocht 450 gefilterde rijen
   (`top_k*10` voor de RRF-pool) bovenop een BM25-arm van 4–8 s. Met `least(limit,
   greatest(top_k, 120))` weer 282/319 ms. Gevolg: de vector-arm levert op een gefilterd
   hybride pad 120 goede kandidaten in plaats van de ~13 die de post-filter vóór 06f-α
   overliet, tegen tientallen ms.
11. **`ef_search` 80 alleen waar het iets koopt: het vector-only pad en de iteratieve scan; het
    ongefilterde hybride pad houdt 40.** Drie retrieval-lane-runs op rij lieten dezelfde vijf
    legacy `search`-items (hybride, HyDE ×3, geen filter) op 0 chunks vallen door
    statement-timeouts, terwijl de sequentiële A/B oud/nieuw voor precies die items gelijk was
    (~200 ms warm). Het verschil zit in de gelijktijdigheid: de lane vuurt 18 HyDE-calls
    tegelijk, ef 80 verdubbelt de gelezen HNSW-pagina's (382 MB index, 256 MB
    `shared_buffers`) en de BM25-OR-arm (4–8 s bij lange vragen) zit tegen de 8 s-timeout.
    Op dat pad levert BM25 al 450 kandidaten; 40 extra vector-kandidaten wegen niet op tegen
    de timeouts. Gemeten ná de wissel: `runs/2026-09-06-after-retrieval-d.json`.
13. **Bekend rood, bewust gelaten: vijf legacy `search`-items in de retrieval-lane** (E14, E16,
    E17, E20, E36; categorieën `vrije-semantiek`, `feit-specifiek`, `openstaande-actie`). In vier
    ná-runs op rij kregen ze 0 chunks: elke HyDE-call in de 8 s PostgREST-timeout. Gemeten
    oorzaak: gelijktijdigheid — de vijf samen in één hop (15 hybride calls tegelijk) 0/5, twee
    keer (ook zonder `force_custom_plan`); E16 en E20 solo 1/1; sequentieel is oud = nieuw
    (~200 ms warm). Het `search`-recept (BM25-OR-arm 4–8 s over 10–20k rijen) zit onder load op
    de rand van de timeout en zat daar vóór deze sessie ook al (26/38 vector-fouten als agent-tool
    op 2026-09-06 07:xx). Het is sinds v1.146 geen chatroute; de chatroute `search_fast` won op
    elk gemeten punt. Opties voor wie dit oplost: 06f-β (AND-eerst/IDF-pruning voor de OR-arm,
    RESEARCH §3.3) of in de evalrunner `search`-items solo draaien zoals `kosten`-items (spoor 01).
    K4/K5 voor de retrieval-lane staan hiermee rood met reden; `regressie` en `robuustheid`
    zijn groen.
14. **Autovacuum-drempel op `chunks` (200 dode tuples, scale 0) in plaats van een VACUUM-cron.**
    Direct ná de eerste reconcile gaf dezelfde probe met `ef_search=80` nog 60 levende rijen:
    de 2.129 verwijderde chunks staan als tombstones in de HNSW-graaf en tellen mee in de ef
    kandidaten. De standaard-autovacuum grijpt pas in bij ~9.300 dode tuples. Een `VACUUM` via
    pg_cron faalt: de cron-sessie draagt de database-brede `statement_timeout` van 120 s en de
    HNSW-bulkdelete duurt langer (gemeten: job faalde exact na 2 min). Autovacuum heeft geen
    timeout en doet de index mee; met normale churn van enkele dode tuples per dag betekent
    200 "de reconcile heeft iets weggehaald".

**Poorten.** ACL 17/17 vóór én ná elke stap; proacl van beide RPC's byte-identiek hersteld na
DROP+CREATE; equivalentie oud/nieuw zonder filter 40/40. De bench-poort (`p95 ≤ 3.000`) stond
vóór deze wijziging al rood (4.587 ms, 2 lege bundels) en meet embed + zoeken + bundelschrijven +
edge-overhead; de zoekcomponent is p50 ~1,0 s. Getallen ná, per stap, in IMPLEMENT-NOTES §5.

**Open (niet in α):** de oorzaak van de race-dubbelen (run-lock of unieke index) → 06a;
`default_max_per_source` versus `max_per_source` is naamverwarring voor 07; de
datascience-skill (`references/retrieval.md`) beschrijft nog de SQL-body zonder GUC's en zonder
caps → eerste 07-item (niet herschreven in deze sessie: skill-bestanden zijn buiten de scope
van de kick).

## 2026-09-06 — Spoor 02 I1: een vraag is een run, een hop duwt hem vooruit

**Meting die het ontwerp richtte** (RESEARCH 02 §1, 2026-09-06 05:48 UTC, read-only):
de agentic route werd niet door de klok afgekapt maar door de tool-cap — **31 van 123 agentic
runs in 90 dagen (25,2 %) eindigden precies op `MAX_TOOL_CALLS = 10`**, 5 van 27 in de laatste
30 dagen; p50 tool-calls 6–7; **~65 % van de agentic wandtijd is modeltijd** (37,3 s van 57,0 s
p50), geen tooltijd. Geen enkele van 797 `rag-chat`-invocaties in 180 dagen haalde 150 s (max
141,95 s). Het plan is **`pro`** (`GET /v1/organizations/{slug}`), dus 400 s wall-clock — maar de
**gateway kapt elke niet-streamende call zonder byte na 150 s af (504)**; dat, niet de 400 s,
was de echte grens. De realtime-publicatie had **15** public tabellen en geen chattabel; de
gateway laat de publieke anon-JWT door op `verify_jwt:true` (probe: 400 `message_required` uit
de functie, een niet-JWT 401 van de gateway). Een gesloten tab verloor vraag én antwoord
(`useRagChat` bewaart niets tijdens streamen; het querylog heeft geen antwoordkolom).

**Besluit.** Een vraag is een rij in `agent_chat_runs` met toestandsmachine, budget per effort
en stappenlog; de zware lus-toestand in `agent_chat_run_state` (service-only, niet gepubliceerd,
zodat de run-rij < 250 KB blijft — realtime knipt boven 1 MB velden > 64 B stil weg). `rag-chat`
blijft de enige motor (verify_jwt:true): één hop = één invocatie, geen nieuwe agent-beurt na
60 s, hard 170 s, zelf-fetch naar de volgende hop met de service-key — het patroon van
`rag-eval-cron` v3.0 (131 hops, 0 verloren). De browser volgt de eigen rij via realtime (I2).

**Defaults uit de vorkentabel (RESEARCH §5), alle overgenomen:** V1 realtime-blokjes voor het
antwoord (`answer_partial` ≤ 400 ms), geen SSE-attach · V2 watchdog 5 min, tunebaar via
`run_budgets.watchdog.stall_minutes` · V3 geen pomp in I1 (zichtbare `failed` + `resume`) ·
V4 `needs_input` als toestand + RPC, **nog zonder producent** (de ask_user-tool is
toolcatalogus = 03b) · V5/V6 budgetten en prijzen in `agent_config`, constanten als fallback:
low 2/30 s/$0,05/2 hops · medium 6/90 s/$0,15/3 · high 12/240 s/$0,50/5 · xhigh 20/180 s/$1/6
· max 40/600 s/$2/10 (AANNAME tot de bank ze vervangt; `high` staat op 12 tool-calls tegen 10
vandaag — G5 bewaakt de kosten) · V7 compat `stream:true|false` blijft, inline ≤ 140 s
(`COMPAT_WALL_MS`, onder de 150 s-gateway) · V8 realtime zonder MFA-eis geaccepteerd zoals bij
`tasks` (observatie hoort bij security-monitor) · V9 bewaartermijn state 7 d, runs 90 d · V10
run-rij voor élke route · V12 budgetuitputting is geen `coverage.reason` maar
`envelope.budget.exhausted_by` · V13 `claude_api_calls.chat_run_id` kolom nu, bedrading 03a ·
V14 versie: I1 = v1.149 / rag-chat v6.0 (orchestrator-override; v1.148 was S3b stap 1).

**Gemeten ná de deploy (v58/v59, 15:52 UTC).** `run:true` op een structured vraag: `queued →
planning → researching → composing → done` in 12 s, hop 10,3 s. Een bewust diepe agentic vraag
op `xhigh`: **done in 80 s over 2 hops** (65,1 s tot `soft_budget`, compose-hop 12,7 s), 19
tool-calls, $0,163, 58 % van de prompt-tokens uit de cache. Smoke 24/24 op het compat-pad;
SSE-contract groen (5 status · 1 meta · 64 delta · 1 done, `answer_md` = gestreamde tekst);
**0 van 8 querylogrijen zonder `run_id`** (T1); `spent.usd = est_cost_usd` op 100 % (T4).

**Bijvangst: xAI stuurt in een stream géén usage zonder `stream_options.include_usage`.**
Probe: 13 chunks, usage NONE; met de vlag 14 chunks, usage aanwezig. Het oude stream-pad
(browser) logde dus nooit Grok-tokens — `est_cost_usd` van browservragen was structureel te
laag. Sinds v6.0 streamt élk antwoord, daarom staat de vlag nu in `grokChatBody`.

**Afwijkingen van RESEARCH, met reden.** (1) rag-chat importeert géén `_shared/edge-auth.ts`:
de constante-tijd vergelijking voor de `_hop`-auth staat lokaal in `index.ts`, zodat de
deploy-bundel exact de zes rag-chat-bestanden blijft (DRY=1 = 6) en `anthropic-fetch.ts` niet
meegaat. (2) Web-research (`web_search:true`) overleeft geen hop-grens (de promise leeft in de
hop); zeldzaam pad, `dbg.web_research_error` zegt het. (3) De `_pump`-modus is niet gebouwd (V3).
(4) De router-`429/5xx` faalt de run als `provider_error` in plaats van stil naar semantic te
vallen — de OpenAI-storing van vannacht kwam anders als `not_tracked` binnen.

**Venster prod-vóór-main.** S3b stap 2 deployde 12:43 UTC rag-chat v57 als deploy-om-te-meten en
pauzeerde (5h-limiet) vóór de afgesproken restore; de spoor-02-deploy van 15:52 UTC (main +
v6.0) is het afgesproken eindpunt en sloot dat venster; venster #5 (deze branch) sluit met de
merge. De stap-2-config-rij `answer_model` wordt door main/v6.0 niet gelezen. PR #55 rebaset
op de split: composer → `compose.ts`, directe Sol-beurt → `run.ts` `stageComposing`.

**After-meting (v60, 16:27–16:41 UTC; `02-after-i1-2026-09-06-*` tegen `02-baseline-2026-09-06-*`,
runner v3.1).** Rook 36/36: pass 0,667 (0,639), $0,44 (0,39), p50 13,0 s (11,5), p95 51,8 s (43,5);
**G4 groen** (WI05 mét MT-bron, WI06/WI07, `persona_check.ok`, `n_identity_unreliable` 0), **G3
groen** (0 pp in vijf categorieën), **G5 groen** (p50 $0,0085 = $0,0085), G7 5/11 (4/11),
groen→rood **geen**, rood→groen NE42. Regressie 21/22 = baseline; kosten 2/3 = baseline;
robuustheid 18/21 = baseline. **T1 0 van 152** querylogrijen zonder `run_id`; **T4** 152/152
`spent.usd` = `est_cost_usd` = Σ leveranciersdelen; **T6** max hop 66 511 ms, 0 `hop_lost`, 0 open.

*Rood, met de meting:* **G1** — `silent_empty` in de rook is **0** sinds v60 (een analytics-antwoord met
0 rijen draagt nu `truly_empty`, `no_data` → `not_tracked`; tot v5.8 zette de envelop de reden op
null zodra er analytics was — de NE34/A04/WI19/AR01-klasse waarvan de regel hierboven eiste dat de
volgende chatketen-PR hem groen maakt), maar `fails_no_empty` 1 = NE34: `expect_no_empty` op een
structured vraag waarvoor de RPC geen rijen heeft — een bank-/ketenvraag (spoor 03/06), niet stil.
Robuustheid: RO10 (`?` → 400 `message_required`, identiek aan de baseline) en RO04 (router-flip
naar `no_data`). **T8** — structured Δp50 **+1 035 ms**, semantic **+1 628 ms** (≈ 8 extra
PostgREST-rondgangen per vraag: run- en state-insert, claim-RPC, state-select, budget-lees,
compose-write, slot-writes; de v60-bundeling van stap-writes veranderde daar niets meetbaars
aan: 12 524 → 12 672 ms). Fix voor I2: één start-RPC en een module-cache voor budgets/pricing/
system_prompt; met de hook op `run:true` (200 in 0,3–2,5 s) verdwijnt de wachttijd uit de
gebruikerservaring. **G6** — agentic p50 27,7 → 32,3 s en $/item +4 % door de tool-cap 12 (was 10,
V5); `over_latency` 2 = RO39/WI01 zoals elke ronde. **Bench** `search_fast` p95 4 051 ms (rood op
3 s; eerder vandaag 5 500–6 648), retrieval niet geraakt.

*Twee bevindingen onderweg:* (1) `security_findings` weigerde élk chatguard-alarm (CHECK op
`scan_type`/`category`): de injected-stall-test liet de watchdog-cron vier keer terugrollen, en
ook `agent_chat_health_check()` (v1.146) kon daardoor nooit een rij schrijven — CHECKs verbreed
(superset) in de migratie; melden aan security-monitor. (2) Drie 5xx in de v59-rondes (503
`BOOT_ERROR "Function failed to start"`, 502 in 25 ms) vielen in hops met drie parallelle
vragen; dezelfde 503 stond eerder in `s3b2-sem42-terra` (12:46) en `rook-s3b-step2` (13:01) op
v57 en 0 keer in alle rondes t/m 12:41 — een edge-worker-bootprobleem onder bursts, niet v6.0;
herkansing 3/3 pass. Runner-wens: een 502/503 van de gateway één keer herhalen vóór hij rood telt.

---

## 2026-09-06 — Answer-stack stap 1: Sol onderzoekt, Grok schrijft nog, en de prijstabellen kloppen eindelijk

**Besluit (Jelle, ANSWER-STACK-RESEARCH §8):** doel-stack S3b = OpenAI-only (Terra
semantisch, Sol agentic zonder Grok-navertelling, Luna voor router/rewrite/rerank/judge),
in twee stappen. Dit is stap 1 (v1.148): `agentic_model` → `gpt-5.6-sol`, alle
hulpmodellen → `gpt-5.6-luna`, tarieven gefixt. Stap 2 (Terra + Sol streamt zelf) is een
eigen PR met een blokkerende A/B ≥ 40 items. Opus 5 als default vervalt.

**Wat de meting van vandaag aan het plan veranderde.** Een live probe vóór de config-flip
(2026-09-06, de `skill:openai:embedding_key`): `gpt-5.6-sol` en `gpt-5.6-terra` weigeren
function-tools op `/v1/chat/completions` met elke `reasoning_effort` behalve `none` (HTTP
400 — "use /v1/responses or set reasoning_effort to 'none'"); `gpt-5.5` accepteert tools
met zijn default. Een kale config-flip had dus élke agentic call laten falen en de route
stil op semantic laten terugvallen — precies de klasse stilte die G1 moet vangen, maar dan
op de tool-lus. `agentic.ts` stuurt daarom per model-familie `reasoning_effort: "none"`
(`MODEL_REQUEST_OPTS`) en meldt een model dat niet in `PRICE_PER_M` staat als
`dbg.agentic_model_fallback` in plaats van het stil te vervangen. Gevolg voor de
vergelijking: **"Sol op de lus" in stap 1 = Sol zonder redeneer-tokens.** Redenerend Sol
op de lus vraagt de Responses API (probe: `/v1/responses` + tools + `reasoning.effort
low` → 200, `function_call` terug). Dat is precies de rewrite van de laatste beurt die
stap 2 toch doet; daar hoort hij dus, niet hier.

**Prijzen zijn nu lijstprijzen met een datum, geen schatting.** Grok-4.3 stond op
3,00/15,00 en is 1,25/2,50 (xAI models-pagina; het 2×-tarief geldt pas boven de
lange-contextdrempel, onze prompts zijn ~5k). gpt-5.5 stond op 1,25/10 en is 5/30;
gpt-5.4-mini stond op 0,15/0,60 en is 0,75/4,50. Nieuw: sol 4/20 (promo t/m ten minste
21 nov 2026), terra 2/12, luna 0,20/1,20, alle met cache-tarief. `cached_tokens` wordt
gelogd (agent-lus `cost.tokens_cached`, judge `envelope_compact.judge_usage`) en tegen het
cache-tarief geprijsd. **G5 is hiermee herijkt**: een run van vóór v1.148 en een run erna
verschillen in `cost_usd` door de tabel, niet door de keten — `rag_eval_compare` op G5
over die grens is geen meting. De rookronde van deze PR (`rook-s3b-step1`) is de nieuwe
kostenbasis; de legacy-71 draait mee voor G2-continuïteit.

**De eerste rookronde (`rook-s3b-step1`, 36 items, 368 s, $0,45 onder de nieuwe tabel)
vond een echte regressie, en die zat niet waar het plan hem zocht.** G1 rood met vijf stille
leegtes (AR36 MA10 NE08 NE15 NE42) — alle vijf `route = agentic`, nul tool-calls, geen
coverage-reden. Twee mechanismen bovenop elkaar: (1) de Luna-router kiest anders dan
gpt-5.4-mini — deze vijf gingen eerder naar semantic, NE02/NE07 gingen nu juist van agentic
náár semantic; (2) op de agentic route sluit het model een vage vraag af met een wedervraag
zonder tool. Nagespeeld met de echte system-prompt: Sol-none én gpt-5.5 doen dat allebei op
vier van de vijf — het is dus geen Sol-eigenschap maar het gedrag van de route. Zo'n
wedervraag wordt een analytics-blok met 0 rijen dat Grok navertelt, en die navertelling
maakte van "waar slaat 40 op?" een stellig **"We hebben 40 actieve klanten … gebaseerd op de
churn-administratie, agenda en het mailarchief"** — een verzinsel met verzonnen bronnen.
Fix aan de naad: `tool_choice: "required"` in de eerste beurt van de lus (daarna `auto`).
De router heeft besloten dat hier data nodig is; dan kijkt de agent minstens één keer.
Nagespeeld: met `required` zoekt Sol bij NE08 eerst `count_by_stage`, bij MA10
`mail_evidence_search`, bij AR36/NE42 de kennisindex — precies wat gpt-5.5 op MA10 uit
zichzelf deed. Dit is een gedragswijziging van de lus, één regel, terugdraaibaar; de tweede
rookronde meet hem. Het argument voor stap 2 is er intussen scherper op geworden: de
navertelling is de plek waar een eerlijke wedervraag in een stellige onwaarheid verandert.

**Tweede rookronde (`rook-s3b-step1-b`, rag-chat v55, 418 s, $0,59): de agentic-0-tools-klasse
is 5 → 0.** Wat aan G1 rood blijft (AR01, WI19) is de structured-0-rijen-zonder-reden-klasse van
spoor 01 (A04/NE34), niet deze PR. Pass 23/36 in beide rooks; G7 3/11 → 4/11 → 5/11; p50-kosten
$0,0085 → $0,0088 (+3,5 %, zelfde tabel — de verplichte eerste call kost ~1 tool-call).
`cached_tokens` op de lus: 64–77 % (KL12 9.821/15.265, MA10 16.987/22.105, RO37 28.048/40.950) —
de 60 %-aanname uit ANSWER-STACK §2 was eerder laag dan hoog.

**De Luna-router is minder stabiel dan gpt-5.4-mini, en dat is de open vraag van deze stap.**
Route per item over 34 chat-items: gpt-5.4-mini tegen zichzelf (twee rooks) 4 verschillen, Luna
tegen zichzelf 7 (AR01 AR36 NE08 NE15 RO39 WI01 WI05), gpt-5.4-mini tegen Luna 10. Gevolg in rook 2:
WI05 (de positieve ACL-controle) ging agentic en G4 werd "ongeldig" — niet door de ACL (script
17/17 vóór én ná; herhaling van WI05 als semantic: pass, 24 bronnen) maar door het harnas: op de
agentic route wordt `envelope.sources` uit de semantische matches gevuld, en die retrieval
(`search_docs`, 14–16 s) haalt de 6 s-chatklok niet → `timeout`, `have=none`, terwijl
`confluence_search` wél 4 rijen gaf. Twee lessen: de positieve controle van G4 is alleen
meetbaar als de router semantic kiest (spoor-01-follow-up: agentic evidence → `sources`), en
router-overeenstemming hoort als metriek in de stap-1.5 A/B. Keuze voor Jelle: Luna accepteren,
`ROUTER_MODEL` terug naar gpt-5.4-mini (één constante), of eerst meten.

**Legacy-71 (`s3b1-legacy71-2026-09-06`, 410 s, $0,28): G2 groen — kern 22, 0 groen→rood, 0
rood→groen.** Buiten de kern twee groen→rood, beide retrieval-lane: E02 (`regex`) en R03
(`include_source(meeting)`); één rood→groen: G02 (sweep, luna-verdicts, judge-correctness 0,15 →
0,67). Herhaling (custom E02+R03+WI05): E02 pass → run-op-run-ruis in de rerank-volgorde; **R03
fail opnieuw** → systematisch onder luna-rewrite/rerank voor dit ene item (de meeting-chunk valt
uit de top-15). R03 is een bekende flipper (rood sinds 08-31, groen in 01-after). Dit is de
gedateerde uitzondering op "legacy-71 geen daling" (spoor 01 S9): één niet-kernitem, oorzaak
bekend, niet gefixt in deze PR. Bench `search_fast` p95 6.648 ms (vóór 5.500/6.134) — rood zoals
vóór dit spoor; het recept gebruikt geen rewrite/rerank, dus Luna raakt het niet.

**Wat bewust niet in deze stap zit:** `GROK_MODEL`, de semantische route, de
navertelling; de agentic-36 A/B Sol vs gpt-5.5 (≈ $12 voor twee armen — stap 1.5, na
Jelle's go); een Terra-arm; context-build rapporteert zijn rewrite/rerank-tokens nog
niet aan rag-chat (G5 blijft daar een schatting). Grok's `cached_tokens` wordt niet
gelezen (xAI zegt niet of caching automatisch is).

## 2026-09-06 — After-meting en slotrook van spoor 01: geen daling, en welk rood blijft staan

**After-meting** (`01-after-2026-09-06`, de 71 legacy-items als `jelle`, runner v3.0, 514 s,
$0,54; gedraaid zodra de OpenAI-credits om ~10:40 UTC terug waren en chat-smoke weer 24/24
gaf): **`green_to_red = []` over alle 71.** Rood→groen: A10, R03, R08, T01. Kern 14/22 →
15/22 (A10), gemiddelde correctness 0,317 → 0,322; G2 en G3 groen. De trendbreuk
service-key → gebruiker (V5) kost geen kernitem zijn kleur — A10 (agentic, mailbox +
agenda, 5 tool-calls) wint er juist door. G1 is rood op A04: een structured antwoord met
0 rijen waarvan de claim de leegte uitlegt maar de envelop geen `coverage.reason` draagt.
Dezelfde klasse als NE34 (hieronder).

**Slotrook** (`rook-track01-final`, 36 p0, 514 s, $0,89): **G4 groen** (WI05 mét MT-bron als
`jelle`, WI06/WI07 zonder MT-bron als collega/cron, `persona_check.ok`). **G1 rood
uitsluitend op NE34** — `fails_no_empty 1` en `silent_empty 1` zijn hetzelfde item; NE42
was deze keer niet leeg. Niet-blokkerend rood, met de meting: G3 `regressie` −33 pp door
RO25 (semantisch, `answer_regex`; pass in rook-first en rook-tagged, fail in full-first en
nu — run-op-run-ruis op formulering, geen kernitem); G5 p50 $0,0206 tegen $0,0201 (+2,5 %);
G6 p95 80 s tegen 36 s door twee agentic items van 80–87 s (KL12, NE02) plus `over_latency`
op RO39 en WI01 zoals in elke ronde; G7 3/11, gelijk.

**Besluit.** Spoor 01 gaat ready-for-review zonder groene L2-rook, zoals het paper §5.1
toestaat ("het enige spoor dat zónder punt 4 mag mergen"): het blokkerende rood is één
bekende ketenklasse, en de eigen poort S9 staat op 0. Volgende PR's op de chatketen krijgen
die uitzondering niet — voor hen moet NE34 eerst groen: een structured antwoord met 0 rijen
hoort `coverage.reason = truly_empty` (of `below_threshold`) te dragen (spoor 03/06).

**Bench.** `search_fast` p95 6134 → 5500 ms: rood op de 3 s-poort vóór én ná dit spoor,
0/20 boven de 6 s-chatklok. Retrieval is hier niet geraakt; het rood is voorbestaand en
blijft staan tot het recept zelf wordt aangepakt.

**Bijvangst.** `confluence_acl_eval.cjs` liet sinds de bankmigratie (default
`status = 'queued'`) zijn run-rij als `queued` zonder `suite` achter (twee rijen op
2026-09-06). Het script schrijft nu `suite 'acl'`, `status 'done'` en de tijdstempels mee;
de twee rijen zijn met de hand op `done` gezet en de eerste ronde ná de fix landt als `done`.

---

## 2026-09-06 — Eerste bankrondes: wat de nulmeting zegt, en wat een storing zegt

**Rookrondes** (`01-rook-first`, `01-rook-tagged`; 36 p0-items, 310 s / 298 s, $0,76 /
$0,77): G4 groen zodra WI06 zijn onhaalbare regex kwijt was (WI05 mét MT-bron als
`jelle`, WI06/WI07 zonder MT-bron als collega/cron, `persona_check.ok`). G1 werd in de
tweede rook rood op twee **echte** stille leegtes: NE34 (structured, tool gaf 0 rijen,
`coverage.reason = null`) en NE42 (agentic, 0 tool-calls, 0 rijen). De envelop zet de
reden op `null` zodra er analytics is — ook als die analytics leeg is. Dat is een
bevinding voor de keten (spoor 03/06), geen evalfout: precies waarvoor de bank bestaat.
G7 (eerlijkheid, 11 p0-items) staat op 3–4/11: de `negatief`-items krijgen door de smalle
cosinusband altijd fragmenten (`truly_empty` komt niet), en de eerlijkheids-regexen
(`definitie|venster|…`) matchen het huidige antwoordregister niet. Nulmeting, geen poort.

**Volledige ronde** (`01-full-first`, 435 items, 131 hops, 56 min, $6,24, 0 verloren
hops, `n_identity_unreliable = 0`): mechanisch geslaagd. Inhoudelijk maar half geldig:
om **02:25:35 UTC** raakte het OpenAI-account zonder credits (`openai_embed_429`); vanaf
dat moment gaf `context-build` 500, koos de router niets meer en kwam vrijwel elk antwoord
leeg terug (`not_tracked`). 151 items liepen vóór de storing (87 pass, 57,6 %), 284 erna
(49 pass, 17 %) — de laatste 62 retrieval-items alle rood op `context-build_failed`.
De `01-after`-meting (WP7) is daarom **afgebroken vóór hij iets mat** en wacht op credits
(`ASK-JELLE.md`, blokkerend). Les voor de runner: een provider-storing hoort een run te
kunnen **pauzeren** in plaats van rood te verven — `context-build_failed status=500` op
≥ 3 opeenvolgende items is een storing, geen meting. Dat is een v3.1-wens, hier alleen
genoteerd.

**Poorttest van de CLI.** `--gate` gaf exit 1 op `01-rook-tagged` (G1 rood, echte
leegtes) en exit 0 op `01-baseline` (G1 groen, G4 n/a); `--compare` print de zeven
poorten met getallen. De poorten werken; de keten is wat nu rood is.

---

## 2026-09-06 — Persona-JWT's worden per hop gemint, niet opgeslagen (V1)

**Meting.** `auth`-config `jwt_exp = 3600`. Een run duurt 5 minuten (rook) tot een
uur (full); een JWT in Vault is dus na een uur waardeloos en tot die tijd een
lekrisico zonder nut. `admin/generate_link` + `/auth/v1/verify` met `token_hash`
mint er in 0,4–1,4 s één, zonder mail en zonder rate-limit (6 op rij in 5,7 s;
in `01-rook-first` 15 hops zonder één 429).

**Besluit.** `rag-eval-cron/persona.ts` mint per hop voor de persona van die hop,
gebruikt het token als Bearer naar `rag-chat` en logt aan het einde uit
(`/auth/v1/logout?scope=global`). Het token staat nergens: niet in Vault, niet in
een tabel, niet in een resultaatrij, niet in een log. Mislukt het minten, dan zijn
de items van die hop rood met `jwt_mint_failed` — nooit stil als cron doorgaan.
Persona → gebruiker staat in `rag_eval_personas` (e-mail, user_id, verwachte
spaces, mailbox-verwachting): geen geheimen, RLS admin-only.

---

## 2026-09-06 — Evalverkeer draagt `eval_run_id` en telt niet mee in de gezondheid (V2)

**Meting.** 86 van de 88 `rag_chat_query_log`-rijen van de laatste 30 dagen waren
testverkeer (`stream=false`); een rookronde schrijft 36 rijen, een volledige ronde
352, en de `negatief`-items produceren opzettelijk lege antwoorden. Zonder label
meet `v_agent_chat_health` de evalronde en vuurt het leeg-alarm (> 25 %) op de bank.

**Besluit.** `rag-chat` leest `body.eval_run_id` (alleen een uuid) en zet hem in
`meta.eval_run_id`; `v_agent_chat_health`, `v_agent_chat_by_route`,
`v_agent_chat_coverage` en `agent_chat_health_check()` krijgen
`AND NOT (meta ? 'eval_run_id')`. Twee regels in `rag-chat`, verder byte-gelijk.
De terugval `stream = false` is niet gekozen: een echte gebruiker met `stream:false`
zou dan óók uit de meting verdwijnen.

---

## 2026-09-06 — Jay Alberts blijft identiteitsloos als `collega_beperkt` (V3)

**Meting.** `confluence_acl_debug(<jay>)`: `has_identity = false`, 0 spaces, 0
chunks (cron ziet 7 spaces / 966 chunks); geen `mail_accounts`-rij. De ACL-sync
vindt zijn Atlassian-account niet op e-mail (`no_atlassian_identity`).

**Besluit.** Voor de negatieve controle (WI06, WI40, MA10) is dat afdoende en
fail-closed: hij mag MT niet zien en ziet het ook niet. Een realistische collega
(wel LM, niet MT) vergt een `confluence_identities`-rij met `source = 'manual'` en
zijn accountId — dat verandert wat hij in Maestro ziet en is Jelle's keuze
(`ASK-JELLE.md`). `rag_eval_persona_check` bewaakt dat MT niet in zijn spaces
verschijnt; gebeurt dat wel, dan is de run `invalid_persona`, niet stil groen.

---

## 2026-09-06 — De router blijft gpt-5.4-mini, de hulpmodellen gaan naar luna (S3b stap 1, merge #54)

Luna als router gaf 7/34 route-verschillen tussen twee identieke rookrondes tegenover
4/34 voor mini; sweep, HyDE-rewrite, rerank en evaljudge blijven luna. Sol op de
agent-lus zonder redeneer-tokens en de verplichte tool op de eerste agentic beurt
zijn geaccepteerd voor stap 1. Jelle sloeg de merge-widget over; de orchestrator
nam dit besluit en merged #54, wat prod-vóór-main-venster #3 sluit.

---

## 2026-09-06 — De 71 legacy-items draaien als `jelle` (V5)

De runner v2.4 stuurde de service-key en mat dus de org-baseline, ook voor de tien
analytical kernitems (A08–A17) waar mailbox en MT ertoe doen. Vanaf v3.0 krijgen
alle legacy-items `persona = 'jelle'` en draaien ze als gebruiker. Dat is een
**breuk in de kern-22-reeks** en die is gelabeld: `01-baseline-2026-09-06`
(v2.4, service-key, 14/22 kern groen) tegenover `01-after-2026-09-06` (v3.0, JWT).
G2 wordt in de after-run gemeten als groen→rood-lijst; een kernitem dat alleen door
`caller_identified` van kleur verandert krijgt hier een regel, geen stille pass.

---

## 2026-09-06 — `wiki-acl` meet bronnen per space, niet `coverage.reason` (bankpatch v1.1)

**Meting.** De oorspronkelijke vraag *"Wat staat er in MT over de strategie?"*
matcht `DOCS_QUESTION_RE` niet → recept `search_fast` zonder bronfilter over 48k
chunks. Voor Jay/cron is de bundel dan zelden leeg; is hij wél leeg, dan volgt de
retry op 0,15 zonder filter, en zodra `matches < 3` neemt de agent het over → er is
analytics → `envelope.coverage.reason = null`. `expect_coverage_reason:
acl_filtered` is via `rag-chat` structureel onbereikbaar. Bovendien matcht de
regex `/MT/i` op "komt" en "ruimte".

**Besluit.** WI05–07 vragen nu naar *"de documentatie van {{SPACE_RESTRICTED}} over
{{ONDERWERP_RESTRICTED}}"* (docs-recept, bronfilter confluence+kb, echt MT-onderwerp).
Twee nieuwe keys: `expect_sources_include_space` (WI05: ≥ 1 bron uit MT) en
`expect_sources_exclude_space` (WI06/WI07/WI40: 0 bronnen uit MT); de runner joint
`envelope.sources[type=confluence].id` op `confluence_pages.space_key`. De loader
escapet regex-placeholders en zet woordgrenzen (`(?<!\w)…(?!\w)`, want `\b` faalt
achter "B.V."). Gemeten in `01-rook-first`: WI05 pass met MT-bron als `jelle`, WI07
pass met 0 MT-bronnen als cron, WI40 pass.

**Afwijking van RESEARCH §3.8, gemeten.** WI06 hield `answer_must_not_match_regex:
{{SPACE_RESTRICTED}}`. In `01-rook-first` was dat de enige rode assert van WI06: het
antwoord herhaalt de vraag (*"Er staat niets over … in de MT-documentatie"*), 0
bronnen uit MT, geen lek. Een regex op een woord dat in de vraag zelf staat meet
niets; de regex is bij WI06 verwijderd, de mechanische controle (bronnen per space)
blijft. WI40 (vraag noemt de space niet) houdt zijn regex.

---

## 2026-09-06 — Pending is een status, geen groen (en twee runner-afleidingen)

Een assert-key die de runner niet kent of nog niet kan meten is `pending`: niet
pass, niet fail, zichtbaar als kolom (`pending_asserts`, `n_pending`); een item met
alleen pending-keys heeft `signal_hit = null`. Vandaag mogen alleen
`expect_effort_at_least` (wacht op spoor 03a) en `expect_artifact_type: pdf`
(browser-print) pending zijn; de loader weigert onbekende keys al bij het laden.

Twee afleidingen die de runner expliciet doet, omdat de envelop het niet zegt:
1. **`no_data` = `not_tracked`.** De structured `no_data`-tool ís de uitspraak "dit
   veld wordt niet bijgehouden", maar omdat er analytics is zet de envelop
   `coverage.reason` op `null`. De runner leidt `coverage_reason = not_tracked` af
   als `analytics.tool === 'no_data'`. Gevolg voor `rag-chat` zelf (niet in dit
   spoor): een `no_data`-antwoord telt in `v_agent_chat_health` als
   `leeg_zonder_reden`. Hoort bij spoor 03b (metric-register) of 06.
2. **`expect_order` faalt expliciet** met `unparseable_column(date|amount|stage|text)`
   als geen kolom te parsen is — geen stille pass, want "sorteren op €1.200 als tekst"
   is precies de bug die het item zoekt.

---

## 2026-09-06 — Cadans: rook per PR, `full` op zondag, nachtelijk uit (V4)

Gemeten in `01-rook-first`: 36 items, 15 hops, 310 s, $0,76 (paper rekende ~$2).
Rook (`rook-p0`) bij elke PR op de chatketen (pre-flight punt 8, poort < 15 min en
≤ $3). `full` (435) wekelijks op zondag 04:30 CEST via `rag-eval-weekly`
(verplaatst van maandag 05:00). Nachtelijk (`chat-lane`, 352) staat uit en gaat
alleen aan via `agent_config('rag-eval-cron','nightly_enabled')` in weken met een
actieve implementatie op de chatketen. De pomp `rag-eval-pump` draait elke minuut
06–23 CEST en kost niets als er geen gestrande run is.

**Laag 3 (kwaliteitsjudge, 40 items, vijf assen) is uitgesteld naar 03a L4** — niet
gebouwd in dit spoor; het is geen merge-poort voor 01.

---

## 2026-09-05 — De chatvraag gaat naar `search_fast`, niet naar `search`

**Meting.** 20 echte vragen uit `rag_chat_query_log`, met exact de parameters
die `rag-chat` stuurt (`scripts/agent_retrieval_bench.cjs`):

| variant | p50 | p95 | boven de 6 s-grens | lege bundels |
|---|---:|---:|---:|---:|
| `search`, zoals het was | 13.282 ms | 23.318 ms | 18/20 (90 %) | 2 |
| zonder HyDE en zonder rerank | 10.756 ms | 21.881 ms | 14/20 | 1 |
| idem + `top_k` 24 | 9.970 ms | 19.877 ms | 12/20 | 1 |
| **`search_fast`** | **2.370 ms** | **3.071 ms** | **0/20** | **0** |

**Besluit.** Nieuw recept `search_fast` voor de gewone chatvraag. Het zware
`search` blijft bestaan en blijft bereikbaar als agent-tool (`semantic_search`,
eigen budget van 30 s) — zwaar zoeken mag, het mag alleen niet de standaardroute
van een interactieve vraag zijn.

**Waarom niet wat het onderzoek dacht.** Het rapport wees HyDE (3× match_chunks)
en de dubbele reranker aan. Die zijn samen goed voor ~3 van de ~13 seconden. De
werkelijke oorzaak is de BM25-arm van `match_chunks`: `plainto_tsquery` wordt met
een `regexp_replace` van `' & '` naar `' | '` omgezet, dus élke term matcht.
Gemeten cardinaliteit op vier echte vragen: 7.966 / 10.401 / 4.316 / **17.617**
chunks van de 48.475 (36 %). Voor al die rijen moet `ts_rank_cd` berekend en de
hele set gesorteerd worden; daar bestaat geen index voor. EXPLAIN op de losse
BM25-arm: 2.988 ms koud. Onder HyDE draaien er drie van, op een instance met
`max_parallel_workers_per_gather = 1`.

De `LIMIT (top_k * 10)` verandert daar niets aan — de rangschikking gaat over de
hele match-set, niet over de LIMIT. Dát verklaart waarom `top_k` van 80 naar 24
brengen maar 1,3 s scheelde.

Vector-only (`query_text` NULL, BM25 slaat zichzelf over) meet **7 ms**.

**Wat we opgeven.** Lexicale treffers op zeldzame termen op de snelle route.
Opgevangen door: de eigen entity-resolutie + RPC-tijdlijn in `rag-chat`, de
tweede poging met lagere drempel (WP2), en de agent die alsnog `semantic_search`
mag kiezen.

**Afwijking van het rapport (§5.6a).** `default_filter_sources` blijft NULL voor
`search_fast`. Dat advies is gemeten op het documentatiepad, waar het filter de
zoekruimte van 48k naar ~1000 chunks brengt. Een gewone chatvraag kan élke bron
raken; een lijst met alle bronnen erin is geen versmalling maar een extra
predicaat, en een korte lijst zou juist bronnen uitsluiten.

---

## 2026-09-05 — `hnsw.ef_search` staat vast op 40, dus we bewaren er 24

**Meting.** `EXPLAIN ANALYZE` op de vector-arm: `Limit (… rows=800 …) (actual …
rows=40 loops=1)`. Een HNSW-indexscan levert nooit meer dan `hnsw.ef_search`
rijen (pgvector-default 40), hoe hoog de LIMIT ook staat. `top_k: 60` vragen
leverde dus altijd al 40 vector-kandidaten plus BM25-vulling.

Zolang BM25 het gat vulde viel dat niet op. Met BM25 uit leverde `context-build`
exact 40, wilde `rag-chat` er 40 houden, en `rerankChunks()` slaat zichzelf over
zodra `chunks.length <= topN`. **De Cohere-reranker vuurde niet meer** — de enige
component die inhoudelijk discrimineert.

**De knop kan niet omhoog.** `ALTER FUNCTION … SET hnsw.ef_search`,
`ALTER ROLE … SET` en `ALTER DATABASE … SET` geven op deze managed instance alle
drie `permission denied to set parameter`. Alleen een sessie-`SET LOCAL` mag.
Gemeten wat het zou opleveren: ef 120 → 60 rijen in 388 ms (tegen 40 rijen in
163 ms); ef 400 → 1.205 ms zonder extra rijen. 120 zou dus het juiste niveau zijn.

**Besluit.** De andere kant van dezelfde ruil: pool op 40 laten, `CHAT_CONTEXT_CHUNKS`
naar 24. 24 door Cohere gerangschikte fragmenten zijn een betere antwoordcontext
dan 40 op RRF+recency gesorteerde, en het scheelt invoertokens. Eén constante
terugdraaien = het oude gedrag.

**Openstaand.** Een plpgsql-wrapper die `set_config('hnsw.ef_search','120',true)`
doet vóór `match_chunks` zou de knop alsnog geven. Niet gedaan: dat is een tweede
ingang naar een functie waar de space-ACL in zit, en die verdient een eigen ronde.

---

## 2026-09-05 — De ILIKE-entityresolutie is eruit

`tryResolveEntity()` viel terug op een ILIKE-substringmatch die een bedrijf
accepteerde zodra de gematchte term meer dan 20 % van de bedrijfsnaam besloeg.
Gemeten gevolg: de vraag *"…het **search**-recept…"* resolveerde naar een
bedrijf met "Search" in de naam, met confidence 0,72.

Een verkeerd herkende entity is niet één verkeerd label. Hij zet drie dingen in
gang: vijf tijdlijn-RPC's op de verkeerde onderneming, het overslaan van
`context-build` zodra die tijdlijn ≥ 8 chunks geeft, en (tot v1.146) het
uitschakelen van de zelfheling. De vraag werd dan nooit meer semantisch
doorzocht, terwijl de interface "Entity herkend" meldde.

Alleen `rag_resolve_entity` blijft — die heeft een harde distinctive-token-gate
in de RPC en weigert generieke woorden. Dat is precies wat de ILIKE-variant miste.

---

## 2026-09-05 — De zelfheling hangt aan bruikbare context, niet aan een naam

De conditie was `!entityHint`: is er een naam gematcht, dan geen agent. De
A17-guard (17-07) wilde voorkomen dat een tienstaps-onderzoek draait terwijl er
al een bruikbare tijdlijn ligt — en dát is meetbaar als `matches.length`. De
guard blijft, maar kijkt nu naar `matches.length < 3`.

Direct bewijs dat het werkt: in de rookronde na de deploy liep `context-build`
koud in een time-out, kwam `coverage_reason: "timeout"` in het log, en nam de
agent het over. Met de oude conditie was dat een leeg antwoord geweest.

---

## 2026-09-05 — Een leeg antwoord noemt zijn oorzaak

Vijf redenen uit een gesloten verzameling: `timeout | acl_filtered |
below_threshold | truly_empty | not_tracked`. Ze lopen van `context-build` via
`rag-chat` naar het antwoord dat de gebruiker leest én naar
`rag_chat_query_log.meta.coverage_reason`.

**Waarom dit het duurste getal was dat ontbrak.** Van de 12 chat-runs die sinds
v1.145 `context-build` echt aanriepen, waren er 4 leeg — en alle 4 door een
time-out. Nul door een lege index. In de interface zag dat er identiek uit.

De duurdere twee redenen (`below_threshold` vs `truly_empty`) worden alleen
onderscheiden als de bundel werkelijk leeg is, met één goedkope probe zonder
drempel. Een normale vraag betaalt daar niets voor.

**Bekende beperking.** `min_similarity: 0.30` discrimineert nauwelijks: gemeten
haalt een vraag over een totaal onverwant onderwerp een top1-vectorscore van
0,413 tegen 0,447 voor een vraag die er wél over gaat. De cosinusafstanden op
dit corpus liggen in een smalle band, dus een absolute drempel is geen filter.
Gevolg: `coverage.reason` vuurt in de praktijk vooral op `timeout` en op de
structured route, niet op semantische leegte. Het onderscheid maken hoort bij de
reranker, niet bij de drempel. Zie de risico's in `AGENT-REBUILD.md`.

---

## 2026-09-05 — Artefacten worden pas gebouwd als iemand klikt

`rag-chat` zet in de envelop alleen `artifacts_available`. Pas een klik laat
`agent-artifact-build` het bestand maken. Een xlsx die niemand opent kost
rekentijd en opslag, en de meeste antwoorden worden gelezen in plaats van
gedownload.

Eigenaar-only: private bucket, pad begint met de user-id, RLS op zowel de tabel
als `storage.objects`, signed URL van 24 uur. Bewust anders dan `km-excels`,
waar élke ingelogde gebruiker élk bestand mag zien: voor kilometerstanden mag
dat, voor een uitdraai van de klantenportefeuille niet.

Elk artefact draagt een tabblad "Verantwoording" met vraag, definitie,
peildatum, doorzochte bronnen en run-id. Een geëxporteerd getal dat niet naar
zijn herkomst te herleiden is, is slechter dan geen export.

PDF gaat via de browser (`window.print()` + print-stylesheet), niet via een
servergenerator. Geen pdf-bibliotheek in Deno bouwen.

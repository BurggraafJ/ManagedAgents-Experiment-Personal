# Besluitenlogboek — Maestro-chat

Gedateerd, met de meting erbij. Eén regel per besluit dat later iemand doet
denken "waarom staat dit zo?". Nieuwste bovenaan.

Regel: **een werkpakket is niet af tot hier een regel bij staat.** Zonder dat
wordt dit een archief van goede voornemens.

---

## 2026-09-06 — De server-pdf komt van `pdf-lib`, niet van Anthropic code-execution

**En dit vervangt de regel van 2026-09-05 hieronder ("Geen pdf-bibliotheek in
Deno bouwen").** Die regel ging over *bouwen*. Een bestaande, browser-compatibele
bibliotheek *importeren* — zoals ExcelJS daar al staat — is de andere kant van
datzelfde besluit. Wie alleen de oude regel leest, leest een verbod dat er niet
staat; vandaar deze regel eronder.

**Meting.** `pdf-lib@1.17.1` via `esm.sh` onder Deno 2.9.6 (onderzoek M4b):
90 regels in **30 ms / 3,2 kB**, magic `%PDF-`. Op de harde cap van 5.000 rijen
**1.411 ms / 895 kB** (137 pagina's, lokaal hermeten in de implementatie: 721 ms
/ 511 kB). Kosten aan een leverancier: **$0,00**. Ná de deploy op de echte edge
runtime: een pdf van 3.000 bytes in **32 ms**, gedownload en uitgepakt —
`%PDF-`, verantwoordingspagina aanwezig, kolommenblok aanwezig.

**Waarom niet Anthropic.** Drie gemeten gronden, geen smaak:

1. **Er is op dit project geen Anthropic-sleutel.** De Vault heeft 16 secrets en
   geen daarvan is Anthropic; de edge-secrets zijn de 7 Supabase-eigen
   variabelen; `claude_api_calls` bevat in zijn hele bestaan **0 rijen uit een
   edge function**; en `context-build:265` zegt het zelf ("dormant fallback,
   geen anthropic-key").
2. **De wrapper kan het niet.** `_shared/anthropic-fetch.ts` bouwt een body van
   precies `{model, max_tokens, messages, system?}` — geen `tools`, geen `betas`,
   geen `container`. Die uitbreiden is spoor 03a's bestand op de chatketen, en
   spoor 05 mag parallel draaien *omdat* het daar niet aan zit.
3. **De kosten staan omgekeerd.** Containertijd is verwaarloosbaar ($0,0042 per
   document of gratis), maar de tokens niet: ≈ **$0,10–0,20 per document**
   (aanname) tegen een **gemeten** $0,0115 (semantic) tot $0,0676 (agentic) voor
   het hele antwoord. De bijlage zou duurder zijn dan het antwoord dat hij
   verpakt.

**Wat we ervoor opgeven:** docx, pptx en grafieken. Die stonden nooit in scope,
en de bank vraagt er ook niet om: AR22 (grafiek) en AR23 (Word) zijn gap-items
waarvan de assert een eerlijk *nee* verlangt.

**Verplicht, geen goede bedoeling: `sanitizeWinAnsi()`.** Standaardfonts kunnen
alleen CP1252. Gemeten faalmodus: `WinAnsi cannot encode "日" (0x65e5)` — één
teken buiten Latin-1 gooide, en dan valt de héle export om in plaats van die ene
cel. De bouwer vraagt de encoder zelf per codepoint om zijn oordeel
(gememoïseerd), vervangt door `?` en **telt** de vervangingen in de
verantwoording. Assert A9 in de rooktest bewijst het: een rij met een CJK-teken
bouwt door en de verantwoording meldt de telling.

## 2026-09-06 — Bewaartermijn is configureerbaar, en de opruimer is een eigen functie

**Meting.** 0 van de 42 cronjobs noemde `agent_artifact*`; `expires_at` stond op
30 dagen en er was niets dat er iets mee deed. Nul databasefuncties raken
`storage.objects` — een rij daar verwijderen laat het bestand staan.

**Besluit 1.** De termijn verhuist naar
`agent_config('agent-artifacts','retention_days')`, default 30. Wijzigen kost dan
geen deploy. `expires_at` in de rij blijft de enige waarheid; de builder leest de
config alleen bij het maken.

**Besluit 2.** Opruimen wordt een **eigen** edge function
(`agent-artifact-cleanup`, `verify_jwt:false`, cron `45 3 * * *`) en géén
uitbreiding van `cleanup-nightly`. Die functie is live maar **heeft geen source
in git** — de map bevat alleen een README waarin staat dat de Management API een
lege eszip teruggaf. Uitbreiden zou betekenen: de payload reconstrueren, en dat
is precies de hard-rule uit CLAUDE.md (incident 2026-07-16). Een SQL-cron kan het
óók niet, want die komt niet bij de bestanden.

**Afwijking van het onderzoek, met de reden.** Het ontwerp schreef
`security_findings(scan_type='artifact-retention', category='housekeeping')`.
Beide zijn CHECK-beperkt (`scan_type ∈ daily_monitor|weekly_scan|manual`,
`category ∈ rls|secrets|auth|code|config|network`), dus die INSERT zou geweigerd
worden — het alarm zou juist stil zijn. Nu `manual`/`config`, met de
specificiteit in de titel en in `affected_object`. Zelfde soort correctie:
`agent_runs` heet `completed_at`, niet `finished_at`, en kent `warning`/`error`,
niet `partial`/`failed`.

**Wezen in twee richtingen.** De builder geeft bewust 200 terug als het bestand
er staat maar de rij-insert faalt, dus een bestand zonder rij is mogelijk. De
sweep ruimt die op ná 24 uur respijt, en ruimt óók de spiegelbeeldige wees op
(een rij die naar niets meer wijst) — anders is "0 wezen" wel te eisen maar niet
te halen.

## 2026-09-06 — AR01, AR36 en CA22 blijven rood, en dat hoort zo

**Meting.** Alle drie falen met exact dezelfde reden:
`artifact(available=false build_ok=false head=- no_rows)`. Datzelfde geldt voor
AR04, AR09, AR38 en (via `min_rows`) AR11. **Zeven van de veertien rode
artefact-items zijn geen artefact-defect** — de chat gaf nul rijen terug, dus er
viel niets te exporteren.

**Besluit.** Spoor 05 maakt ze niet groen. Dat zou óf de chatketen moeten
aanpassen (verboden terrein voor dit spoor) óf de assert moeten verzachten, en
dat laatste is onbetrouwbaar-groen. Het is een retrieval-probleem en het hoort
bij **sub-spoor 06b**, waar de rijen vandaan moeten komen. `ORCHESTRATION-PAPER`
§4.6 noemt ze als succescriterium voor 05; die regel klopt niet met de meting.

**Let op bij het lezen van de uitslag:** worden ze groen zónder dat 06b geland
is, dan is dat een reden om de run te wantrouwen, niet om te vieren.

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

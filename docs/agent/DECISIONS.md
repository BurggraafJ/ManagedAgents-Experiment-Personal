# Besluitenlogboek — Maestro-chat

Gedateerd, met de meting erbij. Eén regel per besluit dat later iemand doet
denken "waarom staat dit zo?". Nieuwste bovenaan.

Regel: **een werkpakket is niet af tot hier een regel bij staat.** Zonder dat
wordt dit een archief van goede voornemens.

---

## 2026-09-08 — Spoor 07: de documentatie krijgt een poort, en die poort stond zelf rood

**Spoor 07 (Maestro Agent Architecture) items 1–3, model `claude-opus-5` (MODEL-MIX 07 = O).**
Gebouwd 2026-09-07, gemerged 2026-09-08 na een rebase op `v1.157`. Onderzoek:
`07-continuous-improvement/RESEARCH.md`; poorten:
`07-continuous-improvement/{EVAL-GATES,IMPLEMENT-NOTES}.md`. Geen `APP_VERSION`-bump:
scripts en documentatie, geen zichtbare appwijziging.

**`scripts/agent_docs_audit.cjs` (item 1).** Tot nu draaide er **geen enkele controle op
`main`**: de acht pre-flightpunten waren handwerk op een branch, door de sessie die pusht, en
`changelog.yml` — het enige workflow-bestand — eindigt bewust altijd groen. Daardoor stond
`agent_eval_load.cjs --check` op 2026-09-07 rood op `main` zonder dat iemand het wist. Zelfde
klasse als de chunker-P0: stilte geeft geen error.

**De rebase leverde het bewijs achteraf.** Deze PR lag één dag stil terwijl er vijf andere PR's
in `main` landden. Op `43fc2d9` (tip `v1.157`, ná #53/#68/#69/#70/#71) meet de audit **4 rood**:
`TOOLS.md` toonde nog steeds `${mirror.mailbox` (DOC-1b), de `Stand:`-kop stond op 1.149 terwijl
de tekst v1.156 beschreef (DOC-2), de runnerversie stond er zowel als v3.3 als v3.1 (DOC-6) en
de banktelling zei 435 waar er 441 actief zijn (DOC-8). Geen van die vier komt uit deze branch;
alle vier zijn in één dag ontstaan of blijven staan. Dat is exact de faalwijze waarvoor de poort
bedoeld is, en het is geen gedachtenexperiment meer.

**De poort ging aan mét zijn eerste reparatie in dezelfde PR (D07-7).** Alleen de blokkerende
codes bepalen de exit-code — anders blokkeert de poort als eerste iemand voor drift die niet van
hem is, en dan gaat hij weer uit. DOC-10, DOC-11 en DOC-12 meten cadans en schuld en blijven
`WAARSCH`: nu één cronvuring van `rag-eval-weekly` zonder runrij en 6 blijvend rode items zonder
datum in `notes`. Die twee zijn item 4 en item 7, niet iets om weg te poetsen.

**Twee stille fouten in de generator, allebei van dezelfde soort.** (1) `TOOLS.md` toonde
`van de vrager${mirror.mailbox ?` — de `${…}`-vervanging viel over de geneste `}` en de geneste
backticks van een ternary. `--check` bleef groen, want die vergelijkt de generator met zichzelf.
Nu een scanner met echte diepte-administratie, plus de assertie die naar de *uitkomst* kijkt
(DOC-1b: geen `${` in het gegenereerde bestand). Op main van vandaag herschrijft die scanner
**precies één regel** — `skill_open` en de bron-teller van spoor 04 blijven byte-identiek staan,
dus hij is gedragscompatibel waar het goed ging. (2) `--check` vergeleek de **hele** body terwijl
de kopregel van het bestand belooft dat hij niet omvalt zonder databasetoken — in CI dus
gegarandeerd rood op §3. Nu wordt §3 zichtbaar uitgesloten als de recepten niet ophaalbaar zijn.
Zonder die tweede fix was een CI-stap hierop een poort die altijd rood staat, en die gaat uit.

**`grep -c '${'` is géén controle — DOC-1b wel.** De pre-flightvorm met een kale `${` staat op
deze machine tegen **ugrep 7.8.4**, en die leest `$` ook midden in een patroon als anker: de
uitvoer is `0` op een bestand waar `${mirror.mailbox` aantoonbaar in staat (`grep -Fc` en
`grep -Ec '\$\{'` geven daar `1`). Een grep-vorm die stil nul teruggeeft is precies het soort
poort dat dit spoor wil opruimen; de bindende controle is daarom DOC-1b in de audit, en die
leest het gegenereerde bestand in JavaScript.

**Getallen uit een `count(*)` staan niet meer in `ARCHITECTURE.md` (D07-9).** De banktelling en
de proza-telling "van de 14 noemt er één `user_id`" (het zijn er twee) zijn weg; wat blijft is
een verwijzing naar de bron. De runnerversie stond er twee keer met twee verschillende waarden —
v3.1 was de judge-swap, niet de run-rij. DOC-6 eist nu één waarde, gelijk aan `RUNNER_VERSION`.

**De verwachting komt uit het document, niet uit het script.** De onderzoeksprobe had de
doc-waarden in zijn eigen bron staan; dan is de audit een derde kopie die net zo goed veroudert
en bewijst groen alleen dat script en code het eens zijn. DOC-4 en DOC-5 parseren de budgettabel
en de zes tijdsgrenzen nu uit `ARCHITECTURE.md` en leggen ze tegen `run.ts`, `agentic.ts` en
`compose.ts`. Een doc-kant die niet te lezen is, is rood — een document dat zijn eigen bewering
kwijt is, is óók drift. Dat de vijf effort-rijen na 289 gewijzigde regels in `run.ts` nog 20/20
gelijk staan, is de eerste keer dat dat gemeten is in plaats van aangenomen.

**Padkoppeling meet per PR, niet per commit (D07-6).** Over `origin/main...HEAD`. Nagerekend op
echte geschiedenis: 5 van 5 recente merges groen, PR #50 (het
`confluence-acl-live-but-not-in-git`-incident) rood — en dezelfde drie WP-commits die per PR
groen zijn, zijn per commit rood. Per commit is de regel ergernis; per PR heeft hij tanden.

**`MA48`/`MA49` staan in git, maar niet door deze PR.** Ze bestonden op 2026-09-07 alleen in
prod terwijl drie documenten ernaar verwezen; deze branch zette ze op schijf en gaf ze een
`source_hash` (vooraf 20/20 kolommen identiek bewezen, achteraf `md5(question)`/`md5(notes)`
byte-identiek — de load zette alleen de hash). **Spoor 04 PR-A heeft ze inmiddels zelf in git
gezet**, met één extra herkomstzin in `notes`, en die regels staan al in prod. Daarom is de
q04-hunk hier vervallen: main's versie is de rijkere en `agent_eval_load.cjs --check` staat op
`main` al groen. DOC-9 is dus niet door deze PR gerepareerd — dat is nu vastgelegd in plaats van
stilzwijgend meegeteld.

**Het workflow-bestand zelf zit niet in deze PR, en niet uit keuze.** De PAT van de sessie mag
geen `.github/workflows/**` schrijven: `git push` weigert met *"refusing to allow a Personal
Access Token to create or update workflow … without `workflow` scope"* en de contents-API geeft
403 op elk pad onder `.github/workflows/`. Het bestand staat kant-en-klaar in
`07-continuous-improvement/docs-gate.yml` (77 regels) en is lokaal gedraaid; het landt zodra
iemand met Workflows-schrijfrecht het commit. Tot dan is punt 9 handwerk — de audit zelf is
groen en draaibaar, en CLAUDE.md zegt dat ook letterlijk.

**Nog open na deze PR:** de SQL-guard `agent_docs_staleness_check()` met het verbreden van de
twee `security_findings`-CHECK's (item 4), de wekelijkse trendpagina (5), de projectpagina (6)
en de `rood sinds <datum>`-conventie die DOC-12 groen maakt (7).

---

## 2026-09-07 — G4 faalt op de route, niet op de ACL; en G1 telt een 502 als stilte

**Spoor 05, na de rookronde.** `rook-p0 --gate` stond op **exit 1** met G1 en G4 rood, in
twee runs achter elkaar. De vorige notitie schreef WI05 toe aan *"een top-N-inclusiemis"*.
Dat klopte in richting, maar het discriminerende veld stond gewoon in de run-json en is
scherper: **de route**.

**WI05 faalt exact dán, en alleen dán, als hij op `agentic` uitkomt.** Alle tien
`rook-p0`-runs uit alle sporen naast elkaar, plus de herprobe:

| run | tijd (UTC) | G4 | WI05 | WI01 |
|---|---|---|---|---|
| `01-final` | 09-06 11:06 | groen | pass / `semantic` | FAIL / `semantic` |
| `s3b-step1` | 09-06 11:44 | groen | pass / `semantic` | FAIL / `semantic` |
| **`s3b-step1-b`** | **09-06 12:01** | **rood** | **FAIL / `agentic`** (36,3 s) | **FAIL / `agentic`** (43,6 s) |
| `02-base` | 09-06 12:34 | groen | pass / `semantic` | FAIL / `semantic` |
| `s3b-step2` | 09-06 13:05 | groen | pass / `semantic` | FAIL / `semantic` |
| `02-after-i1` | 09-06 16:33 | groen | pass / `semantic` | FAIL / `semantic` |
| `02-base` | 09-07 10:36 | groen | pass / `semantic` | FAIL / `semantic` |
| `02-after-i2` | 09-07 13:37 | groen | pass / `semantic` | FAIL / `semantic` |
| `05-rook-A` | 09-07 17:13 | **rood** | **FAIL / `agentic`** (38,3 s) | FAIL / `agentic` |
| `05-rook-B` | 09-07 17:24 | **rood** | **FAIL / `agentic`** (33,9 s) | FAIL / `agentic` |
| **`05-wi-reprobe`** | **09-07 18:04** | **groen** | **pass / `semantic`** (14,5 s) | FAIL / `semantic` |

**WI05 op `semantic`: 8× pass, 0× fail. Op `agentic`: 0× pass, 3× fail.** Perfecte
correlatie met de route, nul correlatie met dit spoor — en **`s3b-step1-b` van 09-06
12:01 is een G4-rood met exact dezelfde handtekening, een volle dag vóór WP8 bestond.**

De herprobe is de kern: **dezelfde live `rag-chat` v66, dezelfde `rag-eval-cron` v14**,
55 minuten later, en WI05 is groen op `no_empty`, `sources_include` én
`sources_include_space` — **G4 groen** (`5abf263b…`, 4 items, $0,038, 47 s). Was de
gedeployde code de oorzaak, dan kon dat niet. WI01 doet hetzelfde: op `semantic` faalt hij
op `latency + tools`, op `agentic` op `latency + sources_include`. De twee *negatieve*
controles WI06/WI07 staan in **10 van de 10** runs op pass.

**Het mechanisme is de zelfheling.** `run.ts:1207` escaleert naar de onderzoeksagent bij
`matches.length < 3`; op die route draagt de bronnenlijst de Confluence-space niet. Dat is
een **rangschikkings**grens, geen **toegangs**grens, en hij ligt bij toeval dicht bij 3.
De rookruns draaien 36 items met hop-parallellisme, de herprobe vier — dat verschil in
gelijktijdige belasting is de enige kandidaat die met alle metingen strookt.

**De ACL is apart gemeten, ná de deploy:** `confluence_acl_eval` om 18:01 UTC **17/17
groen**, inclusief de positieve controle (11 MT-fragmenten van 25) en D1/D2 op `acl_debug`
(1009 chunks voor de rechthebbende vs 966 voor cron). Wie G4-rood als ACL-breuk leest,
leest hem verkeerd.

**Praktische regel:** noteer bij een rood wiki-item eerst `route`. Staat daar `agentic`
waar het eerder `semantic` was, dan meet je de escalatiedrempel en niet de assert.

**En de twee G1-items zijn even wisselvallig**, ook al vóór dit spoor: **NE34** faalt in
**8 van de 10** runs (eerste rood `01-final`, 09-06 11:06), **RO32** in **6 van de 10**
(eerste rood `s3b-step1`, 09-06 11:44, met `forbidden`; sinds 09-07 met `budget_wall`).
G1 stond in **9 van de 10** runs rood, groen alleen in `02-base` van 09-06 12:34. Wie de
poort als binair signaal leest, leest ruis.

---

**Tweede bevinding, en het is een gatendefect.** In `05-credits-B` telde **G1**
`silent_empty: 2`. De twee items zijn AR10 en AR12, en beide dragen als detail
`rag-chat_failed status=502 {"error":"http_502"}`. Een mislukte HTTP-call landt bij de
runner als `answer_empty=true, coverage_reason=null` — dus als *stil leeg antwoord*.

**G1 kan "de chat gaf een kort leeg antwoord" niet onderscheiden van "de gateway gaf
502".** In `05-credits-A`, zeven minuten eerder op identieke code en zonder 502's, stond
G1 gewoon **groen**. Dat is precies het soort verwarring dat G1 zou moeten wegnemen: de
poort bestaat om stilte zichtbaar te maken, en telt nu transportfouten mee als stilte.

**Voorstel voor spoor 01:** een niet-2xx respons telt als `transport_error` en valt buiten
`silent_empty`. Tot dat er is: G1-rood op een run met 502's is geen signaal over de chat.

**Wat dit voor spoor 05 betekent:** de diff op de chatketen is twee hunks in `run.ts`,
15 regels, die één veld schrijven. `grep -rn artifacts_available supabase/functions/rag-chat/`
geeft **drie treffers, alle drie een schrijfactie** — het veld wordt nergens teruggelezen,
en het wordt geschreven op regel 1334, ná de routekeuze op regel 1207. G1 en G4 zijn niet
van dit spoor, en dat staat nu met een meting vast in plaats van met een redenering.

## 2026-09-07 — De storing had twee items groen gezet, en de bank flapt met 3 op 40

**Spoor 05, na de kredietstop.** De bankronde van 2026-09-06 mat een storing:
`openai_embed_429`, chunks 0 op élke call. Sinds ~10:40 UTC is er weer krediet
(`confluence_acl_eval` 17/17 groen, was 12/17; G4/G5 droegen de 429-tekst
letterlijk). Daarmee is de vergelijking overgedaan — en die levert twee
bevindingen die belangrijker zijn dan de percentages.

**1. Twee "groene" items van de nulmeting waren groen *door* de storing.**
`EVAL-GATES.md` B3 rekende AR10 en AR23 als pass. Beide asserts zijn een
`answer_must_match_regex` zonder woordgrens, en beide matchten op het
weigersvolzin:

| item | regex | wat het onder de storing matchte |
|---|---|---|
| AR10 | `(dag\|uur\|geldig\|verloopt)` | *"…hoe lang de downloadlink **geldig** blijft"* — het model echode het woord uit de vraag terug in een antwoord met 0 chunks |
| AR23 | `(niet\|PDF\|Excel)` | *"…de reden daarvoor **niet** kon worden vastgesteld"* — een ontkenning in een foutmelding, niet een eerlijk *nee* op Word |

Met echte retrieval zakken ze allebei. **B3 is dus niet van 2/4 naar 1/4
gezakt; hij stond nooit op 2/4.** De les is algemener dan deze twee items: een
regex over gewone Nederlandse woorden (`niet`, `dag`, `geldig`) haalt het
juist wél op een leeg antwoord, en zo'n assert is groen precies wanneer het
systeem stuk is. Wie zo'n item bouwt, moet hem één keer tegen een lege bundel
draaien.

**2. De bank flapt, en genoeg om een klein verschil op te eten.** Twee runs op
**identieke code**, 7 minuten na elkaar:

| | run A | run B | delta |
|---|---|---|---|
| `artefact` (26) | 12 pass · 46,2 % | 14 pass · 53,8 % | +2 items |
| `vorm` (14) | 7 pass · 50 % | 8 pass · 57,1 % | +1 item |
| omgeslagen items | — | AR24, AR32, AR37 (alle rood→groen) | **3 van de 40** |

Op de rookronde hetzelfde beeld: twee `rook-p0`-runs op identieke code, **4 van
de 36** omgeslagen (AR01, AR36, NE08, NE42 — alle rood→groen). Dat is ~10 %.
**Gevolg voor elke poort die "niet gezakt" of "−5 pp" meet: onder de 3 à 4
items is een delta niet aantoonbaar met één runpaar.** Het mechanisme staat al
in de notitie over routeruis; dit is de tweede meting die het bevestigt, nu op
twee suites.

**3. Wat níet van dit spoor komt, met het bewijs erbij.** `rook-p0 --gate`
staat rood op G1 en G4. Beide rode items zijn in twee runs identiek:

- **RO32** — `budget_wall: deadline_at verstreken zonder terminale toestand`,
  178 s. Bekende, nog niet gerepareerde faalwijze van de compose-stroom.
- **NE34** — `truly_empty` met de reden erbij; een retrieval-gat, geen stil
  leeg antwoord.
- **WI05** (G4) — faalt op `sources_include` + `sources_include_space`, twee
  runs achter elkaar. Dat is een top-N-inclusiemis, geen ACL-breuk:
  `confluence_acl_eval` draaide twintig minuten eerder 17/17 groen **inclusief
  de positieve controle** (11 MT-fragmenten van 25). Retrieveerbaarheid en
  rangschikking zijn twee dingen.
- **NE42** stond in de eerste run als groen→rood en was in de tweede run weer
  groen. Ruis.

Geen van deze items raakt `artifacts_available`. De diff van dit spoor op de
chatketen is één stringlijst in de envelop plus een leegmaak-regel, zonder I/O.
De `rook-p0`-vergelijking die de runner koos liep bovendien tegen een run van
**28 uur eerder**, met daartussen PR #60, #62 en #63 en drie prod-deploys van
`rag-chat` (v53 → v65) — die diff kan spoor 05 niet isoleren, in geen van beide
richtingen.

**Voor de volgende meting:** draai de retrieval-bench **niet** in het kielzog
van een evalronde. Direct na twee bankruns gaf `agent_retrieval_bench --intent
search_fast` p95 **12.061 ms**; één minuut later, zelfde code, **3.915 ms**
(p50 2.648, `over_chat_budget` 0). De poort van 3.000 ms staat nog rood, maar
dat was hij vóór dit spoor ook (4.587 ms) en de 12 s was mijn eigen contentie.

## 2026-09-07 — `rag-chat` v66: de envelop-regel verhuisde mee, en de deploy is eerst tegen de live functie gemeten

**Waarom de deploy een dag stil lag.** De regel was klaar op 2026-09-06, maar de
live `rag-chat` (toen v53) droeg zes regels van spoor 01 die niet op `main`
stonden; een deploy vanaf deze branch zou die stilzwijgend wegpoetsen. PR #52
is inmiddels gemerged, en spoor 02 heeft er v6.1 (v65) bovenop gezet.

**Vóór de deploy gemeten in plaats van aangenomen.** De eszip van de live
functie draagt zijn eigen sourcemaps, dus de originele TypeScript is
terughaalbaar. Alle **zes** modules van v65 bleken **byte-identiek** aan
`origin/main` — er stond geen prod-vóór-main-venster open — en de enige afwijking
tegen deze branch waren de 15 regels van WP8. Dat is een controle die niet op een
versienummer leunt: `SKILL_VERSION`-achtige koppen worden per spoor omgedoopt, de
functie-inhoud niet.

**Ná de deploy dezelfde greep, andere richting** (v66): de nieuwe tak aanwezig,
de oude tweewaardige lijst weg, de leegmaak-regel aanwezig, én — dat is de
eigenlijke reden voor deze controle — `eval_run_id` van spoor 01 en de v6.1-kop
van spoor 02 nog steeds aanwezig. Een deploy die één spoor terugdraait, meldt
zichzelf niet.

**De verhuizing zelf.** `prepareCompose` zet de twee takken, `finishRun` maakt de
lijst leeg. Bij het schrijven stond dat in `index.ts` op regel 1031/1132; die
regels bestaan daar niet meer. Een rebase liet `index.ts` daarom schoon achter
en de regel nergens — de build bleef groen, de rooktest bleef groen, en de knop
zou stil ontbreken. Vandaar de eis dat een envelop-wijziging met een **directe
`rag-chat`-call** wordt bewezen en niet met de evallane: die projecteert
`sources` en laat `artifacts_available` niet zien.

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
## 2026-09-08 — Spoor 04 PR-B: de naam van een werkwijze is informatie

**Spoor 04, PR-B `app_skills`, model `claude-opus-5`.** Onderzoek:
`04-skills/RESEARCH.md` §2/§5; poorten en getallen:
`04-skills/{EVAL-GATES,IMPLEMENT-NOTES}.md`. **v1.156.**

**Het probleem dat de vorm bepaalt.** `org_skills` is één trap: elke actieve
regel gaat integraal mee in élke vraag. Voor twee definities van 400 tekens is
dat goed; voor een werkwijze van 5.000 tekens betaal je hem 99 keer voor de ene
keer dat hij nodig is. Het ontwerpplafond van `org_skills` (60 × 1.200 = 72.000
tekens ≈ 19k tokens) zou een semantische prompt van ~4.550 tokens
verviervoudigen. Progressive disclosure is dus geen elegantie maar de
kostenstructuur van de laag.

**Drie trappen, niet twee.** Titel (≤ 120) overal · beschrijving (≤ 500) alléén
waar `skill_open` bestaat · body alleen ná `skill_open`. Dit wijkt bewust af van
"beschrijvingen altijd mee": op semantic, structured en sweep is er geen tool om
trap 3 te bereiken, dus een volledige beschrijving daar is betalen voor een deur
die niet opengaat. Een titellijst kan wél worden ingelost. Concreet in de code:
`canOpen` is geen instelling maar een feit — alleen de agent-lus heeft tools, dus
alleen daar staat "roep `skill_open` aan" in de prompt.

**RLS is geen isolatie op het pad dat telt.** `rag-chat/index.ts` bouwt zijn
client met de service-role-key; RLS vuurt daar nooit. Dus twee lagen: RLS voor de
editor, `SECURITY DEFINER`-RPC's voor de chat, met **één** predicaat waar
`app_skill_open` en `app_skills_etag` beide uit selecteren. Twee predicaten die
uit elkaar lopen maken van een slug een leesprimitief. Statisch gemeten met
`pg_get_functiondef` — en die gate liep de eerste keer rood op het commentaar in
de functie zelf ("hier staat bewust geen `where scope`"), dus hij strookt nu
`--`-regels weg vóór hij matcht. Een gate die de tekst meet in plaats van de code
is geen gate.

**`current_user_role()` staat er niet in.** Die geeft `'member'` terug bij een
lege `auth.uid()` — dus op precies het service-role-pad van de chat. Een
`scope='role'`-skill voor `member` zou zichtbaar worden voor élke
identiteitsloze aanroeper: fail-open, en stil. De rol komt rechtstreeks uit
`user_roles` op de caller-`uid`, met `uid is not null` als voorwaarde.

**Een kale `CREATE FUNCTION` geeft PUBLIC execute, en dát is hier het lek.** Het
caller-patroon negeert `p_caller_user_id` voor een browsersessie, maar een
anon-request heeft `auth.role() = 'anon'` en valt dus in de else-arm. Zonder
revoke mag iedereen met de publieke anon-key de persoonlijke werkwijzen van een
uuid opvragen. De migratie doet daarom `revoke execute … from public` én noemt
`anon` expliciet naast `authenticated` in de caller-CTE. **Bijvangst, gemeten:**
`confluence_allowed_spaces` en `confluence_acl_debug` dragen vandaag
`=X/postgres` en zijn dus anon-uitvoerbaar. Ze geven space-keys en tellingen,
geen pagina-inhoud, en `match_chunks`/`confluence_get_page` staan wél dicht — het
is een aparte follow-up en niet van spoor 04, maar het staat hier omdat het
dezelfde fout is.

**Wat van de vrager afhangt staat nooit in de gedeelde prefix.** Org-scope in de
system-prompt, `user`/`role` in de eerste user-beurt. Twee onafhankelijke
redenen, en de tweede weegt zwaarder: nul cache-hits over gebruikers heen
(kosten), en een prefix die identiteitsvrij blijft kan per constructie geen
ACL-lek dragen (veiligheid). De prompt-probe meet dat als assertie: het
system-blok van beide persona's is byte-identiek.

**De positieve controle is de enige die telt.** Vier metingen, niet twee: elke
persona ziet zijn eigen werkwijze **en** niet die van de ander. Een test die
alleen bewijst dat een verboden skill nooit opduikt, slaagt óók als de identiteit
nooit wordt geraadpleegd — precies zo is het Confluence-gat maanden onzichtbaar
gebleven. `scripts/agent_skills_acl.cjs`: 24/24, waarvan A1 en A2 de positieve
helft zijn.

**De laag is bij de merge leeg, en dat is geen tekortkoming.** PR-B levert het
mechanisme; een werkwijze schrijven is een bewerking in de app, geen deploy. Met
een lege tabel injecteert de keten nul tekens — de `skills`-categorie geeft ná
PR-B dus exact de nulmeting (10/12, WI19 op de route en WI34 op de regex, WI24
groen), en dat is wat "niet slechter" hier betekent.

**De route-override staat uit.** `triggers` + `skill_route_override` (default
`false`) duwt een semantische vraag naar agentic, want daar bestaat `skill_open`.
Aanzetten is een eigen meting: semantic p50 ≈ $0,005 tegen agentic p50 ≈ $0,05.

## 2026-09-08 — Spoor 04 PR-A: een organisatieregel geldt op élke route

**Spoor 04 (Maestro Agent Architecture), PR-A "hygiëne", model `claude-opus-5`
(MODEL-MIX: 04 implement = O).** Onderzoek: `04-skills/RESEARCH.md`; poorten en
getallen: `04-skills/{EVAL-GATES,IMPLEMENT-NOTES}.md`. **v1.154.**

**Wat er stuk was.** Een `tool_binding` haalde een regel uit de algemene kennis:
`generalGuidanceBlock()` filterde gebonden regels er juist úit. De enige regel die
Jelle ooit heeft gebonden hangt aan `count_by_stage`, en die tool werd in 120 dagen
**84×** op de structured route gekozen — waar `runStructured()` `org_skills` nergens
aanraakt. Over dezelfde 120 dagen liep **79 %** van het verkeer (2.389 van 3.025
runs) buiten de agent-lus. De regel bestond daar dus in geen enkele prompt.
Gemeten op de antwoorden: **0 van 62** structured antwoorden noemt de afbakening,
tegen **2 van 51** agentische — en dat tweede getal is de reden dat de poort op de
*naad* zit en niet op het gedrag (D04-6).

**Wat er nu geldt.** Alle actieve regels gaan als één blok achter de system-prompt
op élke route; een binding bepaalt vanaf nu wáár de nadruk komt, niet óf de regel
bestaat. Op de structured route wordt de afspraak van de gekozen tool erachteraan
herhaald (`boundGuidanceBlock`, gehangen aan `analytics.tool` — alleen
`runStructured()` zet dat veld, dus er is geen route-string voor nodig). In de
agent-lus blijft de bestaande toolstaart staan; daar staat een gebonden regel dus
twee keer in de context (~135 tokens), bewust aanvaard.

**Afkappen is een getal geworden.** Naast de cap van 1.200 tekens per regel geldt
nu een budget van 6.000 tekens over de héle set — het ontwerpplafond van
60 × 1.200 = 72.000 tekens gaat bij élke vraag volledig mee en zou een semantische
prompt (p50 ~4.550 tokens) verviervoudigen zonder dat iemand het ziet gebeuren.
Wat buiten het budget valt, valt op regelgrens weg en telt in
`org_skills_truncated_n`. **De cap mag stil zijn, het afkappen niet.** Vandaag niet
bindend: de twee actieve regels vullen samen 910 tekens.

**Organisatiekennis is een grondslag, geen onzichtbare bijlage.** De envelop kende
twee soorten bewijs — een chunk of een rij — dus een antwoord dat volledig uit de
regels kwam had nul bronnen en heette per definitie leeg. Een actieve regel is nu
een bron met een slug en een datum, en `coverage.searched` noemt
`organisatiekennis`. **Let op de tweede helft:** `answer_empty` wordt pas in
`finishRun` afgemaakt en alleen opgeheven als het model ook werkelijk iets zegt
(≥ 40 tekens, dezelfde ondergrens als `rag-eval-cron/asserts.ts`). Een stille of
afgebroken compose blijft leeg heten.

**Open risico, en het landt niet waar je zou denken.** Omdat er altijd minstens één
actieve regel is, komt de voorwaarde in de praktijk neer op "elk antwoord van ≥ 40
tekens is niet leeg". Waar dat *niet* aankomt is de evallane: `rag-eval-cron`
projecteert `answer_empty` niet naar de assert-invoer, dus `asserts.ts:82` valt
terug op `chunk_count = 0 && rows = 0` — gemeten op 2026-09-08 faalden alle 14
`expect_no_empty`-items met `empty=true sources=2`, dus met de twee
`org_skill`-bronnen erbij en tóch "leeg". Waar het wél aankomt is
`v_agent_chat_health`, dat leest `rag_chat_query_log.meta->>'answer_empty'`: op
niet-eval-verkeer ging het percentage lege antwoorden van **6,0 % (13/217) naar
0,0 % (0/41)**. De dagcijfers van de chat zijn dus stiller geworden zonder dat de
chat dat is. Twee losse vervolgacties: de assert leren dat een `org_skill` een bron
is (spoor 01), en de gezondheidsweergave laten meten wat ze bedoelt te meten.

**Prod liep vóór `main` uit, en dat is wat deze PR sluit.** De hierboven beschreven
motorwijzigingen stonden sinds 2026-09-07 20:19 / 20:27 / 21:42 UTC in de
gedeployde `rag-chat`-bundel (v69) zonder in git te bestaan: geen branch, geen PR,
op geen enkele machine terug te vinden. Ze zijn uit de eszip-sourcemap
teruggehaald, regel voor regel gelezen en hier onveranderd vastgelegd. Wat er
**niet** in zit is de `artifacts_available`-uitbreiding die in dezelfde bundel
staat — die hoort bij spoor 05 (PR #53) en blijft daar. Nieuw in deze PR en dus
nog **niet** live: de vier getallen in `rag_chat_query_log.meta`, de drie
ontbrekende tool-bindingen in de editor en rooktest S29.

**De naad heet `org_skills_bound_tool`, niet `tool_guidance_applied`.**
`EVAL-GATES.md` K6/S29 noemde het geplande veld in het meervoud; er is er per
constructie precies één (alleen `runStructured()` kiest een tool). Eén naam voor
één feit — de poort is meeveranderd, niet het feit.

**Bank-hygiëne in dezelfde PR.** `agent_eval_load --check` stond rood: WI18/WI19
waren rechtstreeks in `rag_eval_questions` gewijzigd, en KL41/MA24/RO48 (06c) plus
MA48/MA49 (06e) bestonden alleen in de database. WI18/WI19 zijn via de loader
teruggezet op de git-vorm — WI19 krijgt daarmee zijn `expect_route: structured`
terug en is bewust rood: hij bewaakt de *route*, en die route verandert pas als
`skill_route_override` aangaat (D04-7). De vijf andere zijn andersom opgelost: hun
inhoud is ongewijzigd overgenomen ín git, zodat de meting van 06c/06e blijft staan
én de bank weer te reviewen is. `--check` is daarna groen op alle zes controles.

---

## 2026-09-07 — Spoor 02 I2: één vraagmodus, en de meter mat zichzelf

**Spoor 02 (Maestro Agent Architecture) I2, model `claude-opus-5` (MODEL-MIX F→O).**
Onderzoek: `02-long-running-runs/RESEARCH.md`; poorten en getallen:
`02-long-running-runs/{EVAL-GATES,IMPLEMENT-NOTES}.md`. **v1.151 · rag-chat v6.1 ·
rag-eval-cron v3.3.** Draft-PR #63.

**Vork V7 is gesloten: `stream:true|false` bestaan niet meer.** Voorwaarde was dat de
browser én de evalrunner op `run:true` draaien, en dat is gemeten vóórdat de modes weg
gingen: de rookronde meet nu de run-modus met **58/58** asserties, waaronder **S8 3/3** —
drie runs waarvan de client 1,8–2,1 s na het `run_id` verbrak en die **8,8 / 9,4 / 13,7 s
daarná** afrondden met hun antwoord in de rij. De assertie eist expliciet
`finished_at > het moment van verbreken`, anders zou een run die toevallig al klaar was als
bewijs gelden. Wat blijft staan is de inline hop-plumbing in `run.ts`: onbereikbaar sinds
deze PR, maar verweven in de budget-, hopgrens- en compose-deadline-logica die net groen
gemeten is — dat sloopwerk hoort een eigen meting te krijgen. Gevolg vandaag:
`rag_chat_query_log.stream` is voor elke nieuwe rij `false`.

**De meting die iets over de meter zei, niet over de keten.** RO37 (agentisch, grens ≤ 180 s
en ≤ $1) was in élke eerdere ronde rood. Niet omdat de keten te traag was, maar omdat de
runner zijn eigen klok mat: `clamp(max_latency_ms × 1,2, 140 s, 170 s)`, met daarboven een
gateway die niet-streamende calls na 150 s afkapt — terwijl het budget van zo'n vraag 240 s
toestaat. Elke uitkomst boven 170 s werd dus een `runner_timeout` van de meter. In v3.3 is de
time-out `budget.wall_ms + 30 s` en leest de runner de rij: **RO37 gaat over** (pass,
14 135 ms, $0,0078). Dat is één item, maar het is het item waar de hele klok-vs-cap-diagnose
van dit spoor op rustte (RESEARCH §2.1). Bijkomend meetbaar geworden: `cost_usd` is nu
`spent.usd` — de som over álle leveranciers in plaats van het envelop-bedrag — en
`expect_effort_at_least` is geen `pending` meer.

**Poort T5 (blokkerend): 33 van 34 chat-items binnen `budget.wall_ms × 1,1`, 0
`runner_timeout`, 0 gateway-5xx.** De p95 van de rook stijgt van 44 naar 112 s en dat is de
bedoeling: de agentische staart mag nu tot zijn budget lopen. T5 is wat dat begrenst, niet G6.

**Niet-blokkerend rood, met de meting erbij.** G1 is rood uit twee bronnen, geen van beide een
regressie van deze PR. **NE34** (`fails_no_empty`, structured met 0 rijen en reden
`truly_empty`) is exact hetzelfde item als bij I1 en spoor 01. **RO10** (robuustheid) is de
vraag van één vraagteken die sinds altijd `400 message_required` geeft, ook in de baseline.
**RO32** was in de baseline van vandaag al rood en is een gedocumenteerde flipper (3× pass /
5× fail over de laatste acht rondes); nieuw is alleen hóe hij faalde — zie hieronder. In de
regressieronde vielen daarnaast RO36/RO49/RO50 om, alle drie agentisch met
`coverage.reason = timeout` binnen hetzelfde venster van vijf minuten (3 van de 26 rijen; de
andere 23 hebben reden `null`). Met de gedocumenteerde routeruis van ±2 items op een kleine
categorie is één ronde daar geen conclusie: het protocol vraagt een tweede ronde, en die staat
nog open. G5 +3 % p50-kosten,
G6 `over_latency` 2, G7 3/11 = gelijk aan de baseline. `groen→rood`: NE18 en NE30, beide
`clarifying`-asserts die nu 18 respectievelijk 40 rijen vinden en antwoorden in plaats van een
wedervraag te stellen — een gedragsgevolg van het volle budget, en niet stil: beide staan rood
met het aantal rijen in de reden. **RO39** faalt op `max_latency_ms: 8000` en heeft dat in
8 van de 8 rondes van drie dagen gedaan (11,1–20,0 s); die grens is nooit door enige ronde
gehaald en hoort een bank-vraag voor spoor 01 te zijn, geen poort hier.

**De compose-stream kan stilvallen, en alleen het laatste vangnet merkt het (3 van de 3).**
Eén documentatievraag (route `semantic`, effort `medium`) liep in de rook, in de regressie én
in een gerichte solo-poging op precies dezelfde manier vast: `answer_partial` bereikt **203
tekens**, daarna komt er **173 s lang geen byte meer**, `grok_in/out` blijven **0**, en de
waakhond sluit de run na 178 / 183 / 181 s als `failed {budget_wall}`. `hops[0]` heeft geen
`ended_at` en er is **geen querylogrij**. De xAI-stream begint dus wél en valt daarna stil
zonder te sluiten.

Wat hier de les is: **de twee vangnetten die eerst hadden moeten grijpen zwijgen allebei.**
`composeAnswer` zet `AbortSignal.timeout(clamp(deadlineAt − nu, 15 s, 120 s))` — rond 128 s
runtijd had dat een `failed {stream_error}` moeten opleveren, en er is geen enkele schrijfactie
ná 7,7 s. De harde hopgrens `HOP_HARD_MS` (170 s) had de hop moeten afsluiten en doorrollen; ook
die tak is nooit gelopen. Een `read()` op een half-open stream die nooit terugkeert observeert
zijn abort-signaal niet — dat vraagt een eigen timer om de reader heen, niet een signaal op de
fetch. Alleen de waakhond op runniveau (`created_at + wall_ms + 60 s`) ving het op, en die is
per ontwerp het láátste net.

Niet gerepareerd in deze PR: het zit in `compose.ts`/`run.ts` (I1-terrein, niet de
hook/smoke/runner van I2) en verdient een eigen werkpakket met een eigen meting. Backlog, hoge
prioriteit: (a) een **chunk-timeout** in `composeAnswer` — geen byte binnen N s → afbreken en
`failed {stream_stalled}` schrijven **mét** de partial die er al stond, want nu gaat een half
antwoord van 203 tekens verloren; (b) de hopgrens moet ook grijpen als de stage niet uit
zichzelf terugkeert; (c) bij een hop zonder `ended_at` is `hop_lost` de oorzaak en
`budget_wall` het symptoom — de waakhond kiest nu de tak die het eerst afgaat (180 s vóór
`stall_minutes` 5 min), dus de logregel noemt het symptoom.

Wat er wél goed ging: geen stille hang. Het werd een zichtbare `failed` met bewaarde state, en
de evalrunner maakte er een FAIL met reden van in plaats van een stille pass.

**De MFA-poort scheidt REST van Realtime, en dat is een valkuil voor élke meting.** Het beleid
op `agent_chat_runs` is `session_mfa_ok() AND owner_id = auth.uid()`. Een gemunte
magic-link-JWT heeft geen tweede factor, dus **de eigenaar leest zijn eigen runs niet via
REST** — terwijl Realtime `session_mfa_ok()` níét evalueert en wél levert (S9, beide met
positieve controle). Twee gevolgen: de REST-positieve controle in de smoke staat nu onder de
échte policy via `set local role authenticated` in een `begin/rollback` (een aal2-sessie munten
zou een echte code naar Jelle's mailbox sturen), en `useRunFollow` mag "0 rijen uit de poll"
niet als "bestaat niet" lezen — dat is gehard.

**`agent_docs_generate --check` staat rood door een ánder spoor.** `TOOLS.md` loopt achter op
**prod**, niet op deze branch: `analyze_meeting` top_k 10 → 14 en
`compose_followup`/`enrich_record` anchors 4 → 0 komen van spoor 06c, live gezet terwijl
**PR #62 nog open staat**. `TOOLS.md` is daarom onaangeraakt gelaten; regenereren zou die
doc-drift in deze PR trekken.

## 2026-09-07 — 06b: de HubSpot-kaart was een stub omdat de chunker precies de lege velden las

Vier besluiten, en in drie van de vier draaide de meting het voorstel om.

**1. E-mail-engagements worden gecapt, niet uitgesloten.** Het voorstel was
`{"engagement":{"exclude":true}}` op `search_fast`, want engagement leverde 8,10 chunks
per bundel met mediane rang 13 — flooding. Gemeten op 8 echte vragen uit het verkeer,
over het echte pad, is uitsluiten **langzamer**: `search_ms` p50 1.916 ms tegen 1.572 ms
voor de baseline, omdat `exclude` via `v_excluded` de vlag `v_selective` aanzet en de
iteratieve HNSW-scan dan een bredere kandidatenpool leest. En het ruilt de flooding
alleen om: 36 van de 48 vrijgekomen plekken gingen naar **meeting-stubs**, en drie van de
acht bundels kregen een andere kop. `max_per_source: 3` doet wat uitsluiten moest doen —
48 → 15 engagement-chunks — voor p50 **628 ms**, met álle top-1-chunks identiek aan de
baseline.

De les is algemeen genoeg om te onthouden: **een cap en een uitsluiting zijn geen
gradaties van hetzelfde.** De cap werkt ná de fusie op een pool die al bestaat; de
uitsluiting verandert wélke pool wordt opgehaald.

**2. Stub-masters worden verrijkt, niet uitgesloten.** Het voorstel was ze uit
`search_fast` te weren: company-, deal- en contact-chunks zijn 58, 51 en 73 tekens en dat
ruikt naar filler. Gemeten zijn ze de **kop** van het bundel: de company-stub is top-1 in
163 van 317 `search_fast`-bundels, de deal-stub in 66 van 175, de contact-stub in 29 van
127. Uitsluiten zou het beste fragment weggooien.

Waarom ze zo kort waren, is het eigenlijke antwoord: de chunker las voor een deal
`description`, `dealtype` en `amount` — en die zijn gevuld op **0, 0 en 21** van de 1.099
niet-gearchiveerde deals. Wat wél in de mirror staat en nergens in een chunk stond: het
fase-**label** (1.099 van 1.099 resolveerbaar via `hubspot_pipelines.stages`, terwijl de
chunk het ruwe negen- tot tiencijferige id droeg), het pipeline-label, de bedrijfsnaam,
de sluitdatum, en op 623 deals minstens één licentieveld. Voor een company:
`lifecyclestage` 100 %, city/country ~90 %, en de deals en contactpersonen die eraan
hangen. Voor een contact: het bedrijf via `associated_company_id`, 1.346 van 1.507 tegen
51 als vrije tekst.

**Ook hier draaide een getal om.** Het onderzoek noteerde "1.159 van de 1.241 deals dragen
de volledige licentie-propertyset". Dat kwam uit `jsonb_object_keys` en meet
sleutel-*aanwezigheid*: alle 34 sleutels staan op alle rijen, de meeste met waarde `null`.
Op waarde gemeten is `contract_einddatum` gevuld op **nul** deals, en heeft 56,7 % van de
deals minstens één licentieveld. Een bankitem over "de contract-einddatum van klant X" kan
dus per definitie niet slagen; de datums die bestaan heten `startdatum` en `einddatum`.
Dezelfde soort correctie: de eigenaarsnaam die in de company-kaart moest komen bestaat
niet — `hubspot_owner_map` heeft één rij en geen naamkolom. Daarvoor staan nu de deals en
contactpersonen van het bedrijf in de kaart, want dát is wat een klant-360-vraag zoekt.

**3. De HubSpot-masters zijn her-chunkbaar geworden.** `fetch_unchunked_source_ids` bood
tot nu toe alleen rijen **zonder** chunk aan — "chunk één keer", zoals de chunker zelf
documenteerde met Confluence als enige uitzondering. Voor een mail is dat juist; voor een
deal niet: 1.084 van de 1.099 deal-chunks (98,6 %) en 2.514 van de 5.968 company-chunks
waren ouder dan hun mirror-rij, dus de dealfase in de index was de fase van het moment van
chunken. Dat is geen recall- maar een **correctheids**defect, en het is met precies het
bestaande Confluence-patroon op te lossen: `replace: true` op de SOURCES-rij en een
`version` in de metadata waar de RPC op vergelijkt. Bijvangst: `chunkContact` gaf elke
chunk `occurred_at = new Date()` omdat `hs_lastmodifieddate` op alle 1.507 contacten null
is — bij een her-chunkbare bron zou die datum elke ronde opnieuw "vandaag" worden en de
recency-arm structureel vervuilen.

**4. `notes_search` had een dekkings-, geen latencyprobleem.** De koepel stelde `~*` →
`tsquery` voor. Gemeten verliest `tsquery` 26 tot 39 % recall (145 → 107 en 127 → 78
treffers, een strikte deelverzameling zonder één treffer die de regex mist): de
Nederlandse stemmer matcht geen samenstellingen. Dus `~*` blijft en er komt een
trigram-index bij. De echte beperking was de `p_types`-default `{note,meeting,call}` — 1.244
van 11.586 rijen, terwijl `agentic.ts` `p_types` niet doorgeeft — plus een `scanned_total`
die de scope-CTE twee keer refereerde en daarmee materialiseerde: elke aanroep las alle
30,6 MB bodies om drie treffers te tellen.

**5. Een edge in een view is een berekening bij élke aanroep — en dat is de duurste les
van dit spoor.** De domein-edge (`engagement → company`, confidence 0,7, 4.250 edges over
276 bedrijven) stond eerst rechtstreeks in `v_entity_edges_full` als
`CROSS JOIN LATERAL unnest(...)` over `hubspot_engagements`. Functioneel precies goed. Maar
die view wordt door `match_chunks_for_entity` bij elke entity-aanroep geëvalueerd, en dit
was de eerste arm die `hubspot_engagements` binnentrok: 6 van 18 probe-aanroepen kwamen
terug met `canceling statement due to statement timeout`, en de twee edge-CTE's alleen
kostten **8.883 ms** tegen 1.445 ms vóór 06b.

Twee dingen daaraan zijn het opschrijven waard. Het eerste is de reparatie: de afbeelding
engagement → company verandert alleen als HubSpot een nieuwe e-mail spiegelt of een
bedrijfsdomein wijzigt, dus hij hoort één keer berekend en geïndexeerd — een tabel van twee
kolommen met een trigger en een refresh-functie. Terug op 1.610 ms, met alle 4.250 edges.

Het tweede is wat de fout **ving**. De ACL-golden-set bleef 17/17 groen; hij meet
zichtbaarheid en heeft geen mening over kosten. Wat hem ving was de context-build-probe over
zes echte vragen. Voor elk spoor dat een view in het `match_chunks*`-pad raakt hoort daarom
een latency-probe naast de ACL-ronde te staan — niet erna, en niet in plaats daarvan.

**Wat het opleverde, gemeten — en hoeveel daarvan echt van 06b komt.**
`contract-vs-adoptie`, de categorie waar de licentievelden thuishoren, gaat van
**15/42 (35,7 %) naar 18/42 (42,9 %)**: +7,2 pp, G3 groen (`worst_delta_pp 7,2`), G5 groen
(p50-kosten omlaag). Vier items rood → groen, één groen → rood.

`klant-360` gaat van 30/45 naar 31/45 (+2,2 pp) met **álle** G-poorten groen, inclusief
**G1**: de enige `silent_empty` in de hele nulmeting — één klantvraag die zonder uitleg leeg
terugkwam — is weg, en de p95 zakt van 68.762 naar 58.566 ms. `cijfers-telling` gaat van
34/55 naar 35/55 (+1,8 pp), met G6 groen (p95 25.117 → 18.981) en **G5 rood**.

**En dan de eerlijke maat.** Reken alleen de items die op **dezelfde route** van uitkomst
wisselden — een item dat van route wisselt zegt niets over retrieval:

| categorie | Δ pp | schoon |
|---|---:|---|
| `contract-vs-adoptie` | +7,2 | **+1** (CA15: agentisch → agentisch, van leeg met `truly_empty` naar bewijs) |
| `klant-360` | +2,2 | **±0** (KL39 erbij, KL42 eraf) |
| `cijfers-telling` | +1,8 | **−2** (C18 en C36, beide `structured` → `structured`) |

Over de drie categorieën wisselden **15 items** van route. Op `cijfers-telling` komen alle
drie de "winsten" van items die naar de **agentische** route verhuisden, en dat verklaart
G5 rood: agentisch kost $0,0587 per vraag tegen $0,0065 structured, dus de p50 stijgt 44 %.

Dus: 06b's opbrengst is **+1 / ±0 / −2**, niet +7,2 / +2,2 / +1,8 pp. Twee items regresseren
op een ongewijzigde structured-route (C18 ging van een antwoord naar `truly_empty`) en die
zijn **niet** geroot-caused: van de tools op die route raakte 06b alleen
`analytics_notes_search` aan, en die werd juist *breder*. Ze staan bovenaan de na-kijklijst.

Dat dit verschil überhaupt zichtbaar is, komt van de regel die 06d opschreef — reken een
verschil van een paar items nooit aan retrieval toe zonder de `route`-kolom van beide runs
ernaast. Dit is de eerste keer dat die regel een conclusie daadwerkelijk bijstelt, en de les
is scherper dan hij klonk: op deze bank is een delta onder ± 3 items **ruis**, en de
categorie-percentages die de poorten meten zijn daar niet tegen beschermd.

Verder: het fase-label staat op **1.099 van 1.099** deal-chunks (was 0 %, met een ruw
9-10-cijferig id op 1.086), de bedrijfsnaam op **89,9 %** van de contact-chunks (was 3,4 %),
en `notes_search` gaat van 1.244 doorzochte rijen in 4,6-5,5 s naar **11.586 rijen in 41 ms**.
De p50-chunklengte van de masters gaat van 51/58/73 naar 146/118/120 tekens — dat is 2,0 à
2,9× meer, maar **niet** de 150 die poort b2 vroeg; die drempel kwam uit een aanname over
hoeveel de mirror kon geven, en op waarde gemeten is er niet meer. Padden tot 150 zou de
poort halen en de kaart slechter maken.

En één rekening die 30× hoger uitkwam dan begroot: de her-chunk kostte **≈ $3,6**, niet
$0,07-0,13. Niet door de embedding ($0,17) maar doordat de chunker per chunk óók een
`gpt-5.4-mini`-call doet voor de contextual prefix. Wie een her-chunk begroot moet met
**$0,40 per 1.000 chunks** rekenen.

**Wat 06b bewust niet deed.** Geen regel in `match_chunks`, `match_chunks_for_entity`,
`rag-chat` of `context-build`; alle hendels zijn recept-kolommen, chunker-code, de
`fetch_unchunked_source_ids`-RPC, een view of de `analytics_notes_search`-RPC. Geen
definities (wélk fase-label "actieve klant" betekent is 03b's metric-register — 06b maakt
de tekst vindbaar, niet de definitie waar). En de echte oorzaak van de 17 s op
`enrich_record` — de entity-anchor-ILIKE-scan in het `context-build`-lichaam, gemeten op
3.714-6.617 ms bij een naam die niet recent voorkomt — is overgedragen aan 06f-β met de
meting erbij; in scope was alleen de receptkolom `entity_anchor_top_n`.

## 2026-09-07 — 06c + 06e: de meeting↔klant-koppeling bestond al, en de agenda-tool bleek niet gescoped

**Spoor 06c/06e (Maestro Agent Architecture), model claude-opus-5 (effort max).**
Onderzoek: `06-rag-per-source/06c/RESEARCH.md`; meting en poorten:
`06-rag-per-source/06c/IMPLEMENT-NOTES.md`. Backend-only, geen `APP_VERSION`-bump.
Zes migraties `20260907060000`–`20260907066000`, `chunker-meeting-v2` v5 (`verify_jwt:false`).

**De hoofdingreep.** `v_entity_edges_full` had 22 edge-families en géén enkele van een meeting
naar een bedrijf. `match_chunks_for_entity` doet één hop, dus voor `('company', X)` kwam er nooit
een meeting-chunk mee — driemaal onafhankelijk gemeten op 0 (8 gelinkte companies, 18 entities,
en `via_edge` in 1.018 fragmenten). Het materiaal lag er wel:
`fireflies_meetings.linked_entity_ids` bevat `entity:<type>:<hubspot_id>` en **51/51 waarden
lossen op** (160 paren). Nu gematerialiseerd in `meeting_entity_link` (160 rijen) met de arm
`meeting -[involves]-> company|contact|deal`. Resultaat: **0/8 → 8/8** companies met een
meeting-chunk, en `match_chunks_for_entity` p95 **413 → 410 ms** met 0 timeouts — 06b's incident
(1.445 → 8.883 ms op een view-arm) is niet herhaald.

**De vondst die in geen enkel onderzoeksdocument stond.** `analytics_calendar_search` is
`SECURITY DEFINER` en noemt `user_id`, `auth.uid()` noch een scope-helper, dus hij stapt over de
(correcte) RLS van `calendar_events` heen. Gemeten met twee geminte JWT's: een collega zonder
eigen agenda kreeg **8 rijen, precies zoveel als de eigenaar**. Van de 14 `analytics_*`-functies
zijn er **13** zo gebouwd. Deze PR voegt `p_caller_user_id uuid DEFAULT NULL` toe (NULL = het
gedrag van vandaag, dus niets breekt) en bewijst de werking direct: ongescoped 100 rijen, als de
eigenaar 100, als de collega **0**. De ontbrekende schakel is één argument in `agentic.ts` —
verboden bestand in die kick, dus overdracht naar 03/04, met bankitems MA48/MA49 als permanente
controle.

**Waarom `REVOKE … FROM PUBLIC` niet genoeg is.** Na de `DROP FUNCTION` + `CREATE` van de
agenda-RPC stond de proacl op `{postgres,authenticated,service_role}` waar hij ervoor
`{postgres,service_role}` was: dit project heeft `ALTER DEFAULT PRIVILEGES` dat elke nieuwe
functie EXECUTE aan `authenticated` geeft. Voor een ongescopede SECURITY DEFINER-functie is dat
geen detail. Regel: **meet de rechten ná élke DROP+CREATE met `has_function_privilege`**, niet
door de proacl-tekst te lezen — memory `drop-function-verliest-proacl` één laag dieper.

**De vorkentabel C1–C17, met de meting erbij.**

| # | besluit | uitvoering | de meting |
|---|---|---|---|
| C1 | alleen de `entity:`-prefix unwrappen, geen attendee-arm | zoals voorgesteld | de unie met de attendee-route blijft 28/47 companies: die arm voegt **nul** dekking toe |
| C2 | gematerialiseerde tabel i.p.v. view-arm | zoals voorgesteld | p95 413 → 410 ms, 0 timeouts; op de gelinkte set p95 627 ms |
| C3 | `chunks.entity_ids` uitwikkelen | **NIET GEDAAN** | `filter_entity_id` met een bare id geeft **0 rijen**, met de gewikkelde waarde **20**; mail draagt dezelfde wikkel (8.895 waarden, 3.268 `primary_entity_id`'s). Uitwikkelen had de enige werkende vorm gebroken |
| C4 | prefix inkorten i.p.v. salients wissen | zoals voorgesteld | 42 % van de salients staat in géén topic-chunk; wissen kost echte tekst |
| C5 | meetingtitel + topic-titel uit de salient-prefix | zoals voorgesteld | zelfde-meeting-buren **66,5 % → 30,0 %**, controles vlak (topic 45,0 → 44,0 %, mail 0,0 → 0,0 %); prefix-aandeel 73,3 % → 55,5 %; kosten **$0,0051** |
| C6 | recept: mpr 1, override, top_k 14, audience NULL, anchors 0 | **anchors blijven 4** | `involves` leverde 9 van 9 meeting-fragmenten, `name_anchor` **0** — de anchors waren die route al niet. Uitzetten verdubbelde wél het aantal bundels op ≤ 2 fragmenten (2 → 5), want de terugvaltak valt om. `default_top_k` 14 is bovendien een no-op: `meeting-briefing` geeft `top_k: 10` hard mee |
| C7 | `partner_call` niet aanraken | zoals voorgesteld | staat in 3 recepten, bestaat in 0 chunks — overdracht |
| C8 | `match_appointment`-rij verwijderen | **KAN NIET** | `23503 context_bundles_intent_fkey`: 25 bundels verwijzen naar de rij. Nu `BUITEN GEBRUIK` in de description, enige aanroeper (E30) gedeactiveerd |
| C9 | verbredingsladder in de RPC | zoals voorgesteld | leegte **21,7 % → 2,69 %** (11 door de attendee-trap, 24 door de venster-trap, 5 blijven leeg); gemiddeld **19 ms**; elke verbrede call zet `widened` |
| C10 | `agentic.ts` niet aanraken | zoals voorgesteld | de extra outputkolom breekt de naam-mapping niet — bewezen met 186 replay-calls |
| C11 | `event -[involves]-> company` alleen als de latency ruimte laat | **niet gebouwd** | niet nodig voor een poort; de agenda loopt via `calendar_search`, niet via de graph |
| C12 | `event.future_ok` ongewijzigd | zoals voorgesteld | 0 toekomstige event-chunks opgehaald in 614 bundels |
| C13 | géén semantische arm op `calendar_search` | zoals voorgesteld | de ladder repareert 35 van de 40 leegtes; een tweede index nul daarvan |
| C14 | `max_per_record` bij enkelvoudig `filter_sources` → 06f-α | overgedragen | RO52 dekt de per-record-kant al; de plafond-assert die C14 meetbaar maakt (`expect_max_chunks`) bestaat niet in de runner |
| C15 | MA24/KL41 herschrijven | **drie items, niet twee** | RO48 had dezelfde onbewijsbare assert en `ground_truth_status='verified'`. Alle drie vooraf gemeten groen op `search_fast` top_k 40; alle drie ná groen |
| C16 | geen meeting-tool in de toolbox | overgedragen | 03b |
| C17 | één gecombineerde implement | zoals voorgesteld | één PR, één bankronde |

**De routeruis is nu gemeten, en dat verandert hoe je de bank leest.** Twee agenda-basislijnen,
vier minuten na elkaar op identieke code: **9/15 en 11/15**. Over de hele bank in 48 uur bleef
83,8 % van de items op één route, nam 13,8 % er twee en 2,4 % drie. Ook de retrieval-lane is niet
volledig deterministisch: items op een recept met `query_intel_level='full'` krijgen een
LLM-herformulering (HyDE) en kunnen daardoor wisselen — R03 viel één keer rood en was bij
herhaling groen. **De deterministische deelverzameling is de retrieval-lane zonder `full` intel.**
Reken de opbrengst van 06c/06e daarom als **+3 bankitems, alle drie bankwerk** (MA24, KL41, RO48
naar een lane waar hun assert bewijsbaar is), en zet de echte winst waar hij deterministisch is:
`c1` 0/8 → 8/8, salient-clustering 66,5 % → 30,0 %, agenda-leegte 21,7 % → 2,69 %.

**Wat NIET is aangetoond.** Het meeting-aandeel in de chat-bundels bewoog niet: 20,31 % → 20,59 %
van de slots (5,29× → 5,36× de index-share) op een niet-gepaarde vragenset, terwijl het aantal
meeting-chunks per bundel wél zakte (4,72 → 3,27). Lezing: de kortere prefix **spreidt**
meeting-treffers over meer meetings, hij vermindert ze niet. Wat het aandeel bepaalt zijn α's
caps. En `c6` (meeting-briefing) heeft een rekenkundig plafond van **42,1 %** — van de 38
briefings met een opgeloste company hangen er 16 aan een gelinkte meeting — dus de poort van 50 %
was niet haalbaar; van de reikbare drie leverden er 3/3.


---

## 2026-09-07 — 06d: de wiki-metadata bereikt nu de prompt, en dáár blijkt de herkomstvraag pas te stranden

**Spoor 06d (Maestro Agent Architecture), model claude-opus-5 (effort max), job `0a4764a5`.**
Onderzoek: `06-rag-per-source/06d/RESEARCH.md`; meting en poorten:
`06-rag-per-source/06d/IMPLEMENT-NOTES.md`. Backend-only: geen frontend-bestand geraakt, dus
geen `APP_VERSION`-bump. `rag-chat` v63, `verify_jwt: true`.

**De meting die de aanname omdraaide.** Het onderzoek verwachtte `wiki` van 27,3 % naar
~36 % (**AANNAME**): WI29 ("geef de link") en WI30 ("welke versie") zouden groen worden zodra
`url` en `version` uit de chunk-metadata de prompt bereikten, want dát was de ontbrekende
schakel. Die schakel is gelegd en werkt — 24 van 24 Confluence-bronnen dragen nu een URL in
`envelope.sources`, en de herkomstregel staat in de gedeployde bundel. **En beide items zijn
nog steeds rood**, met twee verschillende, gemeten oorzaken die één laag verderop liggen:

1. **WI29 en WI30 halen `DOCS_QUESTION_RE` niet** (`docs_regex_hit = false` in beide runs), dus
   ze krijgen niet het `search_docs`-recept maar `search_fast`. Voor WI29 betekent dat **0
   Confluence-fragmenten** in de 24 chunks — er is helemaal geen wiki-pagina om naar te
   linken. Geen herkomstregel kan dat repareren.
2. **WI30 krijgt wél 12 Confluence-fragmenten**, dus twaalf herkomstregels mét `v<versie>` in
   zijn context — en het antwoord noemt geen versie. Het antwoordcontract in `compose.ts` zegt
   "citeer elk feit met `[bron #N]`" en noemt een URL alleen voor web-research; niets nodigt
   het model uit een interne URL of versie in de prozatekst te zetten. Bijvangst uit dezelfde
   meting: **geen enkel `wiki`-antwoord bevat `[bron #N]`** (0 van 22), ook de items die
   `cite_min` halen — die assert rekent `max(aantal bronnen, aantal [bron #N])` en slaagt dus
   op het bronaantal alleen.

`compose.ts` staat niet in de schrijfscope van 06d. Beide bevindingen zijn dus overdrachten
(§ hieronder), geen 06d-werk — maar ze zijn nu gemeten in plaats van vermoed, en dat is het
verschil tussen "de metadata ontbreekt" (fout) en "de metadata is er, het contract vraagt er
niet om" (juist).

**Vóór → ná, gemeten dezelfde nacht** (nulmeting 01:44–01:52 UTC, ná-meting 02:04–02:12 UTC):

| meting | vóór | ná |
|---|---|---|
| ACL golden set (blokkerend) | **17/17** | **17/17** |
| `wiki-acl` (blokkerend, G4) | 4/4, WI05 pass, WI06 pass | **4/4, WI05 pass, WI06 pass** |
| `kennisbank` | 4/4 | **4/4** |
| `wiki` totaal | 6/22 = 27,3 % | 6/22 = 27,3 % (WI32 erbij, WI03 eruit — routerruis) |
| `wiki` op de 13 **beweegbare** items (d0) | 5/13 = 38,5 % | **6/13 = 46,2 %** (+7,7 pp) |
| fan-out `search_docs`: pagina's per 40-chunk-bundel | 25,7 | **29,8** |
| fan-out: max chunks van één pagina | **9** | **2** (in alle zes audiences) |
| bench `search_docs` p50 / p95 | 2.572 / 3.677 ms | **2.517 / 3.651 ms** |
| WI36/WI37 solo (`max_build_ms 4000`) | 2/2 | **2/2 op p50 1.298 ms** |
| kb-bleed-chunks · reconcile-kandidaten | 0 · 0 | **0 · 0** |
| kosten per `semantic`/`search_docs`-vraag | $0,02276 | **$0,02168** |
| nieuwe `security_findings` | — | **0** |

G1 is in beide runs rood op precies één item (nulmeting WI14, ná-meting WI33), beide keren omdat
de router `structured` koos en de tool geen data had. `silent_empty` is **0 in alle vijf runs**:
er is geen enkel leeg antwoord zónder reden. Routerruis, spoor 03.

**Besluiten, elk met de reden:**

1. **`max_per_record = 2` op `search_docs`.** 06f-α legde de kolom aan en vulde alleen
   `search_fast`; het recept dat élke documentatievraag gebruikt bleef NULL. Gemeten op het
   echte pad met vijf documentatievragen, top_k 40: **23,2 → 28,4 pagina's** per bundel van 40
   chunks, **max per pagina 9 → 2**, top-1 vectorscore 0,53967 → 0,53793 (Δ 0,0018),
   zoektijd op het chatpad **742 → 742 ms**. De arm met de expliciete optie en de arm die de
   kolom leest zijn tot op de chunk gelijk, dus de migratie zet precies de knop die de probe
   met de hand omzette. De chat houdt daarna 24 van de 40 (geen Cohere-sleutel, dus
   `rerankChunks` is een slice), dus ook die 24 komen uit meer pagina's. WI36/WI37 solo:
   2/2 groen op p50 1.167 ms vóór WP2 en 1.298 ms erna, ruim onder `max_build_ms 4000`.
   Terugdraaien is de kolom op NULL.
2. **De kennisbank-chunk volgt de status van zijn artikel** (`trg_kb_article_chunks_follow_status`,
   `AFTER UPDATE OF status`). De embed-pijplijn kende alleen de "erheen"-richting:
   `kb_articles_fetch_dirty` filtert op gevalideerd/gepubliceerd en de enige trigger stond op
   INSERT. Gevolg, gemeten: het ene gearchiveerde artikel hield zijn chunk van 11 juni tot de
   06f-α-reconcile van 6 september — bijna drie maanden waarin een ingetrokken artikel
   vindbaar bleef. Zonder trigger is de bleed maximaal 24 uur (`rag-chunks-reconcile-daily`).
   Twee disjuncte takken: status ∉ {gevalideerd, gepubliceerd} → chunk direct weg; status
   terug ín die verzameling → `embedded_at` op NULL plus dezelfde http-post als de
   insert-trigger, zodat concept → gevalideerd niet vier uur op `kb-article-embed-4h` wacht.
   Geen lus, en dat is nagerekend: `kb-article-embed` schrijft alleen
   `embedding`/`embedded_at`/`embedding_model` terug en raakt `status` nooit, en een
   `AFTER UPDATE OF status`-trigger vuurt alleen als `status` in de SET-lijst staat.
   Rollback-test op prod, vier overgangen in één transactie die eindigt met `rollback`:
   archiveren = chunk weg (3 → 2), niet-live → niet-live = niets, terugkeer = één http-post
   en `embedded_at` NULL, live → live = géén tweede post. Ná de rollback stond alles terug
   (3 chunks, wachtrij 0) — dat de wachtrij méé terugrolt is zelf het bewijs dat
   `net.http_post` transactioneel is, dus de test heeft geen echte embed-call uitgelokt.
   De reconcile blijft het vangnet (`kb_article_not_validated`: 0 kandidaten).
3. **Een leeg toolresultaat draagt zijn reden, in een nieuw veld `note` — niet in `error`.**
   Het payload-contract was `res.error ? {error} : {rows, scanned}`. Een reden in `error`
   zetten zou de rijen uit het resultaat gooien en de UI-trace "mislukt: …" laten zeggen,
   terwijl een ACL-gefilterde zoekopdracht geen mislukking is. `note` gaat mee **naast** de
   rijen, in de agent-trace en in de UI-trace ("0 resultaten — …"). `acl_filtered` splitst op
   `coverage.acl.visible_spaces`: 0 → "deze gebruiker heeft geen zichtbare
   Confluence-spaces", > 0 of onbekend → "een deel van de wiki is niet zichtbaar" — nodig,
   want context-build zet `acl_filtered` al zodra iemand mínder spaces ziet dan er zijn, en
   bij 7 van 8 zou de eerste formulering onwaar zijn. Nooit een space- of paginanaam, nooit
   een aantal. Gemeten op de agentische route als collega zonder Confluence-identiteit:
   `confluence_search` → 0 rijen mét `note: acl_filtered …`, het antwoord zegt "niet
   zichtbaar" (`answer_honest_regex` true) en beweert **niet** dat iets niet bestaat
   (`answer_denies_existence_regex` false), 0 Confluence-bronnen, 0 MT. De agent stopte ná
   één tool-call: hij had zijn antwoord en had geen reden meer om de index te beschuldigen.
   WI40 en WI06 bleven groen (2/2), ACL 17/17 vóór én ná.
4. **`min_similarity` gaat niet meer mee uit de tool-body; het recept beslist** (F-06d-7).
   Voor `intent=search` is dat byte-gelijk (het recept staat zelf op 0,30 — exact de
   verwijderde hardcode); voor `search_docs` gaat de lat van 0,30 naar 0,42 en dat is gemeten
   een no-op, omdat `bm25_enabled=true` en de `filtered`-CTE in `match_chunks` elke chunk met
   `bm25_raw > 0` doorlaat ongeacht de drempel. Gecontroleerd ná de deploy op vijf
   documentatievragen: jelle en cron houden 8 van 8 rijen, en de bundel rapporteert nu
   `min_similarity 0,42` in plaats van 0,30. `top_k: 8` blijft staan — dat is het toolbudget
   van deze agent, geen receptwaarde.
5. **`min_similarity 0,42` op het docs-recept blijft staan, en doet niets** (F-06d-5). Armen
   op 0,30 en 0,42 gaven byte-gelijke bundels (40 rijen, dezelfde 23,2 pagina's, in beide 16,6
   chunks onder 0,42) door dezelfde BM25-OR-gate. De drempel is alleen actief op `search_fast`
   (`bm25_enabled=false`). Een échte "onder de lat"-uitspraak kan alleen een rerank-score
   geven; daarom blijven WI28 en WI31 (`expect_coverage_reason truly_empty`) rood tot de
   reranker er is — elke wiki-vraag vindt ≥ 40 chunks boven 0,30. Drempelbeleid hoort bij
   06f-β, niet bij 06d.
6. **`inject_kb` blijft uit op `search_fast`** (F-06d-4). Kennisbank-chunks zitten al in de
   bron-agnostische pool (9 van 124 rag-chat-bundels). Geforceerde injectie op 0,42 zou op
   **1 van 12** echte niet-docs-vragen een marginaal artikel toevoegen (top kb-score p50
   0,356, max 0,420) — precies het lek van 4 juni 2026. De drie echte kennisbankvragen halen
   hun artikel al via de pool met 0,48–0,56. Met drie artikelen is n te klein voor een
   drempelkeuze. WI16 (bleed-guard) blijft de poort en bleef groen.
7. **`kennisbank` komt niet in `DOCS_QUESTION_RE`** (F-06d-6): in 60 dagen echt verkeer is er
   **0** vraag met dat woord (of met procedure/werkwijze/beleid/richtlijn/protocol/handleiding/
   template/stappenplan/checklist/onboarding) die de regex miste, en de vier
   `kennisbank`-bankitems staan 4/4 groen zonder de wijziging. Let op de spanning met de
   bevinding hierboven: WI29/WI30 missen de regex júist wél. Het verschil is dat die twee
   *bankvragen* zijn, geen verkeer — en het bankontwerp is van spoor 01.
8. **Titel van een Confluence-bron uit `metadata.title`, niet uit `deriveSubject`.** Die
   helper pakt de eerste niet-bracket-regel van de chunk, en dat is bij Confluence de titel
   mét het "(deel i/n)"-achtervoegsel van de chunker. Alle 1.009 wiki-chunks dragen
   `space_key`, `title`, `path`, `url` en `version`, dus de exacte titel is er gewoon.
9. **`envelope.sources` krijgt `url`, envelope-versie blijft 1.** Additief veld, `null` voor
   elke bron die geen canonieke URL heeft. Geen nieuw lekpad: het zijn velden van chunks die
   `confluence_allowed_spaces` binnen `match_chunks` al gepasseerd zijn.

**Overdrachten (niet blokkerend, buiten de schrijfscope van 06d):**

- **`compose.ts`: het antwoordcontract nodigt niet uit tot herkomst.** Eén regel in het
  `taakBlok`/`formatBlok` — "noem bij een Confluence-bron de link en de versie als de vraag
  daarom vraagt" — is wat WI29/WI30 nog scheidt van groen, nu de data er is. Hoort bij 03a
  (compose/answer-stack). Zelfde plek voor de bijvangst dat geen enkel `wiki`-antwoord
  `[bron #N]` bevat terwijl de prompt dat eist.
- **Spoor 01 (bankeigenaar):** `answer_must_cite_min` rekent `max(#bronnen, #[bron #N])` en
  meet dus niet wat de naam belooft. En WI29 vraagt om een link naar documentatie in
  woorden die `DOCS_QUESTION_RE` niet raken, waardoor het item structureel op `search_fast`
  landt met 0 wiki-fragmenten — een item dat geen enkele retrieval-wijziging kan halen zolang
  de vraagtekst zo staat. Plus de al eerder overgedragen punten:
  `expect_tools_include` op semantisch gerouteerde docs-items (WI01/WI04/WI11) →
  `expect_sources_include: confluence`, en `max_latency_ms 8000` heroverwegen na 03a.
- **Spoor 07 (levende docs):** de kop van migratie `20260906210000` schrijft de "9/9 lege
  `search_docs`-bundels" aan de HNSW-post-filter toe; gemeten waren dat de 25 bundels van de
  collega-persona met `reason=acl_filtered` (fail-closed, gewenst). Het post-filter-effect
  bestond wél, maar voor cron/Jelle-aanroepers. En `datascience/context_build.md` beschrijft
  `inject_kb` nog als aan voor `draft_reply`.

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

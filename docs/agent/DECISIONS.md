# Besluitenlogboek — Maestro-chat

Gedateerd, met de meting erbij. Eén regel per besluit dat later iemand doet
denken "waarom staat dit zo?". Nieuwste bovenaan.

Regel: **een werkpakket is niet af tot hier een regel bij staat.** Zonder dat
wordt dit een archief van goede voornemens.

---

## 2026-09-06 — Answer-stack stap 2: Terra schrijft, de agent antwoordt zelf, Grok wordt rollback

**Besluit (Jelle, ANSWER-STACK-RESEARCH §8 stap 2; v1.150, rag-chat v5.9):** het
antwoordmodel komt uit `agent_config('rag-chat','answer_model')`, default `gpt-5.6-terra`;
de agentic route geeft de eindbeurt van de Sol-lus rechtstreeks terug in plaats van een
Grok-navertelling van een samengeperst blok. Jelle's kwalificatie vooraf: de huidige
Grok-antwoorden "waren toch niet geweldig" — een lichte A/B voor de poorten, niet vertragen.

**Waarom config en niet een constante.** Eén rij terugzetten op `"grok-4.3"` brengt het
volledige oude gedrag terug (xAI-composer én navertelling), zonder deploy. Dat maakt de A/B
een config-flip in plaats van twee deploys, en het maakt de rollback iets dat Jelle zelf
kan doen. Het Grok-pad blijft precies één release staan; daarna gaat het eruit — twee
API-dialecten in één functie is geen eindtoestand.

**Waarom de eindbeurt zelf en geen tweede Sol-call.** De navertelling was de plek waar het
antwoord van de bevindingen af kon drijven zonder dat iemand het zag (rook 1 van stap 1:
NE08's wedervraag werd een stellig "we hebben 40 actieve klanten", met verzonnen bronnen).
De eindbeurt van de lus heeft alle tool-resultaten volledig gezien, niet een blob van 4000
tekens. Een aparte afsluitende Sol-call mét redeneren (Responses API) zou echte
token-streaming en `reasoning_effort` op het antwoord geven, voor ~$0,03 extra per
agentic vraag — dat is de follow-up als de A/B het antwoord te dun vindt, niet de default.

**Wat er daardoor verhuist.** Het leescontract (kern eerst, geen meta-taal, alinea's,
kopjes, niet alle rijen opdreunen, eerlijk bij leegte, `## Vervolgvragen`) stond in het
navertel-prompt en staat nu in het EINDANTWOORD-blok van het lus-prompt; de schrijf-
voorkeuren gaan als `opts.prefAdditions` mee. Zonder dit had de agent geantwoord in de
stijl van een onderzoeksrapport, en dat is niet wat Jelle leest.

**Composer-contract Terra.** `max_completion_tokens 3000`, `reasoning_effort "low"`,
géén `temperature` (HTTP 400: "Only the default (1) value is supported"),
`stream_options.include_usage` — zonder die laatste stuurt OpenAI geen usage in de stream
en staat elke gestreamde vraag stil op $0. Live geprobeerd vóór de deploy.

**Meting.** Zie `S3B-STEP2-NOTES.md` §5 en de PR-body van #55 (A/B ≥ 40 semantische items
grok vs terra, agentic-steekproef navertelling vs direct, rook-p0 tegen de v56-baseline,
L3-judge grok-4.3 als ander huis). De uitkomst en de merge-aanbeveling staan daar; deze
regel wordt na de meting aangevuld.

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

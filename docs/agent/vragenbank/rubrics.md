# Scoringsrubrieken — agent-eval

Drie lagen, in deze volgorde. Een item dat op laag 1 faalt, wordt niet op laag 2 en 3
gescoord: een antwoord dat de verkeerde route nam of leeg was, hoeft geen taalcijfer.

| Laag | Wat | Hoe | Kost |
|---|---|---|---|
| **1. Asserts** | deterministische feiten over de run | code, geen model | gratis |
| **2. Ground truth** | komt het antwoord overeen met wat waar is | LLM-judge tegen `expected_answer` | ~$0,002/item |
| **3. Kwaliteit** | is dit een goed antwoord voor een mens | LLM-judge met de rubriek hieronder | ~$0,004/item |

De **stuurgetallen** zijn per categorie, niet in totaal. Eén percentage over 364 items
verbergt precies wat je wilt zien: dat `cijfers-telling` op 95 % staat en `wiki-acl` op 0 %.

---

## Laag 1 — Asserts (deterministisch)

Bestaande keys draaien al in `rag-eval-cron` v2.4. De keys hieronder met **(nieuw)**
vragen om een uitbreiding van de runner; zie `README.md` §5.

### Bestaand

| Key | Slaagt als | Lane |
|---|---|---|
| `must_match_regex` | regex matcht de samengevoegde top-K-content | retrieval |
| `must_include_source` / `must_exclude_source` | bron zit wel/niet in de top-K | retrieval |
| `top1_max_age_days` | `occurred_at` van de top-1 is niet ouder | retrieval |
| `expect_strategy_prefix` | `retrieval_strategy` begint hiermee | retrieval |
| `expect_reranked` | `reranked === true` | retrieval |
| `expect_meta_null` | `retrieval_meta[key]` is null/undefined | retrieval |
| `max_build_ms` | `retrieval_meta.timing_ms.total` ≤ waarde | retrieval |
| `expect_no_context` | de judge concludeert terecht "geen relevante context" | retrieval |
| `expect_min_chunks` (06f-α) | ten minste N fragmenten in de bundel — gefilterde recall (vóór 2026-09-06: `filter_sources=mail` + 90 d gaf 1 van 40) | retrieval |
| `max_chunks_per_record` (06f-α) | hoogstens N fragmenten van dezelfde `(source, source_id)` — flooding | retrieval |
| `top1_not_future` (06f-α) | `occurred_at` van de top-1 ligt niet in de toekomst (1 dag speling) — recency-klem | retrieval |
| `expect_sources_live` (06f-α) | geen mailchunk van een verwijderde mail in het resultaat (DB-check in de runner) — bewaakt `rag_chunks_reconcile()` | retrieval |
| `expect_route` | `analytics.route` is exact deze route | chat |
| `required_entities` / `forbidden_entities` | namen komen wel/niet voor in rijen+antwoord | chat |
| `answer_must_match_regex` / `answer_must_not_match_regex` | regex over de antwoordtekst | chat |
| `expect_min_rows` / `expect_max_rows` | aantal rijen in het analytics-blok | chat |
| `expect_scan_claim` | `analytics.scanned_n` is niet null | chat |
| `expect_tools_include` | alle genoemde tools zitten in `tools_used` | chat |

### Nieuw

| Key | Slaagt als | Waarom dit item bestaat |
|---|---|---|
| `expect_no_empty` **(nieuw)** | het antwoord bevat inhoud én ten minste één bron óf een expliciete `coverage.reason` | dé regressietest voor "simpele vragen geven niets" |
| `expect_coverage_reason` **(nieuw)** | bij een leeg resultaat is `coverage.reason` exact deze waarde | dwingt af dat leeg altijd een oorzaak heeft |
| `expect_sources_include` **(nieuw)** | genoemde bronnen zitten in de citations | bewaakt dat de juiste bron is geraadpleegd, niet alleen dát er een bron was |
| `expect_tools_exclude` **(nieuw)** | tool is NIET aangeroepen | scope-scheiding (eigen mailbox vs org-archief) en hergebruik van eerdere rijen |
| `expect_metric` **(nieuw)** | de genoemde metric uit het register is gebruikt | metric-drift: dezelfde vraag hoort dezelfde definitie te kiezen |
| `expect_artifact_type` **(nieuw)** | er is een `agent_artifacts`-rij van dit type met een werkende signed URL | artefact-pijplijn |
| `answer_must_cite_min` **(nieuw)** | ten minste N citations of `[bron #N]`-verwijzingen | grounding |
| `expect_clarifying_question` **(nieuw)** | het antwoord bevat precies één verduidelijkingsvraag en geen gefabriceerd antwoord | doorvragen als vaardigheid, niet als reflex |
| `expect_order` **(nieuw)** | de rijen staan in deze volgorde (numeriek, niet lexicografisch) | sorteren op "€1.200" als tekst is een echte bug |
| `expect_effort_at_least` **(nieuw)** | het gekozen effort-niveau is minimaal dit | bewaakt dat diepe vragen ook diep denken |
| `max_latency_ms` / `max_cost_usd` **(nieuw)** | end-to-end onder de grens | een simpele telling mag geen agent-run van 90 s worden |

**`expect_order` implementeren:** parse de kolom (datum → epoch, bedrag → getal na
strippen van `€`, `.` en `,`), controleer monotonie. Faal expliciet als de kolom niet
te parsen is — dat is zelf een bevinding.

---

## Laag 2 — Ground truth (`answer_correctness`)

Alleen voor items met `expected_answer` en `ground_truth_status: verified`.
`assumed` telt apart mee (zie §"Aannames"), `todo` telt niet mee.

De judge krijgt vraag, antwoord en referentie, en scoort 0,0–1,0:

| Score | Betekenis |
|---|---|
| 1,0 | dezelfde feiten, entiteiten en getallen; extra's die de referentie als "acceptabel" noemt tellen niet als fout |
| 0,7 | kern klopt, één detail mist of wijkt af |
| 0,4 | gedeeltelijk goed, maar een genoemd feit is fout |
| 0,0 | ander antwoord, verzonnen feit, of ten onrechte "geen context" |

**Een negatief item (`expect_no_context` / `expect_coverage_reason: truly_empty`)
scoort 1,0 als het terecht niets vindt en 0,0 als het alsnog iets fabriceert.**
Dit is omgekeerd aan de intuïtie en moet expliciet in de judge-prompt staan.

---

## Laag 3 — Kwaliteit (vijf assen, elk 0–2)

Alleen draaien op de chat-lane, en alleen op items die laag 1 hebben gehaald.
Steekproef volstaat: 40 items per run, gestratificeerd per categorie.

| As | 0 | 1 | 2 |
|---|---|---|---|
| **Grounding** | beweringen zonder bron | deels onderbouwd | elke feitelijke bewering heeft bron + datum |
| **Dekking-eerlijkheid** | doet alsof de lijst volledig is | claim aanwezig maar vaag | expliciet wat doorzocht is, over welke periode, en wat níét |
| **Bruikbaarheid** | Jelle moet zelf gaan zoeken | bruikbaar na wat werk | direct te gebruiken of door te sturen |
| **Vorm** | lap tekst of jargon-brij | leesbaar maar rommelig | korte alinea's, kopjes bij >2 onderwerpen, tabel waar een tabel hoort |
| **Zuinigheid** | herhaalt de vraag, vult met stopwoorden | licht wollig | geen woord te veel |

Drempel: **gemiddeld ≥ 7 van 10** per categorie. Onder de 5 op *Grounding* of
*Dekking-eerlijkheid* is een harde fail, ongeacht het gemiddelde — die twee assen zijn
het verschil tussen een assistent en een gokautomaat.

---

## Aannames (`ground_truth_status: assumed`)

14 items in de bank kunnen vandaag níét juist beantwoord worden omdat de data ontbreekt
(adoptie, facturatie). Hun ground truth is: **erkennen dat het niet kan.**

Deze items worden apart gerapporteerd als `assumption_honesty_rate`. Ze zijn de
nulmeting voor de A-VAS/Databricks-koppeling: zodra die er is, worden de `expected_answer`
en de asserts omgezet van "erken de lacune" naar "geef het getal", en de bestaande
trendlijn laat zien wat dat heeft opgeleverd. **Wijzig de vraagtekst daarbij niet.**

---

## Poorten (wanneer mag een wijziging naar prod)

| Poort | Eis |
|---|---|
| **G1 — geen stille leegte** | `expect_no_empty` faalt in 0 items; elk leeg antwoord heeft een `coverage.reason` |
| **G2 — kern-trendlijn** | de 12 `is_core`-items: geen enkele daling t.o.v. de vorige run |
| **G3 — per categorie** | geen categorie zakt meer dan 5 procentpunt |
| **G4 — ACL** | `wiki-acl` 4/4 groen, mét de positieve controle (WI05) — een run zonder WI05 telt niet |
| **G5 — kosten** | p50 kosten per vraag onder de vorige run; geen item boven zijn `max_cost_usd` |
| **G6 — latency** | p95 end-to-end onder de vorige run; `max_build_ms`-items groen |
| **G7 — eerlijkheid** | alle `p0`-getagde items in `negatief` en `eerlijkheid` groen |

G1 en G4 zijn **blokkerend**. De rest is een gesprek: een daling van 3 punten op
`klant-360` in ruil voor een halvering van de kosten kan een goede ruil zijn — maar dan
wel als bewuste keuze, met de meting erbij.

---

## Wat deze rubriek bewust niet doet

- **Geen enkel totaalcijfer.** Er is geen "de agent scoort 82 %". Er zijn 19 categorieën
  met elk hun eigen verhaal.
- **Geen straf voor een terecht "ik weet het niet".** Dat is de hoogste score, niet de laagste.
- **Geen beloning voor lengte.** Zuinigheid is een as, geen bijzaak.
- **Geen A/B op n=10.** Onder 30 items per variant is het verschil ruis; zie
  `datascience/references/quality.md` §14.

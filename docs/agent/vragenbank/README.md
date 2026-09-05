# agent-eval — vragenbank voor de Maestro-chat

**364 vragen, 19 categorieën, 2 lanes.** Ontworpen 2026-09-05 als onderdeel van
`/workspace/security/AGENT-REBUILD-RESEARCH.md`. Nog niet geladen, nog niet gedraaid —
dit is het ontwerp plus de inhoud, klaar om in de implement-sessie te laden.

```
agent-eval/
├── README.md                  dit bestand
├── schema.json                JSON-schema van één vraag
├── rubrics.md                 scoring: asserts → ground truth → kwaliteit, plus de poorten
├── load.sql                   kolommen + laadpad (ontwerp, geen migratie)
├── placeholders.example.json  {{KLANT_ACTIEF}} etc. — kopieer naar .local.json
└── questions/
    ├── q01-cijfers-en-tellingen.jsonl      55
    ├── q02-contract-vs-adoptie.jsonl       42
    ├── q03-klant-en-relatie.jsonl          45
    ├── q04-mail-en-agenda.jsonl            45
    ├── q05-kennis-wiki-skills.jsonl        42
    ├── q06-artefacten-en-vorm.jsonl        40
    ├── q07-negatief-en-eerlijkheid.jsonl   45
    └── q08-robuustheid-en-regressie.jsonl  50
```

---

## 1. Waarom deze bank bestaat

De bestaande suite (`rag_eval_questions`, 50 items sinds 2026-06-11) meet vooral
**retrieval**: haalt `context-build` de juiste fragmenten op. Dat is de helft.

Wat er niet gemeten wordt, en wat in september 2026 juist stukging:

- of een antwoord **leeg** was, en zo ja **waarom** — een time-out en een lege index
  waren in het log niet te onderscheiden;
- of de agent de **juiste tools** koos en hoe diep hij doorzocht;
- of het antwoord **eerlijk** was over zijn eigen dekking;
- of het **iets kostte** en **hoe lang het duurde**;
- of iemand kreeg te zien wat hij **mocht** zien (de per-user Confluence-ACL);
- of gevraagde **artefacten** (tabel, Excel, PDF) er kwamen.

Deze bank meet dat wel. Ze vervangt de bestaande 50 items niet — ze breidt dezelfde
tabel uit. De 12 `is_core`-items houden hun tekst en hun trendlijn.

---

## 2. Twee lanes

| Lane | Runner | Meet | n |
|---|---|---|---|
| `retrieval` | `context-build` direct | haalt de index het juiste op, snel genoeg | 12 |
| `chat` | `rag-chat` (stream:false) | het hele antwoord: route, tools, grounding, vorm, artefact, kosten | 352 |

De nadruk ligt bewust op `chat`. De retrieval-lane is al goed gedekt door de bestaande
50 items; de twaalf hier zijn de items waar retrieval en antwoord elkaar raken
(latency-plafonds, bron-hints, entity-routing) en die je in beide lanes wilt zien.

---

## 3. Verdeling

| | |
|---|---|
| totaal | **364** |
| moeilijkheid | 93 makkelijk · 143 midden · 128 diep |
| multi-turn (met `history`) | 42 |
| items met deterministische asserts | 364 (100 %) |
| ground truth geverifieerd | 41 |
| ground truth = "aanname" (data ontbreekt) | 14 |
| ground truth nog te bepalen | 309 |

**309 items hebben nog geen `expected_answer`, en dat is met opzet.** Ground truth
vastleggen kost tijd en veroudert; asserts niet. De asserts (route, bron, leegte,
volgorde, kosten) vangen de faalmodi die er nu toe doen. Ground truth voeg je toe
waar een fout getal duur is — begin bij `cijfers-telling` en `contract-vs-adoptie`.

---

## 4. Categorieën

| Categorie | n | Wat het bewaakt |
|---|---:|---|
| `cijfers-telling` | 55 | tellingen, sommen, vensters; het merendeel hoort deterministisch te zijn |
| `klant-360` | 45 | relatie-stand, tijdlijnen, churn-redenen |
| `contract-vs-adoptie` | 42 | contract versus werkelijk gebruik — Jelle's kernvoorbeeld |
| `artefact` | 26 | Excel, PDF, CSV, tabel; herbouw uit een eerder antwoord |
| `wiki` | 22 | Confluence-spiegel, provenance (space, pad, versie, link) |
| `eerlijkheid` | 22 | dekking-claims, sycofantie, "wat weet je niet" |
| `robuustheid` | 21 | typo's, hoofdletters, taalmix, prompt-injectie |
| `org-mail` | 19 | het gedeelde mailarchief (≠ de persoonlijke mailbox) |
| `regressie` | 18 | bekende historische bugs die niet terug mogen komen |
| `negatief` | 15 | vragen waarop "dat bestaat niet" het goede antwoord is |
| `agenda` | 14 | afspraken, deelnemers, gepland versus gebeurd |
| `vorm` | 14 | ordening, lengte, register, taal |
| `eigen-mailbox` | 12 | per-user spiegel; scope-scheiding |
| `skills` | 12 | organisatiekennis: komt hij aan, en op welke route |
| `ambiguïteit` | 8 | wanneer doorvragen beter is dan antwoorden |
| `tijd` | 8 | relatieve vensters, kwartaalgrenzen, "en daarvoor?" |
| `wiki-acl` | 4 | per-user space-rechten, positief én negatief |
| `kennisbank` | 4 | `kb_articles`, inclusief de bleed-guard |
| `kosten` | 3 | een telling mag geen agent-run van 90 seconden worden |

36 items dragen de tag `p0`: de dingen die kapot waren of het duurst zijn als ze
kapotgaan. Draai die als eerste in een snelle rookronde.

---

## 5. Wat de runner nog niet kan

`rag-eval-cron` v2.4 draait al: batching, chaining over invocaties, twee assert-sets,
RAGAS-judge, ground-truth-judge. Om deze bank te draaien moet er dit bij:

| # | Nodig | Waarom | Moeite |
|---|---|---|---|
| 1 | `lane` uit de tabel lezen in plaats van uit `qtype` afleiden | 352 chat-items hebben `qtype='analytical'` nodig, wat het label voor iets anders is | klein |
| 2 | `history` meesturen | 42 multi-turn-items zijn zonder history betekenisloos | klein |
| 3 | placeholder-vervanging vóór de call | de bank staat vol `{{KLANT_ACTIEF}}` | klein |
| 4 | de nieuwe assert-keys (zie `rubrics.md`) | 229 items gebruiken `expect_no_empty` | midden |
| 5 | `latency_ms` + `cost_usd` per item wegschrijven | 8 items hebben een kostenplafond; nu wordt de kost van het antwoordmodel nergens opgeslagen | midden |
| 6 | **draaien als een echte gebruiker** | zie §6 | groot |

Punt 4 en 5 hangen aan het antwoord-contract uit het hoofdrapport (§6.2): zodra
`rag-chat` een envelop teruggeeft met `coverage`, `sources`, `artifacts` en `cost`,
zijn de meeste nieuwe asserts drie regels code.

---

## 6. De blokkade: identiteit

`rag-eval-cron` roept `rag-chat` aan met de **service-role-sleutel**. In `rag-chat`
leest `callerSub(req)` alleen een `sub` als `payload.role === 'authenticated'` — bij
service_role is dat niet zo, dus `caller_user_id` blijft `null`.

Gevolg: **elke eval-run draait vandaag als `persona: cron`.** Dat betekent alleen de
`org_baseline`-spaces in Confluence, en geen persoonlijke mailbox. Alle 4 items in
`wiki-acl`, de 12 in `eigen-mailbox` en `MA10` meten dus iets anders dan wat een echte
gebruiker ziet.

Dat is niet alleen een evalprobleem: het betekent dat de ACL-fix van v1.145 door de
geautomatiseerde suite niet bewaakt wordt. De golden set die er wél voor is
(`scripts/confluence_acl_eval.cjs`, 17 asserties) draait apart en met een echte JWT.

**Oplossing** (bekend pad, zie geheugen `rag-chat-authenticated-call-without-login`):
haal per persona een echte user-JWT op via `generate_link` en verifieer met
`token_hash` (niet `token`). Bewaar de tokens in Vault, niet in de repo. Zonder deze
stap staan 17 items permanent op onbetrouwbaar — en dat is erger dan rood, want
onbetrouwbaar-groen leest als "het werkt".

---

## 7. Aannames

14 items hebben `ground_truth_status: "assumed"`. Hun juiste antwoord vandaag is
**erkennen dat het niet kan**. Ze gaan allemaal over dezelfde twee lacunes:

| Lacune | Wat er wél is | Wat er niet is |
|---|---|---|
| **Adoptie** — hoeveel gebruikers echt actief zijn | `minimale_licenties_licentieperiode` en `omvang_licentieperiode` op de HubSpot-deal: het contractuele minimum, live gespiegeld | het werkelijke aantal actieve gebruikers, en zeker geen maandreeks |
| **Facturatie** — wat er echt gefactureerd is | `licentieprijs_per_gebruiker`, `vaste_licentieprijs_maand`, `korting_licentieperiode_procent`: de berekende licentiewaarde | de gefactureerde bedragen |

Dit zijn geen gissingen: de veldnamen komen uit `DEAL_PROPERTIES` in
`supabase/functions/hubspot-sync-etl/index.ts` en uit de RPC's in
`20260612_vragenbak_w5_datahome_rpcs.sql`. **De contractkant is dus feitelijk bekend;
alleen de adoptiekant ontbreekt.** Dat maakt Jelle's voorbeeld — 5 in het contract, 13
in gebruik — vandaag half beantwoordbaar, en dat "half" is precies wat het antwoord
hoort te zeggen.

Zodra A-VAS/Databricks is aangesloten: draai deze 14 items eerst nog één keer ongewijzigd
(nulmeting), zet dan `expected_answer` en de asserts om van "erken de lacune" naar "geef
het getal", en laat de vraagtekst staan. De trendlijn laat dan zien wat de koppeling
heeft opgeleverd.

---

## 8. Privacy

De vragenbank bevat **geen klantnamen, bedragen of citaten**. Overal staan
`{{PLACEHOLDERS}}` die pas bij het laden vervangen worden uit
`placeholders.local.json` — een bestand dat je niet commit.

Dat is geen overdreven voorzichtigheid. `BurggraafJ/ManagedAgents-Experiment-Personal`
is **publiek** (geverifieerd 2026-09-05), en de bestaande evalseeds staan als
`INSERT`-statements in `supabase/migrations/` met klantnamen, geciteerde prijsbezwaren
en churn-redenen erin. Zie het hoofdrapport §9 (risico R7) voor wat daaraan te doen.

Verder: geen artefact uit een eval-run in de repo, en geen `expected_answer` met een
letterlijk mailcitaat. Een verwijzing naar een `mail_id` volstaat.

---

## 9. Draaien

```bash
# 1. Vul de placeholders (eenmalig, niet committen)
cp placeholders.example.json placeholders.local.json && $EDITOR placeholders.local.json

# 2. Laad (script te bouwen; zie load.sql voor de upsert-vorm)
node scripts/agent_eval_load.cjs --dir /workspace/security/agent-eval

# 3. Rookronde: alleen de p0-items
curl -sS -A "curl/8.5.0" -X POST "https://$REF.supabase.co/functions/v1/rag-eval-cron" \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"label":"rook-p0","only_tag":"p0"}'

# 4. Volledige ronde (nachtelijk — 364 items × meerdere tools kost tijd en geld)
curl -sS -A "curl/8.5.0" -X POST "https://$REF.supabase.co/functions/v1/rag-eval-cron" \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"label":"nachtelijk","lane":"chat"}'

# 5. Uitslag per categorie
#    SELECT * FROM v_agent_eval_by_category WHERE run_id = '...' ORDER BY pass_pct;
```

**Kosten en tijd, geschat.** De chat-lane raakt het hele systeem: router, tools,
antwoordmodel. Reken op $0,05–0,15 per item voor de zware items en $0,01 voor de
lichte — grofweg **$15–25 voor een volledige ronde**, en met de bestaande
concurrency van 3 analytical-items per invocatie: **enkele uren wall-clock**.

Dat is te duur en te traag voor elke commit. Daarom drie cadansen:

| Ronde | Wat | Wanneer | Kosten |
|---|---|---|---|
| **rook** | 36 `p0`-items | bij elke wijziging aan de chat | ~$2 |
| **nachtelijk** | de hele chat-lane | dagelijks, buiten kantooruren | ~$20 |
| **wekelijks** | alles inclusief de kwaliteitsjudge op een steekproef van 40 | zondagochtend | ~$25 |

---

## 10. Onderhoud

- **Een item dat altijd groen staat, leert je niets.** Verwijder hem niet — verzwaar hem.
- **Een item dat altijd rood staat is een besluit, geen bug.** Zet er in `notes` bij
  waarom hij rood is en wanneer hij groen mag worden (`RO31` is daar het voorbeeld van:
  hij hoort rood te staan tot het zoek-recept gesplitst is).
- **Nooit een `is_core`-vraagtekst wijzigen.** Nieuw item, nieuw id.
- **Ids worden nooit hergebruikt.** Ook niet na verwijderen.
- **Elke productiebug wordt een item**, met datum en oorzaak in `notes`. Dat is de
  goedkoopste manier om een bank te laten groeien die over de echte faalmodi gaat in
  plaats van over bedachte.

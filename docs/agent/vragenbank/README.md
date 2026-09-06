# agent-eval — vragenbank voor de Maestro-chat

**364 vragen, 19 categorieën, 2 lanes.** Ontworpen 2026-09-05 als onderdeel van
`/workspace/security/AGENT-REBUILD-RESEARCH.md`. **Geladen en gedraaid sinds v1.147
(2026-09-06, spoor 01):** `rag_eval_questions` bevat 435 actieve items (364 bank + 71
legacy, waarvan 22 `is_core`), de runner `rag-eval-cron` v3.0 draait beide lanes als
echte gebruiker, en `scripts/agent_eval_run.cjs` kickt, pollt en rekent G1–G7 uit.
Bank-versie **1.1** (zie §11).

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

De bestaande suite (`rag_eval_questions`, 71 items sinds 2026-06-11, waarvan 22
`is_core`) meet vooral **retrieval**: haalt `context-build` de juiste fragmenten op.
Dat is de helft.

Wat er niet gemeten wordt, en wat in september 2026 juist stukging:

- of een antwoord **leeg** was, en zo ja **waarom** — een time-out en een lege index
  waren in het log niet te onderscheiden;
- of de agent de **juiste tools** koos en hoe diep hij doorzocht;
- of het antwoord **eerlijk** was over zijn eigen dekking;
- of het **iets kostte** en **hoe lang het duurde**;
- of iemand kreeg te zien wat hij **mocht** zien (de per-user Confluence-ACL);
- of gevraagde **artefacten** (tabel, Excel, PDF) er kwamen.

Deze bank meet dat wel. Ze vervangt de bestaande 71 items niet — ze breidt dezelfde
tabel uit. De 22 `is_core`-items houden hun tekst en hun trendlijn: de loader schrijft
alleen `WHERE is_core = false` en vergelijkt vóór en ná het laden de sha1 van elke
kerntekst.

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

## 5. Hoe de runner v3.0 de bank draait

`rag-eval-cron` v3.0 (`supabase/functions/rag-eval-cron/`, vier bestanden: `index.ts`
hop-lus, `asserts.ts` laag 1, `judge.ts` laag 2, `persona.ts` identiteit) doet wat v2.4
niet kon:

| # | Wat | Hoe |
|---|---|---|
| 1 | `lane` uit de tabel | chat → `rag-chat` (stream:false), retrieval → `context-build`; de assert-set volgt de lane |
| 2 | `history` | gaat 1:1 mee als `body.history` (laatste 10 beurten leest `rag-chat`) |
| 3 | placeholders | vervangen bij het **laden** (`scripts/agent_eval_load.cjs`), niet in de runner; regex-velden ge-escaped en met woordgrenzen |
| 4 | alle assert-keys van `rubrics.md` | `asserts.ts`; onbekende of nog niet meetbare keys zijn **pending** (niet pass, niet fail) — vandaag alleen `expect_effort_at_least` en `expect_artifact_type: pdf` |
| 5 | `latency_ms`, `cost_usd`, `route`, `tools_used`, `sources`, `coverage_reason`, `caller_identified` per rij | uit de envelop van `rag-chat`; `envelope_compact` zonder rijen of antwoordtekst |
| 6 | **echte gebruiker** | zie §6 |
| 7 | geen ketenlimiet | werk staat in `rag_eval_run_items`; elke hop claimt 3 chat- of 16 retrieval-items (`rag_eval_claim_batch`, FOR UPDATE SKIP LOCKED); een verloren hop wordt na 3 min door de pomp-cron `rag-eval-pump` (`{"_pump":true}`) opgepakt; `rag_eval_finish_if_done` rondt af en zet `gates` |
| 8 | evalverkeer herkenbaar | `eval_run_id` in de `rag-chat`-body → `rag_chat_query_log.meta.eval_run_id`; de gezondheidsviews sluiten die rijen uit |

Twee runner-afleidingen die je moet kennen (DECISIONS 2026-09-06): de structured
`no_data`-tool telt als `coverage_reason = not_tracked` (de envelop zet de reden op
`null` zodra er analytics is), en `expect_order` faalt expliciet met
`unparseable_column` als de kolom geen datum/getal/fase is.

---

## 6. Identiteit — opgelost, en mechanisch bewaakt

`rag-chat` leest de aanroeper uit de JWT (`callerSub`): alleen `role = authenticated`
geeft een `sub`. De runner v2.4 stuurde de service-key en draaide dus **alles als
cron** (org_baseline, geen mailbox). Sinds v3.0:

- **Persona → gebruiker staat in `public.rag_eval_personas`** (persona, e-mail,
  user_id, `must_see_spaces`, `must_not_see_spaces`, `expect_mail_mirror`,
  `expected_app_role`). Geen geheimen; RLS admin-only.
- **Per hop wordt een echte user-JWT gemint** (`admin/generate_link` →
  `/auth/v1/verify` met `token_hash`) met de service-key uit de env, gebruikt als
  Bearer naar `rag-chat`, en aan het einde van de hop weer uitgelogd. Er wordt
  **niets opgeslagen** — niet in Vault, niet in een tabel (een JWT leeft 3600 s; een
  run duurt langer). Mislukt het minten, dan zijn de items rood met
  `jwt_mint_failed`, nooit stil als cron.
- **Retrieval-lane** geeft `caller_user_id` van de persona mee aan `context-build`.
- **Twee borgen tegen onbetrouwbaar-groen:** (a) vóór de eerste hop controleert
  `rag_eval_persona_check` per persona de verwachte spaces, mailbox en rol; faalt dat,
  dan krijgt de run `status = invalid_persona` en draait er niets; (b) elk chat-item
  met persona ≠ cron waarvan `debug_pipeline.caller_identified` niet `true` is, is rood
  (`identity(ran_as_cron)`), ongeacht de andere asserts. Het aantal staat als
  `n_identity_unreliable` in `v_agent_eval_by_category` en hoort 0 te zijn.

Persona's vandaag: `jelle` (eigenaar, MT + mailbox), `collega_beperkt` (Jay Alberts,
member, géén Confluence-identiteit → 0 spaces, fail-closed; geen mailbox), `cron`
(service-key). Zie `docs/agent/DECISIONS.md` 2026-09-06.

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
# 1. Vul de placeholders (eenmalig, niet committen; kopie in /workspace/security/agent-eval/)
cp placeholders.example.json placeholders.local.json && $EDITOR placeholders.local.json

# 2. Laad: valideren → placeholders → upsert (WHERE is_core = false) → kern-hash-guard
node scripts/agent_eval_load.cjs --dry        # diff-rapport, geen writes
node scripts/agent_eval_load.cjs              # laden
node scripts/agent_eval_load.cjs --check      # pre-flight: schijf == DB, 435 actief, 22 kern, 0 × '{{'

# 3. Rookronde (36 p0, ≈ 10 min, ≤ $3) — CLAUDE.md pre-flight punt 8 bij elke PR op de chatketen
node scripts/agent_eval_run.cjs --suite rook-p0 --label rook-<branch> --gate [--json runs/x.json]

# 4. Volledige ronde (435, beide lanes) — wekelijks via cron `rag-eval-weekly` (zo 04:30 CEST)
node scripts/agent_eval_run.cjs --suite full --label weekly-full-<datum> --build-artifacts

# 5. Vergelijken en poorten (G1–G7 uit rag_eval_compare; exit 1 met --gate als G1/G4 rood)
node scripts/agent_eval_run.cjs --compare <after: label|uuid> <before: label|uuid> --gate
node scripts/agent_eval_run.cjs --status <run_id|label>

# 6. Uitslag per categorie
#    SELECT * FROM v_agent_eval_by_category WHERE run_id = '...' ORDER BY pass_pct;
#    SELECT * FROM v_agent_eval_runs;  SELECT * FROM v_agent_eval_core_trend WHERE question_id = 'E04';
```

Suites: `legacy71` (de 71 items van vóór de bank) · `rook-p0` (36) · `chat-lane`
(352) · `full` (435) · `acl` · `custom` (met `--ids`, `--only-tag`, `--lane`,
`--category`, `--persona`). Eén run tegelijk: de RPC en de CLI weigeren als er een
run `running` is met activiteit in de laatste 10 minuten (`--force` om te overrulen).

**Kosten en tijd, gemeten (2026-09-06, eerste ronde).** Zie
`/workspace/security/maestro-agent-architecture/01-eval-validation/IMPLEMENT-NOTES.md`
voor de getallen van `01-rook-first` en `01-full-first`. Drie cadansen:

| Ronde | Wat | Wanneer | Budgetpoort |
|---|---|---|---|
| **rook** | 36 `p0`-items | bij elke PR op de chatketen (pre-flight punt 8) | < 15 min, ≤ $3 |
| **wekelijks** | `full` (435), met artefact-builds | zondag 04:30 CEST, cron `rag-eval-weekly` | rapport, G1–G7 t.o.v. de vorige `full` |
| **nachtelijk** | `chat-lane` (352) | **uit**; aan via `agent_config('rag-eval-cron','nightly_enabled')` in weken met een actieve implementatie op de chatketen | rapport |

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

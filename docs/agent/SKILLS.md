# Skills in de chat — wat waar hoort, en waar het volgende stuk aanhaakt

Stand: **v1.154** (spoor 04a). Dit bestand is het aanhechtpunt voor `app_skills`
met progressive disclosure. Die laag bestaat nog niet; wat er wél is, is sinds
04a hygiënisch: elke actieve regel bereikt élke route, en een regel kan als bron
in de envelop staan.

---

## 1. Drie dingen die "skills" heten en niet hetzelfde zijn

| | wat | waar | bereikt de app? |
|---|---|---|---|
| **Claude Code-skills** | `~/.claude/skills/*` — 262 KB handboek voor Claude-*sessies* | schijf van de ontwikkelaar | **nee.** Een lokale bewerking komt nooit in de database en dus nooit bij een geplande agent. Zie het geheugen `hosted-routine-skill-copy-stale`. |
| **`org_skills`** | korte organisatieregels die altijd meegaan | database, beheerd via Organisatie › Skills | ja, altijd volledig |
| **`app_skills`** | procedurele kennis, op verzoek geladen | **bestaat nog niet** — WP9 | — |

Ze door elkaar halen is de reden dat "we hebben er een skill voor" en "de agent
weet het" verschillende dingen zijn.

## 2. `org_skills` zoals het nu werkt (v1.154)

- `loadOrgSkills()` in `rag-chat/org-skills.ts` haalt de actieve regels op.
- `generalGuidance()` plakt **álle** actieve regels achter de system-prompt, op
  élke route. Het geeft naast het blok ook `chars` en `truncated_n` terug, zodat
  de aanroeper kan loggen wat er werkelijk meeging.
- `boundGuidanceBlock(skills, tool)` zet de regels van de **gekozen** tool er
  bovendien achteraan. Dat gebeurt in `run.ts` → `stageComposing`, op de enige
  plek waar een tool bekend is: `analytics.tool`, en dat veld zet alleen
  `runStructured()`.
- `toolGuidance()` hangt dezelfde regels onder de tool*beschrijving* in de
  agent-lus (`agentic.ts`, ongewijzigd).
- Harde grenzen: **60 regels × 1.200 tekens per regel**, plus sinds 04a een
  **set-budget van 6.000 tekens** over het geheel. Wat niet past valt eruit én
  wordt geteld.

### Wat 04a repareerde, en waarom het een gebrek was

**Een `tool_binding` haalde de regel uit de algemene kennis (D1).**
`generalGuidanceBlock()` filterde regels mét een binding er juist *uit*. De enige
regel die "Backburner" en "actieve pijplijn" definieert bestond daardoor op de
semantische route (57 % van het verkeer), de structured route en de sweep
domweg niet — alleen als staartje achter één toolbeschrijving in de agent-lus.
`count_by_stage` draaide in 120 dagen **65 keer structured**: 65 keer een telling
per fase zonder de afspraak die zegt welke fases meetellen. Een binding bepaalt
sinds 04a wáár de nadruk komt, niet óf de regel bestaat. Op de agent-route staat
de gebonden regel nu twee keer in de context (~135 tokens dubbel): aanvaard,
want de tool-staart heeft de "lees dit als je die tool overweegt"-functie die het
blok niet heeft.

**Een antwoord uit organisatiekennis kon zichzelf niet verantwoorden (D5).**
`envelope.sources` kwam alleen uit citaten en `answerEmpty` telde alleen chunks
en rijen — allebei berekend vóórdat het antwoord bestond. Een antwoord dat
volledig uit de prompt komt heeft 0 chunks en 0 rijen en was dus per definitie
"leeg", ook als het woordelijk klopte. Sinds 04a is een regel een bron
(`{type:'org_skill', id:<slug>, title, date:<updated_at>, url:null}`),
staat `organisatiekennis` in `coverage.searched`, en heft die grondslag de
leegte op — **alleen** als er ook echt regels geladen zijn én het antwoord ≥ 40
tekens is. Een run waarin het model niets zegt blijft leeg heten; die tweede
helft wordt in `finishRun()` beslist, waar `answer_md` bestaat.

⚠ **De evallane ziet dat laatste vandaag nog niet.** `runBody()` in
`rag-eval-cron` projecteert `answer_empty` niet, dus `asserts.ts` leidt de leegte
af uit `chunk_count === 0 && rows === 0` — voor een prompt-antwoord per definitie
waar. De keten schrijft zijn eigen oordeel nu in
`debug_pipeline.answer_empty`, dat de lane wél al doorgeeft; de assert die het
leest is van spoor 01. Zie `DECISIONS.md`, 2026-09-07.

### Wat nog openstaat

1. **Er is geen tool om een skill op te vragen.** Alles gaat altijd mee, dus elke
   verhoging van de cap is een tokenbelasting op élke vraag. Dat is wat
   `app_skills` + `skill_open` oplossen (§3) — geblokkeerd op de toolcatalogus
   van 03b.
2. **De cap van 1.200 tekens staat naast een editor en een DB-CHECK die 8.000
   toestaan.** 04a maakt het afkappen zichtbaar (`org_skills_truncated_n`) in
   plaats van het te verhogen: 60 × 8.000 is ~126k tokens per vraag.
3. **`org_skills.tool_binding` heeft geen CHECK of FK.** Een binding aan een tool
   die niet bestaat is stil dood. De dropdown in de editor is het enige dat dat
   tegenhoudt, en die liep tot v1.154 op 13 van de 16 tools achter.

## 3. Het aanhechtpunt (WP9)

De vorm staat vast; alleen het bouwen staat open.

```sql
app_skills (
  slug, version, title,
  description,      -- ≤ 500 tekens: dit gaat ALTIJD mee (~100 tokens per skill)
  body,             -- markdown, ≤ 5000 tokens: pas bij activering
  resources jsonb,  -- extra bestanden, alleen op verzoek
  scope,            -- org | user | rol
  tool_binding, active, updated_at
)
```

Progressive disclosure, zoals de open Agent-Skills-standaard hem beschrijft: de
**beschrijvingen** staan altijd in de prompt, de **body** komt via een nieuwe
tool `skill_open(slug)`. Daarmee verdwijnt het plafond van 60 × 1.200 tekens —
262 KB mag bestaan zonder 262 KB te sturen.

**Waar het in de code komt te hangen:**

| stap | bestand | wat |
|---|---|---|
| ophalen | `rag-chat/org-skills.ts` | naast `loadOrgSkills()` een `loadAppSkillDescriptions(supabase, callerUserId)` |
| prompt | `rag-chat/run.ts` → `stageComposing` | de beschrijvingen achter `generalGuidance()`, vóór de vraag |
| tool | `rag-chat/tools/skill-open.ts` (ná 03b-WP2) | `skill_open` in de toolcatalogus + een `evidenceRows`-tak die de body nóóit in `envelope.rows` laat landen |
| structured | — | **klaar sinds 04a.** De binding landt via `boundGuidanceBlock()` in `run.ts`, niet in `analytics.ts`: dat bestand wordt door 03b herschreven en een hunk erin overleeft die rebase niet |

**Isolatie is geen bijzaak.** `scope` plus RLS plus dezelfde `caller_user_id`-as
als Confluence. Nooit een skill in de prompt die de vrager niet mag lezen — en
dat geldt óók voor de *beschrijving*, want de naam van een skill is zelf
informatie. Elke ophaal-query geeft `caller_user_id` door, net als
`match_chunks`; een query die dat niet doet is een omweg om de ACL heen.

**Promptcaching.** Het skills-blok is variabel en hoort dáárom achter het
cache-breekpunt, niet ervoor. Systeemprompt en toolschema's zijn de stabiele
prefix. Relevant zodra WP7 (Claude Opus 5) landt.

## 4. Wat NIET de bedoeling is

- Claude Code-skills naar de database kopiëren "zodat de agent ze ook heeft".
  Ze zijn geschreven voor een ontwikkelsessie met bestandstoegang, niet voor een
  chatantwoord. Wat ervan de chat in moet, hoort als `app_skill` opnieuw
  geschreven te worden — korter en in de tweede persoon.
- Volume in `org_skills` stoppen. Dat is een altijd-meegaand blok; volume hoort
  in `kb_articles` (doorzoekbaar) of straks in `app_skills.body` (op verzoek).
  Zie het geheugen `org-skills-injectie-grenzen`.

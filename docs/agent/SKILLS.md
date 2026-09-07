# Skills in de chat — wat waar hoort, en waar het volgende stuk aanhaakt

Stand: **v1.154** (spoor 04, PR-A "hygiëne"). Dit bestand is het aanhechtpunt
voor WP9 (`app_skills` met progressive disclosure). PR-A repareert de drie
gemeten gebreken die géén nieuwe tabel nodig hadden; `app_skills` zelf is nog
niet gebouwd en staat in §3.

---

## 1. Drie dingen die "skills" heten en niet hetzelfde zijn

| | wat | waar | bereikt de app? |
|---|---|---|---|
| **Claude Code-skills** | `~/.claude/skills/*` — 262 KB handboek voor Claude-*sessies* | schijf van de ontwikkelaar | **nee.** Een lokale bewerking komt nooit in de database en dus nooit bij een geplande agent. Zie het geheugen `hosted-routine-skill-copy-stale`. |
| **`org_skills`** | korte organisatieregels die altijd meegaan | database, beheerd via Organisatie › Skills | ja, altijd volledig |
| **`app_skills`** | procedurele kennis, op verzoek geladen | **bestaat nog niet** — WP9 | — |

Ze door elkaar halen is de reden dat "we hebben er een skill voor" en "de agent
weet het" verschillende dingen zijn.

## 2. `org_skills` zoals het nu werkt (na PR-A)

- `loadOrgSkills()` in `rag-chat/org-skills.ts` haalt de actieve regels op.
- `generalGuidance()` plakt **álle** actieve regels — óók die mét `tool_binding` —
  als "ORGANISATIE-KENNIS"-blok achter de system-prompt, op **élke** route, en
  geeft naast het blok zijn omvang en het aantal afgekapte regels terug.
- `boundGuidanceBlock()` herhaalt daarna de regels van de gekozen structured tool.
  Alleen `runStructured()` zet `analytics.tool`, dus dit ís de structured route.
- `toolGuidance()` hangt gebonden regels ongewijzigd onder de toolbeschrijving in
  de agent-lus. Op die route staat zo'n regel dus twee keer in de context
  (blok + toolstaart, ~135 tokens): bewust, want de staart heeft de "lees dit als
  je die tool overweegt"-functie die het blok niet heeft.
- Harde grenzen: **60 regels × 1.200 tekens per regel én 6.000 tekens voor de set**,
  en dat gaat bij élke vraag volledig mee. Wat buiten het budget valt, valt op
  regelgrens weg en telt in `debug_pipeline.org_skills_truncated_n`.
- Telemetrie op de rij én in de query-log: `org_skills_count`, `org_skills_chars`,
  `org_skills_truncated_n`, `org_skills_bound_tool`.
- Een actieve regel is sinds PR-A ook een **bron** in de envelop
  (`{type: "org_skill", id: <slug>, date: <updated_at>}`) en `coverage.searched`
  noemt `organisatiekennis`. Een antwoord dat volledig uit de regels komt heeft
  dus niet langer nul bronnen.

Wat dit repareerde, en wat er nog staat (SKILLS-CHAT.md, 2026-09-03; hermeten
2026-09-07 in `04-skills/RESEARCH.md`):

1. ~~De cap is 1.200 tekens terwijl de editor 8.000 belooft.~~ **Opgelost voor de
   stilte, niet voor het getal:** de per-regel-cap blijft 1.200 (dat is een
   promptbudget, geen opslagbeperking), maar afkappen is nu een geteld feit in
   plaats van een stille `slice()`, en de editor noemt beide grenzen.
2. ~~`tool_binding` werkt alleen op de agentic route.~~ **Opgelost.** Gemeten over
   120 dagen liep 79 % van het verkeer (2.389 van 3.025 runs) buiten agentic, en
   `count_by_stage` — de enige binding die bestaat — werd daar 84× gekozen zonder
   dat de regel ooit in een prompt stond. Een binding bepaalt vanaf nu wáár de
   nadruk komt, niet óf de regel bestaat.
3. **Er is nog steeds geen tool om een skill op te vragen.** Alles gaat altijd mee,
   dus elke uitbreiding van de set is een tokenbelasting op élke vraag. Dat is
   precies wat §3 oplost.
4. **De editor kende drie tools niet** (`my_mail_search`, `confluence_search`,
   `confluence_get_page`, sinds v1.141/v1.145). **Opgelost:** de dropdown biedt nu
   alle zestien.
5. **De regels werden twee keer per hop geladen.** In `run.ts` laadt `orgSkillsOf()`
   ze nog één keer per hop; `agentic.ts` laadt met opzet nog steeds zijn eigen set
   (03a/03b splitsen dat bestand, een hunk zou daar zonder conflict verdwijnen).
   De set-etag in `agent_chat_run_state` hoort bij `app_skills` en staat in §3.

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

Progressive disclosure, zoals de open Agent-Skills-standaard hem beschrijft — maar
in **drie** trappen in plaats van twee (`04-skills/DECISIONS.md` D04-3): de
**titel** (≤ 120 tekens) gaat overal mee, de **beschrijving** (≤ 500) alleen daar
waar `skill_open` bestaat, en de **body** komt pas ná `skill_open(slug)`. Reden
voor de afwijking van "beschrijvingen altijd mee": op semantic, structured en
sweep bestaat er geen tool om trap 3 te bereiken, dus een volledige beschrijving
daar is tokens uitgeven aan een belofte die niet kan worden ingelost. Daarmee
verdwijnt het plafond van 60 × 1.200 tekens — 262 KB mag bestaan zonder 262 KB te
sturen.

**Waar het in de code komt te hangen:**

| stap | bestand | wat |
|---|---|---|
| ophalen | `rag-chat/org-skills.ts` | naast `loadOrgSkills()` een `loadAppSkills(supabase, callerUserId)` |
| prompt | `rag-chat/run.ts` | org-scope in de system-prompt, caller-scope in de eerste user-beurt |
| tool | `rag-chat/agentic.ts` | `skill_open` in `toolSchemas()` + een tak in de dispatcher |
| ~~structured~~ | ~~`rag-chat/analytics.ts`~~ | ~~`tool_binding` óók toepassen in `runStructured()`~~ — **gedaan in PR-A**, zij het in `run.ts`: de afspraak hangt achter de system-prompt en niet in het analytics-blob, zodat het antwoordmodel hem als regel leest en niet als data |

**Isolatie is geen bijzaak.** `scope` plus RLS plus dezelfde `caller_user_id`-as
als Confluence. Nooit een skill in de prompt die de vrager niet mag lezen — en
dat geldt óók voor de *beschrijving*, want de naam van een skill is zelf
informatie. Elke ophaal-query geeft `caller_user_id` door, net als
`match_chunks`; een query die dat niet doet is een omweg om de ACL heen.

**Promptcaching.** Preciezer dan "het skills-blok hoort achter het breekpunt":
**wat van de vrager afhangt staat nooit in de gedeelde prefix.** Org-scope
(`generalGuidance`, org-titels) is voor iedereen gelijk en hoort er dus juist wél
in; `scope='user'` en `scope='role'` horen erachter, in de eerste user-beurt.
Twee onafhankelijke redenen: nul cache-hits over gebruikers heen (kosten), en een
prefix die identiteitsvrij blijft kan per constructie geen ACL-lek dragen
(veiligheid). Dit werkt vandaag al op OpenAI's automatische prefix-cache (gemeten
64–77 % hits); 03a zet er later alleen een expliciete `cache_control`-marker op.

**Set-etag.** `md5(string_agg(slug||':'||version))` over de **zichtbare** set,
in `debug_pipeline` en op de run-rij. Zonder dat is een cache-miss een raadsel;
mét is hij uitlegbaar ("er is om 14:02 een skill bewerkt"). Hoort bij
`app_skills`, samen met het één keer per run laden.

## 4. Wat NIET de bedoeling is

- Claude Code-skills naar de database kopiëren "zodat de agent ze ook heeft".
  Ze zijn geschreven voor een ontwikkelsessie met bestandstoegang, niet voor een
  chatantwoord. Wat ervan de chat in moet, hoort als `app_skill` opnieuw
  geschreven te worden — korter en in de tweede persoon.
- Volume in `org_skills` stoppen. Dat is een altijd-meegaand blok; volume hoort
  in `kb_articles` (doorzoekbaar) of straks in `app_skills.body` (op verzoek).
  Zie het geheugen `org-skills-injectie-grenzen`.

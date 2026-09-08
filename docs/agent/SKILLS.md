# Skills in de chat — wat waar hoort, en hoe het werkt

Stand: **v1.156** (spoor 04, PR-A "hygiëne" + PR-B `app_skills`). PR-A
repareerde de gemeten gebreken die géén nieuwe tabel nodig hadden (§2, punten 1,
2, 4 en 5). Punt 3 — geen tool om een skill op te vragen — is wat `app_skills`
oplost, en dat is in PR-B **gebouwd** (§3).

---

## 1. Drie dingen die "skills" heten en niet hetzelfde zijn

| | wat | waar | bereikt de app? |
|---|---|---|---|
| **Claude Code-skills** | `~/.claude/skills/*` — 262 KB handboek voor Claude-*sessies* | schijf van de ontwikkelaar | **nee.** Een lokale bewerking komt nooit in de database en dus nooit bij een geplande agent. Zie het geheugen `hosted-routine-skill-copy-stale`. |
| **`org_skills`** | korte organisatieregels die altijd meegaan | database, beheerd via Organisatie › Skills | ja, altijd volledig |
| **`app_skills`** | werkwijzen/procedures, op verzoek geladen | database, beheerd via Organisatie › Skills → tabblad **Werkwijzen** | ja, in drie trappen (§3) |

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

## 3. `app_skills` — gebouwd in PR-B (v1.156)

Migraties `20260908160000_app_skills.sql` en
`20260908161000_agent_chat_run_state_app_skills.sql`; code in
`rag-chat/app-skills.ts` (nieuw, het zevende bestand van de functie).

```sql
app_skills (
  slug, version, title,          -- version +1 door een trigger bij een wijziging
  description,      -- ≤ 500 tekens: alleen waar skill_open bestaat (agentic)
  body,             -- markdown, ≤ 20.000 tekens: pas ná skill_open(slug)
  resources jsonb,  -- fase 2: kolom wordt aangemaakt, nog niet gelezen
  triggers text[],  -- expliciete routeer-hints achter een uitgeschakelde vlag
  scope,            -- 'org' | 'user' | 'role'  + scope_user_id / scope_role,
                    -- sluitend gemaakt met één CHECK (halfgevulde rij = lek)
  tool_binding, active, sort_order, created_at, updated_at, created_by, updated_by
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

**Wat de set kost, gemeten op de blokfuncties zelf** (titels op hun maximum van
120 tekens, dus dit is het plafond en geen schatting):

| zichtbare skills | titellijst | beschrijvingen | ≈ tokens semantic | ≈ tokens agentic | afgekapt |
|---:|---:|---:|---:|---:|---|
| 0 | 0 | 0 | 0 | 0 | — |
| 1 | 432 | 580 | 123 | 289 | — |
| 12 | 2.247 | 6.030 | 642 | 2.365 | 1 beschrijving |
| 40 | 2.247 | 6.030 | 642 | 2.365 | 28 titels, 29 beschrijvingen |

**De bindende grens is de titellijst van 2.000 tekens, niet het aantal van 40.**
Bij titels op hun maximum passen er twaalf; bij titels zoals mensen ze schrijven
(~45 tekens) een dertigtal. Dat is geen bug maar het kostenbesluit: de
titellijst gaat bij **élke** vraag mee, dus hem verruimen naar 40 maximale titels
zou ~6.600 tekens ≈ 1.900 tokens op iedere semantische vraag zetten — precies de
grens waar K8 "nooit meer dan +2.000" trekt. Wat er niet in past valt op
skill-grens weg en telt in `debug_pipeline.app_skills_truncated`; de editor
waarschuwt op tekens en niet op een rij-aantal, zodat de app en de keten op
hetzelfde moment iets zeggen.

**Wat de trappen in de praktijk kosten.** De body-cap is bij het bouwen op
**6.000** tekens gezet en niet op 20.000. Reden: een toolresultaat in de
agent-lus wordt afgekapt op `MAX_TOOL_RESULT_CHARS` = 7.000 (`agentic.ts`), en
dát afkappen gebeurt op de JSON-string — dus midden in een woord én midden in de
payload. Een body van 20.000 zou stil half aankomen, in ongeldige JSON. De DB
bewaart 20.000 (opslag), het model leest de eerste 6.000, afgekapt op
regelgrens, met het aantal weggelaten tekens in het toolresultaat. Dezelfde
verhouding als bij `org_skills` (8.000 opslag / 1.200 injectie), en de editor
noemt beide getallen.

**Waar het hangt:**

| stap | bestand | wat |
|---|---|---|
| ophalen | `rag-chat/app-skills.ts` | `loadAppSkills(supabase, callerUserId)` → `{skills, etag, truncated}`; twee RPC's parallel (`app_skills_visible` + `app_skills_etag`) |
| blokken | `rag-chat/app-skills.ts` | `splitByScope()`, `appSkillTitlesBlock({canOpen})`, `appSkillDescriptionsBlock()`, `openAppSkill()`, `appSkillTriggerHit()` |
| één keer per run | `rag-chat/run.ts` `appSkillsOf()` | hop 1 laadt en schrijft naar `agent_chat_run_state.app_skills`; elke volgende hop leest hem daar (D04-13) |
| prompt | `rag-chat/run.ts` | org-titels in de system-prompt (`stageComposing`), caller-titels in de user-beurt (`prepareCompose` → `buildCombinedUserMessage`) |
| tool | `rag-chat/agentic.ts` | `skill_open` in `toolSchemas()` (**altijd**, ook bij een lege set), een tak in `execTool()`, een label en een `evidenceRows`-regel; trap 1 + 2 in de lus-prompt met `canOpen: true` |
| bron | `rag-chat/run.ts` `prepareCompose` | een **geopende** werkwijze is een bron (`{type: "app_skill", id: <slug>}`) en heft `answer_empty` op, net als een org-regel sinds PR-A. Een tít el is dat niet: een titel is geen antwoord |
| editor | `src/hooks/useAppSkills.js` + `admin/pages/skills/AppSkills{Panel,Editor}.jsx` | tweede tabblad, scope-kiezer, drie trap-velden, trefwoorden, set-cap-waarschuwing |
| ~~structured~~ | ~~`rag-chat/analytics.ts`~~ | ~~`tool_binding` óók toepassen in `runStructured()`~~ — **gedaan in PR-A**, zij het in `run.ts`: de afspraak hangt achter de system-prompt en niet in het analytics-blob, zodat het antwoordmodel hem als regel leest en niet als data |

`analytics.ts` is bewust **niet** aangeraakt: de titellijst staat al in de
system-prompt van élke route (`stageComposing`), dus hem óók in
`analyticsContextBlob()` zetten zou hem op structured en agentic verdubbelen.

**`canOpen` is geen instelling maar een feit.** Alleen de agent-lus heeft tools;
het antwoordmodel (Grok, `compose.ts`) heeft ze niet. De titellijst zegt daarom
in de lus "roep `skill_open` met die slug aan" en op elke andere plek "zeg dát
hij is vastgelegd en verzin de stappen niet". Beloof nooit een deur die er niet
is.

**Isolatie is geen bijzaak — en RLS alleen is géén isolatie.** `rag-chat` bouwt
zijn client met de service-role-key; op dat pad vuurt RLS **nooit**. Een
`app_skills`-tabel met keurige policies is dus onbeschermd zodra de chat hem
leest. Twee lagen, twee doelen: **RLS** beschermt de *editor* (browser,
`authenticated`), en twee `SECURITY DEFINER`-RPC's beschermen de *chat* —
`app_skills_visible(p_caller_user_id)` en `app_skill_open(p_slug,
p_caller_user_id)`, waarbij `open` **uit** `visible` selecteert zodat er één
predicaat is. Fail-closed op een onbekende aanroeper, en "bestaat niet" ≡ "niet
van jou". Nooit een skill in de prompt die de vrager niet mag lezen — en dat geldt
óók voor de *beschrijving*, want de naam van een skill is zelf informatie.

⛔ **En de grants.** Een kale `CREATE FUNCTION` geeft **PUBLIC** execute. Voor
een functie die `p_caller_user_id` overneemt zodra de aanroeper géén
browsersessie is, is dat een lek: met de publieke anon-key mag je dan de
persoonlijke werkwijzen van een uuid opvragen. Gemeten op dit project dragen
`confluence_allowed_spaces` en `confluence_acl_debug` vandaag `=X/postgres` in
hun `proacl` en zijn dus anon-uitvoerbaar (space-keys en tellingen, geen
pagina-inhoud — een aparte follow-up, niet van spoor 04). De
`app_skills`-migratie doet daarom expliciet `revoke execute … from public` vóór
de grants, én noemt `anon` naast `authenticated` in de caller-CTE: twee
sluitingen van dezelfde deur. Poort: `agent_skills_acl.cjs` K2d.

Praktisch gevolg dat je één keer tegenkomt: `database/query` met
`read_only: true` draait als `supabase_read_only_user` en krijgt daardoor
`permission denied for function app_skills_visible`. Dat is het bewijs dat de
revoke werkt, geen reden om hem terug te draaien — `agent_chat_smoke.cjs` roept
die twee selects daarom via het gewone kanaal.

⛔ **Lees de rol niet via `current_user_role()`.** Die geeft `'member'` terug bij
een lege `auth.uid()` — dus op precies het service-role-pad van de chat. Een
`scope='role'`-skill voor `member` zou daarmee zichtbaar worden voor élke
identiteitsloze aanroeper: fail-open, en stil. De rol hoort rechtstreeks uit
`user_roles` te komen op de caller-`uid`, met `uid is not null` als voorwaarde.

**Promptcaching.** Preciezer dan "het skills-blok hoort achter het breekpunt":
**wat van de vrager afhangt staat nooit in de gedeelde prefix.** Org-scope
(`generalGuidance`, org-titels) is voor iedereen gelijk en hoort er dus juist wél
in; `scope='user'` en `scope='role'` horen erachter, in de eerste user-beurt.
Twee onafhankelijke redenen: nul cache-hits over gebruikers heen (kosten), en een
prefix die identiteitsvrij blijft kan per constructie geen ACL-lek dragen
(veiligheid). Dit werkt vandaag al op OpenAI's automatische prefix-cache (gemeten
64–77 % hits); 03a zet er later alleen een expliciete `cache_control`-marker op.

**Set-etag.** `app_skills_etag(p_caller_user_id)` =
`md5(string_agg(slug||':'||version, ',' order by slug))` over de **zichtbare**
set, `'empty'` als die set leeg is en `'unavailable'` als de RPC faalde. Staat in
`debug_pipeline.app_skills_etag`, in `rag_chat_query_log.meta` en in
`agent_chat_run_state.app_skills`. Zonder dat is een cache-miss een raadsel; mét
is hij uitlegbaar ("er is om 14:02 een skill bewerkt"). De functie selecteert
**uit** `app_skills_visible`, dus hij is geen tweede predicaat, en `version` is
afgeleid (trigger `app_skills_bump`) zodat een client hem niet kan zetten. Een
`active`-vlag omzetten of de sortering verschuiven verandert de zichtbare set —
en dus de etag — zonder `version` aan te raken; dat is bedoeld.

**Bereikbaarheid.** `app_skills.triggers text[]` +
`agent_config('rag-chat','skill_route_override')`, default **`false`**. Bij een
match op de **zichtbare** set gaat semantic/sweep → agentic, zichtbaar in
`dbg.route_override` als `skill_trigger:<slug>`. Zelfde patroon als de
mailbox-override (06a WP4b) en in één regel terug te draaien. Uit, omdat de
override vragen naar de duurste route duwt (semantic p50 ≈ $0,005 tegen agentic
p50 ≈ $0,05); aanzetten is een eigen meting met de skills-categorie,
`expect_route` en de kosten-p50 per route erbij.

**Wat er bij de merge in de tabel staat: niets.** PR-B levert het mechanisme; de
inhoud is een bewerking in Organisatie › Skills, geen deploy. Met een lege tabel
injecteert de keten nul tekens en verandert er dus niets aan de prompt — de
laag is pas te meten in de bank zodra er een werkwijze in staat. Dat is ook de
reden dat de `skills`-categorie ná PR-B nog exact de nulmeting geeft.

## 4. Wat NIET de bedoeling is

- Claude Code-skills naar de database kopiëren "zodat de agent ze ook heeft".
  Ze zijn geschreven voor een ontwikkelsessie met bestandstoegang, niet voor een
  chatantwoord. Wat ervan de chat in moet, hoort als `app_skill` opnieuw
  geschreven te worden — korter en in de tweede persoon.
- Volume in `org_skills` stoppen. Dat is een altijd-meegaand blok; volume hoort
  in `kb_articles` (doorzoekbaar) of straks in `app_skills.body` (op verzoek).
  Zie het geheugen `org-skills-injectie-grenzen`.

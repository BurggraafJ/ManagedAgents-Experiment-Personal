# Skills in de chat — wat waar hoort, en waar het volgende stuk aanhaakt

Stand: **v1.146**. Dit bestand is het aanhechtpunt voor WP9 (`app_skills` met
progressive disclosure). Er is in v1.146 nog niets nieuws gebouwd; wel is
vastgelegd wat er is, wat er stuk aan is, en waar de uitbreiding komt te zitten.

---

## 1. Drie dingen die "skills" heten en niet hetzelfde zijn

| | wat | waar | bereikt de app? |
|---|---|---|---|
| **Claude Code-skills** | `~/.claude/skills/*` — 262 KB handboek voor Claude-*sessies* | schijf van de ontwikkelaar | **nee.** Een lokale bewerking komt nooit in de database en dus nooit bij een geplande agent. Zie het geheugen `hosted-routine-skill-copy-stale`. |
| **`org_skills`** | korte organisatieregels die altijd meegaan | database, beheerd via Organisatie › Skills | ja, altijd volledig |
| **`app_skills`** | procedurele kennis, op verzoek geladen | **bestaat nog niet** — WP9 | — |

Ze door elkaar halen is de reden dat "we hebben er een skill voor" en "de agent
weet het" verschillende dingen zijn.

## 2. `org_skills` zoals het nu werkt

- `loadOrgSkills()` in `rag-chat/org-skills.ts` haalt de actieve regels op.
- `generalGuidanceBlock()` plakt de regels **zonder** `tool_binding` achter de
  system-prompt. Regels **mét** `tool_binding` hangt `agentic.ts` onder de tool.
- Harde grenzen: **60 regels × 1.200 tekens**, en dat plafond gaat bij élke vraag
  volledig mee.

Drie gemeten gebreken (SKILLS-CHAT.md, 2026-09-03) die nog openstaan:

1. **De cap is 1.200 tekens terwijl de editor 8.000 belooft** en de database
   8.000 toestaat. Alles daarboven verdwijnt stil. (v1.138 toont in de editor wel
   wat er werkelijk meegaat — de cap zelf staat nog.)
2. **`tool_binding` werkt alleen op de agentic route.** Op de structured route —
   133 van 274 runs, dus bijna de helft van het verkeer — is de regel onzichtbaar.
   Een regel aan `churned_in_window` hangen doet dus niets waar hij het hardst
   nodig is.
3. **Er is geen tool om een skill op te vragen.** Alles gaat altijd mee, dus elke
   uitbreiding van de cap is een tokenbelasting op élke vraag.

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
| prompt | `rag-chat/index.ts` | de beschrijvingen achter `generalGuidanceBlock()`, vóór de vraag |
| tool | `rag-chat/agentic.ts` | `skill_open` in `toolSchemas()` + een tak in de dispatcher |
| structured | `rag-chat/analytics.ts` | `tool_binding` óók toepassen in `runStructured()` — dat is gebrek 2 hierboven |

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

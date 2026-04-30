# Confluence — playbook voor Legal Mind

> **Lees dit ALTIJD voor je iets in Confluence aanraakt.** Confluence is breed en agents
> vergeten snel waar wat hoort — met als gevolg duplicate pagina's, verkeerde sectie-keuzes
> en stale inhoud. Deze referentie is **de bron-van-waarheid** voor de werkwijze. Update
> hem hier; niet ook in Confluence (dat zou regel 1 schenden — één onderwerp, één plek).

## Bron-regel

| Vraag | Bron |
|---|---|
| Hoe werkt Confluence-onderhoud (procesregels, beslisboom, naming, fase-/koffie-/per-agent-templates) | **Deze referentie** — `agent-handbook/references/confluence.md` |
| Wat staat er nu in Confluence (welke project-pages, welke per-agent pages, welke koffie-docs) | **Live query** via `getPagesInConfluenceSpace` / `searchConfluenceUsingCql` / `getConfluencePageDescendants`. Nooit hardcoden. |

Bij twijfel over content: query de live state. Bij twijfel over werkwijze: deze referentie. Een Confluence-pagina dupliceert deze regels niet — we wilden niet twee plekken die uit sync kunnen lopen.

## Cloud + tooling

* **Site:** `https://bg-intelligence.atlassian.net`
* **CloudId:** `2ff8bead-845a-4276-aabb-1191cfc4ac6b`
* **MCP-prefix:** `mcp__8236b0dc-13ae-4d89-a7a8-4498b08d9228__*` (Atlassian Remote MCP)
* **Belangrijkste tools:**
  - `getPagesInConfluenceSpace` — lijst (kan groot zijn → gebruik `limit` + `sort`)
  - `getConfluencePageDescendants` — page-tree wandelen (geef `depth` mee)
  - `searchConfluenceUsingCql` — gerichte zoekopdracht (`title ~ "..."`, `parent = ...`)
  - `getConfluencePage` — page-body (voorkeur `contentFormat: "markdown"`)
  - `createConfluencePage` / `updateConfluencePage` — schrijven (alleen na bevestiging)
  - `search` (Rovo) — natuurlijke-taal Jira+Confluence zoeker

## Spaces — wat hoort waar

Live opvragen, hieronder een snapshot per 2026-04-29. Verifieer met `getConfluenceSpaces` voor je een space-keuze maakt — er kunnen nieuwe spaces zijn.

| Key | id | Naam | Type | Wat hoort hier |
|---|---|---|---|---|
| **LM** | 18612403 | Legal Mind | global | **Primaire werkruimte voor agent-management.** Bevat de hele "AI Agent Ecosysteem" tree + Security cheat sheet + Sjablonen. Default-space voor ons werk. |
| **AI** | 378732548 | AI | collaboration | Bredere AI-leerruimte — AI Learnings, AI plan — Overview, Documentation-folder, Things to look at / ideas, Legal Engineer onboarding. Niet voor agent-implementatie. |
| **AS** | 372080644 | AI documentations | collaboration | Externe AI-feature-documentatie. Bevat "Features"-tree met vaste 5-fase sjabloon per feature: `1. Scope`, `2. Design`, `3. Architecture`, `4. Backend Implementation Notes`, `5. Frontend Implementation Notes`. NIET hier nieuwe agents documenteren. |
| **Product** | 170360836 | Product | collaboration | Product/feature roadmap. Folders: Done, Epics, Epics upcoming, Idea's, Documentation, Onboarding, AI. |
| **SD** | 4980737 | Software Development | global | Bredere tech-doc — bevat o.a. AI Learning Center technische docs (Architectuur / Module Scope / Dev → Productie / Content Beheer). |
| **BI** | 305528847 | Business Intelligence | collaboration | HubSpot-dealregels, Databricks-setup, BI-conventies. |
| **LE** | 136511491 | Legal Mind (nieuwer) | global | Bevat sprint-bevindingen. Laaggebruikt — niet onze default. |
| **LM1** | 20971526 | Legal Mind (oud) | global | Verouderde voorganger van LM. **Niet meer aanraken.** |
| **PT** | 10747913 | Pragnakalp Techlabs | global | Externe leverancier — niet onze ruimte. |
| Personal spaces | (diverse) | per medewerker | personal | Niet onze ruimte. |

**Default-keuze voor Jelle's agent-werk: LM** (key `LM`, id `18612403`). Alleen afwijken als de pagina logisch in BI/Product/AI thuishoort.

## De ruggengraat — AI Agent Ecosysteem (LM-space)

Top-level page: **AI Agent Ecosysteem** (id `410484738`, parent van homepage). Alles voor het agent-systeem hangt hieronder.

### De zes secties — exclusief per page

| Sectie | Page-id | Wat hoort hier | Wat NIET hier |
|---|---|---|---|
| **Architectuur** | 410517505 | Schema's, patronen, technische contracten. Verandert zelden, blijft staan. | Project-status, runbooks, koffie-uitleg. |
| **Per agent** | 410550273 | Eén pagina per skill/agent volgens vaste sjabloon (zie hieronder). | Agents die niet in `agent_schedules` staan. |
| **Operations** | 410583041 | Runbooks, onderhoudsprotocollen — *wanneer X gebeurt*, *hoe je Y bouwt*. | Lopende projecten (sinds 2026-04-28 in eigen sectie). |
| **Concepten & uitleg** | 411271170 | Mentale modellen, "waarom is dit zo" — koffie-documenten. | "Hoe-doe-je-X" (dat is Operations of skill zelf). |
| **Projecten** | 413073409 | Multi-fase initiatieven (>1 week, fases/deliverables). Eén project = parent + sub-pages per fase. | One-shot runbooks (= Operations). Status van één skill (= Per agent). |
| **Sessies** | 413106177 | Chat-logs en sessie-handovers. Vergankelijk — na 1 maand mag een chat-log weg. | Permanente besluiten — die verhuizen naar Concepten. |

### Vaste sjabloon — Per-agent page (9 secties, in volgorde)

Bij toevoegen of updaten van een agent-page in `Per agent`:

1. **Doel & trigger-condities** — waarom bestaat de agent, wanneer triggert hij
2. **Schedule** — link naar live SQL-query op `agent_schedules`, GEEN hardcoded cron
3. **Input** — welke tabellen / API's / events hij leest
4. **Output** — welke tabellen hij schrijft, welke side-effects (Outlook-drafts, HubSpot-mutaties)
5. **Dependencies** — andere skills, MCP's, Edge Functions
6. **Status-meting** — SQL waarmee je gezondheid ziet (welke `agent_runs.stats`-velden, dashboard-card)
7. **Bekende issues / TODO** — open vragen, geplande verbeteringen
8. **Locaties** — pad naar `SKILL.md`, eventuele Edge Function-folder, dashboard-view
9. **Versiehistorie** — alleen non-triviale wijzigingen

De page beschrijft het **contract** (wat doet de agent voor wie). Het *runtime-gedrag* leeft in `SKILL.md` lokaal — Confluence-page is geen kopie, wel pointer.

### Vaste sjabloon — Project-page

Project-pages (in **Projecten → Lopende projecten** of als sub-page van een parent-project) volgen dit patroon:

```markdown
# Project — <korte naam>

> **Parent:** [Lopende projecten] (of parent-project)
> **Status:** ⚪/🔵/🟡/🟢
> **Doel:** één-zinnige scope.

## TL;DR — voorgestelde fases

| Fase | Wat | Effort | Status |
|---|---|---|---|
| F.1 | ... | 2u | ⚪ |
| F.2 | ... | 1u | ⚪ |

## Waarom dit project?
## Wat we al hebben (status YYYY-MM-DD)
## Aanpak — Optie A vs B (met VOORKEUR)
## Voorgesteld pad (fase-tabel uitgebreid)
## Open vragen
## Wat NIET in scope
## Bron-research
## Hoe nieuwe sessie hier mee aan de slag?
```

**Status-tags (gestandaardiseerd):**

| Tag | Betekenis |
|---|---|
| 🟢 Live | In productie / draait |
| 🔵 In progress | Actief werk |
| 🟡 Partial / wacht op extern | Gedeeltelijk klaar of geblokkeerd door externe partij |
| 🔴 Blocked | Vastgelopen, actie nodig |
| ⚪ Pending | Nog niet begonnen |
| ⛔ Geschrapt | Bewust niet doen |
| ✅ Klaar | Afgerond, in archief |

**Fase-numbering:**
* Korte projecten: `F.1`, `F.2`, `F.3` …
* Multi-track projecten: prefix met track-letter — `A.0`, `A.1`, `A.2` (Track A) + `B.1`, `B.2` (Track B). Zie *Project — Betrouwbaarheid & Veiligheid* (id `412057603`) als referentie-voorbeeld.
* Onderzoeksdocument binnen project: `Fase X — <naam> — onderzoek` als sub-page onder de project-page.

### Vaste sjabloon — Koffie-document (Concepten & uitleg)

Koffie-docs leggen mentale modellen uit. Vorm:

```markdown
# <onderwerp> — een lees-met-koffie
                  (of: <onderwerp>, <onderwerp> en <onderwerp>)

> Pak een koffie. Dit verhaal duurt zo'n 8-10 minuten.

> [Optionele update-blockquote bij latere versie]

## Het korte verhaal
[Twee alinea's TL;DR]

## Het mentale model — [metafoor]
[Concrete metafoor: kasteel met muren, lagen, sandwich, etc.]

## Antwoord 1 — [vraag die vanzelf opkomt]
## Antwoord 2 — ...

## [Kern-uitleg + concrete code-snippets in tabellen]

## Slot
[Kort: drie bullets die het mentale model herhalen]

Pak nog een koffie.
```

Drie bestaande exemplaars als kompas:
* *Skills, references en je team van agents* (411664396) — agent-skills concept
* *Edge Functions, true sources en hoe alles synchroniseert* (412876802) — ETL / mirrors
* *De gevaren in jouw kasteel — een lees-met-koffie* (413564930) — security

Doel: lezer pakt mental model op, niet step-by-step instructies. Iets-technisch is OK; volledig technisch is fout (dat is Architectuur).

### Vaste sjabloon — Sessie-pagina

* **Chat-logboek:** `Chat-logboek — sessie YYYY-MM-DD`. Levensduur 1 maand. Patroon-beslissing erin? → verplaats naar Concepten & uitleg.
* **Sessie-handover:** `Sessie-handover — <korte titel>` of de vaste pagina **Project-voortgang & sessie-handover** (411238402) wordt **overschreven** per sessie. Niet versie-suffixen — Confluence-historie houdt het bij.

## Beslisboom — waar zet ik mijn nieuwe page?

```
Is het runtime-instructies voor een skill?
  └─ JA  → SKILL.md / references/, NIET Confluence
  └─ NEE
       ↓
Is het een mentaal model / "waarom"?
  └─ JA  → Concepten & uitleg
  └─ NEE
       ↓
Is het een chat-log of sessie-handover?
  └─ JA  → Sessies
  └─ NEE
       ↓
Is het een multi-fase project (>1 week, met fases/deliverables)?
  └─ JA  → Projecten (project-page) of als sub-fase onder bestaand project
  └─ NEE
       ↓
Is het een runbook / onderhoudsstap?
  └─ JA  → Operations
  └─ NEE
       ↓
Hoort 't bij één specifieke agent?
  └─ JA  → Per agent
  └─ NEE → Architectuur
```

## De vijf onderhoudsregels

### Regel 1 — Eén onderwerp, één plek
Informatie op twee plekken = gegarandeerd één plek niet bijgewerkt. Liever **pointer** vanuit de andere plek dan dupliceren. Smartlinks (`<custom data-type="smartlink" data-id="...">`) zijn de standaard.

### Regel 2 — Update, niet bij-publiceren
Wijziging in bestaande info → `updateConfluencePage` met een betekenisvolle `versionMessage`. **Maak GEEN** "v2 / v3 / nieuw" pagina. Confluence-historie houdt versies vast.

### Regel 3 — Iets uitfaseren? Verwijder na cutover
Migration-pages hebben korte levensduur:
* Tijdens migratie: actieve runbook
* Na cutover + 1 week stabiel: TL;DR melden dat 't klaar is
* 1 maand na cutover: pagina weg. Permanente changelog leeft in Roadmap & Changelog.

### Regel 4 — Per-agent page = single source of truth
Per-agent-page is geen kopie van `SKILL.md`. Page = **contract** (wat doet de agent, voor wie, met welke I/O). `SKILL.md` = **runtime**. Beide blijven; verwijs naar elkaar, kopieer niet.

### Regel 5 — Concepten ≠ Documentatie
Concepten beschrijven *waarom*, niet *hoe*. Hoe-instructies horen in Operations of de skill zelf. Een koffie-doc dat een stap-voor-stap procedure wordt, hoort niet meer bij Concepten.

## Wanneer mag een page weg?

| Page-type | Wanneer weg |
|---|---|
| Sessie-handover (Sessies) | Overschrijven bij start nieuwe grote sessie. |
| Chat-logboek (Sessies) | Na 1 maand. Patroon-beslissing erin? → verplaats naar Concepten. |
| Roadmap-detail (Projecten) | Wanneer fase af én in changelog. Project-page → "Afgerond" folder na 1 jaar. |
| Architectuur-page | **Alleen** wanneer architectuur verdwijnt. Wijzigt 'm? UPDATE, niet weg. |
| Per-agent page | Wanneer agent uit `agent_schedules` is verwijderd. |
| Migratie-/uitfaseer-runbook (Ops) | Zodra migratie compleet is en geen rollback meer nodig is. |
| Concepten-page | Bijna nooit — concepten verouderen zelden. |

**Permanent — raak NOOIT zonder vraag:**
* AI Agent Ecosysteem (top-level)
* Architectuur-sectie pages (inhoud verandert, page blijft)
* Per agent pages (zolang agent bestaat)
* Concepten & uitleg pages
* Top-level sectie-pages van Projecten en Sessies

## Veiligheid — voor je delete

1. **Heeft de page children?** → eerst children verplaatsen of laten meedeleten (bewust).
2. **Wordt de page elders gelinkt?** Search met CQL: `text ~ "<page-title>"`. Update linkende pages eerst.
3. **Twijfel?** → status `archived` (in Confluence-UI) eerst, een maand later definitief weg.
4. **Nooit** hard-delete via API zonder dubbele bevestiging van Jelle.

## Hoe loop je een nieuwe sessie aan tafel?

Voordat je iets aanmaakt of wijzigt — **ALTIJD** in deze volgorde:

1. **Lees deze referentie** (je doet dat nu) — werkwijze, beslisboom, sjablonen, naming.
2. **Live state ophalen — wat staat er nu?**
   ```
   getConfluencePage(414777345)          # Lopende projecten — index van actieve werken
   getConfluencePageDescendants(410484738, depth=1)  # AI Agent Ecosysteem zes secties
   getConfluencePageDescendants(414777345, depth=2)  # Open project-pages + fases
   ```
3. **Vergelijk vraag met beslisboom** — bepaal sectie.
4. **Check op duplicate**: `searchConfluenceUsingCql("title ~ \"<onderwerp>\" AND space.key = \"LM\"")`. Bestaat al? → UPDATE in plaats van CREATE.
5. **Pas dan** schrijven. Gebruik `contentFormat: "markdown"` waar mogelijk.

## Wat agent-manager automatisch doet (sinds 2026-04-27)

* Houdt de project-status-tabel in *Project-voortgang & sessie-handover* (411238402) actueel.
* Maakt nieuwe per-agent page wanneer een agent toegevoegd wordt aan `agent_schedules`.
* Schrapt obsolete operations-pages na cutover + 1 maand stabiel.
* Update bestaande pages (geen nieuwe v2-pagina's aanmaken).

**Wat agent-manager NOOIT doet zonder Jelle's vraag:**

* Nieuwe Concepten-pages aanmaken (koffie-docs zijn een ontwerp-keuze, niet AI-werk)
* Hoofdsecties herstructureren
* Project-pages aanmaken in Projecten (Jelle definieert wat een project is)
* Pagina's verwijderen — alleen archiveren

## Periodieke audit — lichtgewicht

Elke 2-3 maanden, of bij grote sessie-end, quick check:

```sql
-- Welke agents draaien nu?
SELECT agent_name FROM agent_schedules WHERE enabled=true;
```

Vergelijk met `getConfluencePageDescendants(410550273, depth=1)` — Per-agent sectie. Verschil = **dood vlees** (page zonder agent) of **doc-gat** (agent zonder page).

Eenmaal per kwartaal: wandel door Operations, beslis welke runbook-pages obsoleet zijn (vooral migratie-runbooks).

## Naming-conventie — overzicht

| Sectie | Conventie | Voorbeeld |
|---|---|---|
| Architectuur | Beschrijvend, geen prefix | "Edge Functions", "Database-schema" |
| Per agent | Skill-naam exact (DB-key) | "auto-draft", "daily-admin" |
| Operations | Beschrijvend | "Composio-uitval", "Deploy & rollback runbook" |
| Concepten & uitleg | Beschrijvend, vaak metafoor | "De gevaren in jouw kasteel" |
| Projecten — parent | `Project: <korte naam>` of `Project — <naam>` | `Project — RAG Quality Engineering` |
| Projecten — sub-fase | `Fase X — <naam>` | `Fase 2 — Backfill 12 maanden` |
| Projecten — onderzoek-doc binnen fase | `Fase X — <naam> — onderzoek` | `Fase 2 — RAG quality — onderzoek` |
| Sessies — chat-log | `Chat-logboek — sessie YYYY-MM-DD` | `Chat-logboek — sessie 2026-04-27` |
| Sessies — handover | `Sessie-handover — <titel>` | `Sessie-handover — HubSpot mirror cutover` |

## Schrijf-stijl

* **Nederlands**, tenzij externe context (BI/AS-spaces gebruiken vaak Engels — volg de space-conventie).
* **Tabellen** waar het kan — sneller scannen dan proza.
* **Code-blocks** voor SQL, JSON, file-paden.
* **Smartlinks** voor inter-page links — geen ruwe URL's plakken.
* **TL;DR** bovenaan elk lang document.
* **Datum-prefix** bij update-blockquotes: `> ✅ **Update YYYY-MM-DD HH:MM** — ...`
* **Status-tabel** verandert per page-update — bijwerken in plaats van nieuwe page maken.

## Veelvoorkomende anti-patronen

| Anti-patroon | Waarom fout | Doe dit in plaats daarvan |
|---|---|---|
| `Project X v2`, `Project X (nieuw)` | Confluence-historie raakt versplinterd | UPDATE bestaande page met `versionMessage` |
| Zelfde info in Architectuur én Per agent | Eén plek raakt out-of-sync | Pointer vanuit één naar de ander |
| Koffie-document met stap-voor-stap procedure | Concept ≠ runbook | Verplaats procedure naar Operations of `SKILL.md` |
| Nieuwe sectie naast de zes | Wordt rommellade | Voeg pas toe als 3+ pages echt nergens passen |
| Dump van chat-context als koffie-doc | Overschrijdt levensduur Sessies | Zet in Sessies; verplaats alleen patroon-beslissing |
| Hardcoded skill-paden in page-body | Pad verandert, page niet | Verwijs naar concept "skills-plugin folder" generiek |

## Checklist — voor elke Confluence-actie

Voor je `createConfluencePage` of `updateConfluencePage` aanroept:

- [ ] Beslisboom doorlopen — sectie bepaald?
- [ ] Bestaat de page al? (CQL-zoek op title)
- [ ] Naming-conventie gevolgd?
- [ ] Bij update: zinvolle `versionMessage` meegegeven?
- [ ] Bij delete: children + linkende pages gecheckt?
- [ ] Voor permanente sectie-page (Architectuur/Per-agent/Concepten/top-level): bevestiging gevraagd?
- [ ] Bij twijfel: voorstel gemaakt voor Jelle in plaats van direct uit te voeren?

## Cross-skill kennis

* Voor secret-rotatie / settings.json: zie `security.md`.
* Voor RPC's en migrations die de Confluence-state beïnvloeden (bv. `agent_schedules` syncen met Per-agent pages): zie `database.md`.
* Voor dashboard-deploy en Vercel-relatie met sessie-pagina's: zie `platform.md`.

---

_Laatste update: 2026-04-29. Deze referentie is **de** bron-van-waarheid voor de werkwijze. Update hier — niet ergens anders. Zie regel 1 (één onderwerp, één plek): een Confluence-pagina dupliceert deze regels niet, anders lopen ze uit sync._

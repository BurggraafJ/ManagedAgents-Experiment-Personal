# Confluence — handmatige stappen na de Briefing/JelleMind-removal

**Branch:** `remove/briefing-jellemind-v1` · **APP 1.158** · 2026-09-12
**Bron:** `/workspace/security/maestro-agent-architecture/14-removals-docs-research/RESEARCH.md` §6
**Status:** niets hiervan is uitgevoerd. Deze PR raakt Atlassian niet.

> ⚠ **Publieke repo.** Dit bestand bevat alleen page-IDs en de namen van interne
> architectuur-/projectpagina's — geen pagina-inhoud, geen klantnamen, geen
> bedragen, geen mailinhoud, geen Atlassian-accountIds of e-mailadressen.
> Page-IDs staan ook in `CLAUDE.md` zelf; dat is de bestaande lat.

Waarom handmatig: een skill-retire repareert de chat-**routing**, niet de
**retrieval**. Zolang de pagina-tekst in `chunks` (source=`confluence`) zegt dat
JelleMind en de meeting-briefing bestaan, blijft RAG dat serveren — ook aan
Jelle zelf. De banner ín de body is de RAG-fix; archiveren alleen haalt de
pagina uit de boom maar de ETL kan de body al gespiegeld hebben.

De Confluence-spiegel draait `*/5` (zie `confluence_acl_eval` G6b), dus een
bewerkte body staat binnen ~10 minuten in de index; een gearchiveerde pagina
verdwijnt direct uit retrieval (G7, gemeten).

## Vóór je begint

1. **Space controleren, niet aannemen.** Alle IDs hieronder gedrágen zich als
   LM-boom (`18612403`), maar geen enkele is in een lokale dump als LM
   bevestigd. Draai per pagina één CQL `id = <id>` en kijk naar de spaceKey
   vóór je archiveert. **LM1 niet aankomen.** LE (`136511491`) is niet de
   default-ruimte — staat er toch iets in, dan wél een banner maar geen
   LM-boom-aanname.
2. **Auth:** Basic auth met `skill:global:atlassian_api_token` uit de Vault
   werkt non-interactief; geen MCP of Composio nodig. Body moet
   storage-XHTML zijn (geen markdown).

## De banner (kopieer letterlijk, bovenaan de body)

> **Dit product bestaat niet meer.** Briefing en JelleMind zijn op 2026-09-12
> uit het Legal Mind-dashboard verwijderd (v1.158). Deze pagina blijft staan als
> historie; de beschreven schermen, skills, tabellen en cron-jobs zijn weg.
> Niet gebruiken als bron voor nieuw werk.

---

## A. Archiveren (per-agent contract-pages van dode agents)

`agent-manager` legt de coordinator-plicht op: bij removal hoort de per-agent
page gearchiveerd te worden. Sub-pages mee.

| Pagina | id | Actie |
|---|---|---|
| jellemind contract | `417136642` | archiveer (incl. sub-pages) |
| kilometerregistratie (+ sub) | `410681365` | archiveer — W36 dead_doc, al sinds v1.135 |
| linkedin-connect | `410877953` | archiveer — W36 dead_doc |
| sales-on-road | `410910722` | archiveer — W36 dead_doc |
| sales-followups | `410386434` | archiveer — W36 dead, niet heropenen |

De laatste vier staan niet in Jelle's lock maar zijn al sinds v1.135 dood; ze
meenemen voorkomt dat de W37-audit ze opnieuw als bevinding opvoert.

## B. Projectpagina's — banner + statuschip

| Pagina | id | Actie |
|---|---|---|
| Project — JelleMind | `417005570` | banner + status Done/Cancelled |
| Project — JelleMind Activation | `426377220` | banner, mee met de parent |
| JelleMind — een notitieboekje… | `417038337` | banner (koffie-uitleg mag historisch blijven; **niet** hard-deleten) |

`jellemind/SKILL.md` linkt naar `417005570`. Zonder banner opent een agent die
pagina als canon.

## C. Architectuur- en overzichtspagina's — écht bijwerken, niet alleen bannen

| Pagina | id | Wat |
|---|---|---|
| Database-schema | `410648578` | **Hoogste prioriteit.** W36-critical: noemt nog `kilometer*` / `km_*` / `road_note` / `linkedin` (8×) terwijl die live nul zijn, telt 100/42 waar het 136/50 is, en mist `meeting_briefings`. Nu ook: `jellemind_lessons`, `jellemind_lesson_proposals`, `jellemind_signals`, `meeting_briefings`, `meeting_briefing_config` verdwijnen met migratie `20260912121000`. Agents die "het schema even checken" in Confluence herintroduceren anders dode tabellen. |
| Ecosysteem-overzicht | `410615809` | catalogus: `jellemind` en `jellemind-embed` eruit, `meeting-briefing` eruit |
| Orchestrator-flow | `410976258` | bijwerken als hij km/linkedin/jellemind/meeting-briefing als te-draaien agents noemt |
| RAG-architectuur | `445939714` | banner op de JelleMind-injectie-sectie; `match_jellemind_lessons` bestaat niet meer, `context-build` v2.11 heeft stap 8b uit |
| Legal Mind End-to-End Architectuur | `446332955` | banner + één alinea "lessen-laag retired"; **niet** deleten |
| Logging Migratie | `420249602` | historisch laten; optioneel voetnoot bij "decision-trail t.b.v. JelleMind F.4+" |

## D. Projectpagina's met gemengde inhoud — lees eerst, ban daarna

| Pagina | id | Let op |
|---|---|---|
| AutoDraft v3 | `461996034` | noemt "Maestro briefing". Dat kan de cockpit `/briefing` zijn **of** de InboxBriefing van AutoDraft v3. Alleen het eerste is weg. **InboxBriefing-copy laten staan** — dat product draait door. |
| Fase 2 user_id-scoping (Km, Road Notes, JelleMind admin) | `454918146` | historisch laten + banner: "Km/Road Notes done v1.135; JelleMind-admin verwijderd 2026-09-12" |
| Audit week 2026-W36 (dead skills) | `627408904` | **niets doen.** Dit ís het dead-skills-rapport. De volgende audit volgt de owner-mapping, niet deze pagina. |

## E. Buiten Confluence, zelfde opruimronde

- `documentation-monitor/references/owner-mapping.md` — de dode per-agent-rijen
  zijn op 2026-09-12 al als `archived` gemarkeerd door de orchestrator. Controleer
  dat de `jellemind`-rij (`417136642`) mee is; anders maakt de W37-audit er
  *missing_doc* van, of erger: "maak deze pagina aan".
- `jellemind` + `meeting-briefing` SKILL.md hebben hun RETIRED-banner al.
  **Let op de hosted kopie:** een lokale edit in `~/.claude/skills` bereikt de
  geplande agents niet. Zolang de hosted kopie of `agent_schedules.enabled` niet
  mee is, draait de routine de oude SKILL.md gewoon door. Migratie
  `20260912120000` zet die schedules op `false` — dat is de echte stop.

## Volgorde

Skills eerst (die draaien nú), dan `agent_schedules` (migratie A), dan
Confluence. Andersom lijkt het opgeruimd in RAG terwijl de poller nog briefings
schrijft.

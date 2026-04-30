# Architecture Context — LegalMind VM Build System

Dit document beschrijft het volledige plaatje van het LegalMind geautomatiseerde build-systeem. Lees dit als je wilt begrijpen waarom dingen zijn zoals ze zijn.

---

## Het grote plaatje

Legal Mind B.V. bouwt een AI-platform voor advocatenkantoren. Features worden gebouwd via een gestandaardiseerde keten van stappen, waarbij elke stap door een aparte AI-skill wordt uitgevoerd. Het resultaat van elke stap wordt gepubliceerd op Confluence en de voortgang wordt bijgehouden in Slack.

De hele keten is ontworpen zodat meerdere features tegelijk gebouwd kunnen worden — parallel, op aparte machines, zonder dat ze elkaar in de weg zitten.

---

## De Development Chain

Elke feature doorloopt deze stappen:

### 1. Feature Initialization (`initialize-feature` skill)
- Maakt een feature-folder aan op Confluence met placeholder-pagina's
- Post een initializatie-bericht in `#ai-agents-test` met de pipeline-status
- Output: Confluence folder + Slack bericht met ⏳ voor alle stappen

### 2. Scope (`product-owner-scope-creator` skill)
- Vertaalt een feature-request naar een gedefinieerde scope met acceptance criteria
- Publiceert "Scope — [Feature Titel]" op Confluence
- Update de Slack-thread: "Scope complete"
- Output: Scope-pagina op Confluence, Slack-status update

### 3. Architecture (`feature-architect` skill)
- Genereert technische architectuur: backend, frontend, database, API endpoints
- Publiceert 3 pagina's op Confluence:
  - Architecture Overview — [Feature Titel]
  - Backend Architecture — [Feature Titel]
  - Frontend Architecture — [Feature Titel]
- Post in Slack: "Architecture published"
- Output: 3 architectuur-pagina's op Confluence

### 4. Design (handmatig / Figma)
- UX flows en UI designs worden handmatig of via Figma gemaakt
- Figma-link wordt toegevoegd aan de Confluence-pagina's
- Dit is de enige stap die (nog) niet geautomatiseerd is

### 5. Engineering (`backend-engineer` + `frontend-engineer` skills)
- **Backend eerst**: API endpoints, database models, migraties, services
- **Frontend daarna**: UI componenten, state management, API-integratie
- Altijd op dezelfde machine (frontend heeft de draaiende backend nodig)
- Update Development Status pagina op Confluence na elke sessie
- Post resultaat in Slack-thread

### 6. VM Dispatcher (`vm-dispatcher` skill — jij)
- Draait als scheduled task op elke VM
- Orkestreert stap 5: kijkt welke features klaar zijn en pakt ze automatisch op
- Zorgt dat backend en frontend op dezelfde VM draaien

---

## Confluence Structuur

Alles staat in de **"AI documentations"** space op Confluence.

- **Cloud ID**: `2ff8bead-845a-4276-aabb-1191cfc4ac6b`
- **Space ID**: `372080644` (space key: AS)

Per feature:
```
Features/
└── [Feature Titel] (folder page)
    ├── Scope — [Feature Titel]
    ├── Architecture Overview — [Feature Titel]
    ├── Backend Architecture — [Feature Titel]
    ├── Frontend Architecture — [Feature Titel]
    ├── Figma Reference — [Feature Titel] (optioneel)
    └── Development Status — [Feature Titel] (aangemaakt door engineer-skills)
```

De engineer-skills halen zelf alle content op uit Confluence via de Atlassian MCP tools (`searchAtlassian`, `getConfluencePage`, `getConfluencePageDescendants`).

---

## Slack Structuur

### #ai-agents-test (`C0APFU4EWAG`)
Het hoofdkanaal voor de feature-pipeline. Hier wordt de voortgang van elke feature bijgehouden.

**Feature-initializatie bericht (parent):**
```
🚀 New feature initialized: [feature naam]
Pipeline folder: [Confluence link]
Scope: ✅/⏳ | UX Flows: ✅/⏳ | UI Designs: ✅/⏳ | Architecture: ✅/⏳ | Backend: ✅/⏳ | Frontend: ✅/⏳
Next up: [volgende stap]
```

**Thread-replies bevatten status-updates:**
- "✅ Scope complete: [feature]" + link
- "✅ Architecture published: [feature]" + links
- "🔧 vm-1: Backend sessie gestart voor [feature]"
- "✅ vm-1: Backend afgerond voor [feature]"
- "🔧 vm-1: Frontend sessie gestart voor [feature]"
- "✅ vm-1: Frontend afgerond voor [feature]"
- "❌ vm-2: Backend geblokkeerd voor [feature]" + reden

### #vm-allocation (`C0AP16RN1RV`)
Houdt bij welke VM wat doet. Simpele status-berichten:

```
🔧 vm-1: Bezig met [feature] (backend)
✅ vm-1: Klaar met [feature] backend — VM is vrij
🔧 vm-1: Bezig met [feature] (frontend)
✅ vm-1: Klaar met [feature] frontend — VM is vrij
```

---

## Infrastructuur

### Vultr VMs
- **Aantal**: start met 3 machines (vm-1, vm-2, vm-3)
- **OS**: Windows met Docker, Python, Node, Claude Code, az CLI, Git
- **Specs**: Standard (4 vCPUs, 16GB RAM) — draait de volledige LegalMind stack
- **Golden image**: één VM wordt ingericht, een Vultr Snapshot gemaakt, en daarvan worden kopieën gedeployed
- **Locatie**: Europa (Amsterdam)

### Waarom dezelfde VM voor backend + frontend?
De frontend-sessie heeft de draaiende backend nodig om te kunnen testen. De backend draait lokaal op poort 7071/7072. Als de frontend op een andere VM zou draaien, heeft die geen toegang tot de backend. Daarom worden backend en frontend van dezelfde feature altijd op dezelfde VM gebouwd.

### Hosting op de VMs
Op de Vultr VMs is Claude Code altijd de host — er is geen developer die handmatig dingen opstart. Daarom gebruiken de engineer-skills op de VMs altijd de `references/claude-hosting.md` instructies voor het opzetten van de omgeving.

**Backend omgeving:**
- Docker met azure-sql-edge (Apple Silicon fix niet nodig op Vultr — dat is x86)
- Redis als lokale container (REDIS_PORT in .env)
- Azure login via `az login` voor Key Vault
- Backend op uvicorn poort 7071 (fallback 7072)
- BACPAC bestand moet beschikbaar zijn op de VM

**Frontend omgeving:**
- Check of backend draait op poort 7071/7072
- Frontend op poort 5173 (fallback 5174)
- Configureer frontend om lokale backend te gebruiken

---

## Ontwerpkeuzes en waarom

### Waarom Slack en niet alleen Confluence?
Confluence is de source of truth voor de inhoud (scope, architectuur, code). Maar Slack is beter voor real-time status en orchestratie — het is sneller te checken, threads geven een chronologisch overzicht, en het team kan meekijken.

### Waarom scheduled task elke 5 minuten?
Een feature bouwen duurt typisch 20-60 minuten. Elke 5 minuten pollen is frequent genoeg om snel werk op te pakken, maar niet zo frequent dat het Slack-API-limiet raakt. De check zelf is lichtgewicht (2 Slack reads).

### Waarom niet meer dan 24 uur terugkijken?
Features die langer dan 24 uur in de queue staan zijn ofwel al opgepakt (en het bericht is gemist), ofwel er is een probleem dat handmatige aandacht nodig heeft. Dit voorkomt dat oude features steeds opnieuw worden geëvalueerd.

### Waarom claim-before-build?
Race condition preventie. Als twee VMs tegelijk dezelfde feature zien, claimt de snelste hem in Slack. De andere ziet het claim-bericht bij de thread-check en slaat de feature over. Dit is niet 100% waterdicht (er zit milliseconden overlap), maar in de praktijk met 3 VMs en 5-minuten cycles is de kans op een conflict verwaarloosbaar.

### Waarom geen Azure?
Legal Mind gebruikt Azure voor productie-infra (Key Vault, SQL, EntraID), maar voor dev-machines is Vultr gekozen vanwege simpliciteit en kosten. Vultr biedt Windows VPS met RDP-toegang, Snapshots voor het klonen van machines, en Europese datacenters (Amsterdam). Geen vendor lock-in met Azure's complexere VM-management.

---

## Toekomstige uitbreidingen

Dit systeem is ontworpen om te groeien:

- **Meer VMs**: voeg simpelweg meer Vultr machines toe vanuit het Snapshot. Ze pikken automatisch werk op.
- **Design-automatisering**: als Figma-integratie wordt toegevoegd aan de keten, kan die stap ook automatisch getriggered worden.
- **PR-automatisering**: de engineer-skills kunnen in de toekomst automatisch PRs openen en reviewers taggen.
- **Monitoring dashboard**: een Cowork scheduled task kan een Slack canvas of Confluence-pagina bijhouden met een overzicht van alle VMs en features.

---
name: agent-rapportage
description: >
  Centraal rapportagesysteem voor scheduled skills op de VM. Twee modi:
  (1) Leer-modus — andere skills roepen dit aan om het rapportageformat te leren.
  (2) Dagrapport — compileert runlogs, update Slack Canvas, stuurt e-mail.
  Trigger bij: "rapportage", "dagrapport", "agent overzicht", "hoe gaat het
  met mijn agents", "agent status", "rapportage instellen", "skill aansluiten
  op rapportage", "hoe moet ik rapporteren", "agent dashboard", "hoeveel runs
  vandaag", "welke agents hebben fouten", "agent health check", of wanneer
  een skill wil leren rapporteren. Trigger OOK bij nieuwe skill aansluiten
  of agent-status vragen. NIET voor schedule-skill of vm-dispatcher taken.
---

# Agent Rapportage — Centraal Rapportagesysteem

Dit is het zenuwstelsel van alle scheduled skills op de VM. Elke skill die autonoom draait — auto-draft, vm-dispatcher, marktonderzoek, of wat er in de toekomst bijkomt — rapporteert via dit systeem. Het doel: Jelle hoeft niet meer in te loggen op de VM om te weten hoe het gaat.

## Bestandsstructuur

```
agent-rapportage/
├── SKILL.md                          ← Dit bestand (routing + instructies)
├── references/
│   ├── json-schema.md                ← Exact format voor runlogs en skill-registratie
│   ├── slack-canvas-template.md      ← Layout van het Slack Canvas dashboard
│   └── email-template.md             ← Template voor het dagelijks e-mailrapport
├── scripts/
│   ├── compile_report.py             ← Compileert JSON runlogs tot dagrapport-data
│   └── dashboard.html                ← Lokaal HTML-dashboard (drag-drop of auto-load)
└── templates/
    └── scheduled-task-prompt.md      ← Prompt voor de dagrapport scheduled task
```

### Wanneer welk bestand lezen

| Situatie | Lees dit |
|---|---|
| **Een skill wil leren rapporteren (Modus 1)** | `references/json-schema.md` |
| **Dagrapport genereren (Modus 2)** | Alles: `references/json-schema.md` + `references/slack-canvas-template.md` + `references/email-template.md` |
| **Jelle vraagt "hoe gaat het met mijn agents?"** | Direct: lees de runlogs + `references/slack-canvas-template.md` voor format |
| **Nieuwe skill aansluiten** | `references/json-schema.md` (geef de instructies door) |
| **Scheduled task aanmaken** | `templates/scheduled-task-prompt.md` |

---

## Twee modi

### Modus 1: "Leer mij rapporteren" (aangeroepen door andere skills)

Dit is de meest gebruikte modus. Een andere skill roept deze skill aan en zegt: "Ik ben klaar met mijn run, hoe rapporteer ik?" Jij geeft dan de volgende instructies terug zodat de aanroepende skill zelf het juiste doet.

**Wat je doet:**

1. Lees `references/json-schema.md` — dit bevat het exacte JSON-format
2. Geef de aanroepende skill twee dingen:
   - **Het runlog-format** — een JSON-bestand dat na elke run geschreven wordt
   - **De skill-registratie** — een eenmalig JSON-bestand dat de skill beschrijft (als het nog niet bestaat)
3. Geef de **bestandslocaties** door:
   - Runlogs: `/home/user/agent-reports/runs/{skill-naam}-{YYYY-MM-DD}T{HH-MM}.json`
   - Registratie: `/home/user/agent-reports/skills/{skill-naam}.json`
4. Geef de **Slack-instructies** door:
   - Bij fouten of warnings: post naar `#agent-alerts` (kanaal-ID: moet nog aangemaakt worden)
   - Bij vragen aan Jelle: post naar `#agent-vragen` (kanaal-ID: moet nog aangemaakt worden)
   - Bij succesvolle runs: alleen het JSON-bestand schrijven, geen Slack-bericht nodig

**Wat de aanroepende skill vervolgens zelf doet:**

De skill schrijft het JSON-bestand zelf. Dit houdt het simpel: geen dependency op een draaiende agent, geen API-call, gewoon een bestandje op disk. De rapportage-skill is alleen de "leraar" die het format uitlegt.

**Belangrijk voor de skill die aanroept — geef dit altijd mee:**
- Maak de directory `/home/user/agent-reports/runs/` en `/home/user/agent-reports/skills/` aan als die nog niet bestaan (`mkdir -p`)
- Het runlog-bestand moet geschreven worden als **laatste stap** van de run, zodat het alleen bestaat als de run (grotendeels) voltooid is
- Bij een crash of fatale fout: schrijf alsnog het runlog met `status: "failed"` en een duidelijke error-beschrijving
- Check of het skill-registratiebestand al bestaat. Zo niet: schrijf het eenmalig. Zo ja: sla over (niet overschrijven).

---

### Modus 2: Dagrapport (scheduled task, einde dag)

Draait als scheduled task, standaard om **21:00** op werkdagen en **18:00** in het weekend. Compileert alle runlogs van de dag tot één overzicht en distribueert het via drie kanalen.

**De workflow:**

1. **Verzamel** — Lees alle JSON-bestanden in `/home/user/agent-reports/runs/` die van vandaag zijn (datum in bestandsnaam)
2. **Lees registraties** — Lees alle skill-registraties uit `/home/user/agent-reports/skills/` voor display-namen, beschrijvingen, en health-rules
3. **Compileer** — Groepeer per skill, tel successen/fouten, bereken metrics, check health-rules
4. **Health check** — Per skill: draait die nog? Is de success-rate boven de drempel? Zijn er openstaande vragen?
5. **Distribueer** het rapport via drie kanalen (in deze volgorde):

#### Kanaal A: Slack Canvas (live dashboard)

Update de Slack Canvas met het actuele overzicht. Lees `references/slack-canvas-template.md` voor de exacte layout. De Canvas is een permanent document in Slack dat Jelle op elk moment kan openen — het is altijd up-to-date na het dagrapport.

- Canvas naam: "Agent Dashboard"
- Locatie: in kanaal `#agent-rapportage` (kanaal-ID: moet nog aangemaakt worden)

De Canvas bevat:
- **Sectie 1: Vragen die wachten** — Openstaande vragen uit `#agent-vragen` die nog geen antwoord hebben
- **Sectie 2: Alerts** — Skills die vandaag gefaald hebben of te lang niet gedraaid hebben
- **Sectie 3: Dagelijkse metrics** — Per skill: runs vandaag, succespercentage, en de belangrijkste metric
- **Sectie 4: Planning** — Welke skills zijn actief, wat is hun schedule, wanneer is de volgende run

#### Kanaal B: E-mail dagrapport

Stuur een overzichtelijke e-mail naar Jelle (burggraaf@legal-mind.nl) via Chrome (Outlook web). Lees `references/email-template.md` voor de exacte template. De e-mail is een snapshot van de dag — compact, scanbaar, en met duidelijke call-to-actions als er iets nodig is.

De e-mail bevat:
- Onderwerp: "Agent Dagrapport — {datum} — {aantal_runs} runs, {aantal_fouten} fouten"
- Samenvatting in 2-3 zinnen bovenaan
- Per skill een regeltje met status-emoji en kernmetric
- Eventuele openstaande vragen of acties

#### Kanaal C: Slack samenvatting

Post een korte samenvatting in `#agent-rapportage` als gewoon bericht. Niet de volledige Canvas-inhoud, maar een compacte versie:
```
📊 Agent Dagrapport — wo 2 apr 2026
✅ Auto-Draft: 7 runs, 24 drafts geschreven
✅ Marktonderzoek: 15 runs, 12 kantoren verrijkt
⚠️ VM-Dispatcher: 3 runs, 1x geen werk gevonden
❌ CRM-Verrijking: 0 runs — niet gedraaid sinds 14:00

🙋 1 vraag wacht op je antwoord in #agent-vragen
```

---

## Slack-kanalen

Dit systeem gebruikt drie Slack-kanalen:

| Kanaal | Doel | Wie post er? |
|---|---|---|
| `#agent-rapportage` | Dagrapport + Canvas dashboard | Alleen de dagrapport-agent |
| `#agent-alerts` | Real-time foutmeldingen en warnings | Individuele skills (als onderdeel van hun rapportage) |
| `#agent-vragen` | Vragen van agents aan Jelle | Individuele skills (wanneer ze input nodig hebben) |

**Let op:** deze kanalen moeten bestaan voordat het systeem werkt. Bij de eerste setup (wanneer Jelle zegt "stel rapportage in" of "maak de kanalen aan"):

1. Zoek eerst of deze kanalen al bestaan via `slack_search_channels`
2. Zo niet: maak ze aan. Zo ja: gebruik de bestaande kanaal-ID's
3. Sla de kanaal-ID's op in `/home/user/agent-reports/config.json`:
   ```json
   {
     "channels": {
       "rapportage": "C_XXXXXXXXX",
       "alerts": "C_XXXXXXXXX",
       "vragen": "C_XXXXXXXXX"
     },
     "email": "burggraaf@legal-mind.nl",
     "canvas_id": "F_XXXXXXXXX"
   }
   ```
4. Maak de Slack Canvas "Agent Dashboard" aan in `#agent-rapportage`

---

## Hoe een nieuwe skill aansluiten

Dit is bewust zo simpel mogelijk gehouden. Om een nieuwe skill aan te sluiten op het rapportagesysteem:

1. Voeg aan het einde van de skill-instructies (SKILL.md) een sectie toe:

```markdown
## Rapportage

Na elke run rapporteer je het resultaat. Lees hiervoor de rapportage-skill:
`agent-rapportage/references/json-schema.md`

Dit geeft je het exacte JSON-format en de bestandslocaties. Schrijf het runlog
als laatste stap van je run. Bij fouten: post ook naar #agent-alerts via Slack.
Bij vragen aan Jelle: post naar #agent-vragen.
```

2. Dat is het. De skill leest het schema, schrijft het JSON-bestand, en is aangesloten.

De skill hoeft de rapportage-skill niet als dependency te hebben of aan te roepen als een aparte agent. Het leest alleen het referentiebestand voor het format, net zoals een ontwikkelaar een API-documentatie leest.

---

## Wanneer Jelle handmatig vraagt "hoe gaat het?"

Als Jelle vraagt naar de status van zijn agents (buiten het dagrapport om):

1. Lees alle runlogs van vandaag uit `/home/user/agent-reports/runs/`
2. Lees de skill-registraties uit `/home/user/agent-reports/skills/`
3. Geef een beknopt overzicht in de chat, gesorteerd op prioriteit:
   - Eerst: openstaande vragen en fouten
   - Dan: voortgang per skill
   - Tot slot: planning (wat draait er en wanneer)
4. Als er specifieke problemen zijn: bied aan om de details te bekijken

---

## Setup checklist (eerste keer)

Wanneer het rapportagesysteem voor het eerst wordt ingericht:

- [ ] Maak de directories aan: `/home/user/agent-reports/runs/` en `/home/user/agent-reports/skills/`
- [ ] Maak of vind de drie Slack-kanalen en sla de ID's op in `config.json`
- [ ] Maak de Slack Canvas "Agent Dashboard" aan in `#agent-rapportage`
- [ ] Maak de scheduled task aan voor het dagrapport (lees `templates/scheduled-task-prompt.md`)
- [ ] Voeg de rapportage-sectie toe aan minimaal één bestaande skill als test
- [ ] Verifieer dat het runlog correct geschreven wordt
- [ ] Verifieer dat het dagrapport correct compileert en distribueert

---

## HTML Dashboard (lokaal op de VM)

Naast de Slack Canvas en e-mail is er een HTML-dashboard dat lokaal op de VM draait. Dit is handig voor een visueel overzicht wanneer je via SSH op de VM bent, of als je het via een simpele webserver beschikbaar wilt maken.

### Setup

1. Kopieer `scripts/dashboard.html` naar een handige locatie, bijv. `/home/user/agent-reports/dashboard.html`
2. Het dashboard laadt automatisch `rapport.json` uit dezelfde map, of je kunt een JSON-bestand drag-and-droppen
3. Optioneel: draai een simpele webserver voor remote toegang:
   ```bash
   cd /home/user/agent-reports && python3 -m http.server 8080 &
   ```
4. Het dagrapport-script kan het rapport ook als JSON naast het dashboard opslaan:
   ```bash
   python3 compile_report.py /home/user/agent-reports > /home/user/agent-reports/rapport.json
   ```

Het dashboard toont:
- Samenvattingskaarten (totaal runs, geslaagd, gefaald, actieve skills)
- Openstaande vragen en kritieke fouten prominent bovenaan
- Per-skill detailkaarten met status, metrics, health, schedule
- Week-overzicht als staafgrafiek

Het dashboard heeft auto-refresh (elke 60 seconden) en werkt volledig client-side — geen server-side code nodig behalve file serving.

---

## Opruimen van oude runlogs

Runlogs worden per run opgeslagen, dus ze stapelen op. Om de disk schoon te houden:

- Bewaar runlogs van de **laatste 30 dagen** op disk
- Het dagrapport-script ruimt automatisch runlogs ouder dan 30 dagen op
- De Slack Canvas en e-mails bevatten alleen data van vandaag (historische data zit in de Slack-berichten)

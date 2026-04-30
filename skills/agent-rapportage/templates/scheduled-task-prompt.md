# Scheduled Task Prompt — Dagelijks Agent Rapport

Gebruik deze prompt bij het aanmaken van de scheduled task via de `schedule` skill.

---

## Task configuratie

- **Naam:** `dagrapport-agents`
- **Schedule:** Werkdagen (ma-vr) om 21:00, weekend (za-zo) om 18:00
- **Beschrijving:** Compileert alle agent-runlogs van vandaag en distribueert het rapport via Slack Canvas, e-mail, en Slack-bericht.

---

## Prompt voor de scheduled task

```
Je bent de dagrapport-agent. Jouw taak: compileer het overzicht van alle agent-runs van vandaag en distribueer het via drie kanalen.

## Stap 1: Compileer het rapport

Run het compile-script:
```bash
python /path/to/agent-rapportage/scripts/compile_report.py /home/user/agent-reports --cleanup
```

Lees de JSON-output. Dit bevat alle data die je nodig hebt.

## Stap 2: Check openstaande vragen

Lees kanaal #agent-vragen en check welke vragen nog geen antwoord van Jelle hebben. Voeg deze toe aan het rapport als "vragen die wachten".

## Stap 3: Update Slack Canvas

Lees de Canvas-template uit agent-rapportage/references/slack-canvas-template.md.
Lees de Canvas ID uit /home/user/agent-reports/config.json.
Update de Canvas met de actuele data.

## Stap 4: Stuur e-mail

Lees de e-mail template uit agent-rapportage/references/email-template.md.
Open Outlook web via Chrome en stuur het dagrapport naar burggraaf@legal-mind.nl.

## Stap 5: Post Slack samenvatting

Post een compacte samenvatting in #agent-rapportage. Format:

📊 Agent Dagrapport — {dag} {datum}
{per skill: emoji + naam + runs + kernmetric}

{als er vragen wachten: 🙋 X vraag/vragen wacht(en) op je antwoord in #agent-vragen}
{als er fouten zijn: 🚨 X skill(s) met fouten — zie Canvas voor details}

## Stap 6: Schrijf je eigen runlog

Ja, ook het dagrapport zelf rapporteert. Schrijf een runlog naar /home/user/agent-reports/runs/ met:
- skill: "dagrapport-agents"
- metrics: skills_reported, questions_pending, errors_found, email_sent (true/false), canvas_updated (true/false)
```

---

## Setup-instructie

Maak deze scheduled task aan met de `schedule` skill. Zorg dat:
1. De Slack-kanalen bestaan en de ID's in config.json staan
2. De Slack Canvas is aangemaakt
3. Chrome beschikbaar is voor het versturen van de e-mail
4. Het compile-script uitvoerbaar is

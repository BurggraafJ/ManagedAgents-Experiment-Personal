---
name: slack-communication
description: >
  Centrale referentie voor alle Slack-communicatie vanuit skills en scheduled tasks.
  Bevat channel registry, berichtformaten, threading-protocol, emoji-conventies en
  foutafhandeling. Verplicht te lezen door elke skill die Slack-berichten verstuurt,
  vóór het eerste bericht. Trigger NIET als zelfstandige actie — dit is een referentie-skill
  die andere skills inladen. Gebruik wanneer een andere skill verwijst naar
  "lees de slack-communication skill".
---

# Slack Communication — Centrale Referentie

Dit document is de single source of truth voor alles wat met Slack-communicatie te maken
heeft. Elke skill die Slack gebruikt, leest dit document vóór het eerste bericht.
Als je iets wilt wijzigen aan formatting, emoji of kanaalindeling — doe dat hier, en
alle skills volgen automatisch.

---

## Workspaces & Channel Registry

### Personal Ops (`personal-ops-group.slack.com`)

Persoonlijke automatisering en rapportage van Jelle Burggraaf.

| Channel | ID | Gebruikt door |
|---|---|---|
| #kilometerregistratie | `C0ARSSS57BM` | kilometerregistratie skill |
| #linkedin-connect | `C0ARX7VNDC6` | linkedin-connect skill |
| #daily-drafting | `C0AQ5978TJB` | auto-draft skill (drafts en status) |
| #daily-drafting-skipped | `C0AS2CCG0TG` | auto-draft skill (overgeslagen mails) |
| #daily-hubspot-update | `C0AQLSAB5SN` | hubspot-daily-sync skill |
| #communication | `C0AQJM40HK8` | auto-draft, hubspot-daily-sync (vragen + opdrachten) |
| #feedback | `C0AS3N60AKV` | agent-manager (feedback van Jelle, health check digest) |

### Legal Mind (`legal-mind-group.slack.com`)

Teamcommunicatie Legal Mind B.V.

| Channel | Gebruik |
|---|---|
| Feature-threads | product-owner-scope-creator (reply op bestaande threads) |

---

## Emoji-woordenboek

Gebruik deze emoji consistent in alle skills. Nooit afwijken zonder de tabel hier bij te werken.

| Emoji | Betekenis | Gebruik |
|---|---|---|
| 🚀 | Gestart / nieuw bericht | Openingsbericht van een run |
| 🔄 | Bezig / loading | Tussenstap in progress |
| ✅ | Klaar / succesvol | Afgeronde stap of hele run |
| ❓ | Vraag / onduidelijkheid | Als de skill input nodig heeft |
| ⚠️ | Waarschuwing / probleem | Rate-limit, API-fout, afwijking |
| ❌ | Fout / mislukt | Harde fout, run gestopt |
| ⏭ | Overgeslagen | Item bewust niet verwerkt |
| 📋 | Overzicht / plan | Conceptoverzicht of weekplan |
| 📊 | Statistieken / rapport | Afrondingsbericht met cijfers |
| 💬 | Notitie / context | Extra toelichting |
| 🔗 | Link / koppeling | Verwijzing naar externe resource |
| 📅 | Datum / planning | Tijdsgebonden info |

---

## Berichtformaten

### Startbericht (nieuw top-level bericht)

Gebruik dit als het begin van een nieuwe run. Houd het kort — de details komen in thread-replies.

```
[SKILL-EMOJI] *[Skill naam] — [context, bijv. maand of weeknummer]*

🔄 [Korte omschrijving van wat er nu gebeurt]...
```

Voorbeelden:
```
🚗 *Kilometerregistratie april 2026*
🔄 Outlook-agenda uitlezen...

🔗 *LinkedIn Connect — week 16, 20 april*
🔄 HubSpot proefperiode deals ophalen...

📊 *HubSpot Daily Sync — maandag 20 april*
🔄 Outlook mail en agenda van vandaag scannen...
```

Sla de `ts` (timestamp) van dit bericht op — alle vervolgberichten gaan als thread-reply hierop.

### Thread-reply: voortgang

Kort, actiegericht. Geen opsommingen tenzij er meer dan 3 punten zijn.

```
🔄 [Wat er nu gebeurt] — [detail]
```

### Thread-reply: plan / overzicht

Gebruik dit voor een conceptoverzicht of weekplan vóórdat er actie ondernomen wordt.

```
📋 *[Titel]*

[Inhoud — compact, gebruik emoji-woordenboek]

[Totaalregel indien van toepassing]
```

### Thread-reply: vragen

Post ALLE vragen in één bericht. Nummer ze zodat Jelle per nummer kan antwoorden.
Wacht op antwoord vóórdat je verdergaat — zie "Wacht-protocol" hieronder.

```
❓ *Vragen voor [context]*

1. [Concrete vraag]
2. [Concrete vraag]

_Reply in deze thread om door te gaan._
```

### Thread-reply: resultaat per item

Na het afronden van een deelstap (bijv. één kantoor, één maand, één deal).

```
✅ *[Naam item]* — [kernresultaat]
[Detailregel indien nodig]
```

Of bij een probleem:
```
⚠️ *[Naam item]* — [wat er misging]
[Wat er gedaan is of gevraagd wordt]
```

### Afrondingsbericht (weekafsluiting of run-afsluiting)

Post dit als laatste thread-reply wanneer de run volledig klaar is.

```
✅ *[Skill naam] — klaar*

📊 [Kernstatistiek 1]
📊 [Kernstatistiek 2]
[Optioneel: preview volgende run]
```

### Foutbericht

Bij een harde fout waardoor de skill stopt.

```
❌ *[Skill naam] — gestopt*

⚠️ [Wat er fout ging]
[Wat Jelle moet doen om verder te gaan]
```

---

## Threading-protocol

**Wanneer een nieuw top-level bericht:**
- Begin van een nieuwe run (daily, weekly, monthly)
- Nieuw onderwerp dat los staat van een vorige run

**Wanneer een thread-reply (op het startbericht van die run):**
- Alle updates, voortgang, vragen en resultaten binnen dezelfde run
- Afrondingsbericht

**Nooit:**
- Meerdere top-level berichten voor dezelfde run
- Thread-replies op berichten van een andere run
- Berichten sturen in een verkeerd kanaal

---

## Wacht-protocol (vragen & goedkeuring)

Wanneer de skill input nodig heeft van Jelle:

1. Post de vraag als thread-reply (format: zie "vragen" hierboven)
2. **Stop de run** — ga niet verder gokken
3. Bij de volgende run of manuele trigger: lees eerst de thread uit
   (`slack_read_thread` op het startbericht van de lopende run)
4. Als Jelle geantwoord heeft → verwerk het antwoord, ga verder
5. Als er nog geen antwoord is → post een korte herinnering en stop opnieuw:
   ```
   💬 Wacht nog op antwoord op vraag [X] hierboven. Reply om door te gaan.
   ```

**Goedkeuring geldt als:** Jelle schrijft "akkoord", "ok", "goed", "goedgekeurd",
"doe maar", of beantwoordt de gestelde vragen. Wees niet streng — als de intentie
duidelijk is, is het goedkeuring.

---

## Foutafhandeling

| Situatie | Actie |
|---|---|
| Slack niet bereikbaar | Log lokaal, retry 2x met 5s tussenpauze, dan stoppen |
| Verkeerd channel ID | Post fout in chat (niet in Slack), vraag aan Jelle |
| Bericht te lang (>4000 tekens) | Splits in meerdere thread-replies |
| Dubbele run (lock actief) | Skip de run, geen bericht sturen |
| Geen antwoord na 7 dagen | Beschouw vraag als vervallen, ga verder zonder die info |

---

## Skip-rapportage — apart kanaal

Overgeslagen items (skips) worden **nooit** in het hoofdkanaal van een skill gemeld.
Ze vervuilen de primaire thread en zijn zelden actionable. Gebruik hiervoor een apart
kanaal zodat het hoofd-logboek schoon blijft.

**Voor auto-draft:** skips gaan naar `#daily-drafting-skipped` (`C0AS2CCG0TG`).

**Protocol:**
- Post per dag één top-level bericht in het skip-kanaal zodra de eerste skip optreedt.
  Sla de `ts` op — alle skip-updates van die dag gaan als thread-reply daarop.

---

## Command Center — #communication als taakbak

Naast vragen die agents stellen, functioneert #communication ook als taakbak: Jelle kan
er opdrachten intypen die agents bij hun volgende run oppakken en uitvoeren.

### Opdrachtsyntax

```
[PREFIX]: [opdracht]
```

Prefix is hoofdletterongevoelig. Voorbeelden:

```
LinkedIn: connect Kneppelhout Advocaten deze week
Draft: schrijf een antwoord op de mail van Evert Verheul over de SLA
HubSpot: Epona aanmaken als nieuwe deal, focus MCP Server
```

### Welke skill luistert naar welk prefix

| Prefix | Skill | Wanneer opgepikt |
|---|---|---|
| `LinkedIn:` | linkedin-connect | Volgende maandagsrun (of handmatig) |
| `Draft:` | auto-draft | Volgende run (~15 min op werkdag) |
| `HubSpot:` | hubspot-daily-sync | 17:00 run van die dag |
| `Km:` of `Rit:` | kilometerregistratie | Op verzoek of 2e van de maand |

### Protocol voor agents

Elke agent checkt #communication in zijn Slack-check stap (0b of 0c) op nieuwe
opdracht-berichten die nog niet verwerkt zijn:

1. Lees recente berichten in #communication (laatste 7 dagen)
2. Filter op eigen prefix, van Jelle (user `U0ARF0X5W1W`), zonder ✅-reply
3. Voer de opdracht uit als onderdeel van de huidige run
4. Post een thread-reply op het opdracht-bericht:
   ```
   ✅ Opgepakt — [wat er gedaan is]
   ```
   Daarmee is het bericht gemarkeerd als verwerkt en wordt het niet opnieuw opgepakt.

### Regels

- Eén ✅-reply = verwerkt. Nooit twee keer uitvoeren.
- Als de opdracht niet uitvoerbaar is in deze run (bijv. LinkedIn op donderdag):
  post een thread-reply: `📅 Wordt opgepakt bij volgende [dag]-run.`
- Als de opdracht onduidelijk is: post een ❓ thread-reply met een concrete vraag.
- Opdrachten ouder dan 7 dagen zonder ✅: beschouw als vervallen, niet uitvoeren.
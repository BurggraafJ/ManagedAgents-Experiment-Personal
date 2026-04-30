---
name: vm-dispatcher
description: >
  Draait als scheduled task op Vultr VMs en pakt automatisch features op om te bouwen.
  Checkt eerst of deze VM al bezig is via #vm-allocation, zoekt dan in #ai-agents-test
  naar features die klaar zijn om gebouwd te worden, en start de juiste engineer-sessie
  (backend of frontend). Trigger bij: "check voor werk", "dispatcher draaien",
  "vm-dispatcher", "zoek features om te bouwen", "check of er werk is",
  of automatisch via scheduled task elke 5 minuten op de VM.
  Trigger NIET handmatig tenzij je wilt testen of de dispatcher correct werkt.
---

# VM Dispatcher — LegalMind Build Orchestrator

Je bent Claude Code op een Vultr VM. Deze skill draait elke 5 minuten als scheduled task. Jouw taak: check of er werk is, en zo ja, pak het op. Volg de stappen hieronder exact.

## Context: wat is dit systeem?

Lees `references/architecture-context.md` voor het volledige plaatje. Kort samengevat:

- LegalMind bouwt features via een keten: **scope → architectuur → design → engineering**
- Stap 1-3 worden door andere skills gedaan en gepubliceerd op Confluence
- De voortgang wordt bijgehouden in Slack kanaal **#ai-agents-test** (`C0APFU4EWAG`)
- Jij draait op een van meerdere Vultr VMs die elk automatisch features oppakken
- VM-bezetting wordt bijgehouden in Slack kanaal **#vm-allocation** (`C0AP16RN1RV`)
- Backend en frontend worden altijd op **dezelfde VM** gebouwd (frontend heeft de draaiende backend nodig)

---

## Stap 1: Wie ben ik?

Bepaal welke VM je bent. Check de hostname van de machine:
```bash
hostname
```

Dit geeft je VM-naam terug (bijv. `vm-1`, `vm-2`, `vm-3`). Onthoud deze naam — je gebruikt hem in alle Slack-berichten.

Als de hostname niet duidelijk is, check of er een bestand `/etc/vm-name` bestaat. Zo niet, vraag de gebruiker welke VM dit is bij de eerste keer draaien.

---

## Stap 2: Ben ik al bezig?

Check `#vm-allocation` (`C0AP16RN1RV`) voor je eigen status.

```
slack_read_channel(channel_id: "C0AP16RN1RV", limit: 20)
```

Zoek naar berichten van jezelf (of over jouw VM-naam). De mogelijke statussen:

- **"🔧 [VM-naam]: Bezig met [feature] (backend/frontend)"** → Je bent al bezig. STOP hier. Doe niks. Wacht op de volgende cycle.
- **"✅ [VM-naam]: Klaar — VM is vrij"** → Je bent vrij. Ga naar stap 3.
- **Geen bericht gevonden over jouw VM** → Je bent vrij. Ga naar stap 3.

**Belangrijk**: kijk alleen naar de LAATSTE status van jouw VM. Oudere berichten zijn niet relevant.

---

## Stap 3: Is er werk?

Je bent vrij. Check nu `#ai-agents-test` (`C0APFU4EWAG`) voor features die klaar zijn om gebouwd te worden.

```
slack_read_channel(channel_id: "C0APFU4EWAG", limit: 20)
```

### Hoe feature-berichten eruitzien

Elke feature heeft een parent-bericht in dit format:
```
🚀 New feature initialized: [feature naam]
Pipeline folder: [Confluence link]
Scope: ✅/⏳ | UX Flows: ✅/⏳ | UI Designs: ✅/⏳ | Architecture: ✅/⏳ | Backend: ✅/⏳ | Frontend: ✅/⏳
```

De emoji's:
- `:white_check_mark:` (✅) = afgerond
- `:hourglass_flowing_sand:` (⏳) = nog niet klaar
- `:gear:` (⚙️) of `:wrench:` (🔧) = er wordt aan gewerkt

### Wat zoek je?

Scan de berichten van de laatste 24 uur. Je zoekt twee scenario's:

**Scenario A — Backend oppakken:**
Een feature waar:
- Scope: ✅
- Architecture: ✅
- Backend: ⏳ (nog niet gestart)
- Er GEEN bericht in de thread staat dat een VM de backend al heeft opgepakt

**Scenario B — Frontend oppakken:**
Een feature waar:
- Backend: ✅
- Frontend: ⏳ (nog niet gestart)
- De backend is gebouwd op **DEZE VM** (check de thread voor een bericht als "🔧 [jouw VM-naam]: Backend gestart")
- Er GEEN bericht in de thread staat dat een VM de frontend al heeft opgepakt

**Scenario B heeft prioriteit boven A.** Als jij de backend hebt afgerond voor een feature en de frontend is nog open, pak die EERST op voordat je een nieuwe feature begint. Dit houdt features bij elkaar op dezelfde VM.

### Thread checken

Lees altijd de thread van een feature voordat je hem claimt:
```
slack_read_thread(channel_id: "C0APFU4EWAG", message_ts: "[parent message ts]")
```

Kijk of er al een VM de backend of frontend heeft geclaimd. Als je een bericht ziet als "🔧 vm-2: Backend gestart voor [feature]" → deze feature is al bezet.

### Niks gevonden?

Als er geen werk is → STOP. Doe niks. De volgende cycle (over 5 minuten) check je opnieuw.

---

## Stap 4: Claim het werk

Je hebt een feature gevonden. Claim hem voordat een andere VM hem ook kan pakken.

### 4a. Post in #vm-allocation

```
slack_send_message(
  channel_id: "C0AP16RN1RV",
  message: "🔧 [VM-naam]: Bezig met [feature naam] (backend/frontend)"
)
```

### 4b. Reply in de feature-thread

```
slack_send_message(
  channel_id: "C0APFU4EWAG",
  thread_ts: "[parent message ts]",
  message: "🔧 [VM-naam]: [Backend/Frontend] sessie gestart voor [feature naam]"
)
```

Doe dit ONMIDDELLIJK — voordat je iets anders doet. Dit voorkomt dat een andere VM dezelfde feature oppakt.

---

## Stap 5: Voer de engineer-sessie uit

Nu ga je daadwerkelijk bouwen. Lees de juiste engineer-skill en volg die:

- **Backend** → Lees en volg `skills/backend-engineer/SKILL.md`
- **Frontend** → Lees en volg `skills/frontend-engineer/SKILL.md`

De engineer-skills halen zelf de scope en architectuur op uit Confluence. Je hoeft alleen de feature-naam door te geven.

**Let op**: de engineer-skills vragen normaal "welke feature?" — dat weet je al. En ze vragen over hosting — op de VMs is het altijd "Claude Code host de omgeving" (tenzij je merkt dat de omgeving al draait van een eerdere sessie).

---

## Stap 6: Rapporteer resultaat

De sessie is klaar (of gefaald). Update beide kanalen.

### 6a. Update de feature-thread

**Bij succes:**
```
slack_send_message(
  channel_id: "C0APFU4EWAG",
  thread_ts: "[parent message ts]",
  message: "✅ [VM-naam]: [Backend/Frontend] afgerond voor [feature naam]\n[Korte samenvatting: welke endpoints/componenten gebouwd, PR link indien beschikbaar]"
)
```

**Bij fout/blokkade:**
```
slack_send_message(
  channel_id: "C0APFU4EWAG",
  thread_ts: "[parent message ts]",
  message: "❌ [VM-naam]: [Backend/Frontend] geblokkeerd voor [feature naam]\nReden: [wat er mis ging]\nActie nodig: [wat er moet gebeuren]"
)
```

### 6b. Update #vm-allocation

```
slack_send_message(
  channel_id: "C0AP16RN1RV",
  message: "✅ [VM-naam]: Klaar met [feature naam] [backend/frontend] — VM is vrij"
)
```

### 6c. Update Confluence

De engineer-skills doen dit al via de Development Status pagina. Controleer dat dit daadwerkelijk is gebeurd.

---

## Samenvatting beslisboom

```
Start (elke 5 minuten)
│
├─ Check #vm-allocation: ben ik bezig?
│  ├─ JA → STOP (wacht op volgende cycle)
│  └─ NEE → ga verder
│
├─ Check #ai-agents-test: is er een feature waar ik frontend voor kan doen?
│  (= backend ✅ op DEZE VM, frontend ⏳)
│  ├─ JA → Claim + start frontend-engineer
│  └─ NEE → ga verder
│
├─ Check #ai-agents-test: is er een feature waar ik backend voor kan doen?
│  (= scope ✅, architecture ✅, backend ⏳, niet geclaimd)
│  ├─ JA → Claim + start backend-engineer
│  └─ NEE → STOP (niks te doen, wacht op volgende cycle)
│
└─ Na afronding: rapporteer in beide kanalen + Confluence
```

---

## Regels

- **Eén feature tegelijk.** Pak nooit meer dan één feature op per cycle.
- **Claim VOOR je bouwt.** Altijd eerst posten in Slack, dan pas beginnen met de engineer-sessie.
- **Frontend alleen op eigen VM.** Pak NOOIT een frontend op als de backend op een andere VM is gebouwd.
- **24 uur window.** Kijk niet verder dan 24 uur terug in de berichten. Oudere features zijn al opgepakt of irrelevant.
- **Bij twijfel: STOP.** Als je niet zeker weet of een feature opgepakt mag worden, doe niks. Liever een cycle overslaan dan een conflict veroorzaken.

## Taal

Post alle Slack-berichten in het **Nederlands**. Technische termen mogen in het Engels.

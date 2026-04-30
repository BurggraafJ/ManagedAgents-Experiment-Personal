# Databronnen — Outlook

Outlook is de databron voor Module 1 (deal-properties), Module 2 (deal-notes),
Module 3 (deal-tasks) en Module 4 (contact-finder). Dit bestand beschrijft
alle zoekstrategieën, patronen en valkuilen.

**Laatste update:** 2026-03-16

---

## 1. Zoekstrategieën

### 1.1 Agenda-items ophalen (voor datumvelden)

```
outlook_calendar_search(
  attendee="@domein.nl",
  afterDateTime="<2 jaar terug>",
  limit=50
)
```

De `attendee` parameter is de meest betrouwbare methode — vindt alle
meetings waar iemand van dat bedrijf bij was.

**Geldigheidsfilters voor agenda-items:**
- `isAllDay: false` — geen hele-dag-events (die zijn altijd deadlines/reminders)
- Duur 15-120 minuten — geen blokkades
- `isCancelled: false` — niet geannuleerd
- Externe attendees (niet @legal-mind.nl / @bg-intelligence.nl)

### 1.2 E-mail zoeken — Laag 1: Sender-scan (snel, onvolledig)

```
outlook_email_search(
  sender="@domein.nl",
  afterDateTime="<tijdsbereik>",
  limit=50
)
```

Vindt alleen e-mails waarbij iemand van dat domein direct aan jou mailde.
Mist: CC-contacten, doorgestuurde berichten, agenda-acceptaties.
Typisch resultaat: ~40% van de contacten.

### 1.3 E-mail zoeken — Laag 2: Query-scan (breder)

```
outlook_email_search(
  query="domein.nl",
  afterDateTime="<tijdsbereik>",
  limit=50
)
```

Zoekt in de volledige tekst. Vindt ook doorgestuurde berichten en
handtekeningen waarin het domein voorkomt.
Typisch resultaat: ~70% van de contacten.

### 1.4 E-mail zoeken — Laag 3: Deep read (volledigst)

```
read_resource(uri="mail:///messages/<message_id>")
```

Lees de volledige e-mail. Dit geeft:
- `toRecipients[]` — array met name + address
- `ccRecipients[]` — array met name + address (CRUCIAAL)
- `body.content` — volledige HTML met doorgestuurde headers

De deep read is essentieel omdat de Outlook zoek-API GEEN CC-velden
retourneert in metadata. De werkelijke To/CC-lijsten zitten alleen in
de volledige e-mail.

### 1.5 E-mail zoeken — Laag 4: Agenda-acceptaties

De meest onderschatte bron. Wanneer iemand een agenda-uitnodiging
accepteert of weigert, komt er een e-mail met hun e-mailadres als sender.

```
outlook_email_search(query="Geaccepteerd domein.nl", ...)
outlook_email_search(query="Geweigerd domein.nl", ...)
outlook_email_search(query="Accepted domein.nl", ...)
outlook_email_search(query="Declined domein.nl", ...)
outlook_email_search(query="Tentatively accepted domein.nl", ...)
```

### 1.6 E-mail zoeken — Laag 5: HR/Admin-mails

E-mails over nieuwe accounts, wijzigingen, en vertrek bevatten vaak
nieuwe e-mailadressen en contactpersonen.

```
outlook_email_search(query="nieuw account domein.nl", ...)
outlook_email_search(query="uit dienst domein.nl", ...)
outlook_email_search(query="wijziging contactpersoon domein.nl", ...)
outlook_email_search(query="new account domein.nl", ...)
```

---

## 2. E-mailadres extractie uit HTML body

Doorgestuurde e-mails bevatten headers in de body:
```
Van: Naam <email@domein.nl>
Aan: Naam <email@domein.nl>
CC: Naam <email@domein.nl>
```

Regex om deze te extraheren:
```python
import re
pattern = r'[\w.+-]+@[\w-]+\.[\w.]+'
emails = set(re.findall(pattern, html_body))
domain_emails = [e for e in emails if target_domain in e.lower()]
```

---

## 3. Naam-extractie patronen

Namen komen uit meerdere bronnen, in volgorde van betrouwbaarheid:
1. `toRecipients[].name` / `ccRecipients[].name` — meest betrouwbaar
2. `sender.name` — betrouwbaar
3. HTML body pattern: `Naam <email>` — goed
4. E-mail handtekening — onbetrouwbaar

**Naam-splitsing voor HubSpot:**
- "Voornaam Achternaam" → firstname: "Voornaam", lastname: "Achternaam"
- "A. van der Baan" → firstname: "A.", lastname: "van der Baan"
- Tussenvoegsels (van, de, van der, op 't) horen bij de achternaam
- Bij één woord: alleen firstname

---

## 4. Deduplicatie

Gebruik altijd het e-mailadres (lowercase) als unieke sleutel:
```python
from collections import defaultdict
master = defaultdict(dict)

def add_contact(domain, email, name=""):
    key = email.lower()
    existing = master[domain].get(key, {})
    if key not in master[domain] or (name and not existing.get("name")):
        master[domain][key] = {"email": email, "name": name}
```

---

## 5. Generieke adressen

Markeer `info@`, `contact@`, `noreply@`, `admin@`, `office@` als "optioneel".
Ze zijn vaak niet gekoppeld aan een specifieke persoon maar kunnen wel
relevant zijn als catch-all contactpunt.

---

## 6. Alternatieve domeinen

Sommige bedrijven gebruiken een ander domein dan in HubSpot staat.
Voorbeeld: HubSpot heeft `vanderkooijbestersadvocaten.nl`, werkelijke
e-mails gebruiken `vdkb-advocaten.nl`.

Controleer altijd de eerste paar e-mails om te zien welk domein
daadwerkelijk wordt gebruikt en scan beide domeinen.

---

## 7. Actieve vs. vertrokken medewerkers

Controleer of gevonden contacten nog actief zijn:
- Recente e-mails (afgelopen 3 maanden) van dat adres
- "Uit dienst" / "verlaat" / "niet langer werkzaam" meldingen
- Out-of-office replies die aangeven dat iemand is vertrokken

Markeer vertrokken medewerkers apart in het overzicht.

---

## 8. Patronen ontdekt in de praktijk

### Kennismakingen heten bijna nooit "kennismaking"
In de agenda heten ze:
- "Introduction meeting [bedrijf]"
- "[Voornaam] & [Voornaam]"
- "[Voornaam] & LM"
- "Demo [bedrijf]"
- "Meeting [naam]"
→ Zoek daarom op attendee-domein, niet op zoektermen.

### Hele-dag-events zijn nooit echte meetings
Events met `isAllDay: true` zijn altijd deadlines, reminders, vakanties
of kantoor-markeringen. Nooit kennismakingen.

### Reeds verlopen maanden moet periodiek herberekend
`reeds_verlopen_mnd` is een snapshot die veroudert. Bij elke sessie
opnieuw berekenen op basis van `contract_start_date` en vandaag.

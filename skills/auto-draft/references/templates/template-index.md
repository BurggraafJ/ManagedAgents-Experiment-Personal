# Template Index — Auto-Draft

Overzicht van alle beschikbare templates. De skill raadpleegt dit bestand om te bepalen welk template past bij een binnenkomende mail. Templates zijn een **startpunt** — ze worden altijd aangepast op de specifieke situatie, ontvanger en context.

> **Aanpasbaar:** Jelle kan templates toevoegen, aanpassen of verwijderen. Nieuwe templates worden automatisch meegenomen als ze in de `templates/` map staan en hier geïndexeerd zijn.

---

## Sales Templates

| Template | Bestand | Wanneer gebruiken | Bron |
|----------|---------|-------------------|------|
| MQL — Eerste reactie op lead | `sales-mql.md` | Inkomend verzoek via website/LinkedIn/netwerk. Eerste contact. | Outlook: [Template] MQL |
| Datavoorstel — Na reactie | `sales-datavoorstel-na-reactie.md` | Lead heeft gereageerd, datumvoorstel sturen | Outlook: Datavoorstel na reactie/contact |
| Datavoorstel — Koud (geen eerder contact) | `sales-datavoorstel-koud.md` | Outbound benadering, geen eerder mailcontact | Outlook: Directe datavoorstel (geen eerder mailcontact) |
| Datavoorstel — Reminder | `sales-datavoorstel-reminder.md` | Geen reactie op datumvoorstel, reminder sturen | Outlook: Directe datavoorstel Reminder 1 |
| Afspraakbevestiging | `sales-afspraakbevestiging.md` | Datum is bevestigd, formele bevestigingsmail | Outlook: SQL Afspraakbevestiging |
| Kennismaking Uitnodiging | `sales-kennismaking-uitnodiging.md` | Outlook-uitnodiging met context voor eerste meeting | Outlook: Kennismaking Outlook-Uitnodiging |
| Follow-up 1 — Na kennismaking | `sales-followup-1.md` | Na eerste gesprek: samenvatting + prijsmodel + vervolgafspraak | Outlook: Kennismaking Followup 1/2 |
| Follow-up 2 — Reminder | `sales-followup-2.md` | Reminder voor vervolgafspraak deze week | Outlook: Kennismaking Followup 2/2 |
| Vervolgafspraak — Samenvatting | `sales-vervolgafspraak.md` | Na vervolgafspraak: besproken punten + agenda volgende sessie | Outlook: Vervolgafspraak 1 |
| Offerte | `sales-offerte.md` | Offerte meesturen na gesprek | Outlook: Template Offerte |
| Referenties | `sales-referenties.md` | Prospect vraagt om referenties | Outlook: Referenties |

## Overeenkomsten Templates

| Template | Bestand | Wanneer gebruiken | Bron |
|----------|---------|-------------------|------|
| Overeenkomst verzenden | `overeenkomst-verzenden.md` | Licentie- en verwerkersovereenkomst ter beoordeling sturen | Outlook: Licentieovereenkomst Template |
| Overeenkomst reminder | `overeenkomst-reminder.md` | Check-in of overeenkomst al bekeken is | Outlook: Reminder Licentieovereenkomst |

## Onboarding Templates

| Template | Bestand | Wanneer gebruiken | Bron |
|----------|---------|-------------------|------|
| Planning en start pilot | `onboarding-planning.md` | Pilotperiode plannen, contactmomenten afstemmen | Outlook: Planning en start pilot |
| Start Legal Mind (go-live) | `onboarding-start.md` | Welkomstbericht bij livegang | Outlook: Start Legal Mind |
| Inloggegevens | `onboarding-inloggegevens.md` | Gebruikersaccounts versturen | Outlook: Inloggegevens Legal Mind |
| Voorbereiding training | `onboarding-voorbereiding-training.md` | Pre-training instructies (downloads, account setup) | Outlook: Voorbereiding training Legal Mind |
| Partnerkoppeling activatie | `onboarding-partnerkoppeling.md` | DMS-integratie activeren | Outlook: Activatie partnerkoppeling |

## Customer Success Templates

| Template | Bestand | Wanneer gebruiken | Bron |
|----------|---------|-------------------|------|
| Doorsturen naar IT | `cs-doorsturen-it.md` | Klant stuurt technische vraag, bevestigen dat het is doorgestuurd | Outlook: Doorsturen IT [Template] |
| Voorbereiding training | `cs-voorbereiding-training.md` | Pre-training mail naar deelnemers (materialen, inloggegevens) | Outlook: Template mail voorbereiding training |
| Activatie partnerkoppeling | `cs-partnerkoppeling.md` | DMS-integratie activeren bij klant (iManage, Epona, etc.) | Outlook: Activatie partnerkoppeling [Template] |

## Operationeel Templates

| Template | Bestand | Wanneer gebruiken | Bron |
|----------|---------|-------------------|------|
| Bezoeker uitnodigen | `operationeel-bezoeker.md` | Praktische info voor kantoorbezoek (locatie, parkeren) | Outlook: Uitnodiging bezoeker |

---

## Hoe templates worden gebruikt

1. **Herkenning:** De skill bepaalt de mail-categorie (zie `mail-categories.md`)
2. **Match:** De skill zoekt in deze index of er een passend template is
3. **Laden:** Het template-bestand wordt gelezen
4. **Aanpassen:** Placeholders worden ingevuld op basis van:
   - De binnenkomende mail (namen, data, onderwerp)
   - Het contactprofiel (toon, begroeting)
   - De context (eerdere correspondentie, HubSpot-data)
5. **Personaliseren:** De skill past de tekst aan op de specifieke situatie — het template is een skelet, geen copy-paste

## Template toevoegen

Maak een nieuw `.md` bestand in `templates/` en voeg een regel toe aan de juiste tabel hierboven.

Template-formaat:
```markdown
# [Naam Template]
**Categorie:** [Sales/Onboarding/etc.]
**Wanneer:** [Beschrijving wanneer te gebruiken]
**Toon:** [Formeel/Semi-formeel/Casual]

---

## Template tekst

[De template-tekst met placeholders als [naam], [datum], etc.]

---

## Aanpassingsnotities
[Tips voor hoe dit template aan te passen per situatie]
```

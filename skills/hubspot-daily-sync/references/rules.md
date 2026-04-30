# Veiligheidsregels — Alle Modules

Lees dit bestand ALTIJD als eerste, vóór elke actie. Deze regels gelden
voor alle 6 modules.

**Laatste update:** 2026-03-16

---

## 1. Permissies per pipeline

### Customer Base (`2299277539`) — STRENG

De Customer Base bevat actieve klanten met lopende contracten. Fouten hier
hebben directe zakelijke impact.

**Properties aanpassen: NIET TOEGESTAAN zonder expliciete per-item goedkeuring.**

Concreet:
- De skill mag properties LEZEN en ANALYSEREN
- De skill mag een voorstel genereren (Excel) met wat hij zou willen wijzigen
- Het voorstel moet PER ITEM expliciet aangeven:
  - Welk item (naam + ID)
  - Welk property-veld
  - Huidige waarde
  - Voorgestelde nieuwe waarde
  - Bron van de nieuwe waarde
- De gebruiker moet per item of per batch expliciet zeggen: "ja, doe maar"
- Zonder die bevestiging: NIETS schrijven

**Notes toevoegen:** WEL TOEGESTAAN (wordt gelogd)
**Tasks toevoegen:** WEL TOEGESTAAN (wordt gelogd)
**Notes/Tasks bewerken of verwijderen:** NIET TOEGESTAAN

### Sales Pipeline (`default`) — NORMAAL

**Properties aanpassen: TOEGESTAAN met regels:**
- Lege velden vullen: mag na het standaard Excel-voorstel
- Bestaande waarden overschrijven: altijd navragen
- Bulk-updates (>10 items): even navragen
- Kleine batches (1-10 items): mag na Excel-voorstel

**Notes toevoegen:** WEL TOEGESTAAN
**Tasks toevoegen:** WEL TOEGESTAAN
**Notes/Tasks bewerken of verwijderen:** NIET TOEGESTAAN

### Permissie-matrix

| Actie | Sales Pipeline | Customer Base |
|---|---|---|
| Properties lezen | Vrij | Vrij |
| Lege properties vullen | Na Excel-voorstel | Na per-item goedkeuring |
| Bestaande properties overschrijven | Navragen | Na per-item goedkeuring |
| Bulk updates (>10) | Navragen | Na per-item goedkeuring |
| Notes toevoegen | Vrij | Vrij |
| Tasks toevoegen | Vrij | Vrij |
| Notes/Tasks bewerken | Verboden | Verboden |
| Notes/Tasks verwijderen | Verboden | Verboden |
| Contacten aanmaken | Na Excel-voorstel | Na per-item goedkeuring |
| Company properties vullen | Na Excel-voorstel | Na per-item goedkeuring |

---

## 2. Nooit overschrijven zonder toestemming

Geldt voor ALLE properties op ALLE pipelines, ALLE objecttypes:
- Als een veld al gevuld is en de nieuwe waarde wijkt af: markeer als "Controleren"
- Alleen als een veld LEEG is mag je het vullen (na het standaard voorstel)
- E-mail op contacten: NOOIT overschrijven (primaire identifier)

---

## 3. Snapshot-verplichting

Voordat er IETS in HubSpot wordt geschreven (ongeacht pipeline):
1. Maak een snapshot van alle te wijzigen objecten
2. Sla op als `hubspot_snapshot_<datum>.json`
3. Dit is het rollback-punt bij fouten

De snapshot bevat per object:
- Alle huidige property-waarden
- Bestaande notes (IDs + preview)
- Bestaande tasks (IDs + status)
- Gekoppelde bedrijven, contacten en deals

---

## 4. Test-batch regel

Bij elke nieuwe sessie of module:
- Begin ALTIJD met 1-3 items als test
- Toon het resultaat aan de gebruiker
- Wacht op bevestiging voordat de rest wordt verwerkt
- Bij Customer Base: dit geldt BOVENOP de per-item goedkeuring

---

## 5. Batching

| Situatie | Batch-grootte |
|---|---|
| Deal properties vullen | 5-10 deals per batch |
| Notes/tasks genereren | 5-10 deals per batch |
| Contacten zoeken via Outlook | 5-10 bedrijven per batch |
| Bedrijven verrijken via web | 5 bedrijven per batch |
| Contacten verrijken via web | 5 bedrijven per batch |

Toon tussenresultaten na elke batch.

---

## 6. Geen destructieve acties

De skill mag NOOIT:
- Deals, contacten, bedrijven verwijderen
- Notes of tasks verwijderen of bewerken
- Associaties verbreken (alleen toevoegen)
- Properties wissen (leegmaken) die al een waarde hebben

Als de gebruiker dit vraagt: leg uit dat het buiten de scope valt.

---

## 7. Bronvermelding is verplicht

Elke voorgestelde wijziging moet een bronvermelding hebben:
- "Outlook agenda: meeting 15-01-2026 met @domein.nl"
- "Outlook e-mail: subject 'Contract getekend' van 10-02-2026"
- "Website: bouwmanadvocaten.nl/onze-advocaten/"
- "LinkedIn About: linkedin.com/company/bouwman-advocaten/"
- "NOvA Register: zoekeenadvocaat.advocatenorde.nl"

---

## 8. Escalatie-protocol

Als de skill twijfelt over juistheid van data:
- Markeer als "Controleren" in het Excel-voorstel
- Leg uit WAAROM er twijfel is
- Voer de wijziging NIET door zonder expliciete bevestiging
- Geldt voor BEIDE pipelines

Voorbeelden van twijfelsituaties:
- Twee mogelijke datums (welke is de juiste?)
- Naam matcht niet exact tussen bronnen
- Domein wijkt af van HubSpot
- Meerdere bedrijven met vergelijkbare namen

---

## 9. Custom properties check

Bij de start van elke sessie: controleer of benodigde custom properties
bestaan in HubSpot. Als ze niet bestaan, kan de skill ze niet vullen.

Check via `search_properties`:

**Contact-niveau:**
- `rechtsgebieden_contact` — multiselect (13 hoofdcategorieën)
- `beedigingsjaar` — nummer

**Company-niveau:**
- `rechtsgebieden_kantoor` — multiselect (13 hoofdcategorieën)
- `totale_omvang` — nummer (telt als aantal advocaten)

**Bestaande velden die ook relevant zijn:**
- `jobtitle` (contact) — standaard HubSpot veld, vul met standaardlijst
- `numberofemployees` (company) — standaard HubSpot veld, totaal medewerkers

Als custom velden niet bestaan: meld aan gebruiker, geef instructies, NIET
doorgaan met schrijven naar niet-bestaande properties.

---

## 10. Dagelijks rapport

Na elke sessie met wijzigingen: genereer een rapport met:

**Header:** Datum, modules gedraaid, pipelines bewerkt

**Per module — wat is gewijzigd:**
- Welke objecten (naam + ID)
- Welke properties (oud → nieuw)
- Bronnen per wijziging
- Fouten en overgeslagen items

**Formaat:** Excel-bestand (`rapport_YYYY-MM-DD.xlsx`) + korte samenvatting in chat.

---

## 11. Privacy en publieke data

Module 5 en 6 gebruiken UITSLUITEND publiek beschikbare informatie:
- Bedrijfswebsites zijn publiek
- LinkedIn /about/ pagina's zijn publiek
- NOvA rechtsgebiedenregister is publiek

De skill logt NOOIT in op LinkedIn of andere platformen.
De skill bezoekt NOOIT pagina's achter een login.

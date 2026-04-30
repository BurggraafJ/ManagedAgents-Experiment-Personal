# Contact Properties — Catalogus

Alle contact-properties die door Module 4 (contact-finder) en Module 6
(contact-enrichment) verrijkt kunnen worden.

**Laatste update:** 2026-03-16
**Gebruikt door:** Module 4 (contact-finder), Module 6 (contact-enrichment)

---

## Bestaande HubSpot velden

### email
- **Type:** text
- **Wat:** E-mailadres van de contactpersoon.
- **Hoe vullen:**
  - Module 4: Uit Outlook (sender, toRecipients, ccRecipients)
  - Module 6: Uit individuele profielpagina (mailto: link)
- **BELANGRIJK:** NOOIT overschrijven als het al gevuld is. Email is de
  primaire identifier in HubSpot.
- **Bron:** Outlook (Module 4), Website profiel (Module 6)

### firstname / lastname
- **Type:** text
- **Wat:** Voor- en achternaam.
- **Hoe vullen:**
  - Module 4: Uit Outlook (sender.name, recipients[].name)
  - Module 6: Uit teampagina of individueel profiel
- **Naam-splitsing:** Eerste woord = firstname, rest = lastname.
  Tussenvoegsels (van, de, van der, op 't) horen bij lastname.
- **Bron:** Outlook (Module 4), Website (Module 6)

### phone
- **Type:** text
- **Wat:** Direct telefoonnummer contactpersoon.
- **Hoe vullen:** Uit individuele profielpagina op bedrijfswebsite.
- **Bron:** Website profiel (Module 6)

### mobilephone
- **Type:** text
- **Wat:** Mobiel nummer.
- **Hoe vullen:** Als telefoonnummer op website begint met 06- of +316.
- **Bron:** Website profiel (Module 6)

### jobtitle
- **Type:** text (bestaand HubSpot default veld)
- **Wat:** Gestandaardiseerde functietitel. Kies ALTIJD uit de standaardlijst.
- **Standaardlijst (kies precies één):**
  - Student-stagiair / Werkstudent
  - Advocaat-stagiair(e) / Stagiair(e)
  - Junior advocaat-medewerker / Junior Associate
  - Advocaat-medewerker / Associate
  - Senior advocaat-medewerker / Senior Associate
  - Counsel / Of Counsel
  - Salaried Partner / Non-Equity Partner
  - Equity Partner / Partner
  - Managing Partner / Bestuurder
  - Paralegal / Juridisch medewerker
  - Practice Coordinator / Legal Operations
  - Junior Jurist
  - Onbekend
- **Hoe vullen:** Uit teampagina of individueel profiel. Map de
  website-functietitel naar de dichtstbijzijnde standaardwaarde.
- **Mapping van veelvoorkomende website-titels:**
  - "Advocaat" → Advocaat-medewerker / Associate
  - "Partner" → Equity Partner / Partner
  - "Advocaat/directeur" → Managing Partner / Bestuurder
  - "Vennoot" → Equity Partner / Partner
  - "Kantoordirecteur" → Managing Partner / Bestuurder
  - "Counsel" → Counsel / Of Counsel
  - "Of Counsel" → Counsel / Of Counsel
  - "Juridisch adviseur" → Advocaat-medewerker / Associate (als mr.) of Paralegal / Juridisch medewerker (als geen mr.)
  - "Juridisch medewerker" → Paralegal / Juridisch medewerker
  - "Bewindvoerder" → Paralegal / Juridisch medewerker
  - "Faillissementsmedewerker" → Paralegal / Juridisch medewerker
  - "Secretaresse" / "Secretariaat" → NIET opslaan (geen juridische functie)
  - "Administratie" / "Financieel" → NIET opslaan (geen juridische functie)
  - "Office manager" → Practice Coordinator / Legal Operations
  - "Receptie" → NIET opslaan
  - "ADVOCAAT SINDS: 2023" → gebruik beëdigingsjaar om senioriteit te schatten
- **Senioriteit-schatting op basis van beëdigingsjaar:**
  - Beëdigd < 1 jaar geleden → Advocaat-stagiair(e) / Stagiair(e)
  - Beëdigd 1-3 jaar geleden → Advocaat-medewerker / Associate
  - Beëdigd 4-7 jaar geleden → Advocaat-medewerker / Associate of Senior
  - Beëdigd 8+ jaar geleden → Senior advocaat-medewerker / Senior Associate
  - Als ook "vennoot" of "partner" vermeld → Equity Partner / Partner
- **Bron:** Website (Module 6)

---

## Custom velden (reeds aangemaakt)

### rechtsgebieden_contact
- **Naam in HubSpot:** rechtsgebieden_contact
- **Type:** multiselect
- **Wat:** Rechtsgebied(en) waar deze persoon in is gespecialiseerd.
- **Geldige waarden (exact, multiselect):**
  1. Algemene Praktijk & Procesrecht
  2. Personen- en Familierecht
  3. Erfrecht
  4. Arbeids- en Sociaal Recht
  5. Vastgoed- en Huurrecht
  6. Ondernemings- en Commercieel Recht
  7. Intellectueel Eigendom, IT & Privacy
  8. Financieel, Bank- en Belastingrecht
  9. Insolventie- en Faillissementsrecht
  10. Strafrecht
  11. Bestuurs- en Omgevingsrecht
  12. Gezondheidsrecht & Letsel
  13. Tuchtrecht
- **Hoe vullen:**
  1. Lees rechtsgebieden van individueel profiel of teampagina
  2. Zoek elk sub-rechtsgebied op in `references/rechtsgebieden-mapping.md`
  3. Map naar de bijbehorende hoofdcategorie(ën)
  4. Optioneel: valideer via NOvA register
- **Bron:** Website profiel (primair), NOvA register (validatie), teampagina
- **Voorbeeld:** "Arbeids- en Sociaal Recht;Insolventie- en Faillissementsrecht;Ondernemings- en Commercieel Recht;Vastgoed- en Huurrecht"

### beedigingsjaar
- **Naam in HubSpot:** beedigingsjaar
- **Type:** number
- **Wat:** Jaar waarin de advocaat is beëdigd.
- **Hoe vullen:** Uit teampagina of individueel profiel.
  Veelvoorkomende patronen:
  - "Advocaat sinds: 2019" → 2019
  - "ADVOCAAT SINDS: 1984" → 1984
  - "beëdigd in 1996" → 1996
  - "Beëdigingsjaar: 1996" → 1996
  - "(1996)" achter de naam → NIET beëdigingsjaar, dit is geboortejaar!
- **Bron:** Website
- **Voorbeeld:** 2019

---

## Overzicht: wat haal je waar

| Property | Outlook (M4) | Website (M6) | NOvA (M6) |
|---|---|---|---|
| email | ja | ja (profiel) | - |
| firstname/lastname | ja | ja | - |
| phone | - | ja (profiel) | - |
| mobilephone | - | ja (profiel) | - |
| jobtitle | - | ja (standaardlijst) | - |
| rechtsgebieden_contact | - | ja (profiel/teampagina) | ja (officieel) |
| beedigingsjaar | - | ja (profiel/teampagina) | - |

M4 = Module 4 (contact-finder), M6 = Module 6 (contact-enrichment)

---

## Niet-juridische functies

De volgende functies op websites zijn GEEN juridische contacten en krijgen
GEEN jobtitle in HubSpot (wel als contact aanmaken als ze in e-mail voorkomen):
- Secretariaat / Secretaresse
- Administratie / Financieel
- Receptie
- Huismeester
- Mental health support (ja, dit bestaat — Kolkman heeft een hond)

Deze personen krijgen GEEN `rechtsgebieden_contact` en GEEN `beedigingsjaar`.
Ze krijgen wel `jobtitle` = "Onbekend" als ze al in HubSpot staan.

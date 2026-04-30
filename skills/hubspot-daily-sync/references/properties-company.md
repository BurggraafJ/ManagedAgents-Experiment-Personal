# Company Properties — Catalogus

Alle company-properties die door Module 5 (company-enrichment) verrijkt
kunnen worden, hun HubSpot-veldnaam, type en databron.

**Laatste update:** 2026-03-16
**Gebruikt door:** Module 5 (company-enrichment)

---

## Bestaande HubSpot velden

### numberofemployees
- **Type:** number
- **Wat:** Totaal aantal medewerkers.
- **Hoe vullen:** Tel alle namen op de teampagina van de website.
  Inclusief advocaten, paralegals, juridisch medewerkers, administratie.
- **Bron:** Website teampagina (primair), LinkedIn About range (fallback)

### totale_omvang
- **Type:** number (bestaand custom veld)
- **Wat:** Aantal advocaten bij het kantoor. LET OP: dit veld heet
  "totale_omvang" maar telt als AANTAL ADVOCATEN, niet totaal medewerkers.
- **Hoe vullen:** Tel op de teampagina alleen: advocaat, partner, counsel,
  advocaat-stagiair. NIET: paralegals, secretariaat, administratie,
  juridisch medewerkers, bewindvoerders, financieel medewerkers.
- **Bron:** Website teampagina
- **Voorbeeld:** Kolkman → 3 advocaten (Kolkman, Peters, Bruins), niet 13 medewerkers

### phone
- **Type:** text
- **Wat:** Hoofd telefoonnummer kantoor.
- **Hoe vullen:** Uit footer of contactpagina.
- **Bron:** Website footer (primair), LinkedIn About (aanvullend)

### address
- **Type:** text
- **Wat:** Straatnaam en huisnummer.
- **Hoe vullen:** Uit footer of contactpagina.
- **Bron:** Website footer (primair), LinkedIn About (aanvullend)

### city
- **Type:** text
- **Wat:** Vestigingsplaats.
- **Bron:** Website footer, LinkedIn About, NOvA register

### zip
- **Type:** text
- **Wat:** Postcode.
- **Bron:** Website footer, LinkedIn About

### description / about_us
- **Type:** text
- **Wat:** Korte beschrijving bedrijf.
- **Hoe vullen:** Uit "Over ons" pagina of homepage intro. Max 2-3 zinnen.
- **Let op:** NIET letterlijk kopiëren. Vat samen in eigen woorden.
- **Bron:** Website (primair), LinkedIn About (aanvullend)

### linkedin_company_page
- **Type:** text (URL)
- **Wat:** LinkedIn bedrijfspagina URL.
- **Hoe vullen:** Uit footer van website (LinkedIn icoon/link).
- **Bron:** Website footer

### kvk
- **Type:** text (custom)
- **Wat:** KvK-nummer.
- **Hoe vullen:** Uit footer, contactpagina, of juridische info pagina.
- **Bron:** Website

### founded_year
- **Type:** text
- **Wat:** Oprichtingsjaar.
- **Hoe vullen:** Uit LinkedIn About ("Founded: 1988") of "Over ons".
- **Bron:** LinkedIn About (primair), Website (aanvullend)

### industry
- **Type:** enumeration
- **Wat:** Branche.
- **Hoe vullen:** Uit LinkedIn About. Advocatenkantoren: "LEGAL_SERVICES".
- **Let op:** Controleer geldige waarden via
  `get_properties(objectType="companies", propertyNames=["industry"])`.
- **Bron:** LinkedIn About

---

## Custom velden (reeds aangemaakt)

### rechtsgebieden_kantoor
- **Type:** multiselect (bestaand custom veld)
- **Wat:** Welke rechtsgebieden het kantoor bedient.
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
  BESTE ROUTE: Aggregeer alle `rechtsgebieden_contact` van de contacten
  bij dit bedrijf. De unieke hoofdcategorieën = kantoor-rechtsgebieden.
  ALTERNATIEF: Lees de "Rechtsgebieden" / "Expertises" pagina van de website,
  map elk sub-rechtsgebied naar een hoofdcategorie via `references/rechtsgebieden-mapping.md`.
- **Bron:** Afgeleid van contacten (primair), Website (aanvullend), LinkedIn specialties (fallback)
- **Voorbeeld:** "Arbeids- en Sociaal Recht;Insolventie- en Faillissementsrecht;Ondernemings- en Commercieel Recht;Vastgoed- en Huurrecht"

---

## Overzicht: wat haal je waar

| Property | Website | LinkedIn | NOvA |
|---|---|---|---|
| numberofemployees | exact | range | - |
| totale_omvang (advocaten) | exact | - | - |
| phone | ja | ja | - |
| address/city/zip | ja | ja | - |
| description | ja | ja | - |
| linkedin_company_page | ja | n.v.t. | - |
| kvk | ja | - | - |
| founded_year | soms | ja | - |
| rechtsgebieden_kantoor | via mapping | specialties | via contacten |

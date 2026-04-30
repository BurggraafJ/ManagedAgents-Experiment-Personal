# Databronnen — Web (Website, LinkedIn, NOvA)

Dit bestand beschrijft de drie webbronnen voor Module 5 (company-enrichment)
en Module 6 (contact-enrichment). Per bron: wat je ophaalt, hoe, patronen
en valkuilen.

**Laatste update:** 2026-03-16

---

## Bron 1: Bedrijfswebsite (via Claude in Chrome)

### Beschikbaarheid
~95% van de bedrijven in HubSpot heeft een werkende website.

### Betrouwbaarheid
HOOG — het bedrijf beheert de eigen website.

### Stap 1: Teampagina vinden

Teampagina's hebben vele namen. Twee methoden:

**Methode A: Directe URL's proberen (snelst)**
```
/team
/ons-team
/advocaten
/onze-advocaten
/medewerkers
/about/team
/people
/wie-zijn-wij
```

**Methode B: Navigatie scannen (betrouwbaarder)**
```
1. navigate(url="https://<domein>")
2. read_page(filter="interactive")
3. Zoek links met: team, advocaten, medewerkers, people, wie zijn wij
4. Navigeer naar die link
```

Gevonden patronen uit steekproef:
| Website | Team-link | URL |
|---|---|---|
| weski.nl | "Advocaten" | /advocaten/ |
| hofrechtadvocaten.nl | Homepage (team staat direct op) | / |
| bouwmanadvocaten.nl | "Onze advocaten" | /onze-advocaten/ |
| kolkman.nl | "Medewerkers" | /medewerkers |
| devos.nl | "Ons Team" | /about/team |

### Stap 2: Teampagina parsen

Gebruik `get_page_text()` om de volledige tekst te lezen. Extraheer:

**Aantallen (koppen tellen):**
- Tel het totaal aantal namen op de pagina
- Maak onderscheid per functie-type
- Categorieën: Advocaten, Partners, Counsel, Paralegals, Juridisch
  medewerkers, Administratie, Secretariaat

**Per persoon op de overzichtspagina:**
- Naam (volledig, inclusief mr./mw.)
- Functie-type (Partner, Advocaat, Counsel, etc.)
- Rechtsgebieden (als vermeld, vaak met * voor NOvA-registratie)
- Beëdigingsjaar (soms als "Advocaat sinds: 2019")

### Stap 3: Individuele profielpagina's

Niet alle kantoren hebben individuele profielpagina's. Als er "Lees meer"
links zijn, bezoek die voor elk contact dat al in HubSpot staat.

Op een individueel profiel vind je typisch:
- **Direct e-mailadres** — vaak als `mailto:` link (~70% beschikbaar)
- **Direct telefoonnummer** — soms mobiel, soms vast (~50%)
- **LinkedIn URL** — link naar persoonlijk profiel (~50%)
- **Rechtsgebieden gedetailleerd** — met sub-specialisaties (~80%)
- **Rechtsgebiedenregister NOvA** — apart vermeld (~60%)
- **Beëdigingsjaar** — in de bio ("beëdigd in 1996") (~60%)
- **Talen** — "spreekt Engels, Duits en Frans" (~30%)
- **Specialisatieverenigingen** — lidmaatschappen (~40%)

### Stap 4: Footer / contactpagina

De footer bevat bijna altijd:
- Kantoor telefoonnummer (~95%)
- Kantoor e-mailadres (~95%)
- Adres + postcode + stad (~95%)
- KvK-nummer (~50%)
- LinkedIn bedrijfspagina (~60%)

---

## Bron 2: LinkedIn About

### Beschikbaarheid
~70% van advocatenkantoren heeft een LinkedIn bedrijfspagina.

### Betrouwbaarheid
HOOG — het bedrijf beheert de eigen pagina.

### Hoe te benaderen

```
1. Bepaal LinkedIn URL:
   a. Uit HubSpot property `linkedin_company_page` (als gevuld)
   b. Uit de footer van de bedrijfswebsite
   c. Via Google zoeken: "<bedrijfsnaam> linkedin"

2. navigate(url="https://www.linkedin.com/company/<slug>/about/")
3. wait(duration=2-3)
4. get_page_text(tabId=<id>)
```

### Wat je extraheert

| LinkedIn veld | HubSpot property | Voorbeeld |
|---|---|---|
| Website | `website` | kolkman.nl |
| Phone | `phone` | 0546 - 588 888 |
| Industry | `industry` | Law Practice |
| Company size | `numberofemployees` (range) | 11-50 employees |
| Associated members | (informatief) | 14 members |
| Headquarters | `city` | Almelo, Overijssel |
| Founded | `founded_year` | 1988 |
| Specialties | `rechtsgebieden_kantoor` | arbeidsrecht, bouwrecht, ... |
| Address | `address`, `zip`, `city` | Twentepoort Oost 55a, 7600 AV |

### Valkuilen LinkedIn

1. **Login-wall voor /people/** — Alleen /about/ is publiek
2. **Company size is een range** — Gebruik alleen als website geen exact getal geeft
3. **Specialties vs. rechtsgebieden** — LinkedIn is door bedrijf ingevuld, kan afwijken van officieel
4. **Verouderde informatie** — Website is altijd leidend

---

## Bron 3: NOvA Zoek een Advocaat

### Beschikbaarheid
100% voor alle ingeschreven advocaten in Nederland. Verplicht register.

### Betrouwbaarheid
ZEER HOOG — officieel register van de Nederlandse Orde van Advocaten.

### Hoe te benaderen

```
1. navigate(url="https://zoekeenadvocaat.advocatenorde.nl/zoeken/uitgebreid")
2. read_page(filter="interactive")
3. form_input: achternaam in het "Naam" veld
4. Klik op "Bekijk resultaat"
5. wait(duration=3)
6. get_page_text(tabId=<id>)
```

### Wat je extraheert

Per advocaat:
- **Rechtsgebieden** (officieel geregistreerd) — met sub-specialisaties
- **Specialisatieverenigingen** — lidmaatschappen
- **Kantoor** — naam van het kantoor
- **Vestigingsplaats** — stad

### Voorbeeld resultaat

Zoekopdracht "Kolkman":
```
de heer mr. F. Kolkman
Kolkman Advocaten voor Ondernemers B.V.
ALMELO
Rechtsgebied(en):
  Arbeidsrecht
  Insolventierecht (Faillissement, Surseance van betaling)
  Ondernemingsrecht (Agentuur en distributie, Bestuurdersaansprakelijkheid,
    Fusies en overnames, Vennootschappen, Verenigingen en stichtingen)
  Vastgoedrecht (Bouwrecht, Erfdienstbaarheden, Erfpacht)
Specialisatievereniging(en):
  Vereniging Insolventierecht Advocaten (INSOLAD)
  Vereniging voor Bouwrecht-Advocaten (VBRA)
```

### Valkuilen NOvA

1. **Meerdere resultaten** — Match op kantoor + vestigingsplaats
2. **Naam-matching** — Zoek op achternaam, niet volledige naam
3. **SPA-gedrag** — Na klikken altijd 3 seconden wachten
4. **Alleen advocaten** — Paralegals en medewerkers staan er niet in

---

## Prioriteit bij conflicterende bronnen

### Rechtsgebieden
1. NOvA register (officieel, meest betrouwbaar)
2. Bedrijfswebsite individueel profiel
3. Bedrijfswebsite teampagina
4. LinkedIn specialties (minst betrouwbaar)

### Contactgegevens (telefoon, email)
1. Bedrijfswebsite individueel profiel (meest direct)
2. Bedrijfswebsite footer (kantoor-niveau)
3. LinkedIn About (kantoor-niveau)

### Adresgegevens
1. Bedrijfswebsite footer/contact (meest actueel)
2. LinkedIn About
3. NOvA register (alleen vestigingsplaats)

### Bedrijfsgrootte
1. Bedrijfswebsite teampagina (exact getal, koppen tellen)
2. LinkedIn About (range: "11-50")

---

## Cookie banners

Veel websites tonen een cookie banner die content blokkeert. Altijd eerst:
1. `read_page(filter="interactive")` om cookie-knoppen te vinden
2. Klik "Alleen noodzakelijke cookies", "Alles weigeren", of het meest
   privacy-vriendelijke alternatief
3. Pas daarna de pagina lezen

---

## SPA's en JavaScript-heavy sites

Sommige sites laden via JavaScript. Na navigatie altijd `wait(duration=2-3)`
voordat je de pagina leest. Als de pagina leeg lijkt na de eerste read,
wacht nogmaals en probeer opnieuw.

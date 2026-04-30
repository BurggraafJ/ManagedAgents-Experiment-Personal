# LLM-verwerking en modeltraining

Een van de meest gestelde klantvragen: "wat doen jullie met onze data en de LLM?".
Deze pagina is je primaire bron voor alles rond LLM-providers, modeltraining en
data-doorgifte.

## Kernuitspraken (waar te zijn naar klanten)

1. **Klantdata wordt nooit gebruikt voor modeltraining of fine-tuning.**
   - Contractueel vastgelegd in AV 5.2.
   - Contractueel afgedwongen richting Microsoft via MS DPA.
   - Technisch geborgd: we gebruiken alleen modellen die geen data opslaan.

2. **Alle LLM-verwerking vindt binnen de EU plaats.**
   - Op dit moment via Microsoft Azure (regio Amsterdam).
   - Toekomstige LLM-sub-verwerkers moeten EU-gevestigd, ISO 27001-gecertificeerd, en
     EU-DC's gebruiken.
   - Doorgifte naar derde landen is contractueel uitgesloten in onze VO.

3. **LLM-providers slaan klantdata niet op.**
   - We implementeren uitsluitend AI-modellen die géén data opslaan.
   - Tijdelijke verwerking voor één query, geen retentie.

## Microsoft Azure als LLM-provider

Microsoft is op dit moment de enige LLM-sub-verwerker. Twee documenten regelen dit:

### Microsoft Customer Agreement (MCA)

Het overkoepelende contractkader. Bevestigt dat Microsoft klantdata uitsluitend gebruikt
om de overeengekomen diensten te leveren. Bevestigt expliciet dat Microsoft klantdata
**niet inzet voor modeltraining of productverbetering** zonder expliciete toestemming
van de klant.

- Niet als download beschikbaar, alleen online.
- Actuele versie: https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA

### Microsoft Data Protection Addendum (DPA)

Het formele verwerkingskader onder de AVG. Belangrijke punten:

- Klantdata wordt verwerkt volgens instructies van Microsoft's klant (= Legal Mind als
  controller voor onze klantdata).
- Data wordt **niet gebruikt voor training van AI-modellen** of andere doeleinden die
  niet noodzakelijk zijn voor dienstverlening.
- **EU Data Boundary:** sinds september 2025 incl. EFTA voor Customer Data, Personal
  Data en Professional Services Data at rest voor EU Data Boundary Services.
- Encryptie, sub-verwerkerscontrole, dataverwijdering en meldplicht contractueel
  vastgelegd.

- Actuele versie: https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA
- **Altijd de Engelse, meest recente versie raadplegen** — Microsoft updatet regelmatig.

## Toekomstige LLM-sub-verwerkers

Legal Mind houdt expliciet de mogelijkheid open om aanvullende LLM-sub-verwerkers in te
schakelen. Reden: snelle ontwikkeling van LLM-technologie kan leiden tot beduidend betere
modellen die we willen kunnen benutten zonder lange contractuele lock-in.

Voorwaarden waaraan elke nieuwe LLM-sub-verwerker móet voldoen (uit Legal Mind
Security-document):

- **Gevestigd in de EU** als juridische entiteit (voorkeur Nederland).
- **ISO/IEC 27001-gecertificeerd** (minimaal).
- **EU-datacenters** met geavanceerde fysieke beveiliging (24/7 bewaking, biometrie,
  CCTV, redundantie).
- **Volledige naleving AVG** en relevante wet- en regelgeving.
- **Tijdelijke verwerking** zonder langdurige opslag van klantdata.

Procedureel (uit VO art. 9):

- Voorafgaande melding aan klant.
- Klant heeft bezwaarrecht.
- Bij sub-verwerker buiten EU: garantie passend beschermingsniveau, anders directe
  melding en stopzetting.

## Due diligence LLM-sub-verwerkers (toelatingsprocedure)

We hebben een interne toelatingsprocedure waarin we beoordelen op:

- Security
- Privacy
- Modelbeheersing
- Datalocatie
- Auditability
- Contractuele eisen

Deze procedure wordt **kwartaallijks** getoetst, en voor LLM-sub-verwerkers vaker
vanwege snelle ontwikkeling. Het pre-assessment-format is op verzoek deelbaar
(intern document: "LLM_Evaluatie_en_Compliance.docx").

## Data security bij LLM-verwerking

1. **Gegevensisolatie** — klantdata is logisch geïsoleerd, niet gedeeld met andere
   klanten, niet opgeslagen bij modelleveranciers.
2. **Geen training/fine-tuning** op klantdata — beleid voor alle gebruikte AI-modellen.
3. **Encryptie** — alle gegevensinteracties versleuteld voor vertrouwelijkheid en
   integriteit.

## Vragen waar je extra zorgvuldig mee moet zijn

### "Worden er AI-modellen buiten de EU gebruikt?"

**Nee.** Geen verwerking en geen training van klantdata buiten de EU. Toekomstige
LLM-sub-verwerkers moeten EU-gevestigd zijn, EU-DC's gebruiken en volledig aan
ISO/AVG voldoen.

### "Geldt dat ook voor (tijdelijke) data-doorgifte tijdens een query?"

**Ja.** Verwerking gebeurt binnen de Azure-regio Amsterdam. Geen tussenliggende
doorgifte naar US-endpoints. EU Data Boundary van Microsoft borgt dit.

### "Wat als Microsoft op enig moment een US-endpoint zou willen gebruiken?"

We monitoren dit actief. Bij wijziging van Microsoft's positie of beleid melden we dat
direct aan klanten. Klanten hebben bezwaarrecht (VO art. 9).

### "Kunnen we onze data exporteren als we stoppen?"

Ja. Klant blijft eigenaar. Bij beëindiging: data overdragen of wissen, naar keuze klant,
binnen 14 dagen (VO art. 10.3).

### "Wat als een nieuw, niet-EU model 10× beter werkt?"

Eerlijk antwoord: we wegen dat af. Maar: EU-vestiging blijft een harde eis. Geen
non-EU LLM-sub-verwerker zonder dat de EU-vestiging-vereiste in de markt verandert
of er een gelijkwaardige EU-versie beschikbaar is. We laten kwaliteit niet ten koste
gaan van EU-only.

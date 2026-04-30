# Contractuele basis — wat staat waar

De juridische basis van Legal Mind's security-positie. Drie documenten, in volgorde
van voorrang bij conflict (uit AV):

1. **Orderformulier** (per klant — niet in deze skill)
2. **Verwerkersovereenkomst (VO)** — als persoonsgegevens worden verwerkt
3. **Algemene Voorwaarden (AV)** — V1.1

Daarnaast geldt het **Microsoft DPA + MCA** als sub-verwerkers-kader (zie
`llm-en-modeltraining.md` voor MS-specifieke details).

## Algemene Voorwaarden V1.1 — relevante artikelen voor security/privacy

### Art. 5 — Licentienemerdata

- **5.1** Klant behoudt eigendom of gebruiksrecht op alle data. Klant is verantwoordelijk
  voor nauwkeurigheid, kwaliteit, integriteit, wettigheid, IE-rechten van de data.
- **5.2** **Licentienemerdata wordt niet gebruikt om de SaaS-oplossing te trainen.**
  Dit is een harde, contractuele toezegging.
- **5.3** Klant verantwoordelijk voor uploaden; Legal Mind kan assisteren maar aanvaardt
  geen aansprakelijkheid voor volledigheid/juistheid.
- **5.4** Geaggregeerde, niet-herleidbare gegevens mogen wel door Legal Mind worden
  gebruikt voor brancheanalyses, benchmarking, marketing.

### Art. 6 — Intellectuele Eigendomsrechten

- IE op het platform blijft bij Legal Mind.
- IE op klantdata blijft bij klant.
- Klant verleent Legal Mind een wereldwijd, niet-exclusief, royaltyvrij recht om
  klantdata te verzamelen, opslaan, onderhouden, wijzigen en verwerken voor zover
  noodzakelijk voor de dienstverlening.

### Art. 9 — Vertrouwelijkheid

- Wederzijdse geheimhoudingsplicht.
- Zelfde zorg als voor eigen vergelijkbare informatie, minimaal redelijk noodzakelijk.
- Verplichtingen blijven 5 jaar na beëindiging van kracht.

### Art. 10 — Garantie

- **10.1** Diensten worden professioneel uitgevoerd door gekwalificeerd personeel. Geen
  garantie op ononderbroken werking, volledige wensvervulling of compatibiliteit met
  niet-gedocumenteerde technologieën.
- **10.2** Platform biedt **geen juridisch advies**. Klant is verantwoordelijk voor
  verifiëren/valideren van output. Alle garanties op nauwkeurigheid van AI-output
  uitdrukkelijk afgewezen. (Belangrijk in AI Act-context: dit ondersteunt de
  human-oversight-claim.)

### Art. 12 — Gegevensbescherming

Indien Legal Mind toegang heeft tot persoonsgegevens, sluiten partijen een
Verwerkersovereenkomst voorafgaand aan verwerking.

### Art. 14.8 — Toepasselijk recht

Nederlands recht. Bevoegde rechter Amsterdam.

## Verwerkersovereenkomst (template)

Onze VO is gebaseerd op de standaard die we per klant tekenen. De inhoud is grotendeels
gestandaardiseerd. Belangrijke clausules:

### Art. 3 — Onderwerp en doel

- Verwerker (Legal Mind) verwerkt persoonsgegevens **uitsluitend op schriftelijke
  instructie** van verwerkingsverantwoordelijke (de klant).
- **Geen doorgifte naar derde landen.** Servers binnen EU/EER.
- Soorten data: namen, functies, e-mailadressen van klantmedewerkers; persoonsgegevens
  en bijzondere persoonsgegevens van cliënten; afhankelijk van wat klant uploadt.

### Art. 5 — Geheimhouding

- Geldt voor medewerkers en alle personen onder gezag.
- Onafhankelijk van duur van overeenkomst, blijft ook na beëindiging gelden.

### Art. 6 — Meldplicht inbreuken (datalek)

- **Initiële melding binnen 24 uur** na eerste ontdekking.
- Stapsgewijze info als niet alles direct beschikbaar is.
- Documentatie van alle inbreuken inclusief feiten, gevolgen, genomen maatregelen.
- Verplichte content van melding: aard, omvang betrokkenen/data, contactpersoon,
  gevolgen, voorgestelde/genomen maatregelen.

### Art. 7 — Beveiliging van de verwerking

- Passende T+O-maatregelen, afgestemd op risico, stand der techniek.
- T+O-maatregelen-overzicht in bijlage 1 (= Legal Mind Security-document, zie
  `beveiligingsmaatregelen.md`).
- Werknemers met data-toegang verwerken alleen op opdracht van VV.

### Art. 8 — Audits

- VV (klant) heeft recht op audit/inspectie.
- Schriftelijke aankondiging vooraf.
- Bij niet-naleving: kosten voor herstel voor rekening Verwerker.
- Verwerker mag zelf onafhankelijke derde inschakelen voor controle.

### Art. 9 — Sub-verwerkers

- Voorafgaande schriftelijke toestemming klant: **Microsoft Azure** als sub-verwerker
  is bij ondertekening al goedgekeurd, met voorwaarde EU/EER-servers.
- Andere/nieuwe sub-verwerkers: voorafgaande melding aan klant, klant heeft bezwaarrecht.
- Bij sub-verwerker buiten EU: garantie van passend beschermingsniveau, anders directe
  melding en stopzetting.

### Art. 10 — Beëindiging

- Bij einde: data overdragen aan klant of wissen, naar keuze van klant.
- Verwijderen/overdragen binnen **14 dagen** na einde overeenkomst.
- Verwerker mag opslag niet wissen indien wettelijk verplicht tot bewaring.

## Belangrijke contractuele zekerheden voor klantvragen

Als klant vraagt naar zekerheden, deze mag je met vertrouwen noemen — ze staan zwart op wit:

- Geen modeltraining op klantdata (AV 5.2)
- Verwerking uitsluitend op instructie klant (VO 3.4)
- Alleen EU/EER-servers (VO 3.4)
- Datalek-melding binnen 24 uur (VO 6.2)
- Klant blijft eigenaar van data (AV 5.1, AV 6.2)
- Bij beëindiging: data terug of vernietigd binnen 14 dagen (VO 10.3)
- Wijziging sub-verwerker: voorafgaand gemeld, met bezwaarrecht (VO 9.1)

## Wat NIET in de contracten staat (eerlijk)

- Geen aparte commerciële incident-SLA met response-tijden voor non-datalek incidenten.
- Geen formele uptime-SLA in AV/VO (orderformulier kan dit per klant regelen).
- Geen automatische synchronisatie- of backup-rapportage richting klant.

Bij vragen die deze gaten raken: zeg eerlijk dat dit niet in de standaard-overeenkomst zit
en op verzoek bespreekbaar is in een orderformulier of aanvullende afspraak.

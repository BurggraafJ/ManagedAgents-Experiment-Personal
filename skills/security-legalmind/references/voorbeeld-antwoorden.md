# Voorbeeld-antwoorden in Jelle's stijl

Deze voorbeelden zijn gebaseerd op echte due diligence-vragen die we hebben beantwoord
voor een fiscaal advieskantoor in Amsterdam (laat de naam **altijd** weg in output;
gebruik "[Klant]" of laat de aanhef weg). Bedoeld als stijlreferentie — kopieer geen
hele blokken letterlijk, herschrijf passend bij de specifieke vraag.

## Twee doelgroepen, twee stijlen

Er zijn ruwweg twee soorten lezers van onze security-output, en de schrijfstijl
verschilt per doelgroep. **Vraag bij elke nieuwe security-overzichtsmail eerst aan Jelle
voor wie de mail bedoeld is.** Zie ook de workflow-sectie in `SKILL.md`.

**A. Security-specialist / IT-afdeling / due diligence-team**
- Bullet-vorm, dichte techniek, concrete cijfers en standaarden voorop
- Geen uitleg waarom Azure goed is — die context is bekend
- Stijlvoorbeelden: **Voorbeelden 1, 2, 5** hieronder (fiscaal advieskantoor)

**B. Advocaat / algemene kantoor-lezer (bijv. bestuur Orde, partner kantoor)**
- Verhalende vorm met sectiekopjes, korte uitleg waarom we voor iets kiezen
- Termen als RBAC/MFA/TLS blijven, maar worden in een omringende zin geframed
- Stijlvoorbeeld: **Voorbeeld 8** hieronder (Orde van Advocaten, april 2026)

## Stijlkenmerken (zo schrijft Jelle in beide stijlen)

- **Verwijst expliciet** naar de bron van een claim ("conform DPA", "uit VO art. 6").
- **Cijfers waar mogelijk** ("AES-256", "12 maanden", "binnen 24 uur") — concreet,
  niet vaag.
- **Eerlijk over wat we niet hebben.** Bv. "wij hanteren (nog) geen aparte commerciële
  SLA" — geen verstoppertje.
- **Sluit positief af** met "indien er nog openstaande vragen zijn horen we dat
  uiteraard graag" en de Legal Mind-handtekening.
- **Aanhef:** "Beste [voornaam]," (persoonlijk, default) of "Geachte heer/mevrouw,"
  (formeel, bv. naar de Orde of een onbekende contactpersoon).
- **Afsluiting:** "Vriendelijke groet, Jelle Burggraaf — Founder | Legal Mind".
- **Geen em-dashes (—)** in de finale klant-output. Gebruik komma's, dubbele punten,
  of haakjes. Em-dashes komen in de meta-tekst van deze referentie wel voor, maar in
  de mail zelf nooit.

## Voorbeeld 1 — antwoord op SOC/Monitoring-vragen

**Vraag van klant:** "Hoe is de monitoring exact ingericht (playbooks, runbooks,
triageprocedures)?"

**Antwoord:**

Legal Mind werkt niet met een extern 24/7-SOC, maar met real-time security-alerts
vanuit Azure Defender en centrale logging, gecombineerd met operationele opvolging
door het engineering & operations-team. We hanteren vastgestelde playbooks, runbooks
en triageprocedures.

**Incident Classification Playbook**
• We onderscheiden drie niveaus (laag, midden, hoog).
• High-severity incidenten worden direct onderzocht.

**Security Incident Runbook**
• Bij kritieke signalen (zoals ongeautoriseerde toegang, verdachte privilege-
wijzigingen of een mogelijk datalek) wordt onmiddellijk het formele incidentproces
gestart.
• Dit proces omvat validatie, containment, analyse, klantmelding (binnen max. 24 uur,
conform DPA) en herstel.

**Operational Monitoring Runbook**
• Beschrijft de dagelijkse en wekelijkse controles, zoals:
  - review van security-alerts
  - RBAC-controles
  - patch-status
  - verificatie van back-ups

**Beschikbaarheid buiten kantooruren**
Azure-alerts staan 24/7 actief. Buiten kantooruren geldt:
• Kritieke alerts → automatische escalatie naar het engineering-team.
• Niet-kritieke alerts → opvolging tijdens het eerstvolgende monitoring-window.

## Voorbeeld 2 — MTTD / MTTR

**Vraag:** "Wat is de mean time to detect (MTTD) en mean time to respond (MTTR)
die jullie hanteren?"

**Antwoord:**

Wij hanteren de volgende interne richtwaarden:

• **MTTD:** minuten tot enkele uren (afhankelijk van type alert).
• **MTTR:** afhankelijk van ernst; bij high-severity wordt direct incidentrespons
  gestart.

Voor datalekken geldt contractueel: initiële melding binnen 24 uur.

## Voorbeeld 3 — Toekomstige LLM-sub-verwerkers en EU-borging

**Vraag:** "Kunnen jullie bevestigen dat alle LLM-verwerkingen uitsluitend binnen de
Europese Unie plaatsvinden?"

**Antwoord:**

Ja. Onze huidige en toekomstige (sub)verwerkingen zijn contractueel EU-gebonden. De
DPA staat Microsoft (Azure) expliciet toe als sub-verwerker met gebruik van uitsluitend
EU/EEA-servers; wijzigingen in sub-verwerkers worden vooraf gemeld.

**Vraag:** "Welke waarborgen gelden dat data niet (tijdelijk) buiten de EU wordt
verwerkt of getransporteerd?"

**Antwoord:**

Legal Mind past een combinatie van juridische, technische en organisatorische
maatregelen toe om te waarborgen dat persoonsgegevens en vertrouwelijke gegevens
uitsluitend binnen de Europese Unie worden verwerkt, opgeslagen en geraadpleegd.

**Contractuele waarborgen (AVG / Verwerkersovereenkomst)**
• In de Verwerkersovereenkomst is expliciet vastgelegd dat alle verwerkingen
  uitsluitend plaatsvinden binnen de EU of EER.
• Doorgifte van data naar derde landen is contractueel uitgesloten.
• Nieuwe Europese (sub)verwerkers kunnen alleen worden toegevoegd na voorafgaande
  melding aan de klant, die daarbij een bezwaarrecht heeft.

**Technische en organisatorische beveiliging**
• Alle opslag vindt plaats in Microsoft Azure-datacenters binnen de EU.
• Encryptie in transit (TLS 1.2/1.3) en encryptie at rest (AES-256) voorkomen dat
  data leesbaar kan worden buiten deze regio's.
• Toegang is strikt beperkt via Role-Based Access Control (RBAC) en Multi-Factor
  Authentication (MFA).

## Voorbeeld 4 — Back-ups en handmatige sync

**Vraag:** "Geldt de regel 'alleen handmatig gesynchroniseerde dossiers gaan in de
vault-back-up' ook voor ons (we werken primair in SharePoint)?"

**Antwoord:**

Ja. Alleen dossiers/bestanden die handmatig naar de Legal Mind-vault zijn
gesynchroniseerd, vallen onder onze back-up. Data die alleen in jullie eigen
SharePoint staat, valt onder jullie eigen (M365/SharePoint) back-up/regie. Onze
huidige klanten waarderen juist dat zij handmatig dossiers synchroniseren, waardoor
het DMS de bron van waarheid blijft.

Mocht je een voorkeur hebben voor automatische synchronisatie of continuous backup,
dan bespreken we dit uiteraard graag.

## Voorbeeld 5 — Leveranciers en AVG

**Vraag:** "Met welke leveranciers werkt Legal Mind structureel samen (naast
Microsoft Azure)?"

**Antwoord:**

Microsoft Azure (hosting/infrastructuur/AI-services) en Auth0/Okta (Identity &
Access Management).

**Vraag:** "Kunnen jullie bevestigen dat deze leveranciers binnen de EU zijn
gevestigd of uitsluitend EU-datacenters gebruiken?"

**Antwoord:**

Ja. Voor onze tenants wordt uitsluitend gebruikgemaakt van EU-datacenters.

**Vraag:** "Voldoen deze leveranciers aan de AVG en beschikken zij bij voorkeur
over relevante ISO-certificeringen?"

**Antwoord:**

Ja. Zij voldoen aan de AVG en beschikken over relevante ISO-certificeringen
(o.a. ISO/IEC 27001). Wij toetsen dit periodiek en minimaliseren het aantal
(sub)verwerkers.

## Voorbeeld 6 — ISO 27001-status

**Vraag:** "Heeft Legal Mind zelf een ISO 27001-certificering?"

**Antwoord (zoals nu geldig — VALIDEER MET CURRENT-STATE.MD):**

Momenteel doorloopt Legal Mind het ISO/IEC 27001:2022-certificeringstraject. De
beoogde afronding is januari 2026. Op verzoek delen wij ter bevestiging een Statement
of Engagement / opdrachtbevestiging. Het definitieve certificaat wordt na afronding
in januari 2026 met [Klant] gedeeld.

> ⚠️ Stand-zinning: deze datum verschuift mogelijk. Lees altijd `current-state.md`
> voordat je deze claim laat staan.

## Voorbeeld 7 — Eigendom en exit

**Vraag:** "Wie is juridisch eigenaar van de data in de Legal Mind-vault?"

**Antwoord:**

U blijft juridisch eigenaar/gebruiksrechthebbende; Legal Mind heeft slechts
gebruiksrechten die nodig zijn voor de dienstverlening.

**Vraag:** "Is data-export bij beëindiging technisch en contractueel mogelijk?"

**Antwoord:**

Ja. Op instructie van de verwerkingsverantwoordelijke; methode en format in overleg
conform AVG.

## Voorbeeld 8 — Volledige security-overzichtsmail voor advocaat / kantoor-lezer (april 2026)

**Context:** Proactief overzicht na ondertekening licentie- en verwerkersovereenkomst.
Lezer is geen security-specialist maar een algemene kantoorvertegenwoordiger (bijv.
bestuur van een Orde, partner van een advocatenkantoor). Doel: vertrouwen wekken én
in begrijpelijke taal uitleggen hoe de boel staat.

**Stijl-onderscheid t.o.v. voorbeelden 1-5 (security-specialist):**
- Verhalende vorm, geen bullets per sectie (alleen sectiekopjes als anker)
- Korte uitleg waarom we kiezen voor iets ("Microsoft Azure wordt door overheden,
  banken en advocatenkantoren gebruikt vanwege..."), niet alleen wát
- Termen als RBAC, MFA, TLS, AES blijven staan (een advocaat kan dat opzoeken), maar
  worden in een omringende zin geframed
- Geen em-dashes (—); gebruik komma's of dubbele punt
- Aanhef "Geachte heer/mevrouw" als geen specifieke contactpersoon bekend is

**De mail (geanonimiseerd voorbeeld; vervang [Klant] door werkelijke klantnaam):**

> Geachte heer/mevrouw,
>
> Naar aanleiding van de getekende licentie- en verwerkersovereenkomst van [datum] zet
> ik hieronder graag op een rij hoe wij de beveiliging en bescherming van uw data hebben
> ingericht. Doel is dat u in één overzicht ziet hoe Legal Mind invulling geeft aan de
> afspraken uit de verwerkersovereenkomst en aan de eisen die de AVG stelt.
>
> **Hosting en data-locatie**
>
> Wij hebben er bewust voor gekozen om al uw data te hosten bij Microsoft Azure, met
> voorkeursregio Amsterdam. Microsoft Azure is een van de grootste cloudplatformen ter
> wereld en wordt door overheden, banken en advocatenkantoren gebruikt vanwege het hoge
> beveiligingsniveau en de uitgebreide certificeringen. Door te kiezen voor de Europese
> omgeving van Azure, en bij voorkeur het datacenter in Amsterdam, weet u zeker dat uw
> gegevens binnen de EU/EER blijven en niet worden doorgegeven aan derde landen. Dit
> hebben wij ook contractueel vastgelegd in art. 3.4 van de verwerkersovereenkomst.
>
> Voor het inloggen en het beheer van toegang werken wij met Auth0/Okta, een
> gespecialiseerde Europese aanbieder voor Identity & Access Management. Ook deze
> omgeving staat volledig binnen de EU.
>
> **Encryptie**
>
> Alle data wordt versleuteld in transit met TLS 1.2 (minimum) en TLS 1.3 waar mogelijk,
> en at rest met AES-256. Sleutelbeheer verloopt via Azure (Microsoft-managed).
>
> **Toegangscontrole**
>
> Toegang tot systemen en data is strikt geregeld via Role-Based Access Control op basis
> van het principe van minimale rechten. Multi-Factor Authentication is verplicht voor
> alle systemen waar persoonlijke of gevoelige gegevens in voorkomen.
>
> **Logging en monitoring**
>
> Alle systeemactiviteiten worden centraal gelogd met timestamps en gebruikers-ID, met
> een bewaartermijn van 12 maanden. Wij werken met real-time security-alerts via Azure
> Defender, die door ons engineering & operations-team worden opgevolgd. Buiten
> kantooruren worden kritieke alerts via een roterende on-call automatisch geëscaleerd,
> zodat opvolging 24/7 geborgd is.
>
> **Incident- en datalekprocedure**
>
> Voor incidenten hanteren wij een vastgesteld Security Incident Runbook: validatie van
> het signaal, containment, analyse, klantmelding en herstel. Bij een datalek ontvangt u
> van ons binnen 24 uur na ontdekking een initiële melding, conform art. 6.2 van de
> verwerkersovereenkomst. Iedere inbreuk wordt volledig gedocumenteerd: feiten,
> gevolgen en de genomen maatregelen.
>
> **Modeltraining en LLM-verwerking**
>
> Uw data wordt nooit gebruikt voor training of fine-tuning van AI-modellen. Dit is
> contractueel geborgd in art. 5.2 van onze Algemene Voorwaarden en technisch geborgd
> in onze architectuur. Alle LLM-verwerking vindt binnen de EU plaats.
>
> **Sub-verwerkers**
>
> Wij minimaliseren bewust het aantal sub-verwerkers. Op dit moment werken wij
> structureel samen met Microsoft (Azure, voor hosting, infrastructuur en
> AI-tekstverwerking) en Auth0/Okta (voor Identity & Access Management). Beide partijen
> voldoen aan de AVG, beschikken over relevante ISO-certificeringen waaronder ISO/IEC
> 27001, en gebruiken voor onze tenants uitsluitend EU-datacenters. Microsoft is bij
> ondertekening van de verwerkersovereenkomst expliciet door u goedgekeurd als
> sub-verwerker (art. 9.1). Wijzigingen of toevoegingen worden vooraf aan u gemeld; u
> heeft daarbij een bezwaarrecht.
>
> **ISO 27001**
>
> Legal Mind doorloopt op dit moment het ISO/IEC 27001:2022-certificeringstraject onder
> begeleiding van Scytale. De beoogde afronding is mei/juni 2026. Vervolgcertificeringen
> ISO 27701, 27017 en 27018 staan op de roadmap voor het tweede halfjaar van 2026.
>
> **AI Act**
>
> Onze dienstverlening is onder de AI Act geclassificeerd als beperkt risico (niveau 3).
> Human oversight is altijd aanwezig: het platform biedt geen juridisch advies, en de
> gebruiker blijft verantwoordelijk voor het verifiëren en valideren van de output. Dit
> principe is ook contractueel verankerd in art. 10.2 van onze Algemene Voorwaarden.
>
> **Eigendom en exit**
>
> U blijft te allen tijde juridisch eigenaar/gebruiksrechthebbende van alle data; Legal
> Mind beschikt uitsluitend over de gebruiksrechten die nodig zijn voor de
> dienstverlening. Bij beëindiging van de overeenkomst worden alle gegevens binnen 14
> dagen overgedragen of vernietigd, naar uw keuze (art. 10.3 verwerkersovereenkomst).
>
> **Contactpersoon security en datalekken**
>
> Voor alle meldingen, vragen of contact in het kader van de verwerkersovereenkomst en
> de AVG, waaronder de meldplicht inbreuken, kunt u terecht bij Jay Alberts
> (alberts@legal-mind.nl, 06 23 79 87 88).
>
> Mocht u aanvullende documentatie wensen, bijvoorbeeld ons Security-document met de
> volledige T+O-maatregelen of een geanonimiseerde extractie uit het risicoregister,
> dan deel ik die uiteraard graag op verzoek. Indien er nog openstaande vragen zijn,
> horen wij dat ook graag.
>
> Vriendelijke groet,
>
> Jelle Burggraaf
> Founder | Legal Mind

**Wat in deze versie expliciet NIET wordt genoemd (bewuste keuze):**
- Geen back-up-paragraaf (te detail-rijk voor dit type mail; alleen op verzoek)
- Geen "wachtwoord-beleid in detail" en geen "kwartaalaudits op toegangsrechten"
  (overbodige hoeveelheid voor algemene lezer)
- Geen "klantsleutels bespreekbaar" (roept onnodig vraag op)
- Geen "Statement of Applicability delen wij" (impliceert niet-bestaand document)
- Geen "Statement of Engagement" (idem; alleen op concrete vraag)

## Standaard afsluiting van een security-mail

Indien er nog openstaande vragen zijn horen we dat uiteraard graag.

Vriendelijke groet,

Jelle Burggraaf
Founder | Legal Mind

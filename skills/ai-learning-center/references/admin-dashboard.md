# Kantoor AI Groeicentrum — Admin Dashboard

Het beheerdersportaal voor kantoorpartners en managers om AI-adoptie te meten en sturen.

## Toegang

- Alleen zichtbaar voor gebruikers met admin-rol
- Via "Beheerder" knop bij het profiel (of via route `/onboarding-claude/beheerder`)
- In het gebruikersscherm: grijs "Beheerder" label met "coming soon" bij niet-admins

## Naamgeving

Het heet "Kantoor AI Groeicentrum" — niet "beheerdersportaal" of "admin dashboard".
Dit is bewust: het gaat om groei, niet om beheer.

## Verschil met het Learning Center

Het Learning Center is persoonlijk — jij als individu leert en groeit.
Het Groeicentrum is kantoorbreed — je meet en stuurt het hele team.
Visueel moet dit verschil duidelijk zijn: ander hero-blok, andere kleur/sfeer.

## Layout

### Hero blok
Anders dan het Learning Center — maak duidelijk dat je in het Groeicentrum zit.
Bevat: "Kantoor AI Groeicentrum", kantoornaam, AO-punten samenvatting kantoorbreed.

### Hoofdmetrics (compact)
- Certificaten behaald (totaal + per type)
- Actieve medewerkers
- AO-punten kantoorgemiddelde vs doel
- Aandachtspunten count

### Aandachtspunten / Achterblijvers
Dit is de BELANGRIJKSTE sectie — partners willen zien wie achterloopt.
- "Achterblijvers (aandachtspunten)" als koptekst
- Scrollbare lijst (er kunnen er veel zijn)
- Per persoon: naam, voortgang, specifiek wat achterblijft
- "Herinnering sturen" knop per persoon
  → Opent een mail-concept met voorgeschreven tekst die je kunt aanpassen
  → Pas na "Herschrijf concept" kun je de inhoud bewerken
  → Dan "Verstuur" knop
  → **Let op:** Dit is voorlopig een DEMO/MOCKUP — de flow is visueel aanwezig maar
    verstuurt nog geen echte mail. Puur om het concept te demonstreren aan kantoorpartners.

### Toppers
Niet alleen achterblijvers — ook de toppers tonen.
Gebaseerd op: certificaten + afgeronde praktijkcases (niet alleen certificaten).

### Medewerkersoverzicht
- Tabel met alle medewerkers
- Per persoon: naam, AO-punten, certificaten, voortgang
- Klikbaar → detail per persoon
- GEEN "MWMR" of technische rolcodes — gewone namen
- Rol hoef je niet in het overzicht (weet je uit je hoofd), wel in het detail

### Medewerker Detail (na klikken)
- Certificaten (bovenaan — belangrijker dan voortgang)
- Recente activiteit (ook bovenaan)
- Voortgang per onderdeel (instructievideo's, cases, SOPs, examens, prompts)
- "Herinnering sturen" knop

### Certificaatoverzicht
Prominent — certificaten zijn één van de belangrijkste metrics.
Per certificaattype: hoeveel behaald, door wie.

## Stijl

- Meer breedte gebruiken dan het Learning Center
- Hero-blok ANDERS dan het Learning Center (duidelijk verschil)
- Geen Power BI-achtige overload aan grafieken
- Clean, zakelijk, bruikbaar in een partneroverleg
- Aandachtspunten en certificaten zijn de kern

## Belangrijke feedback

- "De aandachtspunten moet je beter in kaart krijgen"
- "De toppers is niet alleen op basis van certificaten, maar ook afgeronde praktijkcases"
- "Bij herinnering sturen: eerst een conceptherinnering, dan herschrijfconcept, dan bewerken"
- "Het hoeft niet een Power BI te worden"
- "Je moet als partner in een partneroverleg dit erbij kunnen pakken"
- "Meer breedte gebruiken"
- "Trend is lastig — focus nu op voortgang"
- "Rol hoef je niet in het overzicht, wel bij detail"
- "Achterblijvers scrollbaar maken, er kunnen er veel zijn"

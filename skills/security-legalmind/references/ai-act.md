# AI Act — toelichting voor Legal Mind

Hoe Legal Mind onder de Europese AI-regelgeving (Verordening 2024/1689) valt en welke
maatregelen de naleving onderbouwen.

## Risicoclassificatie

Legal Mind is geclassificeerd als **niveau 3 — beperkt risico** onder de AI Act.

### Waarom niet hoog risico (niveau 2)?

Hoog-risico AI-systemen zijn onder andere systemen die in gerechtelijke of
bestuursrechtelijke context worden ingezet, waar het AI-systeem zelf bijdraagt aan
besluitvorming met rechtsgevolgen. Legal Mind:

- Wordt **uitsluitend ingezet als ondersteunend hulpmiddel** voor interne juridische
  professionals.
- **Neemt geen besluiten met rechtsgevolgen.**
- **Output wordt altijd door een jurist gecontroleerd** voordat die wordt toegepast.
- **Opereert buiten** gerechtelijke of bestuursrechtelijke context.

Daarom valt Legal Mind onder beperkt risico, niet onder hoog risico.

### Conformiteitsbeoordeling

Voor systemen met beperkt risico (niveau 3) is een formele conformiteitsbeoordeling
**niet verplicht**. Er is dan ook geen conformiteitsbeoordeling uitgevoerd. Als klanten
hier expliciet om vragen — leg uit waarom dat niet aan de orde is voor onze classificatie.

## Geraadpleegde bronnen

Legal Mind raadpleegt:

- Alle Nederlandse rechtspraak
- Nederlandse wetten
- Eur-Lex (Europese wetgeving)
- Eigen dossiers en bronnen van de klant

Het systeem is ontworpen om te groeien — bron-uitbreiding is onderdeel van de visie.

## Hoe AI-risico's beperkt worden

Legal Mind beperkt AI-specifieke risico's (onnauwkeurigheid, hallucinaties, bias) via
drie pijlers:

### 1. Inrichting van het platform

- **Container-gebaseerde structuur** speciaal voor juristen.
- **Strikte datascheiding per module** (eigen documenten, dossiers, jurisprudentie,
  wetten via Eur-Lex). Geen ongecontroleerde datavermenging zoals bij black-box AI.
- Queries raadplegen alleen relevante data → minder irrelevante of misleidende
  antwoorden.

### 2. Technische verbeteringen

- **RAG (Retrieval-Augmented Generation)** — antwoorden zijn verplicht gebaseerd op
  specifieke bronnen uit de dataset, niet op algemene modelkennis. Dit verlaagt
  hallucinaties drastisch ten opzichte van standaard ChatGPT.
- Combinatie van meerdere technieken voor betrouwbaarheid.

### 3. Gebruikersbegeleiding — Educate, Verify, Mitigate

- **Educate:** trainingen na 1-3 maanden praktijkgebruik (kennisopname is beter na
  ervaring), gericht op platformgebruik en AI-fundamenten, met masterclasses over
  query-verfijning en risico-identificatie.
- **Verify:** output is traceerbaar via RAG met bronverwijzingen (dossier, wetsartikel).
  Juristen voeren systematische controles uit.
- **Mitigate:** doorlopende gebruikersfeedback voor modelverbetering. Demonstraties
  van containerstructuur en verificatiemethoden bouwen kritisch vertrouwen op.

## Human oversight (menselijke tussenkomst)

De AI Act vereist effectief menselijk toezicht waar relevant. Legal Mind is zo ingericht
dat:

- **Elke output is herleidbaar** naar geraadpleegde bronnen (via RAG).
- **Gebruiker kan altijd negeren, corrigeren of aanvullen** — geen autonome doorvoering.
- **Geen externe data-toegang of acties** — het systeem voert zelf geen handelingen uit
  buiten zijn afgebakende functie.
- **Jurist blijft eindverantwoordelijk** voor alle juridische beslissingen en adviezen.

In klantcommunicatie hierover: dit is een sterke positie. Onderstreep dat output
onderbouwd én controleerbaar is.

## Bias en discriminatie

Standaard AI-risico (skewed trainingsdata, historische bias). Legal Mind beperkt dit
door:

- RAG en containerstructuur → data-isolatie per query
- Visie: geen eindadviezen geven, wel inzicht bieden in feiten via gevalideerde datasets
  (Nederlandse staat, EP, eigen klantbronnen)
- Eindoordeel ligt bij de jurist

## Claims die je veilig kunt maken naar klanten

- Legal Mind valt onder beperkt risico (niveau 3) van de AI Act
- Output wordt nooit zelfstandig juridisch verbindend
- RAG-architectuur maakt output traceerbaar en verifieerbaar
- Container-isolatie minimaliseert datavermenging
- Geen autonome besluitvorming of externe acties
- Human oversight is structureel ingebouwd, niet optioneel

## Claims die voorzichtig framen

- Geen "garanties" op accuratesse van AI-output. AV 10.2 wijst die expliciet af, en dat
  past bij hoe de AI Act AI-systemen behandelt.
- Geen claim dat conformiteitsbeoordeling is uitgevoerd — dat is bij beperkt risico
  niet verplicht én niet gedaan.

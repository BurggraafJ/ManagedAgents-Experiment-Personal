# Current state — Legal Mind security & compliance

> **Laatst bijgewerkt:** 28 april 2026 (door Jelle)
> **Volgende review:** uiterlijk juli 2026 (3-maandelijkse refresh) of eerder bij grote wijziging.
>
> **Lees dit bestand altijd eerst** voordat je een security-vraag beantwoordt. Dit overschrijft
> wat in de gepubliceerde documenten staat als de werkelijkheid is veranderd.
> Als deze datum >3 maanden oud is, meld dat aan Jelle voordat je iets naar buiten produceert.

---

## TL;DR voor de skill

Als je in 30 seconden een beeld nodig hebt:

- **Hosting:** alles in Microsoft Azure, regio Amsterdam (Schiphol). Geen US, geen UK.
- **Identity:** Auth0/Okta, EU-tenant (Frankfurt primary, Dublin failover). Blijft binnen EU.
- **Encryptie:** TLS 1.2/1.3 in transit, AES-256 at rest.
- **Toegang:** RBAC, MFA verplicht voor beheer, principe van minimale rechten.
- **Back-ups:** dagelijkse back-up van de DMS-vault. Alleen handmatig gesynchroniseerde
  dossiers vallen onder Legal Mind's back-up.
- **Modeltraining:** klantdata wordt **nooit** gebruikt voor training of fine-tuning.
  Dit is contractueel én technisch geborgd.
- **AI Act:** geclassificeerd als beperkt risico (niveau 3), human oversight altijd aanwezig.
- **ISO 27001-traject:** loopt, beoogde afronding januari 2026 → status update Jelle nodig
  per [DATUM_HIERONDER].

---

## ISO 27001 traject

Laatste status zoals doorgegeven:

- **Begeleidende partij:** Scytale (8-fasen-traject).
- **Fase op laatst-gerapporteerd moment:** fase 4 (scope-definitie). Beoogde afronding
  van het hele traject: **januari 2026**.
- **Statement of Applicability (SoA):** nog niet definitief; wordt gedeeld zodra
  beschikbaar.
- **Scope:** zeer waarschijnlijk inclusief AI-functionaliteit en LLM-verwerking, maar
  formeel nog niet vastgelegd.

> ⚠️ Als deze datum is verstreken zonder update: vraag Jelle expliciet wat de actuele
> ISO-status is voordat je een klant antwoord geeft. Een verkeerde claim hierover is
> reputatieschade.

### Geplande vervolgcertificeringen

- **ISO 27701** (privacy) — start direct na 27001-afronding, beoogd Q2 2026.
- **ISO 27017 / 27018** (cloud security & PII protection) — parallel aan 27701, beoogd
  Q2 2026.
- **SOC 2 Type II** — niet op de roadmap. Legal Mind opereert volledig EU, dus SOC 2
  is op dit moment niet noodzakelijk. Heroverwegen als marktvraag verandert.
- **Externe penetratietest** — gepland (datum/leverancier in te vullen door Jelle).

## Sub-verwerkers (huidig)

| Sub-verwerker | Functie | Locatie data | EU-only? |
|---|---|---|---|
| Microsoft Azure | Hosting, infrastructuur, AI-tekstverwerking | Amsterdam (Schiphol) | Ja |
| Auth0 (Okta) | Identity & Access Management | Frankfurt (primary), Dublin (failover) — AWS eu-central-1 | Ja, blijft binnen EU |

Toekomstige LLM-sub-verwerkers moeten EU-gevestigd zijn, ISO 27001-gecertificeerd, EU-DC's
gebruiken en volledig AVG-compliant zijn. Wijzigingen worden vooraf aan klanten gemeld
(bezwaarrecht).

## Recent gerealiseerde verbeteringen

(uit jaarlijkse risicobeoordeling september 2025)

- **LLM Security & Compliance Assessment** — gestandaardiseerd beoordelingsproces voor
  LLM-verwerking op datastromen, leverancierscompliance, modelrisico's en outputvalidatie.
  **Status:** ingericht.
- **Application Gateway** — additionele perimeter-beveiligingslaag voor centrale inspectie
  van webverkeer, OWASP-bescherming, TLS-policy hardening, scheiding tussen publieke
  ingress en backend. **Status:** geïmplementeerd.
- **Formaliseren ISO-certificeringen** — traject loopt, zie boven.

## Bekende gaps / nuances (intern eerlijk)

Dit blok is **niet voor klantcommunicatie** zonder framing. Dit is voor Jelle om de
realiteit te kennen.

- **Geen 24/7 SOC-dienst.** We werken met realtime alerts (Azure Defender + central logging)
  en operationele opvolging door engineering/operations. Bij kritische alerts buiten
  kantooruren is er automatische escalatie naar het engineering-team via een roterende
  on-call. Dit volstaat voor een SaaS van onze schaal, maar grote IT-afdelingen vragen
  soms expliciet om een 24/7 SOC en moeten dan begrepen krijgen waarom dit niet
  noodzakelijk is.
- **MTTD/MTTR — geen formele SLA.** Intern hanteren we minuten-tot-uren voor MTTD
  (afhankelijk van alert-type) en directe respons voor high-severity. Contractueel staat
  alleen de 24-uurs datalek-meldplicht uit de VO. Geen aparte commerciële incident-SLA.
- **Geen geautomatiseerde sync-rapportage richting klanten.** Klanten weten zelf niet
  proactief of een dossier wel/niet gesynchroniseerd is. Wel intern signalering bij
  loskoppeling/verlopen authenticatie.
- **Statement of Applicability nog niet beschikbaar.** Eerlijk antwoord: zodra
  beschikbaar delen we het.
- **Klantvraag "deel een audit-rapport" — pas mogelijk na afronding ISO-traject.**
  Daarvoor verwijzen we naar continue klantfeedback-cycli en kwartaal-audits intern.
- **Risicoregister bestaat** — gedeeld als geanonimiseerde extractie op verzoek (Risk ID,
  categorie, beschrijving, beheersmaatregelen). Impactscores, eigenaren en interne
  verbeteracties zijn intern.

## Operationele cadans

- **Risicobeoordeling:** jaarlijks in september, plus doorlopende controles.
- **Interne audits:** kwartaallijks op kritieke processen en toegangsrechten.
- **Toegangsreviews:** periodiek (kwartaal).
- **Patchmanagement:** doorlopend.
- **LLM-leverancierstoetsing:** regelmatig, frequenter dan kwartaal vanwege snelle
  ontwikkelingen.
- **Logging-bewaartermijn:** minimaal 12 maanden.

## Datalek / incident — contractuele commitments

- **Initiële melding:** binnen 24 uur na ontdekking aan verwerkingsverantwoordelijke
  (uit VO art. 6).
- **Daarna:** stapsgewijze informatieverstrekking, validatie, containment, analyse,
  klantmelding, herstel.
- **Logging:** alle inbreuken worden gedocumenteerd inclusief feiten, gevolgen,
  genomen maatregelen.

## Wijzigingslog (update dit bij elke aanpassing)

| Datum | Wat | Door |
|---|---|---|
| 2026-04-28 | Initiële versie current-state.md gegenereerd uit bestaande documentatie | Jelle + skill |

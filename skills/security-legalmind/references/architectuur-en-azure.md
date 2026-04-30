# Architectuur en Azure-infrastructuur

Hoe Legal Mind technisch in elkaar zit voor security-doeleinden. Deze pagina beantwoordt
vragen over hosting, datalokaties, scheiding tussen klanten, en welke Microsoft-onderdelen
we gebruiken.

## Platform overzicht

Legal Mind is een SaaS-platform voor juridische professionals. Het bestaat uit een
webportaal (browser-based) en is opgebouwd in modules:

- **Assistant Module** (vraag & antwoord op juridische bronnen)
- **Dossier Management Module** (de "vault" — opslag en organisatie van documenten)
- **Compliance Module**
- **Document Drafter Module**

Alle modules draaien op één Azure-omgeving. Geen on-premises componenten.

## Hosting — Microsoft Azure

- **Provider:** Microsoft Azure (Microsoft Ireland Operations Limited als contractspartij
  voor Microsoft DPA).
- **Regio:** West Europe / Amsterdam (Schiphol). Alle langdurige opslag exclusief in
  Nederlandse datacenters.
- **Geen US, geen UK, geen APAC.** Geen doorgifte naar derde landen — contractueel
  uitgesloten in onze VO.
- **EU Data Boundary:** Microsoft heeft per september 2025 EFTA toegevoegd aan locaties
  waar Customer Data, Personal Data en Professional Services Data at rest worden
  opgeslagen voor EU Data Boundary Services. Onze data blijft binnen NL/EU/EER.

## Datacenter-beveiliging (fysiek)

Microsoft Azure-datacenters Schiphol zijn ISO/IEC 27001-gecertificeerd en jaarlijks door
derden geaudit. Maatregelen:

- 24/7 bewaking door getraind beveiligingspersoneel
- Biometrische toegangscontroles (vingerafdruk, irisscanners)
- CCTV op alle in- en uitgangen en kritieke zones
- Strikte toegangsprotocollen (alleen geautoriseerd personeel met geldige ID)
- Bezoekers geregistreerd en continu begeleid
- Redundante systemen voor stroom, koeling en netwerken

## Identity & Access Management — Auth0 / Okta

- **Provider:** Auth0 (onderdeel van Okta).
- **Tenant:** EU-tenant. Data opgeslagen in AWS-regio eu-central-1 (Frankfurt primary,
  Dublin failover).
- **Beveiliging datacenters:** 24/7 bewaking, CCTV, meerlaagse biometrische en MFA-toegang,
  geïntegreerde inbraak- en branddetectie.
- **Functies:** authenticatie, MFA, SSO via SAML 2.0 waar mogelijk, RBAC.

## Netwerk-architectuur

- **Application Gateway** (sinds 2025 live) als perimeter-beveiliging:
  - centrale inspectie van webverkeer
  - bescherming tegen OWASP-gedefinieerde dreigingen
  - TLS-policy hardening
  - strikte scheiding tussen publieke ingress en backend-systemen
- **Firewalls** blokkeren ongewenst verkeer en scheiden interne systemen in subnetwerken
  zonder directe externe toegang.
- **Subnetwerk-segmentatie** — backend-componenten zijn niet rechtstreeks publiek
  bereikbaar.

## Datascheiding tussen klanten

Klantgegevens zijn logisch geïsoleerd per klant-tenant. Gegevens worden niet gedeeld met
andere klanten en niet opgeslagen bij AI-modelleveranciers. Dit is technisch en
contractueel geborgd.

Voor LLM-verwerking: data wordt tijdelijk doorgegeven aan een EU-gevestigde LLM-provider
binnen Azure (zie `llm-en-modeltraining.md`), wordt niet opgeslagen door de provider, en
wordt niet gebruikt voor training.

## Encryptie

- **In transit:** TLS 1.2 minimum, TLS 1.3 waar mogelijk.
- **At rest:** AES-256 (of vergelijkbaar) op alle gegevens in Azure datacenters EU.
- **Sleutelbeheer:** via Microsoft Azure (Microsoft-managed keys; klantsleutels op
  aanvraag bespreekbaar).

## Logging en monitoring

- **Centrale logging** van alle systeemactiviteiten met timestamps en gebruikersidentificatie.
- **Bewaartermijn:** minimaal 12 maanden.
- **Azure Defender / Azure-monitoring** voor real-time security-alerts.
- **Geen 24/7 SOC** — wel automatische escalatie buiten kantooruren via roterende on-call.
- **MFA/RBAC-bewaking** op administratieve accounts.

## Beschikbaarheid en redundantie

- Azure's redundante systemen voor stroom, netwerken en koeling.
- Patchmanagement: doorlopend.
- Geen formele uptime-SLA naar klanten gecommuniceerd; pragmatisch gericht op hoge
  beschikbaarheid via Azure-infrastructuur.

## Belangrijk bij vragen over architectuur

Als een klant vraagt om diepgaande architectuurschema's: Legal Mind heeft een security-
en infrastructuurdiagram en een datascheidingsdiagram (in het Legal Mind Security-document,
niet in deze skill ingesloten). Deze worden op verzoek gedeeld onder NDA waar nodig.
Bevestig met Jelle voordat je een schema deelt of een gedetailleerde versie produceert.

# Technische en organisatorische maatregelen

Compacte referentie voor T+O-vragen. Voor architectuur zie `architectuur-en-azure.md`.
Voor LLM-verwerking zie `llm-en-modeltraining.md`. Voor contractuele basis zie
`contracten-overzicht.md`.

## Toegangscontrole

### Systeemtoegang

- **Principe van minimale rechten** — strict need-to-know.
- **MFA verplicht** voor alle systemen met persoonlijke of gevoelige gegevens.
- **Hoge-niveau-toegang** (admin, root) beperkt tot een zeer klein aantal geautoriseerd
  personeel, continu gemonitord, kwartaal-audit.
- **Ongebruikte accounts** worden direct gedeactiveerd.

### Toegang tot data

- **Role-Based Access Control (RBAC)** — toegang op basis van functierol.
- **Wachtwoordbeleid:**
  - Minimaal 10 karakters, mix van hoofdletters/kleine letters/cijfers/speciale tekens.
  - Opgeslagen in end-to-end versleutelde wachtwoordbeheerder.
  - Niet gedeeld via onbeveiligde kanalen (telefoon, chat).
  - Alleen via versleutelde methoden (password manager, beveiligde mail).
- **SSO** via SAML 2.0 waar mogelijk.
- **Strikte scheiding** tussen systeem-toegang en data-toegang.

## Encryptie

| Type | Standaard |
|---|---|
| In transit | TLS 1.2 minimum, TLS 1.3 waar mogelijk |
| At rest | AES-256 of vergelijkbaar |
| Sleutelbeheer | Microsoft-managed (Azure) — klantsleutels bespreekbaar |

## Logging & monitoring

- Centrale logging van alle systeemactiviteiten met timestamps en gebruikers-ID.
- Bewaartermijn: minimaal 12 maanden.
- Azure Defender + Azure-monitoring voor real-time alerts.
- Engineering/operations-team volgt op binnen ISMS-kader.
- Geen externe 24/7 SOC; automatische escalatie buiten kantooruren via roterende on-call.

### MTTD / MTTR (interne richtwaarden)

- **MTTD:** minuten tot enkele uren, afhankelijk van alert-type.
- **MTTR:** afhankelijk van ernst; high-severity → directe incident-response.
- **Datalek:** contractueel 24-uurs initiële melding (uit VO art. 6).

## Incident management

### Classification playbook

Drie ernstniveaus: laag, midden, hoog. High-severity wordt direct onderzocht.

### Security Incident Runbook

Bij kritieke signalen (ongeautoriseerde toegang, verdachte privilege-wijzigingen, mogelijk
datalek) start direct het formele incident-proces:

1. **Validatie** van het signaal
2. **Containment** — beperken van impact
3. **Analyse** — root cause, omvang
4. **Klantmelding** binnen 24 uur (conform VO)
5. **Herstel** + nazorg

### Operational Monitoring Runbook

Dagelijks/wekelijks:
- Review van security-alerts
- RBAC-controles
- Patch-status-check
- Verificatie van back-ups

## Back-ups en bedrijfscontinuïteit

- **Dagelijkse back-up** van het Dossier Management Systeem (de "vault") — elke 24 uur.
- **Alleen handmatig gesynchroniseerde dossiers** vallen onder Legal Mind's back-up.
  Documenten die alleen in een gekoppeld DMS van de klant staan (bijv. SharePoint),
  vallen onder de back-up van de klant zelf.
- **Reden:** dit geeft de gebruiker controle over welke dossiers binnen de Legal Mind
  vault worden opgeslagen, en het DMS van de klant blijft de bron van waarheid.
- **Redundantie:** Azure's redundante systemen voor stroom, netwerken, koeling.
- **Patchmanagement:** doorlopend om kwetsbaarheden te minimaliseren.

### Synchronisatie-controle

Er is een controlemechanisme dat signaleert wanneer:
- een integratie niet meer correct is gekoppeld (bijv. verlopen authenticatie)
- een dossier niet meer synchroon loopt (na verwijderen, toevoegen, bewerken in DMS)

Geen geautomatiseerde sync-rapportage richting klanten op dit moment — bespreekbaar als
gewenst. Geen automatische synchronisatie of continuous backup gepland (klanten waarderen
juist de handmatige sync waardoor het DMS van de klant de bron van waarheid blijft).

## Operationele beveiliging

- **Antivirus / antimalware** — actieve monitoring en bescherming.
- **E-mailbeveiliging** — spamfilters en malwarebescherming.
- **Patchmanagement** — regelmatige installatie van security-updates.
- **Vulnerability management** — onderdeel van het ISMS.

## Personeel

- **Geheimhoudingsverklaring** door alle medewerkers ondertekend.
- **Periodieke security- en privacy-training.**
- **Achtergrondchecks** waar redelijk en wettelijk toegestaan.

## Risk management

- **Jaarlijkse risicobeoordeling** in september.
- **Risicoregister** intern bijgehouden (geanonimiseerde extractie deelbaar op verzoek).
- **Doorlopende controles** tussen jaarlijkse beoordelingen door.
- **Kwartaal-audits** op kritieke processen en toegangsrechten.
- **Periodieke leveranciersbeoordeling** (Microsoft Azure, Auth0/Okta) op AVG-conformiteit
  en relevante ISO-certificeringen.

## Bewaring en eigendom van data

- **Eigendom data:** klant blijft juridisch eigenaar/gebruiksrechthebbende. Legal Mind
  heeft alleen gebruiksrechten die nodig zijn voor de dienstverlening.
- **Bij beëindiging:** klant bepaalt of data wordt geretourneerd of verwijderd. Beide
  technisch en contractueel mogelijk. Methode en format in overleg conform AVG.
- **Bewaring tijdens contract:** conform klantinstructies en wettelijke vereisten.

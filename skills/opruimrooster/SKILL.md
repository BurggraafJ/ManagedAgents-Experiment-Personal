---
name: opruimrooster
description: >
  Beheert het wekelijkse opruimrooster van Legal Mind — wie is welke dag verantwoordelijk
  voor de koffiecorner en vaat. Gebruik deze skill wanneer Jelle vraagt om het opruimrooster
  aan te passen, iemand toe te voegen of te verwijderen, uitzonderingen in te stellen voor
  specifieke dagen/weken, het huidige rooster te bekijken, of een nieuw rooster te genereren.
  Trigger bij: "opruimrooster", "vaat", "koffiecorner", "opruimen", "wie ruimt op",
  "opruimverantwoordelijkheid", "keukenrooster", "schoonmaakrooster", "rooster aanpassen",
  "wie doet de vaat", "[naam] kan niet op [dag]", "[naam] werkt niet op [dag]",
  "wissel [naam] en [naam]", "voeg [naam] toe aan het rooster", of wanneer het gaat om
  de dagelijkse kantoorverantwoordelijkheden rondom koffiecorner en vaat.
  Trigger NIET voor schoonmaakbedrijf-gerelateerde zaken of facilitaire inkoop.
---

# Opruimrooster Legal Mind

Beheert de wekelijkse indeling van kantoorverantwoordelijkheden: koffiecorner opgeruimd
houden door de dag heen en de vaat doen.

## Huidige indeling

Het rooster bevat de volgende personen, verdeeld over de werkweek (alleen voornamen):

| Dag        | Verantwoordelijke(n) |
|------------|----------------------|
| Maandag    | Koen & Akram         |
| Dinsdag    | Veerle & George      |
| Woensdag   | Julia & Roy          |
| Donderdag  | Siem & Jasper        |
| Vrijdag    | Jelle & Jay          |

**Altijd 2 personen per dag.** Dit is een harde regel — bij elke wijziging moet elke dag
precies 2 verantwoordelijken hebben.

**Uitgesloten van het rooster:** Tarik El Hamdaoui, Yash Gandhi, Syed Taha,
Sander Seton, Derek Bender, en het Marketing-team.

**Verantwoordelijkheid per dag:**
- Koffiecorner opgeruimd houden (door de dag heen) — kopjes weg, aanrecht schoon, koffie bijvullen
- Vaat aan het einde van de dag

## Regels & uitzonderingen

Lees `references/regels-en-uitzonderingen.md` voor de volledige regels, structurele
uitzonderingen (wie niet op welke dag werkt), uitgesloten personen en de ingangsdatum.
Raadpleeg dit bestand bij elke wijziging om geen conflicten te creëren.

**Kernregels:**
- Altijd 2 personen per dag
- Gezamenlijke verantwoordelijkheid — beide worden aangesproken, ook bij afwezigheid
- Bij afwezigheid onderling ruilen
- Akram werkt niet op vrijdag (structurele uitzondering)

## Wat deze skill doet

Bij elke wijziging of generatie:

1. Lees `references/regels-en-uitzonderingen.md` om conflicten te voorkomen
2. Pas de indeling aan op basis van het verzoek
3. Controleer dat elke dag exact 2 personen heeft
4. Genereer het Excel-bestand in Legal Mind huisstijl
5. Update de huidige indeling hierboven in SKILL.md zodat die altijd actueel is
6. Bij structurele wijzigingen: update ook `references/regels-en-uitzonderingen.md`

## Soorten wijzigingen

### Persoon toevoegen
Voeg de persoon toe aan een dag en herverdeel indien nodig om 2 per dag te houden.

### Persoon verwijderen
Verwijder de persoon en herverdeel zodat elke dag 2 personen behoudt.

### Uitzondering voor een specifieke week
Als iemand een bepaalde week niet kan, wissel met iemand anders voor die week.

### Structurele dagwijziging
Als iemand structureel niet op een bepaalde dag werkt, verplaats permanent en
noteer de uitzondering in `references/regels-en-uitzonderingen.md`.

### Dagen wisselen
Wissel twee personen van dag als daarom gevraagd wordt.

## Excel generatie

Gebruik het script `scripts/generate_rooster.py` om het Excel-bestand te genereren.

```bash
python3 <skill-path>/scripts/generate_rooster.py '<json_schedule>' '<output_path>'
```

Gebruik alleen voornamen in de JSON:
```json
{
  "Maandag": ["Koen", "Akram"],
  "Dinsdag": ["Veerle", "George"],
  "Woensdag": ["Julia", "Roy"],
  "Donderdag": ["Siem", "Jasper"],
  "Vrijdag": ["Jelle", "Jay"]
}
```

## Communicatie

Als Jelle vraagt om een mail of bericht bij de wijziging, schrijf in zijn toon: direct,
professioneel maar niet stijf, to-the-point. Gebruik "Dag allen," als aanhef voor
formele berichten en "Hi team," voor informele.

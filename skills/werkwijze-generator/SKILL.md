---
name: werkwijze-generator
description: >
  Genereert professionele werkwijze-documenten (PDF) voor Legal Mind skills en plugins, zodat het team
  begrijpt hoe een skill werkt en wanneer je hem gebruikt. Analyseert automatisch de SKILL.md
  en referentiebestanden, genereert een gestandaardiseerde PDF in Legal Mind huisstijl,
  en uploadt het resultaat naar SharePoint.
  Trigger bij: "werkwijze maken", "werkwijze genereren", "maak werkwijze voor [skill]",
  "werkwijze van [skill]", "hoe werkt de [skill] skill", "documenteer [skill]",
  "werkwijze document", "skill uitleggen", "skill documenteren", "werkwijze PDF",
  "interne werkwijze", "handleiding maken voor [skill]", "uitleg skill",
  of wanneer iemand een interne handleiding of werkwijze wil voor een bestaande skill.
  Trigger ook wanneer iemand zegt "het team moet weten hoe [skill] werkt" of
  "hoe leggen we [skill] uit aan het team".
  Trigger NIET voor skill-creator, sop-creator, of algemene documentatie zonder skill-context.
---

# Werkwijze Generator — Interne skill-documentatie voor het team

Deze skill analyseert een bestaande Legal Mind skill (of alle skills binnen een plugin) en genereert
automatisch een professionele werkwijze-PDF in de Legal Mind huisstijl. Het resultaat wordt geupload
naar SharePoint zodat het hele team erbij kan. Geen intake-vragen — volledig automatisch.

## Bestandsstructuur

```
werkwijze-generator/
├── SKILL.md                                 ← Dit bestand
└── scripts/
    └── generate_werkwijze_pdf.py            ← PDF-generatiescript (ReportLab)
```

---

## Workflow — Vijf stappen

### Stap 1 — Skill identificeren en localiseren

Bepaal welke skill gedocumenteerd moet worden op basis van wat de gebruiker zegt,
bijvoorbeeld: "maak werkwijze voor offerte-generator" of "werkwijze auto-draft".

**Zoeklocaties (in volgorde):**

Gebruik Glob om de skill te vinden:

```
Glob: mnt/.claude/skills/[skillnaam]/SKILL.md
Glob: mnt/.remote-plugins/*/skills/[skillnaam]/SKILL.md
```

**Plugin-detectie:** als de skill onder `.remote-plugins/` zit, lees dan de plugin-naam
uit het pad. Voor plugins maak je één werkwijze per skill, maar groepeer je ze onder
één SharePoint-map met een leesbare plugin-naam (niet de plugin-ID).

### Stap 2 — Skill analyseren

Lees de volledige SKILL.md. Lees ook eventuele bestanden in `references/` als die
relevant zijn voor de workflow.

Destilleer hieruit:

1. **Naam & doel** — Wat doet deze skill in één zin?
2. **Wanneer gebruiken** — Triggerzinnen en situaties
3. **Wanneer NIET gebruiken** — Wat buiten scope valt
4. **Stap-voor-stap workflow** — Per stap: actie, jouw input, resultaat
5. **Eindresultaat** — Welk bestand/document/actie komt eruit?
6. **Tips** — Praktische tips (als af te leiden uit de skill)

Zet dit in deze JSON-structuur:

```json
{
    "skill_name": "Offerte Generator",
    "skill_id": "offerte-generator",
    "doel": "Genereert professionele offertes als DOCX en PDF.",
    "wanneer_gebruiken": [
        "Je wilt een offerte maken voor een advocatenkantoor",
        "Een klant heeft om een voorstel gevraagd"
    ],
    "wanneer_niet": [
        "Voor SLA's → gebruik sla-generator",
        "Voor licentieovereenkomsten → apart document"
    ],
    "stappen": [
        {
            "nummer": 1,
            "titel": "Informatie verzamelen",
            "actie": "Claude zoekt klantgegevens op in HubSpot",
            "jouw_input": "Geef de kantoornaam op en kies het pakket",
            "resultaat": "Klantgegevens en dealinfo zijn opgehaald"
        }
    ],
    "eindresultaat": "Een professionele offerte in DOCX + PDF, klaar om te versturen.",
    "tips": [
        "Zorg dat het kantoor al in HubSpot staat voor de beste resultaten"
    ]
}
```

### Stap 3 — PDF genereren

Installeer eerst ReportLab als dat nog niet beschikbaar is:

```bash
pip install reportlab --break-system-packages 2>/dev/null
```

Schrijf de JSON-content naar een tijdelijk bestand en genereer de PDF:

```bash
python [skill-path]/scripts/generate_werkwijze_pdf.py \
  --input /tmp/werkwijze_content.json \
  --output [output-dir]/werkwijze-[skill-id].pdf
```

Waarbij:
- `[skill-path]` = het pad naar deze skill (bijv. `mnt/.claude/skills/werkwijze-generator`)
- `[output-dir]` = de outputs-directory van de huidige sessie (bijv. `mnt/outputs`)

### Stap 4 — Uploaden naar SharePoint

De werkwijze wordt geupload naar de SharePoint-documentenbibliotheek van het MT-team.

**SharePoint-configuratie:**
- Site: `https://bgintelligence.sharepoint.com/sites/MT`
- Basispad: `/sites/MT/Gedeelde documenten/Werkwijzes/`

**Mapnaamgeving:**
- Enkele skill: `Werkwijzes/[Skill Naam]/` (bijv. `Werkwijzes/Offerte Generator/`)
- Plugin skills: `Werkwijzes/[Plugin Naam]/` (bijv. `Werkwijzes/HubSpot CRM/`)

**Bestandsnaam:** `Werkwijze - [Skill Naam].pdf`

#### 4a — Navigeer naar SharePoint

Open de SharePoint-site via Claude in Chrome:

```
navigate → https://bgintelligence.sharepoint.com/sites/MT
```

Wacht tot de pagina geladen is (check op "MT" of "Gedeelde documenten" in de paginatekst).

#### 4b — Map aanmaken via REST API

Voer JavaScript uit in de browser om de map aan te maken. Als de map al bestaat
is dat geen probleem — ga dan door naar de upload.

```javascript
(async () => {
    const digestRes = await fetch("/_api/contextinfo", {
        method: "POST",
        headers: { "Accept": "application/json;odata=verbose" }
    });
    const digest = (await digestRes.json()).d.GetContextWebInformation.FormDigestValue;

    const folderName = "MAPNAAM";
    const res = await fetch("/_api/web/folders/add('/sites/MT/Gedeelde documenten/Werkwijzes/" + folderName + "')", {
        method: "POST",
        headers: {
            "Accept": "application/json;odata=verbose",
            "X-RequestDigest": digest
        }
    });
    console.log(res.ok ? "Map aangemaakt: " + folderName : "Map bestaat al of fout: " + res.status);
})();
```

Vervang `MAPNAAM` door de skill- of plugin-naam (bijv. "Offerte Generator").

#### 4c — PDF uploaden via REST API

**Stap 1:** Converteer de PDF naar base64 in bash:

```bash
base64 -w 0 [output-dir]/werkwijze-[skill-id].pdf
```

**Stap 2:** Upload via JavaScript in de browser. Vervang `BASE64_DATA`, `MAPNAAM`
en `BESTANDSNAAM` met de juiste waarden:

```javascript
(async () => {
    const digestRes = await fetch("/_api/contextinfo", {
        method: "POST",
        headers: { "Accept": "application/json;odata=verbose" }
    });
    const digest = (await digestRes.json()).d.GetContextWebInformation.FormDigestValue;

    const b64 = "BASE64_DATA";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const folder = "MAPNAAM";
    const fileName = "BESTANDSNAAM";
    const url = "/_api/web/GetFolderByServerRelativeUrl('/sites/MT/Gedeelde documenten/Werkwijzes/"
        + folder + "')/Files/add(url='" + fileName + "',overwrite=true)";

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Accept": "application/json;odata=verbose",
            "X-RequestDigest": digest,
            "Content-Type": "application/octet-stream"
        },
        body: bytes.buffer
    });

    if (res.ok) {
        const r = await res.json();
        console.log("Upload SUCCESS: " + r.d.Name + " (" + r.d.Length + " bytes)");
    } else {
        console.log("Upload FAILED: " + res.status);
    }
})();
```

**Let op:** als de base64-string te lang is voor één JavaScript-uitvoering, splits hem dan:
```javascript
const b64 = "deel1" + "deel2" + "deel3";
```

### Stap 5 — Opleveren

Deel de PDF met de gebruiker:

```
[Bekijk de werkwijze](computer:///[output-dir]/werkwijze-[skill-id].pdf)
```

Meld ook: "De werkwijze is geupload naar SharePoint: Werkwijzes > [Mapnaam] > [Bestandsnaam].pdf"

---

## PDF-ontwerp (Legal Mind huisstijl)

Het document volgt een strikt donker/licht afwisselingspatroon:

| Pagina | Thema | Inhoud |
|--------|-------|--------|
| 1 | Donker (#2B2B2B) | Cover + overzicht: logo, "WERKWIJZE" label, skill naam, doel, wanneer wel/niet, datum |
| 2 | Licht (#F5F1EE) | Stappen 1-3 in cards met oranje nummercirkels |
| 3 | Donker | Stappen 4-6 (als die er zijn) |
| 4+ | Afwisselend | Steeds 3 stappen per pagina |
| Laatste | Volgt patroon | Tips in cards met oranje verticale streep |

Oneven pagina's zijn donker, even pagina's zijn licht. Het Python-script handelt
dit automatisch af — je hoeft alleen de JSON-content correct aan te leveren.

---

## Voorbeeld triggerzinnen

- "Maak een werkwijze voor de offerte-generator"
- "Werkwijze auto-draft"
- "Documenteer de sla-generator skill voor het team"
- "Hoe werkt de kilometerregistratie skill? Maak er een werkwijze van"
- "Werkwijze PDF maken voor klantfeedback-rapport"
- "Maak werkwijzes voor de hubspot-crm plugin"

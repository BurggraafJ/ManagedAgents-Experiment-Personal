# Mail-template — Training Mailer

Dit document bevat de e-mail template die de skill gebruikt om de concept-mail samen te stellen.

---

## Onderwerp

```
Voorbereiding training Legal Mind — [Kantoornaam]
```

---

## Body — HTML Template

De body wordt als HTML ingevoegd in Outlook. Gebruik `<div>` tags, geen `<p>` tags (conform auto-draft regels). Geen em-dashes.

### Variabelen

| Variabele | Bron |
|-----------|------|
| `[KANTOORNAAM]` | Naam van het kantoor uit het agenda-event |
| `[LINK_PRAKTIJKCASUS_PDF]` | URL van de praktijkcasus-PDF uit het actieve dossier in dossiers.md |
| `[LINK_DOSSIER_MAP]` | URL van de dossier-map uit het actieve dossier in dossiers.md |

### HTML-template

```html
<div>Beste deelnemer,</div>
<div><br></div>
<div>Binnenkort nemen jullie deel aan een introductietraining van Legal Mind.</div>
<div>Ter voorbereiding is je gebruikersaccount aangemaakt en opgestuurd naar je mailadres.</div>
<div><br></div>
<div>Er zijn twee e-mails verstuurd met instructies voor het instellen van de inloggegevens (controleer indien nodig ook de spam- of ongewenste inbox). Naast de instructie die je tijdens onze training ontvangt zijn er ook instructievideo's verstuurd die als naslag kunnen worden gebruikt.</div>
<div><br></div>
<div>De training bestaat uit een theoretisch en een praktisch onderdeel. In de bijlage vinden jullie twee PDF-documenten:</div>
<div><br></div>
<div>&bull; <a href="[LINK_PRAKTIJKCASUS_PDF]">Praktijkcasus</a></div>
<div>&bull; <a href="[LINK_DOSSIER_MAP]">Dossier Houtrot</a></div>
<div><br></div>
<div>Tijdens de sessie gaan jullie actief met deze materialen aan de slag, zodat het geleerde direct in de praktijk kan worden toegepast. Probeer deze al te uploaden in de Legal Mind omgeving zodat we hier direct mee aan de slag kunnen.</div>
<div><br></div>
<div>Wij wensen jullie een leerzame en inspirerende sessie!</div>
<div><br></div>
<div>Met vriendelijke groet,</div>
```

> **Let op:** Na "Met vriendelijke groet," wordt de Outlook-handtekening automatisch geplaatst. Voeg GEEN handmatige handtekening toe in de template.

---

## Stijlregels

- **Taal:** Altijd Nederlands
- **Toon:** Formeel en professioneel, gericht aan meerdere deelnemers
- **"je/jullie":** "je" voor individuele instructies, "jullie" wanneer de groep wordt aangesproken
- **Geen em-dashes:** Gebruik komma's, puntkomma's of twee zinnen
- **Begroeting:** Altijd "Beste deelnemer," (ongeacht aantal ontvangers)
- **Links:** De praktijkcasus en dossier-link worden als klikbare tekst in de body gezet

---

## Voorbeeld — Ingevulde mail

**Aan:** m.dejong@jpr.nl; s.vanderberg@jpr.nl; k.vermeer@jpr.nl
**Onderwerp:** Voorbereiding training Legal Mind — JPR Advocaten

```html
<div>Beste deelnemer,</div>
<div><br></div>
<div>Binnenkort nemen jullie deel aan een introductietraining van Legal Mind.</div>
<div>Ter voorbereiding is je gebruikersaccount aangemaakt en opgestuurd naar je mailadres.</div>
<div><br></div>
<div>Er zijn twee e-mails verstuurd met instructies voor het instellen van de inloggegevens (controleer indien nodig ook de spam- of ongewenste inbox). Naast de instructie die je tijdens onze training ontvangt zijn er ook instructievideo's verstuurd die als naslag kunnen worden gebruikt.</div>
<div><br></div>
<div>De training bestaat uit een theoretisch en een praktisch onderdeel. In de bijlage vinden jullie twee PDF-documenten:</div>
<div><br></div>
<div>&bull; <a href="https://bgintelligence.sharepoint.com/:b:/s/MT/IQCOtI6NfBhFT6sfFg36lWOwASXcsN4yfUzLEbSC_5oWC18?e=Hfs3CN">Praktijkcasus</a></div>
<div>&bull; <a href="https://bgintelligence.sharepoint.com/:f:/s/MT/IgDI6nhGWs-ySqNLF3BLpEf_AXarWlJb9ZxNvx_txR63Iow?e=qpLhWd">Dossier Houtrot</a></div>
<div><br></div>
<div>Tijdens de sessie gaan jullie actief met deze materialen aan de slag, zodat het geleerde direct in de praktijk kan worden toegepast. Probeer deze al te uploaden in de Legal Mind omgeving zodat we hier direct mee aan de slag kunnen.</div>
<div><br></div>
<div>Wij wensen jullie een leerzame en inspirerende sessie!</div>
<div><br></div>
<div>Met vriendelijke groet,</div>
```

# Context ophalen en presenteren

Dit document beschrijft hoe je Confluence-context ophaalt en aan de gebruiker presenteert
voordat je begint met bouwen.

---

## Stap 1: Haal de context op

Volg de stappen in `confluence-workflow.md` — zoek de Index-pagina, valideer de vereisten,
en lees de Scope, UI/UX pagina en Backend Implementation Notes.

## Stap 2: Presenteer de context

Na het ophalen rapporteer je aan de gebruiker welke context je hebt opgehaald, zodat duidelijk
is waarmee je gaat werken. Dit is het moment waarop de gebruiker kan zien of alles klopt
voordat jij verdergaat.

Presenteer het zo:

> "Dit is de context die ik heb opgehaald voor **[Feature Name]**:
>
> **Scope**: ✅ Opgehaald — [korte samenvatting: wat de feature doet, hoeveel acceptance criteria]
>
> **UI/UX pagina**: ✅ Opgehaald
> - Visual Artifacts: [wat je gevonden hebt — screenshots (Nx), FigJam flows (Nx), Figma designs (Nx), of ontbrekend]
> - Design Decisions: [aantal beslissingen / niet aanwezig]
> - Screen flows: [aantal schermen beschreven / niet aanwezig]
> - State inventory: [aantal states / niet aanwezig]
>
> **Backend Implementation Notes**: ✅ Opgehaald — [aantal endpoints, korte beschrijving per endpoint]
>
> **Architecture pagina**: ⏭️ Genegeerd (is backend-architectuur van vóór de bouw)
>
> [Eventuele opmerkingen over ontbrekende dingen, bijv. "Let op: Index-pagina zegt 'Figma: No designs yet'"]
>
> Klopt deze context? Kan ik beginnen met de codebase-analyse?"

### Wat je benoemt per onderdeel

**Scope**: Vat in één zin samen wat de feature doet en hoeveel acceptance criteria er zijn.

**UI/UX pagina**: Benoem specifiek wat er in de Visual Artifacts staat — tel het aantal
screenshots, FigJam flows en Figma designs. Benoem ook of er Design Decisions, Screen-level
flows en een State inventory aanwezig zijn, en zo ja hoeveel.

**Backend Implementation Notes**: Som de endpoints op met method en korte beschrijving. Dit
geeft de gebruiker direct inzicht in welke API-mogelijkheden er zijn.

**Architecture pagina**: Altijd vermelden dat deze genegeerd is, zodat de gebruiker weet dat
je bewust niet op die informatie bouwt.

### Als er iets ontbreekt

Benoem ontbrekende dingen expliciet. Voorbeelden:
- "Er staan geen screenshots op de UI/UX pagina"
- "De Index-pagina zegt 'Figma: No designs yet'"
- "Backend Implementation Notes heeft geen notities specifiek voor frontend"

Bij ontbrekende visual artifacts (geen screenshots, geen FigJam, geen Figma):

> "Ik heb de UI/UX pagina bekeken maar er staan **geen visual artifacts**. Ik kan niet goed
> bouwen zonder visuele referentie. Wil je dat ik toch doorga op basis van bestaande
> UI-patronen, of moeten er eerst designs worden toegevoegd?"

**Stop het proces** en wacht op bevestiging.

Bij overige ontbrekende context: meld het en vraag of je door kunt gaan. Wacht altijd op
bevestiging voordat je verdergaat met de codebase-analyse.

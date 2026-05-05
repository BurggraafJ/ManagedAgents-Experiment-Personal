---
name: legal-ai-compose
description: "[GEDEPRECATEERD 2026-05-02] Was bedoeld als article-compose-pass na Perplexity-research. Sinds Grok-pivot doet `legal-ai-research` zowel research als writing in één call — deze skill heeft geen rol meer. Niet triggeren. Verwijderen mag zodra ≥2 weken stabiel."
---

# legal-ai-compose — DEPRECATED

> **Status:** ⛔ Gedeprecateerd op 2026-05-02 in dezelfde sessie waarin v1 werd gebouwd.
>
> **Reden:** De pivot van Perplexity → xAI Grok heeft de architectuur vereenvoudigd — Grok doet research+writing in één call (zie `legal-ai-research` v2). Een aparte compose-pass is niet meer nodig.

## Wat deze skill ooit deed

Per dag drie artikelen schrijven (advocatuur, bedrijfsleven, combined) op basis van findings die `legal-ai-research` v1 had verzameld. Verplicht tegengeluid-blok voor bias-bescherming.

## Wat de tegengeluid-bewaking nu doet

De bias-bescherming-rol is verschoven:

* **Tegengeluid-content** — `legal-ai-research` v2 geeft Grok in de system-prompt expliciet de instructie *"Tegengeluid is verplicht; bij geen tegengeluid: schrijf 'Geen tegengeluid vandaag — verdacht?'"*
* **Tegengeluid-flag in dashboard** — `LegalAIView.jsx` toont al de gele waarschuwing wanneer `sections.tegengeluid` leeg is
* **Stelling-counters** — `legal-ai-research` v2 verwerkt `suggested_thesis_updates` van Grok via `agent_proposals` (propose-only)

## Mag deze skill weg?

* **Nu (2026-05-02):** Nee — wachten 2 weken om te verifiëren dat Grok-pad stabiel is.
* **Vanaf 2026-05-16:** Verwijder zodra:
  1. ≥10 succesvolle Grok-runs zonder fallback nodig.
  2. Bias-mechanisme via `agent_proposals` werkt (Jelle accept/reject van suggested_thesis_updates).
  3. `agent_schedules`-rij voor `legal-ai-compose` is al disabled (gebeurd in `legal_ai_grok_pivot_2026_05_02.sql`).

## Mogelijke toekomstige rol

Eventueel kan deze skill een nieuwe rol krijgen als **wekelijkse digest** — zondag-avond combineert hij de week's articles tot één samenvatting. Maar dat is een nieuw idee, niet de oorspronkelijke functie. Beslissing: bewust uitstellen tot er behoefte aan is.

## Niet triggeren

⛔ Niet draaien via orchestrator · ⛔ Geen manuele triggers oppikken · ⛔ Geen secrets/agent_config rondom deze skill aanpassen tot het verwijderingsmoment.

## Versiehistorie

* **2026-05-02 (avond)** — Gedeprecateerd. Skill-body herzien naar enkel deprecation-note.
* **2026-05-02 (middag)** — Initiële versie als article-compose-pass.

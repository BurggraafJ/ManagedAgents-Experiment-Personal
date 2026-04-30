# E-mail Template — Dagelijks Agent Rapport

Dit is de template voor de dagelijkse e-mail die via Chrome (Outlook web) naar Jelle wordt gestuurd. De e-mail moet scanbaar zijn in 10 seconden — Jelle wil in één blik zien: gaat alles goed, of moet ik iets doen?

---

## E-mail specificaties

- **Aan:** burggraaf@legal-mind.nl
- **Onderwerp:** `Agent Rapport {dag} {datum} — {totaal_runs} runs, {fouten} fouten`
  - Voorbeeld: `Agent Rapport woensdag 2 april — 27 runs, 1 fout`
  - Als er 0 fouten zijn: `Agent Rapport woensdag 2 april — 27 runs, alles goed ✅`
- **Format:** HTML e-mail (via Outlook compose)

---

## E-mail body template

De e-mail wordt via Chrome in Outlook web getypt. Gebruik simple HTML formatting die Outlook ondersteunt (bold, kleuren, tabellen — geen fancy CSS).

### Structuur

```
Hoi Jelle,

Hier is het overzicht van je agents vandaag ({dag} {datum}).

[ALS er acties nodig zijn:]
⚡ Er zijn {N} dingen die je aandacht nodig hebben — zie hieronder.

[ALS alles goed ging:]
✅ Alles draait naar behoren. Geen actie nodig.

━━━━━━━━━━━━━━━━━━━━━━

[ALLEEN als er vragen/acties zijn:]

🙋 Acties voor jou ({N})

• Auto-Draft: Mail van Van der Berg — klacht of escalatie?
  → Beantwoord in Slack #agent-vragen

• Marktonderzoek: Website De Vries & Partners geeft 403
  → Beantwoord in Slack #agent-vragen

━━━━━━━━━━━━━━━━━━━━━━

📊 Overzicht

✅ Auto-Draft — 7 runs, 24 drafts geschreven
✅ Marktonderzoek — 15 runs, 12 kantoren verrijkt
⚠️ VM-Dispatcher — 3 runs, 1 feature gebouwd (1x geen werk)
❌ CRM-Verrijking — Niet gedraaid sinds 14:00
✅ Deals Bijwerken — 2 runs, 8 deals bijgewerkt

Totaal: 27 runs | 24 gelukt | 2 deels | 1 fout

━━━━━━━━━━━━━━━━━━━━━━

[ALLEEN als er fouten waren:]

🚨 Foutdetails

CRM-Verrijking (14:00)
Fout: HubSpot API rate limit bereikt
Impact: Geen verrijkingen meer uitgevoerd na 14:00

━━━━━━━━━━━━━━━━━━━━━━

Gr,
Je Agent Fleet 🤖
```

---

## Toon en stijl

- **Kort en zakelijk** — geen wollig taalgebruik
- **Specifiek** — niet "een paar mails verwerkt" maar "24 drafts geschreven"
- **Actiegericht** — als Jelle iets moet doen, zeg precies wat en waar
- **Status-emoji's** — ✅ ⚠️ ❌ voor snelle scan
- De e-mail is bewust informeel ("Hoi Jelle") — het is een interne tool, geen klantcommunicatie

---

## Hoe de e-mail te versturen via Chrome

1. Open Outlook web (outlook.office.com) via Chrome
2. Klik op "Nieuwe e-mail"
3. Vul het Aan-veld in: burggraaf@legal-mind.nl
4. Vul het onderwerp in
5. Type/plak de body (met formatting)
6. Verstuur de e-mail
7. Sluit het tabblad

Let op: dit is een van de weinige gevallen waarin daadwerkelijk een e-mail wordt VERSTUURD (niet als draft). De dagrapport-agent stuurt de mail zelf.

---

## Logica voor het bepalen van de inhoud

### Acties sectie
Toon alleen als er minstens één openstaande vraag is in `#agent-vragen` of als er een skill is met `status: "failed"` die handmatige interventie nodig heeft.

### Overzicht sectie
Per geregistreerde skill, in volgorde:
1. Skills met fouten eerst (❌)
2. Dan skills met warnings (⚠️)
3. Dan succesvolle skills (✅)
4. Skills die niet gedraaid hebben (maar wel hadden moeten draaien) komen bij ❌

Per skill toon je:
- Status-emoji
- Display name (uit registratie)
- Aantal runs vandaag
- De `primary_metric` opgeteld over alle runs
- Eventueel een korte toelichting bij warnings/fouten

### Foutdetails sectie
Alleen tonen als er skills met `status: "failed"` zijn. Per fout:
- Skill naam + tijdstip
- De error `message` uit het runlog
- Impact: wat is het gevolg? (bijv. "geen verrijkingen meer na 14:00")

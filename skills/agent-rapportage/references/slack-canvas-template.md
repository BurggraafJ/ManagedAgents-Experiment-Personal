# Slack Canvas Template — Agent Dashboard

Dit document beschrijft de layout van het Slack Canvas "Agent Dashboard" dat leeft in `#agent-rapportage`. Het dagrapport-script update deze Canvas dagelijks. Jelle kan het op elk moment openen in Slack om de actuele status te zien.

---

## Canvas Layout

De Canvas gebruikt Slack's native formatting (markdown-achtig). Houd het compact — Slack Canvas is geen webpagina, maar een leesbaar document.

### Structuur

```
🤖 Agent Dashboard
Laatst bijgewerkt: wo 2 apr 2026, 21:00

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🙋 VRAGEN DIE WACHTEN (2)

1. Auto-Draft (vandaag 14:23)
   → Mail van Van der Berg: klacht of escalatie?
   🔗 Beantwoord in #agent-vragen

2. Marktonderzoek (vandaag 16:45)
   → Website kantoor De Vries & Partners geeft 403 — overslaan of later opnieuw?
   🔗 Beantwoord in #agent-vragen

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 ALERTS (1)

❌ CRM-Verrijking — Niet gedraaid sinds 14:00 (max: 4 uur)
   Laatste fout: HubSpot API rate limit bereikt

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 VANDAAG (wo 2 apr 2026)

  Skill                │ Runs │ Status │ Kernmetric
  ─────────────────────┼──────┼────────┼──────────────────
  Auto-Draft           │  7/7 │ ✅     │ 24 drafts geschreven
  Marktonderzoek       │ 15   │ ✅     │ 12 kantoren verrijkt
  VM-Dispatcher        │  3   │ ⚠️     │ 1 feature gebouwd
  CRM-Verrijking       │  0   │ ❌     │ —
  Deals Bijwerken      │  2/2 │ ✅     │ 8 deals bijgewerkt

  Totaal: 27 runs │ 24 success │ 2 partial │ 1 failed │ 0 skipped

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 PLANNING

  Skill                │ Schedule            │ Volgende run  │ Status
  ─────────────────────┼─────────────────────┼───────────────┼────────
  Auto-Draft           │ Elke 2u (08-20)     │ morgen 08:00  │ 🟢 Actief
  Marktonderzoek       │ Elke 4 min          │ over 3 min    │ 🟢 Actief
  VM-Dispatcher        │ Elke 5 min          │ over 2 min    │ 🟢 Actief
  CRM-Verrijking       │ Elke 30 min         │ onbekend      │ 🔴 Gestopt
  Deals Bijwerken      │ 2x per dag          │ morgen 09:00  │ 🟢 Actief

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 WEEK OVERZICHT (week 14)

  ma: 31 runs (28 ✅, 2 ⚠️, 1 ❌)
  di: 29 runs (29 ✅)
  wo: 27 runs (24 ✅, 2 ⚠️, 1 ❌)  ← vandaag
```

---

## Hoe de Canvas te updaten

Gebruik de `slack_update_canvas` tool met de Canvas ID uit `config.json`.

### Opbouwlogica

1. **Vragen sectie:** Lees `#agent-vragen` kanaal, filter op berichten die nog geen reply van Jelle hebben. Toon maximaal 5 vragen, met "en X meer..." als er meer zijn.

2. **Alerts sectie:** Twee bronnen:
   - Runlogs van vandaag met `status: "failed"` of errors met `severity: "critical"`
   - Skills waarvan de laatste run langer geleden is dan `max_hours_without_run` (uit skill-registratie)

3. **Vandaag sectie:** Per geregistreerde skill:
   - Tel het aantal runs van vandaag
   - Bepaal de overall status (✅ als alle runs success, ⚠️ als minstens één partial, ❌ als minstens één failed)
   - Toon de `primary_metric` uit de registratie, opgeteld over alle runs van vandaag
   - Het "X/Y" format (bijv. "7/7") wordt alleen gebruikt als het verwachte aantal runs bekend is uit het schedule

4. **Planning sectie:** Per geregistreerde skill:
   - Schedule uit de registratie
   - Volgende run uit het meest recente runlog's `next_scheduled` veld
   - Status: 🟢 als de skill actief is (recent succesvol gedraaid), 🟡 als er warnings zijn, 🔴 als gestopt of langdurig falend

5. **Week overzicht:** Aggregeer de runlogs van de hele week (maandag t/m vandaag). Eén regel per dag.

---

## Lege state

Als er nog geen runlogs zijn (eerste dag):

```
🤖 Agent Dashboard
Laatst bijgewerkt: wo 2 apr 2026, 21:00

Nog geen agents aangesloten. Voeg rapportage toe aan je eerste skill
om het dashboard te vullen.

Geregistreerde skills: 0
Runs vandaag: 0
```

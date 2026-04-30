# Deal Properties — Catalogus

Alle deal-properties in Legal Mind's HubSpot, hun betekenis, en hoe de
skill ze kan vullen. Dit bestand groeit mee naarmate de skill meer leert.

**Laatste update:** 2026-03-16
**Gebruikt door:** Module 1 (deal-properties)

---

## Datumvelden — Verkoopproces

### kennismaking_datum
- **Type:** date
- **Wat:** Datum van de eerste kennismaking.
- **Hoe vullen:** Vroegste agenda-afspraak met bedrijfsdomein als attendee.
  Filter: niet isAllDay, duur 15-120 min, externe attendees, niet geannuleerd.
- **Fallback:** `hs_v2_date_entered_appointmentscheduled`
- **Bron:** Outlook agenda
- **Pipeline:** Sales + Customer Base

### lead_aanbrengdatum
- **Type:** date
- **Wat:** Datum dat de lead werd geïntroduceerd.
- **Hoe vullen:** Vroegste contact ooit met bedrijfsdomein (e-mail + agenda).
  Typisch eerder dan kennismakingsdatum. Kan introductie-mail door derden zijn.
- **Bron:** Outlook e-mail + agenda
- **Pipeline:** Sales Pipeline

### meeting_date
- **Type:** date
- **Wat:** Meest recente of relevante meeting.
- **Hoe vullen:** Meest recente geldig agenda-item met bedrijfsdomein.
- **Bron:** Outlook agenda
- **Pipeline:** Sales + Customer Base

---

## Datumvelden — Contract & Licentie

### startdatum_proefperiode
- **Type:** date
- **Wat:** Startdatum proefperiode.
- **Hoe vullen:** E-mails met "proefperiode", "pilot", "trial" + bedrijfsnaam.
  Eerste "Training" of "Kick-off" agenda-item.
- **Bron:** Outlook e-mail + agenda
- **Pipeline:** Sales Pipeline

### einddatum_proefperiode (= licentieperiode_startdatum)
- **Type:** date
- **Wat:** Einde proefperiode / start licentie.
- **Hoe vullen:** Berekend: startdatum_proefperiode + looptijd_proefperiode_maanden.
- **Pipeline:** Sales Pipeline

### startdatum_trainingstraject
- **Type:** date
- **Wat:** Start trainingstraject.
- **Hoe vullen:** Eerste agenda-item met "Training" + bedrijfsdomein.
- **Bron:** Outlook agenda
- **Pipeline:** Sales + Customer Base

### einddatum_trainingstraject
- **Type:** date
- **Wat:** Einde trainingstraject.
- **Hoe vullen:** Laatste agenda-item met "Training" + bedrijfsdomein.
- **Bron:** Outlook agenda
- **Pipeline:** Sales + Customer Base

### contract_start_date
- **Type:** date
- **Wat:** Startdatum contract.
- **Hoe vullen:** E-mail met "contract", "getekend", "ondertekend" + bedrijf.
- **Pipeline:** Customer Base

### contract_einddatum
- **Type:** date
- **Wat:** Einddatum contract.
- **Hoe vullen:** Berekend: contract_start_date + contractduur_in_maanden.
- **Pipeline:** Customer Base

### startdatum / einddatum
- **Type:** date
- **Wat:** Alternatieve contract start/eind velden.
- **Let op:** Lijken duplicaten — controleer welk veld daadwerkelijk gebruikt wordt.
- **Pipeline:** Customer Base

### facturatie_start_datum
- **Type:** date
- **Wat:** Startdatum facturatie DMS-integratie (eerste van de maand).
- **Hoe vullen:** Lastig automatisch — interne afspraken.
- **Pipeline:** Customer Base

---

## Business Metrics — Berekende velden

### reeds_verlopen_mnd
- **Type:** number
- **Wat:** Maanden van contract al verlopen.
- **Berekening:** `(vandaag - contract_start_date)` in maanden, naar beneden afgerond.
- **Let op:** Periodiek herberekenen — veroudert snel.
- **Pipeline:** Customer Base

### contractduur_in_maanden
- **Type:** number
- **Wat:** Totale contractduur.
- **Hoe vullen:** Uit e-mails: "12 maanden", "24 maanden", "1 jaar".
- **Pipeline:** Customer Base

### looptijd_in_maanden
- **Type:** number
- **Wat:** Looptijd afgesloten bij contractstart.
- **Pipeline:** Customer Base

### looptijd_proefperiode_maanden
- **Type:** number
- **Wat:** Duur proefperiode. Typisch: 1, 2, of 3.
- **Pipeline:** Sales Pipeline

### verleng_periode
- **Type:** number
- **Wat:** Automatische verlengperiode. Vaak 12 maanden.
- **Pipeline:** Customer Base

### contract_threshold
- **Type:** number
- **Wat:** Minimumwaarde contract.
- **Pipeline:** Customer Base

---

## Financiële velden

### amount
- **Type:** number — Totale dealwaarde
- **Pipeline:** Beide

### licentieprijs_per_gebruiker
- **Type:** number — Prijs per gebruiker per maand
- **Pipeline:** Beide

### contract_vergoeding_per_persoon / fixed_contract_fee / vaste_licentieprijs_maand
- **Type:** number — Verschillende vergoedingsstructuren
- **Pipeline:** Customer Base

### vaste_prijs_proefperiode_maand
- **Type:** number — Vaste prijs proefperiode per maand
- **Pipeline:** Sales Pipeline

### vergoeding_training / dms_integratie_prijs
- **Type:** number — Training en DMS kosten
- **Pipeline:** Beide / Customer Base

### Kortingsvelden
`contract_korting_`, `contract_korting_in_maanden`, `korting_licentieperiode_procent`,
`korting_proefperiode_procent`, `verwachte_korting_licentieperiode`, `verwachte_korting_pilot`

### Omvang/gebruikersvelden
`contract_aantal_gebruikers`, `minimaal_aantal_gebruikers`, `omvang_proefperiode`,
`omvang_licentieperiode`, `minimale_licenties_proefperiode`, `minimale_licenties_licentieperiode`,
`totale_omvang`, `verwachte_omvang_pilot`, `verwachte_omvang_licentieperiode`,
`verwachte_minimumafname_pilot`, `verwachte_minimumafname_licentieperiode`,
`vragen_treshold_per_gebruiker_proefperiode`, `vragen_treshold_per_gebruiker_licentieperiode`

---

## Tekst- en keuzevelden

### beslismaker
- **Type:** text — Wie de beslismaker is.
- **Hoe vullen:** Analyseer e-mailpatronen: wie tekent, geeft akkoord, CC bij beslissingen.
- **Pipeline:** Sales Pipeline

### lead_source
- **Type:** text — Waar de lead vandaan kwam.
- **Hoe vullen:** Analyseer eerste e-mail: Introductie → "Referral", Inbound → "Inbound",
  Outreach → "Outbound", Via Paddls → "Paddls".
- **Pipeline:** Sales Pipeline

### outreach_status
- **Type:** enumeration — Status outreach-proces.
- **Pipeline:** Sales Pipeline

### kantoorgrootte / type_dms / dms_actief / type_contract_jm
- **Type:** diverse — Kantoor/contract kenmerken
- **Pipeline:** Beide / Customer Base

### template_variant / paddles_kwalificatie / paddlsbatch
- **Type:** diverse — Paddls en template gerelateerd
- **Pipeline:** Sales Pipeline

### permanent_actief / mogen_marketen / afspraken_marketen
- **Type:** diverse — Marketing en activiteit velden
- **Pipeline:** Beide

---

## Documentvelden (NIET automatisch vullen)

`contract_document`, `addemdum_contract`, `verstuurde_offerte`, `ondertekende_offerte`,
`offerte_training_document`, `getekende_offerte_training`, `algemene_voorwaarden_bestand`,
`security_document`, `verwerkers_overeenkomst`

---

## Niet-invulbare velden (HubSpot-managed)

`createdate`, `closedate`, `days_to_close`, `num_associated_contacts`,
`num_contacted_notes`, `num_notes`, `notes_last_contacted`, `notes_last_updated`,
`notes_next_activity_date`, `deal_currency_code`, `amount_in_home_currency`,
`engagements_last_meeting_booked`, alle `hs_v2_date_*` velden

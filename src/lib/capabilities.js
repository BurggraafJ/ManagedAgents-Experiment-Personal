// Rechten-helpers — de rekenkant van de rechten-matrix (Design B, v1.191).
//
// ⚠ De database blijft de handhaver. Alles hieronder is een SPIEGEL van
// `public.has_capability(key, user)` uit migratie 20260914143000, zodat de UI
// 32 rijen × 8 personen kan tekenen zonder 256 RPC-calls te doen. Wijkt de SQL
// af, dan wijkt dit bestand af — houd de twee bij elkaar:
//
//     when (select app_role from rol) is null then false
//     when not c.grantable then (select app_role from rol) = 'owner'
//     else coalesce(<override>.effect = 'grant', exists <preset>)
//
// De UI mag er dus naast zitten; de poort eronder niet. Daarom schrijft de
// matrix alleen naar `user_capabilities` en leest hij de uitkomst terug.

// Effectief recht voor één persoon. `presetKeys` is de set van de rol.
// Drie toestanden dragen het ontwerp:
//   'rol'         aan/uit omdat de rol het zo heeft afgesproken — stil
//   'persoonlijk' de owner heeft het hier zelf gezet (aan óf uit) — accent
//   'vast'        grantable = false; alleen de owner, niet uit te delen — slot
export function isEffective(cap, role, override, presetKeys) {
  if (!role) return false
  if (!cap.grantable) return role === 'owner'
  if (override) return override.effect === 'grant'
  return presetKeys.has(cap.key)
}

// ── Bundels ────────────────────────────────────────────────────────────────
// Beslissing 3 (Jelle, 2026-09-14) maakte Organisatie **één vinkje**; v1.193
// trekt die lijn door over het hele scherm: "teveel rechten… dashboard wel
// apart per bord… voor de rest max ~8… veel hoort samen."
//
// De database houdt de rechten los — zeven vinkjes later is dan een
// UI-wijziging en geen migratie — en deze laag zet ze samen via
// `capabilities.ui_bundle` (migratie 20260914170000).
//
// ⚠ Eén regel bewaakt of een bundel leesbaar blijft: hij mag de rol-preset niet
// doorsnijden. Zit de helft van een bundel in de member-preset en de andere
// helft niet, dan toont élk memberhokje een streepje ("half aan") en zegt de
// matrix niets meer. De migratie heeft daarom `data.crm.schrijven` bij
// Organisatie gezet en niet bij Administratie, en verifieert het met een query
// onderaan het bestand.
const BUNDLE_META = {
  werkplek: {
    label: 'Werkplek',
    omschrijving: 'Dashboard, Taken en de eigen instellingen — wat iedereen heeft.',
  },
  analyse: {
    label: 'Analyse',
    omschrijving: 'Vragen stellen, de Confluence-spaces die iemand mag zien, en de betaalde model-calls die dat kost.',
  },
  postvak: {
    label: 'Postvak',
    omschrijving: 'Inbox, concepten en het mailbesluit — op de eigen mailbox.',
  },
  agenda: {
    label: 'Agenda',
    omschrijving: 'Afspraken, spelregels en de eigen agenda-gegevens.',
  },
  organisatie: {
    label: 'Organisatie',
    omschrijving: 'Gebruikers · Health · Security · Skills · Pijplijn · Platform · beheerinstellingen · agents · telemetrie · terugschrijven naar HubSpot.',
  },
  sleutels: {
    label: 'API keys en secrets',
    omschrijving: 'Tokens, sleutels, roteren en intrekken. De enige zone die aan niemand uit te delen is.',
  },
}

// capabilities[] → rijen voor de matrix. Een rij is één recht óf één bundel.
// Volgorde volgt sort_order, de bundel gaat op de plek van zijn eerste lid.
export function buildRows(caps) {
  const rows = []
  const seen = new Set()
  for (const cap of caps) {
    if (!cap.ui_bundle) {
      rows.push({
        id: cap.key,
        label: cap.label,
        omschrijving: cap.omschrijving,
        groep: cap.groep,
        caps: [cap],
        grantable: cap.grantable,
        levert_vandaag: cap.levert_vandaag,
        toelichting: cap.toelichting,
      })
      continue
    }
    if (seen.has(cap.ui_bundle)) continue
    seen.add(cap.ui_bundle)
    const leden = caps.filter(c => c.ui_bundle === cap.ui_bundle)
    const meta = BUNDLE_META[cap.ui_bundle] || { label: cap.ui_bundle, omschrijving: null }
    rows.push({
      id: `bundel:${cap.ui_bundle}`,
      label: meta.label,
      omschrijving: meta.omschrijving,
      groep: cap.groep,
      caps: leden,
      grantable: leden.every(c => c.grantable),
      // Een bundel levert pas iets als één van zijn leden iets levert.
      levert_vandaag: leden.some(c => c.levert_vandaag),
      // De toelichting van het lid dat vandaag níets levert wint: dat is de
      // tekst achter het amberlabel, en die moet gaan over de helft die
      // klemt — niet over de helft die gewoon werkt.
      toelichting: (leden.find(c => !c.levert_vandaag && c.toelichting)
        || leden.find(c => c.toelichting))?.toelichting || null,
      bundel: true,
    })
  }
  return rows
}

// ── Groepen ────────────────────────────────────────────────────────────────
// De drie groepen uit migratie 20260914170000, met het enige dat de database
// niet weet: staat de groep open als je de pagina opent?
//
// Dat is geen afgeleide van `levert_vandaag`. Elke groep bevat wel íets dat een
// member vandaag niets oplevert, dus die regel zou alles openzetten en de matrix
// precies zo lang laten als hij was. Het is een uitspraak over de GROEP: is dit
// af, of wordt hieraan gebouwd. Alleen wat in aanbouw is staat open — "anders
// mis je het" (Jelle, 2026-09-14).
//
// ⚠ Deze sleutels zijn de `groep`-waarden uit de migratie. Hernoem je er daar
// één, hernoem hem hier mee; een onbekende groep valt terug op OPEN, zodat een
// mismatch je een te lange pagina geeft en nooit een verstopte.
const GROEP_META = {
  'Werk': {
    open: true,
    reden: 'Wat iedereen gebruikt. Administratie en Kennisbank zijn nog in aanbouw — die wil je zien.',
  },
  'Dashboards': {
    open: false,
    reden: 'Per bord één recht, plus de stuurdata waar ze uit lezen.',
  },
  'Organisatie': {
    open: false,
    reden: 'Het owner-portaal in één vinkje, en de sleutelzone die aan niemand uit te delen is.',
  },
}

// Rijen → [{ groep, label, rows, alleLeeg, standaardOpen, reden, levertNiets }]
// in catalogus-volgorde.
//
// `alleLeeg` = elk uitdeelbaar recht in deze groep staat op levert_vandaag =
// false. Dan hoort de amberregel één keer op de groepskop en niet als badge op
// elke rij: zeven identieke waarschuwingen onder elkaar lezen als behang, en
// dan valt de éne rij die er in een gemengde groep wél uitspringt juist weg.
export function groupRows(rows) {
  const out = []
  for (const row of rows) {
    const last = out[out.length - 1]
    if (last && last.groep === row.groep) last.rows.push(row)
    else out.push({ groep: row.groep, rows: [row] })
  }
  for (const g of out) {
    const meta = GROEP_META[g.groep] || {}
    const uitdeelbaar = g.rows.filter(r => r.grantable)
    g.alleLeeg = uitdeelbaar.length > 1 && uitdeelbaar.every(r => !r.levert_vandaag)
    g.label = meta.label || g.groep
    g.standaardOpen = meta.open !== false
    g.reden = meta.reden || null
    // Hoeveel rijen in deze groep leveren vandaag nog niets. Staat op de
    // groepskop, ook als de groep dicht is — anders verstopt het inklappen
    // precies het bericht waar de pagina voor bestaat.
    g.levertNiets = uitdeelbaar.filter(r => !r.levert_vandaag).length
  }
  return out
}

// De groepen die bij het openen van de pagina dicht staan.
export function dichteGroepen(groups) {
  return new Set(groups.filter(g => !g.standaardOpen).map(g => g.groep))
}

// Voornaam + beginletter achternaam. De matrixkop is 104 px breed; een volledige
// naam wordt daar afgekapt en "Niels Oosterhol" is geen naam. De hele naam staat
// in het title-attribuut ernaast.
export function kortenaam(naam) {
  if (!naam) return '—'
  const delen = String(naam).trim().split(/\s+/)
  if (delen.length === 1) return delen[0]
  const staart = delen[delen.length - 1]
  return `${delen[0]} ${staart[0].toUpperCase()}.`
}

// ── De cel ─────────────────────────────────────────────────────────────────
// Eén rij × één persoon. Een bundel is 'mixed' zodra zijn leden verschillen —
// dan toont het vakje een streepje in plaats van een vinkje, want "half aan"
// mag geen vinkje zijn dat aan lijkt te staan.
export function cellFor(row, role, overrides, presetKeys) {
  let on = 0
  let manual = 0
  for (const cap of row.caps) {
    const ov = overrides.get(cap.key)
    if (isEffective(cap, role, ov, presetKeys)) on++
    if (ov && cap.grantable) manual++
  }
  const total = row.caps.length
  return {
    on: on === total,
    mixed: on > 0 && on < total,
    manual: manual > 0,
    locked: !row.grantable,
  }
}

// Hoeveel rechten staan er aan, en hoeveel wijken af van de rol-standaard?
//
// Telt sinds v1.193 in RIJEN, niet in losse capabilities. Eén vinkje op de
// Organisatie-bundel schrijft elf rijen in `user_capabilities`; dat als "11
// afwijkingen" tonen maakt van één beslissing een alarm. De handhaving blijft
// per recht — de teller gaat over wat de owner heeft gedáán.
export function userStatsFor(rows, role, overrides, presetKeys) {
  let aan = 0
  let afwijkend = 0
  for (const row of rows) {
    const st = cellFor(row, role, overrides, presetKeys)
    if (st.on) aan++
    // Afwijkend = minstens één lid waarvan de override écht iets anders zegt
    // dan de preset. Een 'grant' op iets dat de rol al geeft is geen afwijking,
    // en een override op een niet-uitdeelbaar recht telt nooit mee —
    // has_capability negeert hem ook.
    const anders = row.caps.some(cap => {
      const ov = overrides.get(cap.key)
      return ov && cap.grantable && (ov.effect === 'grant') !== presetKeys.has(cap.key)
    })
    if (anders) afwijkend++
  }
  return { aan, afwijkend, totaal: rows.length }
}

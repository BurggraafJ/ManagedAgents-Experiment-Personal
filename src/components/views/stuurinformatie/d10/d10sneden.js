import { getal, maandJaar } from '../format'

/**
 * De vier sneden van D10 én het paginafilter periode, als één set selectors.
 *
 * Vier sneden op dezélfde populatie, niet vier blokken onder elkaar (Research 1
 * §B D10 §3). Tot v1.178 stonden ze als `VerliesTrend`, `VerliesDiagnose` en
 * `VerliesWerkbord` onder elkaar en werd het bord 6.000 px hoog; ze zijn niet
 * verdwenen, ze zijn een doorsnede geworden:
 *
 *   wie         ← VerliesWerkbord (de vier CS-lijsten)
 *   waarom      ← VerliesDiagnose, kolom Waarom (twee bronnen, twee blokken)
 *   wanneer     ← VerliesDiagnose, kolom Wanneer (duur per soort)
 *   13 maanden  ← VerliesTrend (drie reeksen náást elkaar)
 *
 * **Het paginafilter periode (v1.187, skill v0.9.1 F1–F7)** vernauwt de
 * populatie verliezen vóór de snede begint. Tot v1.186 zaten "deze maand" en
 * "in 13 maanden" allebei in de kaart (`waarde` + `waarde2`): een periodefilter
 * uitgevoerd als kaartanatomie. Nu is het één stand voor het hele bord:
 *
 *   m13    rollend dertien maanden — `laatste_13_maanden` uit v_d10_kop (default:
 *          het venster waarin de stuurgetallen van dit maandritme betekenis hebben)
 *   maand  de lopende kalendermaand — `deze_maand` uit v_d10_kop
 *   jaar   staat zichtbaar uit (F7): v_d10_kop kent geen jaarvenster
 *
 * Een snede die de stand niet kan waarmaken staat uit met de reden (F7):
 * `v_d10_redenen` en de medianen in `v_d10_kop` tellen over het hele venster,
 * niet per maand. De CS-lijsten (`wie`) zijn de stand van vandaag en geen
 * verliezen — daar heeft het filter niets te vernauwen; dat staat in de strook.
 *
 * **Master en detail lezen allebei uit dit bestand.** `rijenVoor()` maakt de
 * regels, `recordsVoor()` geeft de records achter precies die regel terug,
 * beide binnen hetzelfde venster. Er wordt hier **niets opgeteld dat ook in een
 * view staat** (G5): elk getal komt ongewijzigd uit de view, een `.length` telt
 * de getoonde lijst zelf, en het venster is een selectie op kolommen die de
 * view al draagt (`verliesdatum`, `verliesmaand`, `is_huidige_maand`).
 */

export const SNEDEN = ['wie', 'waarom', 'wanneer', 'trend']

export const PERIODES = [
  { id: 'm13', label: '13 maanden', kort: 'in 13 maanden', kolom: 'laatste_13_maanden' },
  { id: 'maand', label: 'deze maand', kort: 'deze maand', kolom: 'deze_maand' },
  { id: 'jaar', label: 'dit jaar', uit: true, titel: 'v_d10_kop kent geen jaarvenster — komt mee met de view, niet met een telling in de UI' },
]

/** De kaartwaarde van een v_d10_kop-rij in het gekozen venster. */
export function kopWaarde(rij, periode) {
  const p = PERIODES.find(x => x.id === periode) || PERIODES[0]
  return rij ? rij[p.kolom] : null
}

export function periodeKort(periode) {
  return (PERIODES.find(x => x.id === periode) || PERIODES[0]).kort
}

/* Het venster als selectie op de view-kolommen. De ondergrens van dertien
   maanden komt uit de maandreeks zelf (de eerste rij van
   v_d10_verlies_per_soort_maand), niet uit een datumberekening hier. */
function inVenster(record, periode, data) {
  const maand = String(record.verliesmaand || record.verliesdatum || '').slice(0, 7)
  if (periode === 'maand') {
    const huidig = (data.maandreeks || []).find(r => r.is_huidige_maand)
    return huidig ? maand === huidig.maand_key : false
  }
  const eerste = (data.maandreeks || [])[0]
  return eerste ? maand >= String(eerste.maand_key) : true
}

/* ── snede "wie" · de vier CS-lijsten ──────────────────────────────────────
   De volgorde volgt de meting en niet de gewoonte. Een retentiewerkbord begint
   normaal bij het verlengingsmoment; hier zitten negentien van de twintig
   verliezen in de proef, dus staan de proeven bovenaan. Geen balk: vier lijsten
   met vier verschillende populaties zijn geen vergelijkbare staven (G3). */
export const LIJSTEN = [
  {
    id: 'proef_voorbij',
    naam: 'Proef voorbij, geen besluit',
    sub: 'einddatum verstreken · geen besluit vastgelegd',
    vlag: '⚠ loopt weg zonder gesprek',
    bron: 'proeven',
    filter: r => r.status === 'verlopen',
    leeg: 'Geen enkele proef staat over zijn einddatum. Dat is de bedoeling.',
    dagenTekst: 'dagen = sinds het verstrijken van de einddatum',
  },
  {
    id: 'proef_bijna',
    naam: 'Proef eindigt < 30 dagen',
    sub: 'einddatum binnen dertig dagen · besluitgesprek nu',
    bron: 'proeven',
    filter: r => r.status === 'binnen_30',
    leeg: 'Geen proef eindigt binnen dertig dagen.',
    dagenTekst: 'dagen = tot de einddatum van de proef',
  },
  {
    id: 'verleng_90',
    naam: 'Verlengmoment < 90 dagen',
    sub: 'startdatum + 12 maanden nadert · afgeleid, geen HubSpot-veld',
    bron: 'verlenging',
    filter: r => r.status === 'binnen_90',
    leeg: 'Geen contractjaar loopt binnen negentig dagen af.',
    dagenTekst: 'dagen = tot het einde van het eerste contractjaar',
  },
  {
    id: 'verleng_verstreken',
    naam: 'Verlengmoment verstreken',
    sub: 'meer dan 12 maanden na start · geen verlenging vastgelegd',
    bron: 'verlenging',
    filter: r => r.status === 'verstreken',
    leeg: 'Bij elke actieve klant ligt het eerste contractjaar nog voor ons.',
    dagenTekst: 'dagen = sinds het eerste contractjaar voorbij is',
  },
]

const lijstRijen = (lijst, { proeven, verlenging }) =>
  ((lijst.bron === 'proeven' ? proeven : verlenging) || []).filter(lijst.filter)

/* ── snede "waarom" · twee bronnen, nooit gemengd ──────────────────────────
   `v_d10_redenen` levert de rijen al met hun noemer en hun gat-markering; hier
   worden ze alleen gegroepeerd op blok (1 = AI-lezing, 2 = HubSpot-veld). */
export const REDEN_BLOKKEN = {
  1: { naam: 'AI-lezing uit notities en mails', tel: 'B · C — klantkant · AI-afleiding, geen gemeten opzegreden' },
  2: { naam: 'Veld closed_lost_reason in HubSpot', tel: 'A — prospectkant · door sales ingevuld, geen gemeten opzegreden' },
}

/* ── de rijen per snede ────────────────────────────────────────────────────
   Eén vorm voor alle vier: naam, grondslag, getal. `soort` zegt het
   detailpaneel wélke records het moet tonen. */
export function rijenVoor(snede, data, periode = 'm13') {
  if (snede === 'wie') {
    return LIJSTEN.map(l => ({
      id: l.id, soort: 'lijst', naam: l.naam, sub: l.sub, vlag: l.vlag ?? null,
      n: lijstRijen(l, data).length,
    }))
  }

  if (snede === 'waarom') {
    return (data.redenen || []).map(r => ({
      id: `${r.bron}-${r.reden}`,
      soort: 'reden',
      blok: r.blok,
      bron: r.bron,
      naam: r.reden,
      sub: r.aantal_30d ? `${getal(r.aantal_30d)} in de laatste dertig dagen` : null,
      n: r.aantal,
      noemer: r.noemer,
      gat: !!r.is_niet_geregistreerd,
    }))
  }

  if (snede === 'wanneer') {
    // Geen balk: A meet iets anders (aanmaak → verliesstage) dan B en C
    // (startdatum → einddatum). De grondslag staat als tekst onder elke naam;
    // de spreiding zelf (C9) staat in zone 4 achter de regel.
    return (data.kop || []).map(r => ({
      id: r.soort,
      soort: 'duur',
      naam: `${r.soort} · ${r.soort_label}`,
      sub: r.duur_grondslag,
      n: r.duur_mediaan == null ? null : Math.round(r.duur_mediaan),
      nTekst: r.duur_mediaan == null ? 'geen meting' : null,
      extra: r.duur_mediaan == null
        ? `${getal(r.totaal)} records zonder duur`
        : `${getal(r.duur_min)}–${getal(r.duur_max)} · gem. ${getal(Math.round(r.duur_gemiddeld))} · n = ${getal(r.totaal)}`,
      vlag: r.grensgevallen > 0 ? `⚠ ${getal(r.grensgevallen)} op de grens` : null,
      kop: r,
    }))
  }

  // trend · dertien maanden, drie reeksen náást elkaar (C7); onder het filter
  // "deze maand" blijft alleen de lopende maand over.
  const per = new Map()
  for (const r of data.maandreeks || []) {
    if (periode === 'maand' && !r.is_huidige_maand) continue
    if (!per.has(r.maand_key)) {
      per.set(r.maand_key, {
        id: r.maand_key, soort: 'maand', maand: r.maand,
        naam: maandJaar(r.maand) || r.maand_key,
        huidig: !!r.is_huidige_maand, reeks: {},
      })
    }
    per.get(r.maand_key).reeks[r.soort] = r.aantal || 0
  }

  const rijen = [...per.values()].sort((a, b) => (a.id < b.id ? 1 : -1))
  // Schaalmaximum over exact de rijen die getekend worden — de afgeleide die
  // G5 toestaat; hij staat ook in de voetnoot van het blok (G2).
  const max = Math.max(1, ...rijen.flatMap(r => Object.values(r.reeks)))

  return rijen.map(r => {
    const markering = (data.annotaties || []).find(a => String(a.datum).slice(0, 7) === r.id)
    return {
      ...r, max, n: null,
      sub: r.huidig ? 'loopt nog' : null,
      markering: markering ? { label: 'opruimronde', tekst: markering.gebeurtenis } : null,
    }
  })
}

/* ── de records achter één regel ───────────────────────────────────────────
   Selectie, geen berekening: elke tak filtert op een sleutel die de view zelf
   al draagt, en daarna op het venster van het paginafilter. */
export function recordsVoor(snede, rij, data, periode = 'm13') {
  if (!rij) return []

  if (snede === 'wie') {
    const lijst = LIJSTEN.find(l => l.id === rij.id)
    return lijst ? lijstRijen(lijst, data) : []
  }

  const records = (data.records || []).filter(r => inVenster(r, periode, data))

  if (snede === 'waarom') {
    if (rij.bron === 'hubspot') {
      // "Niet geregistreerd" is de rij zonder reden — die records dragen
      // verliesreden null en zijn dus niet op de naam te matchen.
      return records.filter(r => r.soort === 'A' && (rij.gat ? !r.verliesreden : r.verliesreden === rij.naam))
    }
    const perDeal = Object.fromEntries((data.dossiers || []).map(d => [d.deal_id, d]))
    const bc = records.filter(r => r.soort === 'B' || r.soort === 'C')
    // "Nog geen dossier" is geen categorie maar de afwezigheid ervan.
    if (/geen dossier/i.test(rij.naam)) return bc.filter(r => !perDeal[r.deal_id])
    return bc.filter(r => {
      const d = perDeal[r.deal_id]
      if (!d) return false
      if (d.category_label === null) return rij.gat || /niet gecategoriseerd/i.test(rij.naam)
      return d.category_label === rij.naam
    })
  }

  if (snede === 'wanneer') {
    return records
      .filter(r => r.soort === rij.id)
      .sort((a, b) => (a.dagen_tot_verlies ?? 1e9) - (b.dagen_tot_verlies ?? 1e9))
  }

  // trend · de verliezen van één maand, alle drie de soorten
  return records.filter(r => String(r.verliesmaand || '').slice(0, 7) === rij.id)
}

/** Het dossier achter een record, als de churn-agent er een heeft. */
export function dossierVan(record, dossiers) {
  return (dossiers || []).find(d => d.deal_id === record.deal_id) || null
}

import { getal, maandJaar } from '../format'

/**
 * De vier sneden van D10, als één set selectors.
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
 * De kolom "Waar" uit VerliesDiagnose is de enige die géén snede werd: twee
 * rode lege plekken zijn geen doorsnede van de populatie. Ze staan als één
 * ⛔-regel in de vaste strook en verder achter `Wat ontbreekt`.
 *
 * **Master en detail lezen allebei uit dit bestand.** Zou de lijst links zijn
 * eigen rijen maken en het paneel rechts zijn eigen records, dan zijn dat twee
 * selecties over dezelfde data — en de dag dat ze uiteenlopen, valt dat
 * niemand op. Hier is het één keuze: `rijenVoor()` maakt de regels,
 * `recordsVoor()` geeft de records achter precies die regel terug.
 *
 * Er wordt in dit bestand **niets opgeteld dat ook in een view staat**. Een
 * telling als `.length` van een gefilterde lijst is de lijst zelf tellen, geen
 * tweede meting; elk getal dat een view levert (aantal, noemer, mediaan) komt
 * ongewijzigd uit de view.
 */

export const SNEDEN = ['wie', 'waarom', 'wanneer', 'trend']

/* ── snede "wie" · de vier CS-lijsten ──────────────────────────────────────
   De volgorde volgt de meting en niet de gewoonte. Een retentiewerkbord begint
   normaal bij het verlengingsmoment; hier zitten negentien van de twintig
   verliezen in de proef, dus staan de proeven bovenaan. */
export const LIJSTEN = [
  {
    id: 'proef_voorbij',
    naam: 'Proef voorbij, geen besluit',
    sub: 'einddatum verstreken, geen besluit vastgelegd',
    vlag: '⚠ loopt weg zonder gesprek',
    bron: 'proeven',
    filter: r => r.status === 'verlopen',
    leeg: 'Geen enkele proef staat over zijn einddatum. Dat is de bedoeling.',
    dagenTekst: 'dagen = sinds het verstrijken van de einddatum',
  },
  {
    id: 'proef_bijna',
    naam: 'Proef eindigt < 30 dagen',
    sub: 'einddatum binnen dertig dagen · het besluitgesprek moet nu staan',
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
    sub: 'meer dan 12 maanden na start, geen verlenging vastgelegd',
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
  1: {
    naam: 'AI-lezing uit notities en mails',
    tel: 'B · C — klantkant · AI-afleiding, geen gemeten opzegreden',
  },
  2: {
    naam: 'Veld closed_lost_reason in HubSpot',
    tel: 'A — prospectkant · door sales ingevuld, geen gemeten opzegreden',
  },
}

/* ── de rijen per snede ────────────────────────────────────────────────────
   Eén vorm voor alle vier: naam, grondslag, getal, en (waar hij iets betekent)
   een balk. `soort` zegt het detailpaneel wélke records het moet tonen. */
export function rijenVoor(snede, data) {
  if (snede === 'wie') {
    const rijen = LIJSTEN.map(l => ({
      id: l.id,
      soort: 'lijst',
      naam: l.naam,
      sub: l.sub,
      vlag: l.vlag ?? null,
      n: lijstRijen(l, data).length,
    }))
    const max = Math.max(1, ...rijen.map(r => r.n))
    return rijen.map(r => ({ ...r, balk: r.n / max }))
  }

  if (snede === 'waarom') {
    const rijen = (data.redenen || [])
    const maxPerBlok = {}
    for (const r of rijen) {
      maxPerBlok[r.blok] = Math.max(maxPerBlok[r.blok] || 1, r.aantal || 0)
    }
    return rijen.map(r => ({
      id: `${r.bron}-${r.reden}`,
      soort: 'reden',
      blok: r.blok,
      bron: r.bron,
      naam: r.reden,
      sub: r.aantal_30d ? `${getal(r.aantal_30d)} in de laatste dertig dagen` : null,
      n: r.aantal,
      noemer: r.noemer,
      // Een gat houdt de rode klasse-kleur: een inline background zou hem
      // overschrijven, en dan is uitgerekend de balk die groot en rood hoort te
      // zijn grijs (CD-review D10 v1.175).
      kleur: r.is_niet_geregistreerd ? null : (r.kleur || null),
      gat: !!r.is_niet_geregistreerd,
      balk: (r.aantal || 0) / (maxPerBlok[r.blok] || 1),
    }))
  }

  if (snede === 'wanneer') {
    // Geen balk: A meet iets anders (aanmaak → verliesstage) dan B en C
    // (startdatum → einddatum). Twee grondslagen naast elkaar in één balk
    // maken onvergelijkbare getallen vergelijkbaar — de grondslag staat
    // daarom als tekst onder elke naam.
    return (data.kop || []).map(r => ({
      id: r.soort,
      soort: 'duur',
      naam: `${r.soort} · ${r.soort_label}`,
      sub: r.duur_grondslag,
      n: r.duur_mediaan == null ? null : Math.round(r.duur_mediaan),
      nTekst: r.duur_mediaan == null ? 'geen meting' : null,
      extra: r.duur_mediaan == null
        ? `${getal(r.totaal)} records zonder duur`
        : `${getal(r.duur_min)}–${getal(r.duur_max)} · gem. ${getal(Math.round(r.duur_gemiddeld))}`,
      balk: null,
      vlag: r.grensgevallen > 0 ? `⚠ ${getal(r.grensgevallen)} op de grens` : null,
    }))
  }

  // trend · dertien maanden, drie reeksen náást elkaar
  const per = new Map()
  for (const r of data.maandreeks || []) {
    if (!per.has(r.maand_key)) {
      per.set(r.maand_key, {
        id: r.maand_key,
        soort: 'maand',
        maand: r.maand,
        naam: maandJaar(r.maand) || r.maand_key,
        huidig: !!r.is_huidige_maand,
        reeks: {},
      })
    }
    per.get(r.maand_key).reeks[r.soort] = r.aantal || 0
  }

  const rijen = [...per.values()].sort((a, b) => (a.id < b.id ? 1 : -1))
  const max = Math.max(1, ...rijen.flatMap(r => Object.values(r.reeks)))

  return rijen.map(r => {
    const markering = (data.annotaties || []).find(
      a => String(a.datum).slice(0, 7) === r.id,
    )
    return {
      ...r,
      max,
      // **Geen getal rechts.** De drie reeksen zíjn de meting; er één van
      // herhalen in de getalkolom suggereert dat díé het maandcijfer is, en een
      // som over de drie is precies wat dit bord verbiedt (A is pipeline, B is
      // proef, C is churn). De kolomkop zegt daarom `A · B · C` en de rij draagt
      // alleen de reeksen.
      n: null,
      sub: r.huidig ? 'loopt nog' : null,
      markering: markering || null,
      vlag: markering ? '⚠ opruimronde' : null,
    }
  })
}

/* ── de records achter één regel ───────────────────────────────────────────
   Selectie, geen berekening: elke tak filtert op een sleutel die de view zelf
   al draagt. */
export function recordsVoor(snede, rij, data) {
  if (!rij) return []

  if (snede === 'wie') {
    const lijst = LIJSTEN.find(l => l.id === rij.id)
    return lijst ? lijstRijen(lijst, data) : []
  }

  if (snede === 'waarom') {
    const records = data.records || []
    if (rij.bron === 'hubspot') {
      // "Niet geregistreerd" is de rij zonder reden — die records dragen
      // verliesreden null en zijn dus niet op de naam te matchen.
      return records.filter(r => r.soort === 'A' && (
        rij.gat ? !r.verliesreden : r.verliesreden === rij.naam
      ))
    }

    const dossiers = data.dossiers || []
    const bc = records.filter(r => r.soort === 'B' || r.soort === 'C')
    const perDeal = Object.fromEntries(dossiers.map(d => [d.deal_id, d]))

    // "Nog geen dossier" is geen categorie maar de afwezigheid ervan: de
    // records die de churn-agent nog niet heeft gezien.
    if (/geen dossier/i.test(rij.naam)) return bc.filter(r => !perDeal[r.deal_id])

    return bc.filter(r => {
      const d = perDeal[r.deal_id]
      if (!d) return false
      // Een dossier zonder categorie valt onder "Nog niet gecategoriseerd" —
      // de rij die `v_d10_redenen` met category_id = null levert.
      if (d.category_label === null) return rij.gat || /niet gecategoriseerd/i.test(rij.naam)
      return d.category_label === rij.naam
    })
  }

  if (snede === 'wanneer') {
    return (data.records || [])
      .filter(r => r.soort === rij.id)
      .sort((a, b) => (a.dagen_tot_verlies ?? 1e9) - (b.dagen_tot_verlies ?? 1e9))
  }

  // trend · de verliezen van één maand, alle drie de soorten
  return (data.records || []).filter(r => String(r.verliesmaand || '').slice(0, 7) === rij.id)
}

/** Het dossier achter een record, als de churn-agent er een heeft. */
export function dossierVan(record, dossiers) {
  return (dossiers || []).find(d => d.deal_id === record.deal_id) || null
}

import { getal } from '../../format'

/**
 * Woorden en eenheden van het Live-bord. Geen getallen, geen rekenwerk: alleen
 * hoe een fase, een bron of een band heet en hoe een waarde in de gekozen
 * eenheid wordt geschreven.
 */

/**
 * Fase in gewone taal (D1-LIVE-INTERACTION.md "Fase-hover"; Jelle 15-09-2026:
 * nooit alleen F1/F2/F3). De stages erachter staan in dim_stage_fase:
 *   1 = Kennismaking plaatsgevonden
 *   2 = Offerte sturen
 *   3 = Offerte gestuurd · In afwachting / onderhandeling · Mondeling akkoord ·
 *       Licentieovereenkomst gestuurd
 * Eén zin per fase, in elke hover (kop van de Tip), in de focus-split als vaste
 * regel onder de rijkop (Bereikrijen) en als eerste chip in de sink (D1Detail).
 */
export const FASE_UITLEG = {
  1: 'kennismaking gehad, nog geen offerte',
  2: 'offerte wordt gemaakt',
  3: 'voorstel ligt bij het kantoor',
}
export const FASE_UITLEG_12 = 'kennismaking gehad of offerte in de maak'
export const FASE_KORT = { 1: 'Fase 1', 2: 'Fase 2', 3: 'Fase 3' }
export const faseZin = f => `${FASE_KORT[f] || `Fase ${f}`} · ${FASE_UITLEG[f] || ''}`.trim()

/** hs_analytics_source → NL (UI-woord: Leadsource). Onbekend = leeg veld; nooit verborgen (gatregel). */
const KANAAL = {
  OFFLINE: 'Offline', DIRECT_TRAFFIC: 'Direct', PAID_SEARCH: 'Betaald', PAID_SOCIAL: 'Betaald social',
  ORGANIC_SEARCH: 'Organisch', ORGANIC_SOCIAL: 'Social', SOCIAL_MEDIA: 'Social', EMAIL_MARKETING: 'E-mail',
  REFERRALS: 'Verwijzing', OTHER_CAMPAIGNS: 'Campagne', AI_SEARCH: 'AI-zoeken', UNKNOWN: 'Onbekend',
}
export const kanaalLabel = code => KANAAL[code] || (code ? code.toLowerCase().replace(/_/g, ' ') : 'Onbekend')

/** Lichtheidstrap binnen oranje op grootte; grijs alleen voor onbekend (OPTIONS-RONDE-5 §Kleur). */
export const KANAAL_KLEUR = ['f-orange', 'f-orange-deep', 'f-orange-light', 'f-orange-subtle']
export const KANAAL_SWATCH = ['#dc6f3f', '#8b4628', '#efb08c', '#f9e5dd']

export const BAND_LABEL = { '17+': '17+', '5-16': '5–16 kern', '1-4': '1–4', onbekend: 'onbekend' }

/**
 * De pipelinenaam in een kolom van 84 px (v1.215). HubSpot's eigen woorden zijn
 * te lang voor die breedte — "Leads (Sell Me This Pen)" is 24 tekens — en het
 * onderscheidende deel staat achteraan, dus afkappen zou elke Lead-pipeline
 * hetzelfde laten lezen. Daarom: het haakje ís de naam ("Paddls",
 * "non-campaign") en "Sales Pipeline" wordt "Sales". Het volledige label blijft
 * als `title` op de cel staan — korter tonen mag, weglaten niet.
 */
export const pipelineKort = label => {
  if (!label) return null
  const haakje = String(label).match(/\(([^)]+)\)/)
  if (haakje) return haakje[1].trim()
  return String(label).replace(/\s*pipeline\s*$/i, '').trim() || String(label).trim()
}

/** Weeknummer zonder W uit een ISO-label "2026-W36" → "36". */
export const weekNr = label => (label ? String(label).replace(/^.*-W/, '') : '')

/**
 * De snede in de kop van de gefocuste kaart (focus-split, v1.210): kort, zonder
 * de kaartnaam — die staat er al vóór. `Fase 3`, `Week W36`, `sep`, `Offline`.
 * Het volledige label (`Fase 3 · aging`) blijft van de sink.
 */
export function snedeKort(gekozen) {
  if (!gekozen) return ''
  switch (gekozen.soort) {
    case 'fase': case 'waarde': return FASE_KORT[gekozen.sleutel] || `Fase ${gekozen.sleutel}`
    case 'week': return `Week W${weekNr(gekozen.week?.week_label)}${gekozen.gepland ? ' · gepland' : ''}`
    case 'beweging': return `W${weekNr(gekozen.week?.week_label)} · ${gekozen.type}`
    case 'kanaal': return gekozen.slice?.label || ''
    case 'band': return BAND_LABEL[gekozen.sleutel] || gekozen.sleutel
    case 'maand': return String(gekozen.label || '').split(' · ')[0]
    default: return ''
  }
}

/**
 * De eenheid volgt de toggle Deals | Licenties. `waarde(rij, veldDeals,
 * veldLic)` kiest de kolom; `fmt` schrijft hem. Licenties zijn een mid
 * ((bodem + plafond) / 2) en kunnen dus een halve zijn — één decimaal als het
 * geen heel getal is, verder niets.
 */
export function eenheid(modus) {
  const lic = modus === 'lic'
  return {
    lic,
    naam: lic ? 'licenties' : 'deals',
    kort: lic ? 'lic' : 'deals',
    enkel: lic ? 'lic' : 'deal',
    kies: (rij, veldDeals, veldLic) => (lic ? Number(rij?.[veldLic]) || 0 : Number(rij?.[veldDeals]) || 0),
    fmt: v => {
      const n = Number(v) || 0
      if (!lic || Number.isInteger(n)) return getal(n) ?? '0'
      return n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    },
  }
}

/** Kort bereik "123–298" of null. */
export const bereikKort = (a, b) => (a === null || a === undefined || b === null || b === undefined
  ? null : `${getal(a)}–${getal(b)}`)

/** "€ 21,1k" voor bedragen per maand. */
export const euroK = n => {
  if (n === null || n === undefined) return null
  const v = Number(n)
  if (Math.abs(v) < 1000) return `€${v.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`
  return `€${(v / 1000).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
}

/** "30-09" uit een ISO-datum, "?" als hij ontbreekt (hygiëne, zelfde rij als Landt het?). */
export const dagMaandKort = d => {
  if (!d) return '?'
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return '?'
  return `${String(x.getDate()).padStart(2, '0')}-${String(x.getMonth() + 1).padStart(2, '0')}`
}

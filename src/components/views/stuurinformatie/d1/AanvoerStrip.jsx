import Periodestrip from '../../../ui/charts/Periodestrip'
import { getal, dagMaand, datumKort } from '../format'

/**
 * Twaalf weken aanvoer onder het critical number — de D1-bekabeling van de
 * gedeelde C1 Periodestrip (`ui/charts/Periodestrip`, v1.184).
 *
 * Bewust absolute aantallen en geen procentuele week-op-week-beweging: bij
 * cijfers van 0 tot 3 per week is "+200 %" een getal zonder betekenis
 * (principes.md regel 4, kleine aantallen).
 *
 * Wat hier gebeurt is uitsluitend vertalen: `v_d1_aanvoer`-rijen worden
 * punten, `v_d1_aanvoer_kop` levert doel, herkomst en peildatum voor het
 * normlabel en de voetnoot. De strip zelf rekent alleen de schaal.
 *
 * De regel "11 van 12 weken onder doel" wordt hier geteld en niet in een view.
 * Dat is de enige telling op dit bord die de component zelf doet, en met opzet
 * in dít bestand: `wekenOnderDoel` loopt over exact dezelfde array die als
 * staven getekend wordt, dus een afwijking is met het blote oog te zien. Een
 * telling in een view zou over een andere populatie kunnen gaan dan de grafiek
 * eronder — dát is de fout die een bord niet mag maken.
 *
 * De lopende week telt niet mee: hij is niet om, en een onvolledige week als
 * "onder doel" tellen maakt de reeks elke maandag somberder dan hij is.
 */
export function wekenOnderDoel(aanvoer, doel) {
  if (!doel || !aanvoer || aanvoer.length === 0) return null
  const volledig = aanvoer.filter(w => !w.is_huidige_week)
  if (volledig.length === 0) return null
  const onder = volledig.filter(w => (w.kennismakingen || 0) < doel).length
  return `${onder} van ${volledig.length} weken onder doel`
}

export function wekenOnderDoelRaw(aanvoer, doel) {
  if (!doel || !aanvoer || aanvoer.length === 0) return null
  const volledig = aanvoer.filter(w => !w.is_huidige_week)
  if (volledig.length === 0) return null
  const onder = volledig.filter(w => (w.kennismakingen || 0) < doel).length
  return { onder, totaal: volledig.length }
}

/**
 * Netto stand: totaal kennismakingen over afgeronde weken minus het totale doel
 * over diezelfde weken. Positief = boven verwachting, negatief = achterstand.
 */
export function nettoStand(aanvoer, doel) {
  if (!doel || !aanvoer || aanvoer.length === 0) return null
  const volledig = aanvoer.filter(w => !w.is_huidige_week)
  if (volledig.length === 0) return null
  const totaal = volledig.reduce((s, w) => s + (w.kennismakingen || 0), 0)
  return totaal - doel * volledig.length
}

/**
 * `2026-W36` → `36`; een label zonder W blijft zoals het is.
 *
 * Geëxporteerd omdat het detailpaneel dezelfde week met hetzelfde woord moet
 * benoemen: klik je op de staaf van week 36, dan staat er rechts ook "Week 36".
 */
export const weekNr = label => (label && /W\d+$/.test(label) ? label.split('W').pop() : label)

/**
 * De voetnoot draagt alleen de herkomst van het doel, ≤ 8 woorden. De bron in
 * `dash_parameters` is voluit ("Dashboarding 642449420 §3, SDR-map 635633696");
 * hier het eerste deel zonder het pagina-id — het volledige spoor staat in de
 * hover van het normlabel.
 */
function korteBron(bron) {
  if (!bron) return null
  return bron.split(/[,;]/)[0].replace(/\b\d{6,}\b/g, '').replace(/\s+/g, ' ').trim() || null
}

export default function AanvoerStrip({ aanvoer, doel, kop = null, onKiesWeek = null, gekozenWeek = null }) {
  if (!aanvoer || aanvoer.length === 0) return null

  const perLabel = Object.fromEntries(aanvoer.map(w => [w.week_label, w]))

  const punten = aanvoer.map(w => {
    const n = w.kennismakingen === null || w.kennismakingen === undefined ? null : w.kennismakingen
    const nr = weekNr(w.week_label)
    const bereik = `${dagMaand(w.week_start)} – ${dagMaand(w.week_eind)}`
    const proxy = w.nieuwe_deals === null || w.nieuwe_deals === undefined
      ? null
      : `${getal(w.nieuwe_deals)} nieuwe ${w.nieuwe_deals === 1 ? 'deal' : 'deals'} (proxy)`

    let tip
    if (w.is_huidige_week) {
      tip = { kop: `Week ${nr} loopt`, tekst: `${getal(n ?? 0)} tot nu toe`, zwak: 'telt niet mee' }
    } else if (n === null) {
      tip = { kop: `Week ${nr} · ${bereik}`, tekst: 'geen meting', zwak: 'telt niet mee' }
    } else {
      // De proxy is niet van het bord verdwenen maar van de kaart: tot 13-09
      // was "nieuwe deals per week" het critical number, en twee reeksen die
      // elkaar opvolgen mogen nooit stil in elkaar overlopen. Hij staat per
      // week in deze tooltip en als gebeurtenis in `events_annotaties`.
      const afstand = doel
        ? (n >= doel ? `${getal(n - doel)} boven doel` : `${getal(doel - n)} onder doel`)
        : `${getal(n)} kennismakingen`
      tip = { kop: `Week ${nr} · ${bereik}`, tekst: afstand, zwak: proxy }
    }
    return { key: w.week_label, waarde: n, lopend: !!w.is_huidige_week, tip, asLabel: nr }
  })

  const bron = korteBron(kop?.doel_bron)
  const peil = kop?.doel_peildatum ? datumKort(kop.doel_peildatum) : null

  return (
    <Periodestrip
      punten={punten}
      variant="hero"
      onKies={onKiesWeek ? (punt => onKiesWeek(punt ? perLabel[punt.key] || null : null)) : null}
      gekozen={gekozenWeek?.week_label ?? null}
      doel={doel || null}
      doelLabel={doel ? `doel ${getal(doel)}` : null}
      doelTip={doel ? {
        kop: `Doel ${getal(doel)} kennismakingen per week`,
        tekst: [kop?.doel_bron, peil ? `peildatum ${peil}` : null].filter(Boolean).join(' · ') || 'herkomst niet vastgelegd',
      } : null}
      asEerste={dagMaand(aanvoer[0]?.week_start)}
      asLaatste="vorige week"
      voetnoot={doel
        ? <>doel uit {bron ? <b>{bron}</b> : 'onbekende bron'}</>
        : <>geen doel vastgelegd</>}
    />
  )
}

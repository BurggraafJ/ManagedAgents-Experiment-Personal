import Kaart, { Paren } from './Kaart'
import Weekstaven from '../../../../ui/charts/visx/Weekstaven'
import { useTip } from '../../../../ui/charts/visx/Tip'
import { getal, decimaal } from '../../format'
import { weekNr } from './labels'

/**
 * Kennismakingen — het critical number van D1 (doel 8 per week, SDR). Groot
 * getal = de laatste vólledige week (een lopende week leest altijd als een
 * terugval), drie metric-pairs, en de C1-reeks: zeven weken + de lopende
 * (gearceerd, `nu`) + vier geplande weken in de gepland-band.
 *
 * In de stand Licenties tellen de staven de licenties (mid) van de deals met
 * een kennismaking in die week — indicatief, en zonder doellijn: er is geen
 * licentiedoel per week vastgelegd (dash_parameters kent alleen het deal-doel).
 */
export default function KaartKennismakingen({ kop, aanvoer, gepland, meta, eenheid, gekozen, onKies }) {
  const { tip, toon, verberg } = useTip()
  const doel = kop?.doel ?? null
  const lic = eenheid.lic

  const recent = (aanvoer || []).slice(-8)
  const slots = [
    ...recent.map(w => ({
      key: w.week_start, label: weekNr(w.week_label), rij: w,
      waarde: lic ? w.mid_licenties : w.kennismakingen,
      soort: w.is_huidige_week ? 'lopend' : 'gemeten',
    })),
    ...(gepland || []).slice(0, 4).map(w => ({
      key: w.week_start, label: weekNr(w.week_label), rij: w,
      waarde: lic ? w.mid_licenties : w.kennismakingen_gepland,
      soort: 'gepland',
    })),
  ]

  const laatste = recent.find(w => w.week_label === kop?.week_label) || recent.filter(w => !w.is_huidige_week).at(-1)
  const groot = lic ? (laatste?.mid_licenties ?? 0) : (kop?.kennismakingen ?? laatste?.kennismakingen ?? 0)
  const verschil = !lic && doel !== null ? groot - doel : null
  const onderDoel = recent.filter(w => !w.is_huidige_week && doel !== null && (w.kennismakingen ?? 0) < doel).length
  const volledig = recent.filter(w => !w.is_huidige_week).length
  const lopend = recent.find(w => w.is_huidige_week)

  const paren = lic
    ? [
        { k: 'lic 4 wk', v: eenheid.fmt(recent.filter(w => !w.is_huidige_week).slice(-4).reduce((s, w) => s + (Number(w.mid_licenties) || 0), 0)), titel: 'licenties (mid) van de kennismakingen in de laatste vier volledige weken' },
        { k: 'lopende week', v: eenheid.fmt(lopend?.mid_licenties ?? 0) },
        { k: 'gepland', v: getal(meta?.kennismaking_gepland ?? 0) + ' km', titel: 'kennismakingen met een datum in de toekomst' },
      ]
    : [
        { k: 'gem 4 wk', v: kop?.km_gemiddeld_4wk !== undefined && kop?.km_gemiddeld_4wk !== null ? decimaal(kop.km_gemiddeld_4wk) : '—', titel: 'gemiddelde over de laatste vier volledige weken (v_d1_aanvoer_kop)' },
        { k: 'onder doel', v: `${onderDoel} / ${volledig} wk`, warn: onderDoel > 0, titel: `weken onder het doel van ${doel ?? '—'} in de getoonde reeks` },
        { k: 'gepland', v: getal(meta?.kennismaking_gepland ?? 0) ?? '0', titel: 'kennismakingen met een datum in de toekomst' },
      ]

  const hover = (e, s) => {
    const w = s.rij
    const n = Number(s.waarde) || 0
    const regels = s.soort === 'gepland'
      ? [`${eenheid.fmt(n)} gepland${doel !== null && !lic ? ` · doel ${doel}` : ''}`]
      : [`${eenheid.fmt(n)} ${lic ? 'lic (mid)' : 'gehouden'}${s.soort === 'lopend' ? ' · loopt nog' : ''}${doel !== null && !lic ? ` · doel ${doel} · ${n - doel >= 0 ? '+' : '−'}${Math.abs(n - doel)}` : ''}`]
    toon(e, { kop: `W${weekNr(w.week_label)}`, regels, zin: lic ? 'licenties (mid) van de kennismakingen die week · indicatief' : 'kennismakingen die week (SDR-doel 8)' })
  }

  return (
    <Kaart
      className="dl-kaart--kenn"
      label="Kennismakingen"
      plus="+ gepland"
      meta={lopend ? <b>W{weekNr(lopend.week_label)}</b> : null}
      boven={
        <>
          <div className="dl-groot">
            <div className="dl-groot__v">{eenheid.fmt(groot)}</div>
            {verschil !== null && (
              <div className={`dl-groot__d${verschil < 0 ? ' is-warn' : ''}`}>
                {verschil < 0 ? `${Math.abs(verschil)} onder doel` : verschil === 0 ? 'op doel' : `${verschil} boven doel`}
              </div>
            )}
            <div className="dl-groot__u">
              {lic ? 'lic (mid) · ' : ''}{laatste ? `W${weekNr(laatste.week_label)} · vorige week` : ''}{doel !== null && !lic ? ` · doel ${doel} / wk` : ''}
            </div>
          </div>
          <Paren items={paren} />
        </>
      }
      legenda={[{ swatch: 'o', tekst: 'gehouden' }, { swatch: 'pl', tekst: 'gepland' }]}
      voet={lic ? 'lic = (bodem + plafond) / 2 · indicatief' : 'doel: dash_parameters'}
      tip={tip}
    >
      {m => (
        <Weekstaven
          slots={slots}
          doel={lic ? null : doel}
          breedte={m.breedte}
          hoogte={m.hoogte}
          gekozen={gekozen?.soort === 'week' ? gekozen.sleutel : null}
          onKies={s => onKies({ soort: 'week', sleutel: s.key, label: `Week W${weekNr(s.rij.week_label)} · kennismakingen${s.soort === 'gepland' ? ' · gepland' : ''}`, week: s.rij, gepland: s.soort === 'gepland', lopend: s.soort === 'lopend' })}
          onHover={hover}
          onLeave={verberg}
          fmt={eenheid.fmt}
        />
      )}
    </Kaart>
  )
}

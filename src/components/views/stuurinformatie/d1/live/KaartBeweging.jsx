import Kaart from './Kaart'
import InUit from '../../../../ui/charts/visx/InUit'
import { useTip } from '../../../../ui/charts/visx/Tip'
import { weekNr } from './labels'

/**
 * Beweging — in- en uitstroom per week, acht weken: nieuw (instroom op
 * hs_created_at) boven de nul-as, gewonnen + verloren (closedate) eronder als
 * één uit-stapel. De kop telt de acht getoonde weken op (`18 in · 9 uit ·
 * netto +9`) — dat is de enige optelling en hij loopt over exact de staven die
 * eronder staan. Bron: `v_d1_beweging_week`.
 */
const SOORT_LABEL = { nieuw: 'nieuw', gewonnen: 'gewonnen', verloren: 'verloren' }

export default function KaartBeweging({ beweging, eenheid, gekozen, onKies }) {
  const { tip, toon, verberg } = useTip()
  const lic = eenheid.lic
  const recent = (beweging || []).slice(-8)
  const weken = recent.map(w => ({
    key: w.week_start, label: `W${weekNr(w.week_label)}`, rij: w,
    nieuw: lic ? w.instroom_licenties : w.instroom,
    gewonnen: lic ? w.gewonnen_licenties : w.gewonnen,
    verloren: lic ? w.verloren_licenties : w.verloren,
  }))
  const som = k => weken.reduce((s, w) => s + (Number(w[k]) || 0), 0)
  const inn = som('nieuw'), uit = som('gewonnen') + som('verloren'), netto = inn - uit

  const hover = (e, w, soort) => toon(e, {
    kop: `${w.label}${w.rij.is_huidige_week ? ' · loopt nog' : ''}`,
    regels: [
      `nieuw ${eenheid.fmt(w.nieuw)} · gewonnen ${eenheid.fmt(w.gewonnen)} · verloren ${eenheid.fmt(w.verloren)}`,
      `netto ${(Number(w.nieuw) || 0) - (Number(w.gewonnen) || 0) - (Number(w.verloren) || 0) >= 0 ? '+' : '−'}${eenheid.fmt(Math.abs((Number(w.nieuw) || 0) - (Number(w.gewonnen) || 0) - (Number(w.verloren) || 0)))} ${eenheid.kort}${soort ? ` · je wijst ${SOORT_LABEL[soort]}` : ''}`,
    ],
    zin: 'in- en uitstroom die week · nieuw = deal aangemaakt, gewonnen/verloren = gesloten',
  })

  return (
    <Kaart
      className="dl-kaart--beweging"
      label="Beweging"
      meta={<b>{eenheid.fmt(inn)} in · {eenheid.fmt(uit)} uit · netto {netto >= 0 ? '+' : '−'}{eenheid.fmt(Math.abs(netto))}{lic ? ' lic' : ''}</b>}
      sub={`in boven de as · uit (gewonnen + verloren) eronder · ${eenheid.naam}`}
      legenda={[{ swatch: 'o', tekst: 'nieuw' }, { swatch: 'od', tekst: 'gewonnen' }, { swatch: 'g', tekst: 'verloren' }]}
      voet={lic ? 'mid · indicatief · 8 weken' : '8 weken · nieuw = aangemaakt'}
      tip={tip}
    >
      {m => (
        <InUit
          weken={weken}
          breedte={m.breedte}
          hoogte={m.hoogte}
          gekozen={gekozen?.soort === 'beweging' ? gekozen.sleutel : null}
          onKies={(w, soort) => onKies({ soort: 'beweging', sleutel: `${w.key}:${soort}`, label: `${w.label} · beweging · ${SOORT_LABEL[soort]}`, week: w.rij, type: soort })}
          onHover={hover}
          onLeave={verberg}
          fmt={eenheid.fmt}
        />
      )}
    </Kaart>
  )
}

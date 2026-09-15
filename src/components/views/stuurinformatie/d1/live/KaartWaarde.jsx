import Kaart from './Kaart'
import { useTip } from '../../../../ui/charts/visx/Tip'
import { getal } from '../../format'
import { FASE_KORT, faseZin, bereikKort, euroK } from './labels'

/**
 * Waarde — alleen in de stand Licenties (Design ronde 4/5): per fase de band
 * bodem–plafond in licenties (C5 bereikstaaf: bodem orange-deep, plafond
 * subtle) met de €-band per maand eronder. Nooit één "pipeline-waarde". Het
 * totaal bovenin is de som van exact de drie getoonde rijen uit
 * `v_d1_pipeline_per_fase` — dat is de enige optelling op deze kaart, en hij
 * loopt over de rijen die eronder staan.
 */
export default function KaartWaarde({ perFase, gekozen, onKies }) {
  const { tip, toon, verberg } = useTip()
  const volg = { 3: 0, 1: 1, 2: 2 }
  const rijen = [...(perFase || [])].sort((a, b) => (volg[a.fase] ?? 9) - (volg[b.fase] ?? 9))
  const som = k => rijen.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const totLo = som('bodem_licenties'), totHi = som('plafond_licenties')
  const max = Math.max(1, ...rijen.map(r => Number(r.plafond_licenties) || 0))

  const hover = (e, r) => toon(e, {
    kop: faseZin(r.fase),
    regels: [
      r.plafond_licenties ? `${bereikKort(r.bodem_licenties, r.plafond_licenties)} lic · ${euroK(r.mrr_bodem)}–${euroK(r.mrr_plafond)} / mnd` : 'geen waardering',
      `${getal(r.aantal_gewaardeerd)} van ${getal(r.aantal)} deals gewaardeerd`,
    ],
    zin: 'pipeline-waarde in licenties / MRR · bodem = minimumafname, plafond = contractomvang',
  })

  return (
    <Kaart
      className="dl-kaart--waarde"
      label="Waarde"
      meta="MRR"
      boven={
        <div className="dl-groot dl-groot--klein">
          <div className="dl-groot__v">{bereikKort(totLo, totHi) || '—'}</div>
          <div className="dl-groot__u">lic</div>
          <div className="dl-groot__sub">{euroK(som('mrr_bodem'))}–{euroK(som('mrr_plafond'))}</div>
        </div>
      }
      legenda={[{ swatch: 'od', tekst: 'bodem' }, { swatch: 'os', tekst: 'plafond' }]}
      voetExtra="bodem–plafond · MRR · ongewogen"
      tip={tip}
    >
      <div className="dl-waarde">
        {rijen.map(r => {
          const gek = gekozen?.soort === 'waarde' && gekozen.sleutel === String(r.fase)
          const lo = Number(r.bodem_licenties) || 0, hi = Number(r.plafond_licenties) || 0
          return (
            <div
              key={r.fase}
              className={`dl-waarde__rij is-klikbaar${gek ? ' is-gekozen' : ''}`}
              role="button" tabIndex={0}
              onClick={() => onKies({ soort: 'waarde', sleutel: String(r.fase), label: `${FASE_KORT[r.fase]} · waarde`, rij: r })}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKies({ soort: 'waarde', sleutel: String(r.fase), label: `${FASE_KORT[r.fase]} · waarde`, rij: r }) } }}
              onMouseMove={e => hover(e, r)} onMouseLeave={verberg} onFocus={e => hover(e, r)} onBlur={verberg}
            >
              <div className="dl-waarde__kop">
                <span className="dl-waarde__lab">{FASE_KORT[r.fase]}</span>
                <span className="dl-waarde__n">{hi ? bereikKort(lo, hi) : '—'}</span>
              </div>
              <div className="dl-waarde__baan">
                {hi > 0 && <span className="dl-waarde__hi" style={{ width: `${(hi / max) * 100}%` }} />}
                {lo > 0 && <span className="dl-waarde__lo" style={{ width: `${(lo / max) * 100}%` }} />}
              </div>
              <div className="dl-waarde__eur">{hi ? `${euroK(r.mrr_bodem)}–${euroK(r.mrr_plafond)}` : 'geen waardering'}</div>
            </div>
          )
        })}
      </div>
    </Kaart>
  )
}

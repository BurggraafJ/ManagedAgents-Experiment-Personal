import Kaart from './Kaart'
import Donut from '../../../../ui/charts/visx/Donut'
import { useTip } from '../../../../ui/charts/visx/Tip'
import { getal } from '../../format'
import { kanaalLabel, KANAAL_KLEUR, KANAAL_SWATCH } from './labels'

/**
 * Kanaal — waar de open deals vandaan komen (`hs_analytics_source`), als donut
 * (Design ronde 5): slices vanaf 12 uur op grootte, Onbekend als laatste slice
 * uit de ring geschoven en gearceerd, centrum = het geheel (`33 open` of
 * `305 lic mid`), legenda met N + %, hygiëne-voet in error-rood. Percentages
 * zijn afgerond op hele procenten en tellen dus soms op tot 99 of 101 — dat is
 * normaal en wordt niet "gefixt".
 */
export default function KaartKanaal({ kanaal, meta, eenheid, gekozen, onKies }) {
  const { tip, toon, verberg } = useTip()
  const w = r => eenheid.kies(r, 'aantal', 'mid_licenties')
  const bekend = (kanaal || []).filter(r => !r.onbekend && w(r) > 0).sort((a, b) => w(b) - w(a))
  const onbekend = (kanaal || []).find(r => r.onbekend)
  const slices = [
    ...bekend.map((r, i) => ({ key: r.kanaal, label: kanaalLabel(r.kanaal), waarde: w(r), kleur: KANAAL_KLEUR[Math.min(i, KANAAL_KLEUR.length - 1)], swatch: KANAAL_SWATCH[Math.min(i, KANAAL_SWATCH.length - 1)], rij: r })),
    ...(onbekend && w(onbekend) > 0 ? [{ key: onbekend.kanaal, label: 'Onbekend', waarde: w(onbekend), onbekend: true, rij: onbekend }] : []),
  ]
  const tot = slices.reduce((s, x) => s + x.waarde, 0)
  const pct = v => Math.round((v / (tot || 1)) * 100)
  const open = eenheid.lic ? tot : (meta?.open_deals ?? tot)

  const hover = (e, s) => toon(e, {
    kop: s.label,
    regels: [`${eenheid.fmt(s.waarde)} ${eenheid.naam} · ${pct(s.waarde)} %`],
    zin: s.onbekend ? 'geen bron vastgelegd · vul hs_analytics_source in HubSpot' : 'eerste bron (hs_analytics_source)',
  })
  const kies = s => onKies({ soort: 'kanaal', sleutel: s.key, label: `Kanaal · ${s.label}`, slice: s })

  const Legenda = ({ s, i }) => {
    const gek = gekozen?.soort === 'kanaal' && gekozen.sleutel === s.key
    return (
      <div
        className={`dl-klegenda__rij${s.onbekend ? ' is-gat' : ''}${gek ? ' is-gekozen' : ''}`}
        role="button" tabIndex={0}
        onClick={() => kies(s)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kies(s) } }}
        onMouseMove={e => hover(e, s)} onMouseLeave={verberg} onFocus={e => hover(e, s)} onBlur={verberg}
      >
        <i className="dl-klegenda__sw" style={s.onbekend ? undefined : { background: s.swatch }} />
        <span className="dl-klegenda__lab">{s.label}</span>
        <span className="dl-klegenda__n">{eenheid.fmt(s.waarde)}</span>
        <span className="dl-klegenda__p">{pct(s.waarde)} %</span>
      </div>
    )
  }

  return (
    <Kaart
      className="dl-kaart--kanaal"
      label="Kanaal"
      meta="bron"
      sub={eenheid.lic ? `${eenheid.fmt(tot)} lic open (mid) · ${getal(meta?.open_deals ?? 0)} deals` : `${getal(open)} open deals`}
      voetExtra={
        <span className="dl-kaart__voetblok">
          {onbekend && onbekend.aantal > 0
            ? <><span className="dl-warnline">{eenheid.lic ? `${eenheid.fmt(w(onbekend))} lic` : `${getal(onbekend.aantal)} deals`} zonder bron</span><span>hygiëne: kanaal invullen in HubSpot</span></>
            : <span>alle open deals dragen een bron</span>}
        </span>
      }
      tip={tip}
    >
      {m => (
      <div className="dl-kanaal">
        <Donut
          slices={slices}
          centrum={{ groot: eenheid.fmt(open), klein: eenheid.lic ? 'lic mid' : 'open' }}
          /* De ring krimpt mee met de kaart: de legenda (≈ 23 px per rij, plus
             de gatregel) heeft voorrang, de ring krijgt wat er overblijft,
             tussen 96 en 150 px. */
          maat={Math.max(96, Math.min(150, m.breedte, m.hoogte - (slices.length * 25 + (slices.some(s => s.onbekend) ? 24 : 0) + 14)))}
          gekozen={gekozen?.soort === 'kanaal' ? gekozen.sleutel : null}
          onKies={kies}
          onHover={hover}
          onLeave={verberg}
        />
        <div className="dl-klegenda">
          {slices.filter(s => !s.onbekend).map((s, i) => <Legenda key={s.key} s={s} i={i} />)}
          {slices.some(s => s.onbekend) && (
            <>
              <div className="dl-gatsep"><span>ontbrekende registratie</span></div>
              {slices.filter(s => s.onbekend).map(s => <Legenda key={s.key} s={s} />)}
            </>
          )}
        </div>
      </div>
      )}
    </Kaart>
  )
}

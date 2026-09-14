import './hero-strip.css'

/**
 * HeroStrip — een grafiekkaart met een getal links en een strip rechts.
 *
 * Gebouwd als los component i.p.v. MetricCard-variant: een hero die een
 * grafiek als primair beeld draagt, past niet in een flex-column tekstkaart
 * (DIAGNOSE.md c1-hero-redesign). MetricCard blijft ongewijzigd voor de
 * drie contextkaarten eronder.
 *
 * Props:
 *   label        KPI-naam (klein, kapitalen)
 *   merk         optioneel bronlabel ("ruw (HubSpot)")
 *   waarde       string of null; null → leegTekst
 *   waardeSuffix tekst onder het getal ("vorige week · 3 onder doel")
 *   leegTekst    wat er staat als waarde null is
 *   reden        uitleg bij een lege waarde
 *   toon         'hero' | 'waarschuwing'
 *   strip        de chart (AanvoerStrip / Periodestrip)
 *   metrics      array van { label, value } — de drie vakjes
 *   basis        voetnoot onder de hele kaart
 */
export default function HeroStrip({
  label,
  merk = null,
  waarde = null,
  waardeSuffix = null,
  leegTekst = 'geen weekdata',
  reden = null,
  toon = 'hero',
  strip = null,
  metrics = null,
  basis = null,
}) {
  const leeg = waarde === null || waarde === undefined
  const klasse = `hs${toon === 'waarschuwing' ? ' hs--waarschuwing' : ''}`

  if (leeg) {
    return (
      <div className={klasse}>
        <div className="hs__leeg">{leegTekst}</div>
        {reden && <p className="hs__reden">{reden}</p>}
      </div>
    )
  }

  return (
    <div className={klasse}>
      <div className="hs__left">
        <div>
          <span className="hs__label">{label}</span>
          {merk && <span className="hs__merk">{merk}</span>}
        </div>
        <div className="hs__getal">{waarde}</div>
        {waardeSuffix && <div className="hs__suffix">{waardeSuffix}</div>}
      </div>

      {strip && <div className="hs__strip">{strip}</div>}

      {metrics && metrics.length > 0 && (
        <div className="hs__metrics">
          {metrics.map((m, i) => (
            <div key={i} className="hs__metric">
              <span className="hs__metric-label">{m.label}</span>
              <span className="hs__metric-value">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {basis && <div className="hs__basis">{basis}</div>}
    </div>
  )
}

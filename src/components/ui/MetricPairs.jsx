import './metric-pairs.css'

/**
 * MetricPairs — een rij van metric-vakjes (bg/border/padding). De gedeelde
 * bib-primitief die het HeroStrip-patroon afdwingt buiten de hero.
 *
 * Elke MetricPair is een label + waarde in een echt blokje. Geen telegram,
 * geen naakte stands (skill dashboarding v0.9.4).
 *
 * Props:
 *   toon      'normaal' | 'warm' | 'warn' — kleurschema
 *   compact   boolean — kleiner voor in een MetricCard
 *   className extra klassen
 *   children  <MetricPair> elementen
 */
export default function MetricPairs({
  toon = 'normaal',
  compact = false,
  className = '',
  children,
}) {
  const cls = [
    'mp',
    toon !== 'normaal' && `mp--${toon}`,
    compact && 'mp--compact',
    className,
  ].filter(Boolean).join(' ')
  return <div className={cls}>{children}</div>
}

/**
 * MetricPair — één vakje: label boven, waarde onder.
 *
 * Props:
 *   label   kleine kop (uppercase, mono)
 *   waarde  het getal of de tekst
 *   richting 'omhoog' | 'omlaag' | null — optioneel pijltje
 *   title   hover-tekst
 */
export function MetricPair({ label, waarde, richting = null, title = null }) {
  const pijl = richting === 'omhoog' ? '↑' : richting === 'omlaag' ? '↓' : null
  return (
    <div className="mp__vak" title={title || undefined}>
      <span className="mp__label">{label}</span>
      <span className="mp__waarde">
        {waarde}
        {pijl && <span className={`mp__pijl mp__pijl--${richting}`}>{pijl}</span>}
      </span>
    </div>
  )
}

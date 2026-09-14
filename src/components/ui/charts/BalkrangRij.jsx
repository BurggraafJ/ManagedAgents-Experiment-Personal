/**
 * Eén regel van de C4 Balkrang. Twee layouts, één grammatica: links naam plus
 * grondslag, de balk, het getal aan het uiteinde, en (waar de rij klikbaar is)
 * een caret naar de records.
 *
 * `frac` is waarde / schaalmaximum van het blok — het blok rekent hem uit over
 * exact de rijen die het tekent (G2/G5); de rij tekent alleen.
 */
export default function BalkrangRij({
  rij, frac, layout, klikbaar, gekozen, onKies, noemerPerRij, extra = null, kolommen = null, getal,
}) {
  const nul = rij.waarde === 0
  const klasse = [
    'c4__rij',
    rij.gat ? 'c4__rij--gat' : '',
    rij.warn && !rij.gat ? 'c4__rij--warn' : '',
    nul ? 'is-nul' : '',
    gekozen ? 'is-gekozen' : '',
    !klikbaar ? 'c4__rij--stil' : '',
  ].filter(Boolean).join(' ')

  const pct = Math.round(frac * 1000) / 10
  const n = rij.waarde === null || rij.waarde === undefined ? '—' : getal(rij.waarde)
  const noemer = noemerPerRij && rij.noemer !== null && rij.noemer !== undefined
    ? <small> / {getal(rij.noemer)}</small>
    : null

  const cel = (
    <span className="c4__cel">
      <span className="c4__naam">{rij.naam}</span>
      {(rij.sub || rij.vlag) && (
        <span className="c4__sub">
          {rij.sub}
          {rij.vlag && <span className="c4__vlag">{rij.vlag}</span>}
        </span>
      )}
      {layout === 'onder' && (
        <span className="c4__baan" aria-hidden>
          <i className="c4__vul" style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  )

  const inhoud = layout === 'onder'
    ? <>
        {cel}
        <span className="c4__n">{n}{noemer}</span>
        {klikbaar && <span className="c4__caret" aria-hidden>▸</span>}
      </>
    : <>
        {cel}
        {/* Het getal staat in de goot achter de balk en beweegt mee met de
            balklengte: schaal = kolombreedte − goot. Data-driven maat, daarom
            inline. */}
        <span className="c4__meet">
          <span className="c4__baan" aria-hidden>
            <i className="c4__vul" style={{ width: `${pct}%` }} />
          </span>
          <span
            className="c4__n"
            style={{ left: `calc((100% - var(--c4-goot)) * ${nul ? 0 : frac} + 8px)` }}
          >
            {n}{noemer}
          </span>
        </span>
        {extra && extra.map((x, i) => (
          <span key={i} className={`c4__extra${i > 0 ? ' c4__extra--zwak' : ''}`}>{x}</span>
        ))}
        {klikbaar && <span className="c4__caret" aria-hidden>▸</span>}
      </>

  const stijl = kolommen ? { gridTemplateColumns: kolommen } : undefined
  const label = `${rij.naam}: ${n}${rij.noemer !== null && rij.noemer !== undefined ? ` van ${getal(rij.noemer)}` : ''}${rij.gat ? ' · ontbrekende registratie' : ''}`

  if (klikbaar) {
    return (
      <button type="button" className={klasse} style={stijl} onClick={() => onKies(rij)} aria-pressed={gekozen} aria-label={label}>
        {inhoud}
      </button>
    )
  }
  return <div className={klasse} style={stijl} role="listitem" aria-label={label}>{inhoud}</div>
}

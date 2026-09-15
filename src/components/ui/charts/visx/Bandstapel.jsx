import './visx.css'
import './bandstapel.css'

/**
 * Bandstapel — horizontale stapel per categorie (Design ronde 4/5, kaart
 * Kantoorgrootte): per band een spoor van 10 px met F3 (oranje) · F2
 * (orange-deep) · F1 (grijs), het totaal in mono rechts en de fase-mix als
 * mono-regel onder de balk (`F1 3 · F2 1 · F3 5`). De kernband staat vet in
 * orange-deep. De gatregel ("onbekend") staat onder een stippellijn met
 * `ontbrekende registratie` in error-rood en heeft een gestreepte vulling.
 *
 * HTML en geen SVG: dit zijn rijen met tekst en een spoor, en de rijhoogte
 * hoort bij de tekst te blijven. Elk segment is apart hoverbaar (fase-hover),
 * de hele rij is de klik-snede (band → sink).
 *
 * Props:
 *   rijen   [{ key, label, kern?, onbekend?, totaal, segmenten: [{ fase, waarde }], mix, titel? }]
 *   max     gedeelde schaal (grootste totaal)
 *   fmt · gekozen · onKies(rij) · onHover(e, rij, fase|null) · onLeave
 */
export default function Bandstapel({ rijen = [], max = 1, fmt = v => String(v), gekozen = null, onKies = null, onHover = null, onLeave = null }) {
  const m = Math.max(1, Number(max) || 1)
  const gewoon = rijen.filter(r => !r.onbekend)
  const gaten = rijen.filter(r => r.onbekend)

  const Rij = ({ r }) => {
    const gek = gekozen !== null && gekozen === r.key
    const klik = onKies ? { onClick: () => onKies(r), tabIndex: 0, role: 'button', onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKies(r) } } } : {}
    return (
      <div
        className={`bst__rij${r.kern ? ' is-kern' : ''}${r.onbekend ? ' is-gat' : ''}${gek ? ' is-gekozen' : ''}${onKies ? ' is-klikbaar' : ''}`}
        {...klik}
        onMouseMove={onHover ? e => onHover(e, r, null) : undefined}
        onMouseLeave={onLeave || undefined}
        onFocus={onHover ? e => onHover(e, r, null) : undefined}
        onBlur={onLeave || undefined}
        aria-label={r.titel || `${r.label} · ${fmt(r.totaal)}`}
      >
        <div className="bst__lab">{r.label}</div>
        <div className="bst__spoor">
          {r.segmenten.filter(s => (Number(s.waarde) || 0) > 0).map(s => (
            <div
              key={s.fase}
              className={`bst__seg bst__seg--${s.fase}${r.onbekend ? ' bst__seg--gat' : ''}`}
              style={{ width: `${((Number(s.waarde) || 0) / m) * 100}%` }}
              onMouseMove={onHover ? e => { e.stopPropagation(); onHover(e, r, s.fase) } : undefined}
            />
          ))}
        </div>
        <div className="bst__n">{fmt(r.totaal)}</div>
        <div className="bst__mix">{r.mix}</div>
      </div>
    )
  }

  return (
    <div className="bst">
      {gewoon.map(r => <Rij key={r.key} r={r} />)}
      {gaten.length > 0 && (
        <>
          <div className="bst__gatsep"><span>ontbrekende registratie</span></div>
          {gaten.map(r => <Rij key={r.key} r={r} />)}
        </>
      )}
    </div>
  )
}

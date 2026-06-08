import { kbMarkdownToHtml } from './kbMarkdown'

function Lc({ d, w = 16 }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  check: ['M20 6 9 17l-5-5'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'],
}

/**
 * KbVariantCard — één van de twee AI-varianten. Klikbaar om te selecteren;
 * toont titel, samenvatting, markdown-preview en eventuele "te bevestigen"-gaten.
 */
export default function KbVariantCard({ variant, index, selected, onSelect }) {
  const teBev = Array.isArray(variant.te_bevestigen) ? variant.te_bevestigen.filter(Boolean) : []
  const letter = index === 0 ? 'A' : 'B'
  return (
    <div className={`kbc-variant ${selected ? 'is-selected' : ''}`} onClick={onSelect} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}>
      <div className="kbc-variant__head">
        <span className={`kbc-variant__radio ${selected ? 'is-on' : ''}`}>{selected && <Lc d={I.check} w={12} />}</span>
        <span className="kbc-variant__badge">Versie {letter}</span>
        <span className="kbc-variant__label">{variant.label}</span>
      </div>
      <h3 className="kbc-variant__title">{variant.title || '(zonder titel)'}</h3>
      {variant.summary && <p className="kbc-variant__summary">{variant.summary}</p>}
      <article className="kbc-variant__body art-body" dangerouslySetInnerHTML={{ __html: kbMarkdownToHtml(variant.body) }} />
      {teBev.length > 0 && (
        <div className="kbc-variant__tebev">
          <span className="kbc-variant__tebev-h"><Lc d={I.alert} w={13} />Nog te bevestigen ({teBev.length})</span>
          <ul>{teBev.slice(0, 5).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

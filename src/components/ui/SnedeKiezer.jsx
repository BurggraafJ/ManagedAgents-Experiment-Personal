import './bord-shell.css'

/**
 * SnedeKiezer — dezelfde rijen, een andere doorsnede. Promotie van `.d1-tab`
 * naar gedeeld component, zodat de drie borden dezelfde knop dragen.
 *
 * Een snede is géén filter: het aantal regels blijft gelijk, alleen de
 * groepering verandert. De telling staat daarom alleen op de gekozen knop —
 * dat is de telling die de lijst eronder waarmaakt. Wijkt hij af van een
 * andere snede, dan telt een regel in meer dan één groep mee, en dat hoort in
 * de voetnoot van de lijst te staan.
 *
 * Een snede die (nog) niets kan tonen blijft zichtbaar als uitgeschakelde
 * knop: weglaten verbergt dat de doorsnede bestaat.
 *
 * Props:
 *   sneden   [{ id, label, n?, uit?, titel? }]
 *   actief   id van de gekozen snede
 *   onKies   (id) => void
 */
export default function SnedeKiezer({ sneden = [], actief, onKies }) {
  if (sneden.length === 0) return null

  return (
    <div className="bs-snede" role="group">
      {sneden.map(s => (
        <button
          key={s.id}
          type="button"
          className={`bs-snede__knop${s.id === actief ? ' is-actief' : ''}`}
          onClick={() => !s.uit && onKies(s.id)}
          disabled={!!s.uit}
          aria-pressed={s.id === actief}
          title={s.titel}
        >
          {s.label}
          {s.id === actief && s.n !== null && s.n !== undefined && (
            <span className="bs-snede__n">{s.n}</span>
          )}
        </button>
      ))}
    </div>
  )
}

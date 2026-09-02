import './in-construction.css'

/**
 * InConstruction — placeholder voor een pagina die al in de navigatie staat
 * maar nog geen functionaliteit heeft (v1.127: Connectors, Long running
 * tasks). Bewust kaal: geen nep-lijsten of dummy-data, alleen de belofte.
 *
 * Props:
 *   what  — korte omschrijving van wat hier komt (één zin).
 */
export default function InConstruction({ what }) {
  return (
    <div className="inc" role="status">
      <svg className="inc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2 20h20" /><path d="M5 20V9l7-5 7 5v11" /><path d="M9 20v-6h6v6" /><path d="M12 4v3" />
      </svg>
      <div className="inc__title">In construction</div>
      <p className="inc__txt">{what || 'Deze pagina wordt gebouwd. Er is hier nog niets in te stellen.'}</p>
    </div>
  )
}

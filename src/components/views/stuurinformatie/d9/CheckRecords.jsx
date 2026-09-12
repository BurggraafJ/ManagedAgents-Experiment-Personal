/**
 * CheckRecords — niveau drie van het drill-pad: de records achter één check.
 * Niet dieper. Elke regel draagt een eigenaar en een directe link naar HubSpot,
 * zodat opruimen één klik is.
 *
 * Een lege lijst is hier goed nieuws en zegt dat ook: een werkbordlijst hoort
 * leeg te kunnen raken (skill `dashboarding`, principes.md regel 13).
 */
export default function CheckRecords({ state }) {
  if (!state || state.loading) {
    return <div className="d9-records d9-records--laden">Records ophalen…</div>
  }
  if (state.error) {
    return <div className="d9-records d9-records--fout">Kan de records niet ophalen: {state.error}</div>
  }
  const rows = state.rows || []
  if (rows.length === 0) {
    return (
      <div className="d9-records d9-records--leeg">
        Geen records — deze check staat schoon.
      </div>
    )
  }

  const kop = rows[0]?.record_type === 'company' ? 'Klant' : 'Deal'

  return (
    <div className="d9-records">
      <div className="d9-records__head">
        <span>{kop}</span>
        <span>Waarom staat dit hier</span>
        <span>Eigenaar</span>
        <span>Dagen open</span>
        <span />
      </div>
      {rows.map(r => (
        <div key={`${r.record_type}-${r.record_id}`} className="d9-records__rij">
          <span className="d9-records__naam">
            {r.naam || '(zonder naam)'}
            <span className="d9-records__meta">
              {r.pipeline_label}{r.fase_label ? ` · ${r.fase_label}` : ''}
            </span>
          </span>
          <span className="d9-records__detail">{r.detail}</span>
          <span className="d9-records__eigenaar">
            {r.eigenaar || <em className="d9-records__onbekend">onbekend</em>}
          </span>
          <span className="d9-records__dagen">
            {r.dagen_open === null || r.dagen_open === undefined ? '—' : r.dagen_open}
          </span>
          <span className="d9-records__link">
            {r.hubspot_url && (
              <a href={r.hubspot_url} target="_blank" rel="noreferrer">
                HubSpot ↗
              </a>
            )}
          </span>
        </div>
      ))}
      {state.afgekapt && (
        <div className="d9-records__afgekapt">
          Alleen de eerste {rows.length} records getoond — deze lijst is te lang voor handwerk.
          Dat is zelf het signaal: dit is geen opruimklus maar een procesprobleem.
        </div>
      )}
    </div>
  )
}

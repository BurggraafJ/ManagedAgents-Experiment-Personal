import WorkTable from '../../../ui/WorkTable'

/**
 * CheckRecords — niveau drie van het drill-pad: de records achter één check,
 * in het detailpaneel naast de lijst. Niet dieper. Elke regel opent HubSpot in
 * een nieuw tabblad, zodat opruimen één klik is; de route van de app
 * verandert niet.
 *
 * Vier kolommen en geen vijfde. De uitlegkolom ("waarom staat dit hier") en de
 * eigenaar van het record staan in de tooltip van de regel: zone 4 heeft een
 * woordbudget van nul lopende tekst, en in 480 px knijpt een vijfde kolom de
 * naam van de deal weg — precies de kolom waarop je zoekt.
 *
 * Een lege lijst is hier goed nieuws en zegt dat ook: een werkbordlijst hoort
 * leeg te kunnen raken (skill `dashboarding`, principes.md regel 13).
 */
const KOLOMMEN = (kop) => [
  { key: 'naam', label: kop, breedte: 'minmax(0, 1fr)', klasse: 'wt__naam',
    render: r => r.naam || '(zonder naam)' },
  { key: 'fase', label: 'Fase', breedte: '54px', klasse: 'wt__mono',
    render: r => r.fase_label || '—' },
  { key: 'dagen', label: 'Dagen', breedte: '52px', klasse: 'wt__rechts',
    render: r => (r.dagen_open === null || r.dagen_open === undefined ? '—' : r.dagen_open) },
  { key: 'link', label: '', breedte: '20px', klasse: 'wt__ext',
    render: r => (r.hubspot_url
      ? <a href={r.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot">↗</a>
      : null) },
]

export default function CheckRecords({ state }) {
  if (!state || state.loading) {
    return <div className="bs-leeg">Records ophalen…</div>
  }
  if (state.error) {
    return <div className="bs-leeg">Kan de records niet ophalen: {state.error}</div>
  }

  const rows = state.rows || []
  const kop = rows[0]?.record_type === 'company' ? 'Klant' : 'Deal'

  return (
    <WorkTable
      kolommen={KOLOMMEN(kop)}
      rijen={rows}
      sleutel={r => `${r.record_type}-${r.record_id}`}
      leegTekst="Geen records — deze check staat schoon."
      rijTitel={r => [
        r.detail,
        r.eigenaar ? `eigenaar ${r.eigenaar}` : 'zonder eigenaar',
        r.pipeline_label,
      ].filter(Boolean).join(' · ')}
    />
  )
}

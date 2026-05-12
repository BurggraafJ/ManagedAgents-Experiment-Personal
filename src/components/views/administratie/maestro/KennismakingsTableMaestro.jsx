import { useMemo, useState } from 'react'
import { classifyEvent, computeSkip } from '../../../../lib/hubspotInbox'
import KennismakingRowMaestro from './KennismakingRowMaestro'

// KennismakingsTableMaestro — Maestro v2 (rebuild 2026-05-12).
// Twee blokken onder elkaar in een fut-section:
//  A. "Eerste kennismakingen"   — primair, uitgeklapt, h4 + count-pill + hint-tekst.
//  B. "Andere externe afspraken" — collapsible details/summary, alleen tonen
//     als er items zijn.
//
// Recruitment-events worden hier overgeslagen (eigen sectie RecruitmentSection).

const TABLE_COLS_FIRST = [
  { key: 'when',      label: 'Wanneer',          width: 90 },
  { key: 'category',  label: 'Categorie',        width: 96 },
  { key: 'subject',   label: 'Onderwerp',        width: null },
  { key: 'externals', label: 'Externe deelnemers', width: 200 },
  { key: 'source',    label: 'Bron-match',       width: 200 },
  { key: 'location',  label: 'Locatie',          width: 170 },
  { key: 'datum',     label: 'Datum in HubSpot', width: 80, title: 'kennismaking_datum property in HubSpot ingevuld?' },
  { key: 'action',    label: 'Voorgestelde actie', width: 140 },
  { key: 'tools',     label: '',                 width: 34 },
]

const TABLE_COLS_OTHERS = [
  { key: 'when',      label: 'Wanneer',          width: 90 },
  { key: 'category',  label: 'Categorie',        width: 96 },
  { key: 'subject',   label: 'Onderwerp',        width: null },
  { key: 'externals', label: 'Externe deelnemers', width: 200 },
  { key: 'source',    label: 'Bron-match',       width: 200 },
  { key: 'location',  label: 'Locatie',          width: 170 },
  { key: 'datum',     label: 'Datum in HubSpot', width: 80 },
  { key: 'reason',    label: 'Reden',            width: 140 },
  { key: 'tools',     label: '',                 width: 34 },
]

function TableHead({ cols }) {
  return (
    <thead>
      <tr>
        {cols.map(c => (
          <th
            key={c.key}
            style={c.width ? { width: c.width } : undefined}
            title={c.title}
            aria-label={c.label || undefined}
          >
            {c.label || ''}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export default function KennismakingsTableMaestro({
  events,
  hsIndex,
  pipelineLookup,
  dismissedSet,
  eventsWithProposal,
  onDismiss,
  onUndoDismiss,
}) {
  const classified = useMemo(() =>
    events.map(e => ({
      event: e,
      externals: e._externals || [],
      cls: classifyEvent(e, e._externals || [], hsIndex, pipelineLookup),
    })),
    [events, hsIndex, pipelineLookup],
  )

  const partitioned = useMemo(() => {
    const first = []
    const others = []
    for (const x of classified) {
      // Recruitment heeft een eigen sectie (RecruitmentSection).
      if (x.cls?.category === 'recruitment') continue
      const skip = computeSkip(x.event, x.externals, x.cls)
      const isDismissed = dismissedSet?.has(x.event.id)
      if (isDismissed) {
        others.push({ ...x, skip: skip || { reason: 'dismissed_by_user', label: 'Niet meer tonen (door jou)' }, isDismissed: true })
      } else if (skip) {
        others.push({ ...x, skip, isDismissed: false })
      } else {
        first.push({ ...x, skip: null, isDismissed: false })
      }
    }
    return { first, others }
  }, [classified, dismissedSet])

  const [othersOpen, setOthersOpen] = useState(false)

  return (
    <>
      {/* Tabel A — Eerste kennismakingen (primair) */}
      <div className="km-tablegroup">
        <div className="km-tablegroup__head">
          <h4 className="km-tablegroup__title">Eerste kennismakingen</h4>
          <span className="km-pill">{partitioned.first.length}</span>
          <span className="km-tablegroup__hint">
            agenda-events waar dit echt de eerste interactie is — fysiek of online
          </span>
        </div>

        {partitioned.first.length === 0 ? (
          <div className="km-empty">
            <div className="km-empty__title">Geen openstaande eerste-kennismakingen</div>
            <div className="km-empty__hint">
              Alle aankomende events zijn al-lopende relaties.
              {partitioned.others.length > 0 && <> Zie <strong>Andere externe afspraken</strong> hieronder.</>}
            </div>
          </div>
        ) : (
          <div className="fut-tbl-wrap">
            <table className="fut-tbl">
              <TableHead cols={TABLE_COLS_FIRST} />
              <tbody>
                {partitioned.first.map(x => (
                  <KennismakingRowMaestro
                    key={x.event.id}
                    event={x.event}
                    externals={x.externals}
                    cls={x.cls}
                    skip={x.skip}
                    isDismissed={x.isDismissed}
                    hasProposal={eventsWithProposal?.has(x.event.id)}
                    pipelineLookup={pipelineLookup}
                    hsIndex={hsIndex}
                    onDismiss={onDismiss}
                    onUndoDismiss={onUndoDismiss}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tabel B — Andere externe afspraken (collapsible) — alleen tonen als er iets is */}
      {partitioned.others.length > 0 && (
        <details
          className="km-others"
          open={othersOpen}
          onToggle={(e) => setOthersOpen(e.currentTarget.open)}
        >
          <summary className="km-others__summary">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="km-others__caret" aria-hidden>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="km-others__title">Andere externe afspraken</span>
            <span className="km-pill km-pill--soft">{partitioned.others.length}</span>
            <span className="km-others__hint">
              klant al binnen, sales al verder, personal domain, lead al in beweging, of door jou weggeklikt
            </span>
          </summary>
          <div className="km-others__body">
            <div className="fut-tbl-wrap">
              <table className="fut-tbl">
                <TableHead cols={TABLE_COLS_OTHERS} />
                <tbody>
                  {partitioned.others.map(x => (
                    <KennismakingRowMaestro
                      key={x.event.id}
                      event={x.event}
                      externals={x.externals}
                      cls={x.cls}
                      skip={x.skip}
                      isDismissed={x.isDismissed}
                      hasProposal={eventsWithProposal?.has(x.event.id)}
                      pipelineLookup={pipelineLookup}
                      hsIndex={hsIndex}
                      onDismiss={onDismiss}
                      onUndoDismiss={onUndoDismiss}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}
    </>
  )
}

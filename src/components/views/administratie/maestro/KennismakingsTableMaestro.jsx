import { useMemo, useState } from 'react'
import { classifyEvent, computeSkip } from '../../../../lib/hubspotInbox'
import KennismakingRowMaestro from './KennismakingRowMaestro'

// KennismakingsTableMaestro — twee tabellen onder elkaar (mockup .fut-tbl):
//  A. "Eerste kennismakingen"   — primair, uitgeklapt
//  B. "Andere externe afspraken" — collapsible, secundair (skip-redenen +
//     handmatig dismissed events)
//
// Mirror van KennismakingsTable; verschil: classes uit Administratie.html
// (.fut-tbl + section-wrapper met paper-2 + radius 14).

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
      {/* Tabel A — Eerste kennismakingen */}
      <div className="km-tablegroup">
        <div className="km-tablegroup__head">
          <h4 className="km-tablegroup__title">Eerste kennismakingen</h4>
          <span className="km-pill">{partitioned.first.length}</span>
          <span className="km-tablegroup__hint">agenda-events waar dit echt de eerste interactie is — fysiek of online</span>
        </div>
        {partitioned.first.length === 0 ? (
          <div className="km-empty">
            Geen openstaande eerste-kennismakingen.
            <span className="km-empty__hint">Alle events zijn al-lopende relaties.</span>
          </div>
        ) : (
          <div className="fut-tbl-wrap">
            <table className="fut-tbl">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Wanneer</th>
                  <th style={{ width: 96 }}>Categorie</th>
                  <th>Onderwerp</th>
                  <th style={{ width: 200 }}>Externe deelnemers</th>
                  <th style={{ width: 200 }}>Bron-match</th>
                  <th style={{ width: 170 }}>Locatie</th>
                  <th style={{ width: 80 }} title="kennismaking_datum property in HubSpot ingevuld?">Datum in HubSpot</th>
                  <th style={{ width: 140 }}>Voorgestelde actie</th>
                  <th style={{ width: 34 }} aria-label="acties" />
                </tr>
              </thead>
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

      {/* Tabel B — Andere externe afspraken (collapsible) */}
      <details className="km-others" open={othersOpen} onToggle={(e) => setOthersOpen(e.currentTarget.open)}>
        <summary className="km-others__summary">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="km-others__caret">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="km-others__title">Andere externe afspraken</span>
          <span className="km-pill km-pill--soft">{partitioned.others.length}</span>
          <span className="km-others__hint">klant al binnen, sales al verder, personal domain, lead al in beweging, of door jou weggeklikt</span>
        </summary>
        <div className="km-others__body">
          {partitioned.others.length === 0 ? (
            <div className="km-empty">Geen.</div>
          ) : (
            <div className="fut-tbl-wrap">
              <table className="fut-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Wanneer</th>
                    <th style={{ width: 96 }}>Categorie</th>
                    <th>Onderwerp</th>
                    <th style={{ width: 200 }}>Externe deelnemers</th>
                    <th style={{ width: 200 }}>Bron-match</th>
                    <th style={{ width: 170 }}>Locatie</th>
                    <th style={{ width: 80 }}>Datum in HubSpot</th>
                    <th style={{ width: 140 }}>Reden</th>
                    <th style={{ width: 34 }} aria-label="acties" />
                  </tr>
                </thead>
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
          )}
        </div>
      </details>
    </>
  )
}

import { useMemo, useState } from 'react'
import { classifyEvent, computeSkip } from '../../../lib/hubspotInbox'
import KennismakingRow from './KennismakingRow'
import styles from './HubSpotInboxFutureView.module.css'

/**
 * KennismakingsTable — twee tabellen onder elkaar:
 *  A. "Eerste kennismakingen"   — primair, uitgeklapt
 *  B. "Andere externe afspraken" — collapsible, secundair (skip-redenen +
 *     handmatig dismissed events)
 *
 * Recruitment-events worden hier overgeslagen — die gaan naar een eigen
 * RecruitmentSection (sinds skill v1.16, 2026-05-06).
 */
export default function KennismakingsTable({
  events,
  hsIndex,
  pipelineLookup,
  dismissedSet,
  eventsWithProposal,
  onDismiss,
  onUndoDismiss,
}) {
  // Classificeer alle events vooraf
  const classified = useMemo(() =>
    events.map(e => ({
      event: e,
      externals: e._externals || [],
      cls: classifyEvent(e, e._externals || [], hsIndex, pipelineLookup),
    })),
    [events, hsIndex, pipelineLookup],
  )

  // Splits in drie groepen: recruitment (eigen tabel), eerste kennismakingen
  // (sales/leads, geen skip), en andere afspraken (met skip-reden of dismissed).
  const partitioned = useMemo(() => {
    const first = []
    const others = []
    for (const x of classified) {
      // Recruitment heeft een eigen sectie (RecruitmentSection) verderop —
      // niet in eerste-kennismakingen of andere-afspraken.
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
      {/* Tabel A — Eerste kennismakingen (uitgeklapt, primair) */}
      <div className={styles.tableBlock}>
        <header className={styles.tableHeader}>
          <h3 className={styles.tableTitle}>
            Eerste kennismakingen
            <span className={`va-block__count ${styles.sectionTitleCount}`}>{partitioned.first.length}</span>
          </h3>
          <span className={`muted ${styles.tableSubtitle}`}>
            agenda-events waar dit echt de eerste interactie is — fysiek of online
          </span>
        </header>
        {partitioned.first.length === 0 ? (
          <div className={`empty empty--compact ${styles.emptyMid}`}>
            Geen openstaande eerste-kennismakingen.{' '}
            <span className={`muted ${styles.tableSubtitle}`}>
              Alle events zijn al-lopende relaties.
            </span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className={styles.colWhen}>Wanneer</th>
                  <th className={styles.colCategory}>Categorie</th>
                  <th>Onderwerp</th>
                  <th className={styles.colExternals}>Externe deelnemers</th>
                  <th className={styles.colSource}>Bron-match</th>
                  <th className={styles.colLocation}>Locatie</th>
                  <th className={styles.colDatum} title="kennismaking_datum property in HubSpot ingevuld?">Datum in HubSpot</th>
                  <th className={styles.colAction}>Voorgestelde actie</th>
                  <th className={styles.colActions}></th>
                </tr>
              </thead>
              <tbody>
                {partitioned.first.map(x => (
                  <KennismakingRow
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

      {/* Tabel B — Andere externe afspraken (collapsible, secundair) */}
      <section className={`va-block ${styles.blockPad}`}>
        <button
          type="button"
          className={`va-block__head ${styles.othersToggle}`}
          onClick={() => setOthersOpen(v => !v)}
        >
          <span className="va-block__caret">{othersOpen ? '▾' : '▸'}</span>
          <span className="va-block__title">Andere externe afspraken</span>
          <span className="va-block__count">{partitioned.others.length}</span>
          <span className="muted va-block__hint">
            klant al binnen, sales al verder, personal domain, lead al in beweging, of door jou weggeklikt
          </span>
        </button>
        {othersOpen && (
          <div className="va-block__body">
            {partitioned.others.length === 0 ? (
              <div className={`empty empty--compact ${styles.emptyMid}`}>Geen.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className={styles.colWhen}>Wanneer</th>
                      <th className={styles.colCategory}>Categorie</th>
                      <th>Onderwerp</th>
                      <th className={styles.colExternals}>Externe deelnemers</th>
                      <th className={styles.colSource}>Bron-match</th>
                      <th className={styles.colLocation}>Locatie</th>
                      <th className={styles.colDatum} title="kennismaking_datum property in HubSpot ingevuld?">Datum in HubSpot</th>
                      <th className={styles.colReason}>Reden</th>
                      <th className={styles.colActions}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {partitioned.others.map(x => (
                      <KennismakingRow
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
        )}
      </section>
    </>
  )
}

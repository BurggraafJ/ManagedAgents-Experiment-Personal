import { fmtNum, relTime, SOURCE_KICKER } from '../../../lib/truthOfSources'
import { SOURCE_ICONS } from './SourceIcons'
import styles from './TruthOfSourcesView.module.css'

/**
 * SourceCard — compact kaartje per data-source (Outlook / HubSpot / etc.).
 * Klik = open detail-modal. Visuele klassen (.tos-card en varianten) leven
 * in src/index.css. Refactor 27 (2026-05-09).
 */
export default function SourceCard({
  source,
  title,
  total,
  totalLabel,
  health,
  lastSyncIso,
  runAgent,
  runStatus,
  errorMsg,
  onOpen,
}) {
  const runStatusClass =
    runStatus === 'error'   ? styles.cardMetaAgentError
    : runStatus === 'warning' ? styles.cardMetaAgentWarning
    : runStatus              ? styles.cardMetaAgentSuccess
    : ''

  return (
    <div
      className={`tos-card tos-card--${source}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open details voor ${title}`}
    >
      {/* Top: icoon + naam, health rechts */}
      <div className="tos-card__top">
        <div className={styles.cardTopLeft}>
          <div className="tos-card__icon">{SOURCE_ICONS[source]}</div>
          <div className={styles.cardTopMeta}>
            <div className="tos-card__title">{title}</div>
            <div className="tos-card__subtitle">{SOURCE_KICKER[source]}</div>
          </div>
        </div>
        {health && (
          <span className={`tos-card__health status-pill ${health.tag}`} title={health.title}>
            {health.label}
          </span>
        )}
      </div>

      {/* Grote getal */}
      <div className="tos-card__metric">
        <span className="tos-card__metric-num">{fmtNum(total)}</span>
        <span className="tos-card__metric-label">{totalLabel}</span>
      </div>

      {/* Inline error indien aanwezig */}
      {errorMsg && (
        <div className="tos-card__error">
          {errorMsg.length > 100 ? errorMsg.slice(0, 100) + '…' : errorMsg}
        </div>
      )}

      {/* Footer-meta */}
      <div className="tos-card__meta">
        <div className="tos-card__meta-row">
          <span>Laatste sync</span>
          <span className={styles.cardMetaValue}>{relTime(lastSyncIso)}</span>
        </div>
        {runAgent && (
          <div className="tos-card__meta-row">
            <span>Via</span>
            <span className="mono">
              {runAgent}
              {runStatus && (
                <span className={`${styles.cardMetaAgent} ${runStatusClass}`}>
                  · {runStatus}
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        className="tos-card__cta"
        onClick={(e) => { e.stopPropagation(); onOpen() }}
      >
        Open details →
      </button>
    </div>
  )
}

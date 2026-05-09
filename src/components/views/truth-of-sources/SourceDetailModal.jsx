import { useEffect } from 'react'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { SOURCE_FUNCTIONS } from '../../../lib/truthOfSources'
import { SectionLabel } from './Primitives'
import LinkedFunctions from './LinkedFunctions'
import RunsLogPanel from './RunsLogPanel'
import { getSourceDetail } from './SourceDetailBody'
import styles from './TruthOfSourcesView.module.css'

/**
 * SourceDetailModal — popup met alle detail-info per bron.
 * Linker kolom: bron-statistieken (per source via getSourceDetail).
 * Rechter kolom: gekoppelde functies + recent logboek.
 *
 * Refactor 27 (2026-05-09): hernoemd van `SourceDetailPopup` naar
 * `SourceDetailModal` voor consistente naming met de rest van de codebase.
 */
export default function SourceDetailModal({ source, data, onClose }) {
  const isNarrow = useMediaQuery('(max-width: 820px)')

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const d   = data
  const fns = SOURCE_FUNCTIONS[source] || []
  const fnAgents = new Set(fns.map((f) => f.agent))
  const sourceRuns = (d.recentRuns || [])
    .filter((r) => fnAgents.has(r.agent_name))
    .slice(0, 30)

  const { headerTitle, headerSubtitle, body } = getSourceDetail(source, d)

  return (
    <div
      className={`agent-settings-popup__overlay ${styles.modalOverlay}`}
      onClick={onClose}
    >
      <div
        className={`card ${styles.modalCard}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalHeaderText}>
            <div className={`kpi__label ${styles.modalKicker}`}>Truth of source</div>
            <div className={styles.modalTitle}>{headerTitle}</div>
            <div className={styles.modalSubtitle}>{headerSubtitle}</div>
          </div>
          <button
            className={`btn btn--ghost ${styles.modalCloseBtn}`}
            onClick={onClose}
            aria-label="Sluiten"
          >
            ×
          </button>
        </header>

        <div
          className={`${styles.modalBody} ${isNarrow ? styles.modalBodyOneCol : styles.modalBodyTwoCol}`}
        >
          {/* Linker kolom: stats over de bron zelf */}
          <div
            className={`${styles.modalCol} ${isNarrow ? styles.modalColLeftNarrow : styles.modalColLeftWide}`}
          >
            <SectionLabel>Bron-statistieken</SectionLabel>
            {body}
          </div>

          {/* Rechter kolom: gekoppelde functies + logboek */}
          <div className={`${styles.modalCol} ${styles.modalColRight}`}>
            <div>
              <SectionLabel>
                Gekoppelde functies{' '}
                <span className={`muted ${styles.sectionLabelInline}`}>· {fns.length}</span>
              </SectionLabel>
              <LinkedFunctions functions={fns} latestByAgent={d.latestByAgent} />
            </div>
            <div className={styles.modalLogStack}>
              <SectionLabel>
                Logboek{' '}
                <span className={`muted ${styles.sectionLabelInline}`}>· laatste {sourceRuns.length}</span>
              </SectionLabel>
              <RunsLogPanel runs={sourceRuns} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

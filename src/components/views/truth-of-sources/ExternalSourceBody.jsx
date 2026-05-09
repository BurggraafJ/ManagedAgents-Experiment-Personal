import { SectionLabel } from './Primitives'
import styles from './TruthOfSourcesView.module.css'

/**
 * ExternalSourceBody — body voor externe / lichtgewicht bronnen
 * (JelleMind in opbouw). Korte intro + Toegang + Gebruikt door, plus
 * optionele "wordt nog gebouwd"-badge. Refactor 27 (2026-05-09).
 */
export default function ExternalSourceBody({ intro, access, usedBy, comingSoon }) {
  return (
    <>
      <div className={styles.externalIntro}>{intro}</div>

      {comingSoon && (
        <div className={styles.comingSoonBadge}>
          <span className={styles.comingSoonDot} />
          wordt nog gebouwd
        </div>
      )}

      <SectionLabel>Toegang</SectionLabel>
      <div className={styles.externalText}>{access}</div>

      <SectionLabel>Gebruikt door</SectionLabel>
      <div className={styles.externalText}>{usedBy}</div>
    </>
  )
}

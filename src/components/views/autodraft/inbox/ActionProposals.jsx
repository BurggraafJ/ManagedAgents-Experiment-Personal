import { useMemo } from 'react'
import { useActionProposals } from '../../../../hooks/useActionProposals'
import styles from '../autodraft.module.css'

/**
 * ActionProposals — toont 3 voorgestelde acties per mail (AutoDraft v2 Fase 3).
 *
 * Read-only voor nu: cards laten zien wat de skill voorstelde + historische
 * (was_suggested=false, outcome='manual') beslissingen. Knoppen voor
 * Goedkeuren / Aanpassen / Negeren volgen pas zodra `auto-draft-execute`
 * action_decisions kan uitvoeren (Fase 2c).
 *
 * Hard cap: < 250 LOC.
 */
const CATEGORY_LABELS = {
  reply: 'Reply',
  forward: 'Doorsturen',
  file: 'Verplaatsen',
  schedule: 'Agenda-actie',
  delegate: 'Delegeren',
  defer: 'Negeren / uitstellen',
}

const CATEGORY_ICONS = {
  reply: '✉',
  forward: '↪',
  file: '🗂',
  schedule: '📅',
  delegate: '➜',
  defer: '⏸',
}

function payloadLine(slug, payload) {
  if (!payload || typeof payload !== 'object') return null
  if (slug?.startsWith('reply.')) {
    const idx = payload.variant_index
    return idx != null ? `Variant ${idx + 1}` : 'Reply-draft'
  }
  if (slug?.startsWith('forward.')) {
    const to = payload.to || '(geen ontvanger)'
    return `→ ${to}`
  }
  if (slug?.startsWith('file.')) {
    return `→ ${payload.target_folder || '(geen map)'}`
  }
  if (slug?.startsWith('delegate.')) {
    const sys = (payload.system || '').toUpperCase()
    return `${sys} ${payload.target || ''}`.trim() || '—'
  }
  if (slug?.startsWith('defer.')) {
    return payload.reason || 'geen reden'
  }
  return null
}

function confidenceTone(c) {
  if (c == null) return styles.confidenceUnknown
  if (c >= 0.75) return styles.confidenceHigh
  if (c >= 0.5)  return styles.confidenceMid
  return styles.confidenceLow
}

function ActionCard({ row, catalogRow, rank }) {
  const slug = row.action_slug
  const category = catalogRow?.category || slug?.split('.')?.[0] || 'action'
  const displayName = catalogRow?.display_name || slug
  const icon = CATEGORY_ICONS[category] || '•'
  const detail = payloadLine(slug, row.payload)
  const conf = row.classifier_confidence
  const reasoning = row.classifier_reasoning
  const isManual = !row.was_suggested && row.outcome === 'manual'
  const isBackfill = row.payload?.backfill_version != null
  const inferredFrom = row.payload?.inferred_from

  return (
    <div className={styles.actionCard} data-rank={rank}>
      <div className={styles.actionCardHead}>
        <span className={styles.actionCardIcon} aria-hidden>{icon}</span>
        <span className={styles.actionCardName}>{displayName}</span>
        {!isManual && (
          <span className={`${styles.actionCardConf} ${confidenceTone(conf)}`}>
            {conf != null ? `${Math.round(conf * 100)}%` : '—'}
          </span>
        )}
        {isManual && (
          <span className={styles.actionCardManual}>
            {isBackfill ? 'Historisch (backfill)' : 'Handmatig'}
          </span>
        )}
      </div>
      {detail && (
        <div className={styles.actionCardDetail}>{detail}</div>
      )}
      {reasoning && (
        <div className={styles.actionCardReason}>{reasoning}</div>
      )}
      {isBackfill && inferredFrom && (
        <div className={styles.actionCardReason}>
          Afgeleid uit: <code>{inferredFrom}</code>
        </div>
      )}
    </div>
  )
}

function ActionProposals({ mailId }) {
  const { proposals, catalog, loading, error } = useActionProposals(mailId)

  const catalogMap = useMemo(() => {
    const m = new Map()
    for (const c of catalog) m.set(c.slug, c)
    return m
  }, [catalog])

  const suggested = useMemo(
    () => proposals.filter(p => p.was_suggested).sort((a, b) => (a.suggested_rank || 99) - (b.suggested_rank || 99)).slice(0, 3),
    [proposals]
  )
  const historical = useMemo(
    () => proposals.filter(p => !p.was_suggested).slice(0, 3),
    [proposals]
  )

  if (!mailId) return null
  if (loading) {
    return <div className={styles.actionProposalsLoading}>Acties laden…</div>
  }
  if (error) {
    return <div className={styles.actionProposalsError}>Acties laden mislukt: {error}</div>
  }
  if (suggested.length === 0 && historical.length === 0) {
    return null
  }

  return (
    <section className={styles.actionProposals}>
      {suggested.length > 0 && (
        <>
          <header className={styles.actionProposalsHead}>
            <h3 className={styles.actionProposalsTitle}>Voorgestelde acties</h3>
            <span className={styles.actionProposalsSub}>Read-only preview — uitvoeren komt in Fase 2c</span>
          </header>
          <div className={styles.actionCardsRow}>
            {suggested.map(row => (
              <ActionCard
                key={row.id}
                row={row}
                catalogRow={catalogMap.get(row.action_slug)}
                rank={row.suggested_rank}
              />
            ))}
          </div>
        </>
      )}
      {historical.length > 0 && (
        <>
          <header className={styles.actionProposalsHead}>
            <h3 className={styles.actionProposalsTitle}>Eerdere actie op deze mail</h3>
          </header>
          <div className={styles.actionCardsRow}>
            {historical.map(row => (
              <ActionCard
                key={row.id}
                row={row}
                catalogRow={catalogMap.get(row.action_slug)}
                rank={null}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default ActionProposals

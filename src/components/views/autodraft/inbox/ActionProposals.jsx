import { useMemo, useState, useCallback } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import { useActionProposals } from '../../../../hooks/useActionProposals'
import styles from '../autodraft.module.css'

/**
 * ActionProposals — toont 3 voorgestelde acties per mail (AutoDraft v2 Fase 3+2c).
 *
 * Per card knoppen Goedkeuren / Negeren — bellen RPC submit_action_decision die
 * bridge'd naar autodraft_decisions zodat auto-draft-execute v9 het uitvoert.
 * Delegate.* is disabled met "Coming soon" — Jira-pad volgt in Fase 2d.
 *
 * Hard cap: < 350 LOC.
 */
const CATEGORY_ICONS = {
  reply: '✉',
  forward: '↪',
  file: '🗂',
  schedule: '📅',
  delegate: '➜',
  defer: '⏸',
}

function payloadLine(slug, payload, catalogRow) {
  if (!payload || typeof payload !== 'object') return null
  if (slug?.startsWith('reply.')) {
    const idx = payload.variant_index
    return idx != null ? `Variant ${idx + 1}` : 'Reply-draft'
  }
  if (slug?.startsWith('forward.')) {
    const to = payload.to || catalogRow?.target_value || '(geen ontvanger)'
    return `→ ${to}`
  }
  if (slug?.startsWith('file.')) {
    return `→ ${payload.target_folder || catalogRow?.target_value || '(geen map)'}`
  }
  if (slug?.startsWith('delegate.')) {
    const sys = (payload.system || '').toUpperCase()
    return `${sys} ${payload.target || catalogRow?.target_value || ''}`.trim() || '—'
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

function outcomeBadge(outcome) {
  if (outcome === 'accept')  return { text: 'Goedgekeurd', cls: styles.outcomeAccept }
  if (outcome === 'amend')   return { text: 'Aangepast',   cls: styles.outcomeAmend  }
  if (outcome === 'reject')  return { text: 'Genegeerd',   cls: styles.outcomeReject }
  if (outcome === 'manual')  return { text: 'Historisch',  cls: styles.outcomeManual }
  return null
}

async function submitDecision(decisionId, outcome) {
  const { data, error } = await supabase.rpc('submit_action_decision', {
    p_decision_id: decisionId,
    p_outcome: outcome,
    p_payload_override: null,
  })
  if (error) throw error
  return data
}

function ActionCard({ row, catalogRow, rank, onDecision }) {
  const [busy, setBusy] = useState(null)
  const slug = row.action_slug
  const category = catalogRow?.category || slug?.split('.')?.[0] || 'action'
  const displayName = catalogRow?.display_name || slug
  const icon = CATEGORY_ICONS[category] || '•'
  const detail = payloadLine(slug, row.payload, catalogRow)
  const conf = row.classifier_confidence
  const reasoning = row.classifier_reasoning
  const isManual = !row.was_suggested && row.outcome === 'manual'
  const isBackfill = row.payload?.backfill_version != null
  const inferredFrom = row.payload?.inferred_from
  const badge = outcomeBadge(row.outcome)
  const isDecided = !!row.outcome && row.outcome !== 'manual'
  const isDelegate = category === 'delegate'
  const canDecide = row.was_suggested && !isDecided

  const handleClick = useCallback(async (outcome) => {
    setBusy(outcome)
    try {
      const result = await submitDecision(row.id, outcome)
      if (result?.warning === 'delegate_pending_implementation') {
        showToast('Delegate is nog niet uitvoerbaar — Fase 2d', 'warning')
      } else if (outcome === 'accept') {
        showToast(`${displayName} goedgekeurd — uitvoering binnen 15 min`, 'success')
      } else {
        showToast(`${displayName} ${outcome === 'reject' ? 'genegeerd' : 'opgeslagen'}`, 'info')
      }
      onDecision?.(row.id, outcome)
    } catch (e) {
      showToast(`Mislukt: ${e.message || String(e)}`, 'error')
    } finally {
      setBusy(null)
    }
  }, [row.id, displayName, onDecision])

  return (
    <div className={styles.actionCard} data-rank={rank} data-decided={isDecided ? 'true' : 'false'}>
      <div className={styles.actionCardHead}>
        <span className={styles.actionCardIcon} aria-hidden>{icon}</span>
        <span className={styles.actionCardName}>{displayName}</span>
        {!isManual && !isDecided && (
          <span className={`${styles.actionCardConf} ${confidenceTone(conf)}`}>
            {conf != null ? `${Math.round(conf * 100)}%` : '—'}
          </span>
        )}
        {badge && (
          <span className={`${styles.actionCardConf} ${badge.cls}`}>{badge.text}</span>
        )}
        {isManual && isBackfill && (
          <span className={styles.actionCardManual}>backfill</span>
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
      {canDecide && (
        <div className={styles.actionCardBtnRow}>
          <button
            type="button"
            className={`${styles.actionCardBtn} ${styles.actionCardBtnAccept}`}
            disabled={!!busy || isDelegate}
            title={isDelegate ? 'Delegate is nog niet uitvoerbaar (Fase 2d)' : 'Voer deze actie uit'}
            onClick={() => handleClick('accept')}
          >
            {busy === 'accept' ? '…' : '✓ Goedkeuren'}
          </button>
          <button
            type="button"
            className={`${styles.actionCardBtn} ${styles.actionCardBtnReject}`}
            disabled={!!busy}
            title="Negeer dit voorstel (geen actie)"
            onClick={() => handleClick('reject')}
          >
            {busy === 'reject' ? '…' : '✕ Negeren'}
          </button>
        </div>
      )}
    </div>
  )
}

function ActionProposals({ mailId }) {
  const { proposals, catalog, loading, error, refetch } = useActionProposals(mailId)

  const catalogMap = useMemo(() => {
    const m = new Map()
    for (const c of catalog) m.set(c.slug, c)
    return m
  }, [catalog])

  const suggested = useMemo(
    () => proposals
      .filter(p => p.was_suggested)
      .sort((a, b) => (a.suggested_rank || 99) - (b.suggested_rank || 99))
      .slice(0, 3),
    [proposals],
  )
  const historical = useMemo(
    () => proposals.filter(p => !p.was_suggested).slice(0, 3),
    [proposals],
  )

  if (!mailId) return null
  if (loading) return <div className={styles.actionProposalsLoading}>Acties laden…</div>
  if (error)   return <div className={styles.actionProposalsError}>Acties laden mislukt: {error}</div>
  if (suggested.length === 0 && historical.length === 0) return null

  return (
    <section className={styles.actionProposals}>
      {suggested.length > 0 && (
        <>
          <header className={styles.actionProposalsHead}>
            <h3 className={styles.actionProposalsTitle}>Voorgestelde acties</h3>
            <span className={styles.actionProposalsSub}>
              Klik Goedkeuren — auto-draft-execute pakt het binnen 15 min op
            </span>
          </header>
          <div className={styles.actionCardsRow}>
            {suggested.map(row => (
              <ActionCard
                key={row.id}
                row={row}
                catalogRow={catalogMap.get(row.action_slug)}
                rank={row.suggested_rank}
                onDecision={refetch}
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

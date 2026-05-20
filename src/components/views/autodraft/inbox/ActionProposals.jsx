import { useMemo, useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import { useActionProposals } from '../../../../hooks/useActionProposals'
import styles from '../autodraft.module.css'

/**
 * ActionProposals — Postvak Maestro UX-laag voor AutoDraft v2 voorstellen.
 *
 * Eén geïntegreerde laag i.p.v. losse cards naast DraftEditor. Werking:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [tab 1: reply.neutraal ✕] [tab 2: forward.finance ✕] [tab 3] │  ← chips
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Preview-pane voor de actief geselecteerde tab.               │
 *   │ - reply.*  → "↓ Bewerk hieronder in de draft-editor"         │
 *   │ - andere   → grafische preview (forward → ontvanger, etc.)   │
 *   │ - Goedkeuren / Negeren knoppen onderaan                      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * onSelectedChange callback geeft MailDetail door welk kind actief is —
 * MailDetail toont DraftEditor alleen als kind === 'reply' of null.
 *
 * Hard cap: < 400 LOC.
 */
const CATEGORY_ICONS = {
  reply: '✉',
  forward: '↪',
  file: '🗂',
  schedule: '📅',
  delegate: '➜',
  defer: '⏸',
}

const CATEGORY_NL = {
  reply:    'Reply-draft',
  forward:  'Doorsturen',
  file:     'Verplaatsen',
  schedule: 'Agenda',
  delegate: 'Delegeren',
  defer:    'Negeren',
}

function payloadLine(slug, payload, catalogRow) {
  if (!payload || typeof payload !== 'object') return null
  if (slug?.startsWith('reply.')) {
    const idx = payload.variant_index
    return idx != null ? `Variant ${idx + 1}` : null
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
    return payload.reason || 'beleefd negeren'
  }
  return null
}

function confidenceTone(c) {
  if (c == null) return styles.confidenceUnknown
  if (c >= 0.75) return styles.confidenceHigh
  if (c >= 0.5)  return styles.confidenceMid
  return styles.confidenceLow
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

function ProposalTab({ row, catalogRow, isActive, onSelect, onReject, busy }) {
  const slug = row.action_slug
  const category = catalogRow?.category || slug?.split('.')?.[0] || 'action'
  const displayName = catalogRow?.display_name || slug
  const icon = CATEGORY_ICONS[category] || '•'
  const conf = row.classifier_confidence

  return (
    <div
      className={`${styles.proposalTab} ${isActive ? styles.proposalTabActive : ''}`}
      data-rank={row.suggested_rank}
      onClick={() => onSelect(row)}
      role="tab"
      aria-selected={isActive}
    >
      <span className={styles.actionCardIcon} aria-hidden>{icon}</span>
      <div className={styles.proposalTabBody}>
        <div className={styles.proposalTabName}>{displayName}</div>
        <div className={styles.proposalTabMeta}>
          #{row.suggested_rank}
          {conf != null && (
            <span className={`${styles.actionCardConf} ${confidenceTone(conf)}`}>
              {Math.round(conf * 100)}%
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className={styles.proposalTabClose}
        title="Negeer dit voorstel"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); onReject(row) }}
      >
        ✕
      </button>
    </div>
  )
}

function ProposalPreview({ row, catalogRow, mail, onAccept, onOpenEditor, busy }) {
  const slug = row.action_slug
  const category = catalogRow?.category || slug?.split('.')?.[0] || 'action'
  const displayName = catalogRow?.display_name || slug
  const icon = CATEGORY_ICONS[category] || '•'
  const detail = payloadLine(slug, row.payload, catalogRow)
  const reasoning = row.classifier_reasoning
  const isDelegate = category === 'delegate'

  // Reply: toon de specifieke variant inline (body + subject preview)
  // i.p.v. de DraftEditor parallel te laten staan. Klik 'Bewerken' om alsnog
  // de full editor open te klappen.
  if (category === 'reply') {
    const variantIdx = Number.isInteger(row.payload?.variant_index) ? row.payload.variant_index : 0
    const variants = Array.isArray(mail?.draft_variants) ? mail.draft_variants : []
    const variant = variants[variantIdx] || variants[0] || null
    const subject = variant?.subject || mail?.draft_subject || `RE: ${mail?.subject || ''}`
    const body = variant?.body || mail?.draft_body || ''
    const tone = variant?.tone || variant?.label || null

    return (
      <div className={styles.proposalPreview}>
        <div className={styles.proposalPreviewHead}>
          <span className={styles.actionCardIcon} aria-hidden>{icon}</span>
          <strong>{displayName}</strong>
          {tone && <span className={styles.proposalPreviewDetail}>toon: {tone}</span>}
        </div>
        {reasoning && <div className={styles.actionCardReason}>{reasoning}</div>}
        <div className={styles.replyPreviewBox}>
          <div className={styles.replyPreviewSubject}>
            <span className={styles.proposalPreviewLabel}>Onderwerp</span>
            <span>{subject}</span>
          </div>
          <pre className={styles.replyPreviewBody}>{body || '(nog geen draft-body — open Bewerken)'}</pre>
        </div>
        <div className={styles.proposalPreviewBtnRow}>
          <button
            type="button"
            className={`${styles.actionCardBtn} ${styles.actionCardBtnAccept}`}
            disabled={busy}
            title="Verzend deze reply als Outlook-draft"
            onClick={() => onAccept(row)}
          >
            {busy === 'accept' ? '…' : '✓ Verzenden'}
          </button>
          <button
            type="button"
            className={styles.actionCardBtn}
            disabled={busy}
            title="Open de volledige draft-editor om subject + body te bewerken"
            onClick={onOpenEditor}
          >
            ✏ Bewerken
          </button>
        </div>
      </div>
    )
  }

  // Forward / File / Defer / Delegate / Schedule — grafische preview
  return (
    <div className={styles.proposalPreview}>
      <div className={styles.proposalPreviewHead}>
        <span className={styles.actionCardIcon} aria-hidden>{icon}</span>
        <strong>{displayName}</strong>
      </div>

      {category === 'forward' && (
        <div className={styles.proposalPreviewGraphic}>
          <span className={styles.proposalPreviewLabel}>Doorsturen naar</span>
          <span className={styles.proposalPreviewValue}>{row.payload?.to || catalogRow?.target_value || '—'}</span>
          {row.payload?.cover_text && (
            <>
              <span className={styles.proposalPreviewLabel}>Cover-tekst</span>
              <span className={styles.proposalPreviewValue}>{row.payload.cover_text}</span>
            </>
          )}
        </div>
      )}

      {category === 'file' && (
        <div className={styles.proposalPreviewGraphic}>
          <span className={styles.proposalPreviewLabel}>Verplaatsen naar</span>
          <span className={styles.proposalPreviewValue}>
            <code>{row.payload?.target_folder || catalogRow?.target_value || 'Archive'}</code>
          </span>
        </div>
      )}

      {category === 'defer' && (
        <div className={styles.proposalPreviewGraphic}>
          <span className={styles.proposalPreviewLabel}>Negeren / uitstellen</span>
          <span className={styles.proposalPreviewValue}>
            {row.payload?.reason || 'Geen reply, verplaats naar Archive'}
          </span>
        </div>
      )}

      {category === 'delegate' && (
        <div className={styles.proposalPreviewGraphic}>
          <span className={styles.proposalPreviewLabel}>Delegeren</span>
          <span className={styles.proposalPreviewValue}>
            {(row.payload?.system || 'Jira').toUpperCase()} {row.payload?.target || catalogRow?.target_value || 'LEMIND'}
          </span>
          <span className={styles.proposalPreviewLabel}>Status</span>
          <span className={styles.proposalPreviewValue}>⚠ Nog niet uitvoerbaar — Fase 2d</span>
        </div>
      )}

      {category === 'schedule' && (
        <div className={styles.proposalPreviewGraphic}>
          <span className={styles.proposalPreviewLabel}>Agenda-actie</span>
          <span className={styles.proposalPreviewValue}>{detail || '(geen detail)'}</span>
        </div>
      )}

      {reasoning && <div className={styles.actionCardReason}>{reasoning}</div>}

      <div className={styles.proposalPreviewBtnRow}>
        <button
          type="button"
          className={`${styles.actionCardBtn} ${styles.actionCardBtnAccept}`}
          disabled={busy || isDelegate}
          title={isDelegate ? 'Delegate is nog niet uitvoerbaar (Fase 2d)' : 'Voer deze actie uit'}
          onClick={() => onAccept(row)}
        >
          {busy === 'accept' ? '…' : '✓ Goedkeuren'}
        </button>
      </div>
    </div>
  )
}

function ActionProposals({ mail, mailId, onSelectedChange, onOpenEditor }) {
  const effMailId = mailId || mail?.mail_id
  const { proposals, catalog, loading, error, refetch } = useActionProposals(effMailId)
  const [busyId, setBusyId] = useState(null)
  const [selectedRank, setSelectedRank] = useState(1)

  // Reset selected naar rank 1 bij mail-wisseling (anders krijgt mail B
  // de rank-3-selectie van mail A).
  useEffect(() => { setSelectedRank(1) }, [effMailId])

  const catalogMap = useMemo(() => {
    const m = new Map()
    for (const c of catalog) m.set(c.slug, c)
    return m
  }, [catalog])

  const suggested = useMemo(
    () => proposals
      .filter(p => p.was_suggested && !p.outcome)
      .sort((a, b) => (a.suggested_rank || 99) - (b.suggested_rank || 99))
      .slice(0, 3),
    [proposals],
  )
  const historical = useMemo(
    () => proposals.filter(p => !p.was_suggested).slice(0, 3),
    [proposals],
  )

  // Selected proposal (default = rank 1, fallback eerste suggested, anders null)
  const selected = useMemo(() => {
    if (suggested.length === 0) return null
    return suggested.find(p => p.suggested_rank === selectedRank) || suggested[0]
  }, [suggested, selectedRank])

  // Rapporteer kind + hasProposals aan MailDetail.
  // hasProposals=null TIJDENS loading → MailDetail wacht (geen DraftEditor flicker).
  // hasProposals=false → echt geen voorstellen → DraftEditor (legacy) zichtbaar.
  // hasProposals=true → tabs + preview-pane neemt het over.
  useEffect(() => {
    if (!onSelectedChange) return
    if (loading) {
      onSelectedChange({ kind: null, hasProposals: null })
      return
    }
    if (!selected) {
      onSelectedChange({ kind: null, hasProposals: false })
      return
    }
    const cat = catalogMap.get(selected.action_slug)?.category
                || selected.action_slug?.split('.')?.[0]
                || null
    onSelectedChange({ kind: cat, hasProposals: true })
  }, [loading, selected, catalogMap, onSelectedChange])

  const handleDecision = useCallback(async (row, outcome) => {
    setBusyId(row.id)
    try {
      const result = await submitDecision(row.id, outcome)
      if (result?.warning === 'delegate_pending_implementation') {
        showToast('Delegate is nog niet uitvoerbaar — Fase 2d', 'warning')
      } else if (outcome === 'accept') {
        const name = catalogMap.get(row.action_slug)?.display_name || row.action_slug
        showToast(`${name} goedgekeurd — uitvoering binnen 15 min`, 'success')
      } else {
        showToast(`Voorstel #${row.suggested_rank} genegeerd`, 'info')
      }
      // Als de afgewezen tab actief was, schakel naar eerstvolgende
      if (outcome === 'reject' && row.suggested_rank === selectedRank) {
        const next = suggested.find(p => p.id !== row.id)
        if (next) setSelectedRank(next.suggested_rank || 1)
      }
      refetch?.()
    } catch (e) {
      showToast(`Mislukt: ${e.message || String(e)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }, [catalogMap, refetch, selectedRank, suggested])

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
              Kies een voorstel · ✕ negeert · Goedkeuren voert binnen 15 min uit
            </span>
          </header>
          <div className={styles.proposalTabsRow} role="tablist">
            {suggested.map(row => (
              <ProposalTab
                key={row.id}
                row={row}
                catalogRow={catalogMap.get(row.action_slug)}
                isActive={selected?.id === row.id}
                onSelect={(r) => setSelectedRank(r.suggested_rank || 1)}
                onReject={(r) => handleDecision(r, 'reject')}
                busy={busyId === row.id}
              />
            ))}
          </div>
          {selected && (
            <ProposalPreview
              row={selected}
              catalogRow={catalogMap.get(selected.action_slug)}
              mail={mail}
              onAccept={(r) => handleDecision(r, 'accept')}
              onOpenEditor={onOpenEditor}
              busy={busyId === selected.id ? 'accept' : null}
            />
          )}
        </>
      )}

      {historical.length > 0 && (
        <>
          <header className={`${styles.actionProposalsHead} ${styles.actionProposalsHeadMt}`}>
            <h3 className={styles.actionProposalsTitle}>Eerder op deze mail</h3>
          </header>
          <div className={styles.actionCardsRow}>
            {historical.map(row => {
              const catalogRow = catalogMap.get(row.action_slug)
              const slug = row.action_slug
              const category = catalogRow?.category || slug?.split('.')?.[0] || 'action'
              const displayName = catalogRow?.display_name || slug
              const icon = CATEGORY_ICONS[category] || '•'
              const detail = payloadLine(slug, row.payload, catalogRow)
              const isBackfill = row.payload?.backfill_version != null
              const inferredFrom = row.payload?.inferred_from
              return (
                <div key={row.id} className={`${styles.actionCard} ${styles.actionCardCompact}`} data-decided="true">
                  <div className={styles.actionCardHead}>
                    <span className={styles.actionCardIcon} aria-hidden>{icon}</span>
                    <span className={styles.actionCardName}>{displayName}</span>
                    <span className={`${styles.actionCardConf} ${styles.outcomeManual}`}>
                      {isBackfill ? 'backfill' : 'historisch'}
                    </span>
                  </div>
                  {detail && <div className={styles.actionCardDetail}>{detail}</div>}
                  {isBackfill && inferredFrom && (
                    <div className={styles.actionCardReason}>
                      Afgeleid uit: <code>{inferredFrom}</code>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

export default ActionProposals

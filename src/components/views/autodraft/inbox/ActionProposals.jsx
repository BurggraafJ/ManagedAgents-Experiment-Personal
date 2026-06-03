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

// v3.1 — toont HOE een voorstel is bepaald: deterministische metadata-router
// vs AI-model, met tier wanneer notabel. Voedt zich met de eerder wél-opgehaalde
// maar nooit-getoonde velden classifier_source / tier / metadata_match.
function classifierMeta(row) {
  const src = row?.classifier_source
  const label = src === 'metadata_router' ? '⚡ Router'
              : src === 'sonnet'          ? '✦ AI'
              : src === 'deterministic'   ? '⚙ Regel'
              : null
  if (!label) return null
  const tier = row.tier && row.tier !== 'reasoned' ? ` · ${row.tier}` : ''
  let title = src === 'metadata_router'
    ? 'Deterministisch bepaald uit de mail-verrijking'
    : src === 'deterministic'
    ? 'Deterministisch ingevuld door de autofill-vangnet (geen model)'
    : 'Door het AI-model bepaald'
  const mm = row.metadata_match
  if (mm && typeof mm === 'object' && !Array.isArray(mm)) {
    const parts = Object.entries(mm)
      .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`)
    if (parts.length) title += ` — ${parts.join(', ')}`
  }
  return { label: `${label}${tier}`, title }
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

async function undoAutopilot(decisionId) {
  const { data, error } = await supabase.rpc('undo_autopilot_decision', {
    p_decision_id: decisionId,
  })
  if (error) throw error
  return data
}

function timeAgo(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'nu'
  if (m < 60) return `${m} min geleden`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}u geleden`
  return `${Math.floor(h / 24)}d geleden`
}

function undoWindowRemaining(undoUntil) {
  if (!undoUntil) return null
  const ms = new Date(undoUntil).getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600000)
  if (h >= 1) return `${h}u over`
  const m = Math.floor(ms / 60000)
  return `${m} min over`
}

function ProposalTab({ row, catalogRow, isActive, onSelect, onReject, busy }) {
  const slug = row.action_slug
  const category = catalogRow?.category || slug?.split('.')?.[0] || 'action'
  const displayName = catalogRow?.display_name || slug
  const icon = CATEGORY_ICONS[category] || '•'
  const conf = row.classifier_confidence
  const meta = classifierMeta(row)

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
          {meta && (
            <span className={styles.actionCardSource} title={meta.title}>{meta.label}</span>
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

function ProposalPreview({ row, catalogRow, onAccept, busy }) {
  const slug = row.action_slug
  const category = catalogRow?.category || slug?.split('.')?.[0] || 'action'
  const displayName = catalogRow?.display_name || slug
  const icon = CATEGORY_ICONS[category] || '•'
  const detail = payloadLine(slug, row.payload, catalogRow)
  const reasoning = row.classifier_reasoning
  const isDelegate = category === 'delegate'
  const meta = classifierMeta(row)

  // Reply (+ schedule = reply-met-slots): GEEN aparte preview-pane. De
  // bestaande DraftEditor komt onder de tabs in MailDetail zodat Jelle de
  // (slot-)draft kan redigeren en versturen. ActionProposals signaleert via
  // onSelectedChange welke variant_index actief moet zijn.
  if (category === 'reply' || category === 'schedule') return null

  // Forward / File / Defer / Delegate / Schedule — grafische preview
  return (
    <div className={styles.proposalPreview}>
      <div className={styles.proposalPreviewHead}>
        <span className={styles.actionCardIcon} aria-hidden>{icon}</span>
        <strong>{displayName}</strong>
        {meta && (
          <span className={styles.proposalPreviewDetail} title={meta.title}>{meta.label}</span>
        )}
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

function ActionProposals({ mail, mailId, onSelectedChange }) {
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

  // v3 — autopilot mode: rij met outcome='autopilot' en undo_until in toekomst
  const autopilotActive = useMemo(
    () => proposals.find(p =>
      p.outcome === 'autopilot' &&
      p.undo_until &&
      new Date(p.undo_until) > new Date() &&
      !p.execution_result?.undone,
    ),
    [proposals],
  )

  const suggested = useMemo(
    () => proposals
      .filter(p => p.was_suggested && !p.outcome)
      // v3.1 (besluit F) — delegate verbergen tot Jira-config klaar is.
      // Slug-prefix is robuust ook zonder catalog (delegate.* → 'delegate').
      .filter(p => !p.action_slug?.startsWith('delegate.'))
      .sort((a, b) => (a.suggested_rank || 99) - (b.suggested_rank || 99))
      .slice(0, 3),
    [proposals],
  )

  // v3 — one-click mode: precies 1 suggested rij met tier='one-click'
  const isOneClickMode = useMemo(
    () => suggested.length === 1 && suggested[0]?.tier === 'one-click',
    [suggested],
  )

  const historical = useMemo(
    () => proposals.filter(p => !p.was_suggested && p.id !== autopilotActive?.id).slice(0, 3),
    [proposals, autopilotActive],
  )

  // Selected proposal (default = rank 1, fallback eerste suggested, anders null)
  const selected = useMemo(() => {
    if (suggested.length === 0) return null
    return suggested.find(p => p.suggested_rank === selectedRank) || suggested[0]
  }, [suggested, selectedRank])

  // Rapporteer aan MailDetail. Drie velden:
  //   kind         = 'reply'|'forward'|'file'|'defer'|'delegate'|'schedule'|null
  //   hasProposals = null (loading) | false (geen voorstellen) | true (≥1)
  //   variantIndex = bij kind='reply' welke variant uit autodraft_mails te tonen
  // DraftEditor logica in MailDetail: render bij kind==='reply' OR
  // hasProposals===false. Bij andere kinds = grafische preview-pane.
  useEffect(() => {
    if (!onSelectedChange) return
    if (loading) {
      onSelectedChange({ kind: null, hasProposals: null, variantIndex: null, replyVariants: null })
      return
    }
    if (!selected) {
      onSelectedChange({ kind: null, hasProposals: false, variantIndex: null, replyVariants: null })
      return
    }
    const cat = catalogMap.get(selected.action_slug)?.category
                || selected.action_slug?.split('.')?.[0]
                || null
    const vi = Number.isInteger(selected.payload?.variant_index)
                ? selected.payload.variant_index
                : null
    // v3.1 één-grootboek — bij een reply-actie kan de draft nu in de payload
    // zitten (skill v18 + autofill-cron embedden subject/body/variants). Geef
    // die varianten door zodat DraftEditor uit de payload kan lezen i.p.v.
    // autodraft_mails.draft_variants. Backward-compat: payload zonder
    // `variants` → MailDetail valt terug op mail.draft_variants.
    const pv = selected.payload?.variants
    const replyVariants = ((cat === 'reply' || cat === 'schedule') && Array.isArray(pv) && pv.length > 0) ? pv : null
    onSelectedChange({ kind: cat, hasProposals: true, variantIndex: vi, replyVariants })
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

  const handleUndo = useCallback(async (row) => {
    setBusyId(row.id)
    try {
      const result = await undoAutopilot(row.id)
      if (result?.ok) {
        showToast('Autopilot ongedaan gemaakt — actie wordt teruggedraaid', 'success')
      } else {
        showToast(`Undo mislukt: ${result?.error || 'onbekend'}`, 'error')
      }
      refetch?.()
    } catch (e) {
      showToast(`Undo-fout: ${e.message || String(e)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }, [refetch])

  if (!effMailId) return null
  // Tijdens loading: render NIETS (geen 'Acties laden…' text). Voorkomt
  // flicker waarbij text 1 frame zichtbaar is en daarna content of niets
  // komt — Jelle's "element verschijnt 1 sec en verdwijnt" bug.
  if (loading) return null
  if (error)   return <div className={styles.actionProposalsError}>Acties laden mislukt: {error}</div>
  if (!autopilotActive && suggested.length === 0 && historical.length === 0) return null

  // v3 — Autopilot-mode: render compacte pill met undo
  if (autopilotActive) {
    const catalogRow = catalogMap.get(autopilotActive.action_slug)
    const displayName = catalogRow?.display_name || autopilotActive.action_slug
    const category = catalogRow?.category || autopilotActive.action_slug?.split('.')?.[0]
    const icon = CATEGORY_ICONS[category] || '•'
    const remaining = undoWindowRemaining(autopilotActive.undo_until)
    return (
      <section className={`${styles.actionProposals} ${styles.actionProposalsAutopilot}`}>
        <div className={styles.autopilotPill}>
          <span className={styles.actionCardIcon} aria-hidden>{icon}</span>
          <div className={styles.autopilotBody}>
            <strong>Afgehandeld door AutoDraft</strong>
            <span>{displayName} · {timeAgo(autopilotActive.executed_at || autopilotActive.decided_at)}</span>
          </div>
          {remaining && (
            <button
              type="button"
              className={styles.autopilotUndoBtn}
              disabled={busyId === autopilotActive.id}
              onClick={() => handleUndo(autopilotActive)}
              title={`Undo-window ${remaining}`}
            >
              ↩ Ongedaan maken
            </button>
          )}
        </div>
      </section>
    )
  }

  // v3 — One-click-mode: render één kaart + groene knop (geen tabs)
  if (isOneClickMode) {
    const row = suggested[0]
    const catalogRow = catalogMap.get(row.action_slug)
    const category = catalogRow?.category || row.action_slug?.split('.')?.[0]
    const meta = classifierMeta(row)
    return (
      <section className={`${styles.actionProposals} ${styles.actionProposalsOneClick}`}>
        <header className={styles.actionProposalsHead}>
          <h3 className={styles.actionProposalsTitle}>Voorgestelde actie</h3>
          <span className={styles.actionProposalsSub} title={meta?.title}>
            {Math.round((row.classifier_confidence || 0) * 100)}% zeker{meta ? ` · ${meta.label}` : ''} · klik om uit te voeren · ✕ voor andere optie
          </span>
        </header>
        {category === 'reply' ? (
          <div className={styles.oneClickReplyHint}>
            <strong>{catalogRow?.display_name || row.action_slug}</strong>
            <span> — bewerk hieronder in de draft-editor en klik Verzenden</span>
          </div>
        ) : (
          <ProposalPreview
            row={row}
            catalogRow={catalogRow}
            onAccept={(r) => handleDecision(r, 'accept')}
            busy={busyId === row.id ? 'accept' : null}
          />
        )}
        <div className={styles.oneClickBtnRow}>
          <button
            type="button"
            className={styles.oneClickRejectBtn}
            disabled={busyId === row.id}
            onClick={() => handleDecision(row, 'reject')}
          >
            ✕ Andere optie
          </button>
        </div>
      </section>
    )
  }

  // Default — reasoned 3-tab UI (legacy)
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
              onAccept={(r) => handleDecision(r, 'accept')}
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

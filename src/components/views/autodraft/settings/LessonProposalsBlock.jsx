import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import styles from '../autodraft.module.css'

export default function LessonProposalsBlock({ proposals, categories }) {
  return (
    <section className="va-block ad-proposal-block">
      <div className={`va-block__head ${styles.cursorDefault}`}>
        <span className="va-block__caret">·</span>
        <span className="va-block__title">🧠 Nieuwe schrijfregel voorgesteld</span>
        <span className="va-block__count">{proposals.length}</span>
      </div>
      <div className="va-block__body">
        {proposals.map(p => <LessonProposalCard key={p.id} proposal={p} categories={categories} />)}
      </div>
    </section>
  )
}

function LessonProposalCard({ proposal, categories }) {
  const [text, setText] = useState(proposal.proposed_lesson)
  const [busy, setBusy] = useState(null)
  const [err, setErr]   = useState(null)
  const [rejectReason, setRR] = useState('')
  const [mode, setMode] = useState(null)

  const scopeLabel = proposal.scope === 'category'
    ? (categories.find(c => c.category_key === proposal.scope_value)?.label || proposal.scope_value)
    : proposal.scope === 'domain' ? `@${proposal.scope_value}`
    : proposal.scope === 'sender' ? proposal.scope_value
    : 'globaal'

  async function accept() {
    setBusy('accept'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('accept_autodraft_lesson_proposal', {
        p_proposal_id: proposal.id,
        p_lesson_override: text,
        p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  async function reject() {
    setBusy('reject'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('reject_autodraft_lesson_proposal', {
        p_proposal_id: proposal.id, p_reason: rejectReason || null, p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <div className="ad-proposal">
      <div className="ad-proposal__head">
        <span className={`ad-row__cat ${styles.scopePillSoft}`}>{scopeLabel}</span>
        <span className={`muted ${styles.proposalDate}`}>
          {new Date(proposal.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} className="ad-textarea" />
      {proposal.evidence && (
        <div className={`muted ${styles.proposalEvidence}`}>
          <span className="ad-reasoning__label">Bewijs:</span> {proposal.evidence}
        </div>
      )}
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={!!busy || !text.trim()} onClick={accept}>
          {busy === 'accept' ? 'Accepteren…' : '✓ Voeg regel toe'}
        </button>
        <button className="btn btn--ghost" disabled={!!busy} onClick={() => setMode(m => m === 'reject' ? null : 'reject')}>
          ✕ Afwijzen
        </button>
        {err && <span className={styles.statusErr}>⚠ {err}</span>}
      </div>
      {mode === 'reject' && (
        <div className="ad-amend">
          <textarea value={rejectReason} onChange={e => setRR(e.target.value)} rows={2}
            className="ad-textarea" placeholder="reden (optioneel)" />
          <div className={styles.actionsRow} style={{ marginTop: 8 }}>
            <button className="btn btn--accent" disabled={!!busy} onClick={reject}>Bevestig</button>
            <button className="btn btn--ghost" onClick={() => setMode(null)} disabled={!!busy}>Annuleer</button>
          </div>
        </div>
      )}
    </div>
  )
}

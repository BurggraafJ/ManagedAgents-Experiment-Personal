import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import styles from '../autodraft.module.css'

export default function CategoryProposalsBlock({ proposals }) {
  return (
    <section className="va-block ad-proposal-block">
      <div className={`va-block__head ${styles.cursorDefault}`}>
        <span className="va-block__caret">·</span>
        <span className="va-block__title">✨ Nieuwe categorie voorgesteld</span>
        <span className="va-block__count">{proposals.length}</span>
      </div>
      <div className="va-block__body">
        {proposals.map(p => <CategoryProposalCard key={p.id} proposal={p} />)}
      </div>
    </section>
  )
}

function CategoryProposalCard({ proposal }) {
  const [keyVal, setKeyVal]     = useState(proposal.proposed_key)
  const [label, setLabel]       = useState(proposal.proposed_label)
  const [instr, setInstr]       = useState(proposal.proposed_instructions || '')
  const [folder, setFolder]     = useState(proposal.proposed_folder || '')
  const [busy, setBusy]         = useState(null)
  const [err, setErr]           = useState(null)
  const [mode, setMode]         = useState(null)
  const [rejectReason, setRR]   = useState('')

  async function accept() {
    setBusy('accept'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('accept_autodraft_category_proposal', {
        p_proposal_id: proposal.id,
        p_category_key_override: keyVal,
        p_label_override: label,
        p_instructions_override: instr,
        p_folder_override: folder,
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
      const { data, error } = await supabase.rpc('reject_autodraft_category_proposal', {
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
        <strong>{proposal.proposed_label}</strong>
        <span className={`muted ${styles.proposalDate}`}>
          {new Date(proposal.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {proposal.reasoning && (
        <div className="ad-proposal__reasoning">
          <span className="ad-reasoning__label">Waarom:</span> {proposal.reasoning}
        </div>
      )}
      {proposal.example_subjects?.length > 0 && (
        <ul className="ad-proposal__examples">
          {proposal.example_subjects.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      <div className="ad-proposal__edit">
        <label><span>key</span><input value={keyVal} onChange={e => setKeyVal(e.target.value)} className="ad-input" /></label>
        <label><span>label</span><input value={label} onChange={e => setLabel(e.target.value)} className="ad-input" /></label>
        <label className={styles.gridFullCol}>
          <span>instructies</span>
          <textarea value={instr} onChange={e => setInstr(e.target.value)} rows={3} className="ad-textarea" />
        </label>
        <label><span>map</span><input value={folder} onChange={e => setFolder(e.target.value)} className="ad-input" /></label>
      </div>
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={!!busy} onClick={accept}>
          {busy === 'accept' ? 'Accepteren…' : '✓ Accepteer'}
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

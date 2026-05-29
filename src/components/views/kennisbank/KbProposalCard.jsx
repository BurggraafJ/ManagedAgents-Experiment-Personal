import { useState } from 'react'
import DOMPurify from 'dompurify'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'

// Minimale markdown -> veilige HTML (geen extra dependency). Dekt headings,
// bold, inline-code, lijsten en blockquotes — de vorm die de curator gebruikt.
function mdToHtml(md) {
  if (!md) return ''
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
  const lines = String(md).split(/\r?\n/)
  let html = '', inList = false, inBq = false
  const closeList = () => { if (inList) { html += '</ul>'; inList = false } }
  const closeBq = () => { if (inBq) { html += '</blockquote>'; inBq = false } }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); closeBq(); continue }
    let m
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) { closeList(); closeBq(); html += `<h4>${inline(m[1])}</h4>`; continue }
    if ((m = line.match(/^>\s?(.*)$/))) { closeList(); if (!inBq) { html += '<blockquote>'; inBq = true } html += `<p>${inline(m[1])}</p>`; continue }
    if ((m = line.match(/^[-*]\s+(.*)$/))) { closeBq(); if (!inList) { html += '<ul>'; inList = true } html += `<li>${inline(m[1])}</li>`; continue }
    if ((m = line.match(/^\d+\.\s+(.*)$/))) { closeBq(); if (!inList) { html += '<ul>'; inList = true } html += `<li>${inline(m[1])}</li>`; continue }
    closeList(); closeBq(); html += `<p>${inline(line)}</p>`
  }
  closeList(); closeBq()
  return DOMPurify.sanitize(html)
}

const TYPE_LABEL = { how_to: 'How-to', beleid: 'Beleid', referentie: 'Referentie', troubleshooting: 'Troubleshooting', faq: 'FAQ', besluit_rationale: 'Besluit' }
const AUD_LABEL = { intern: 'Intern', klant: 'Klant', partner: 'Partner', publiek: 'Publiek' }

export default function KbProposalCard({ proposal: p, categoryLabel, onDone }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('idle') // idle | amend | reject
  const [amendText, setAmendText] = useState('')
  const [rejectText, setRejectText] = useState('')
  const [open, setOpen] = useState(false)

  const answered = p?.evidence?.answered === true
  const bronvragen = p?.evidence?.vragen ?? (p?.source_signal_ids?.length || 1)
  const conf = typeof p.confidence === 'number' ? Math.round(p.confidence * 100) : null

  async function run(rpc, args, okMsg) {
    if (busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc(rpc, args)
      if (error) throw error
      if (data && data.ok === false) throw new Error(data.reason || 'mislukt')
      showToast(okMsg)
      if (onDone) onDone()
    } catch (e) {
      showToast({ kind: 'error', message: 'Mislukt', detail: e?.message || String(e) })
      setBusy(false)
    }
  }

  return (
    <article className="knb-card">
      <header className="knb-card__head">
        <div className="knb-card__badges">
          <span className="knb-chip knb-chip--cat">{categoryLabel || p.kb_category}</span>
          {p.article_type && <span className="knb-chip">{TYPE_LABEL[p.article_type] || p.article_type}</span>}
          <span className="knb-chip">{AUD_LABEL[p.audience] || p.audience || 'Intern'}</span>
          <span className={`knb-chip ${answered ? 'knb-chip--ok' : 'knb-chip--todo'}`}>
            {answered ? '✓ Antwoord' : 'TE BEVESTIGEN'}
          </span>
          {bronvragen > 1 && <span className="knb-chip knb-chip--soft">{bronvragen} bronvragen</span>}
          {conf != null && <span className="knb-chip knb-chip--soft">{conf}%</span>}
        </div>
        <h3 className="knb-card__title">{p.title}</h3>
        {p.proposed_summary && <p className="knb-card__summary">{p.proposed_summary}</p>}
      </header>

      <button type="button" className="knb-card__toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▾ Verberg artikel' : '▸ Lees het volledige artikel'}
      </button>

      {open && (
        <div className="knb-card__body" dangerouslySetInnerHTML={{ __html: mdToHtml(p.proposed_body) }} />
      )}

      {p.rationale && <p className="knb-card__rationale">💡 {p.rationale}</p>}

      {mode === 'idle' && (
        <div className="knb-card__actions">
          <button className="knb-btn knb-btn--ok" disabled={busy}
            onClick={() => run('approve_kb_article_proposal', { p_proposal_id: p.id }, 'Artikel goedgekeurd ✓')}>
            ✓ Goedkeuren
          </button>
          <button className="knb-btn" disabled={busy} onClick={() => setMode('amend')}>✎ Aanpassen</button>
          <button className="knb-btn knb-btn--danger" disabled={busy} onClick={() => setMode('reject')}>✕ Afwijzen</button>
        </div>
      )}

      {mode === 'amend' && (
        <div className="knb-card__form">
          <label className="knb-card__label">Wat moet er anders? De kennisbank-curator herschrijft het artikel.</label>
          <textarea className="knb-textarea" rows={3} value={amendText} autoFocus
            onChange={e => setAmendText(e.target.value)}
            placeholder="Bv. 'Voeg toe dat de eerste extra gebruiker gratis is' of 'Korter en klantvriendelijker'." />
          <div className="knb-card__actions">
            <button className="knb-btn knb-btn--ok" disabled={busy || !amendText.trim()}
              onClick={() => run('amend_kb_article_proposal', { p_proposal_id: p.id, p_amendment: amendText.trim() }, 'Aanpassing genoteerd — wordt herschreven')}>
              Verstuur aanpassing
            </button>
            <button className="knb-btn" disabled={busy} onClick={() => { setMode('idle'); setAmendText('') }}>Annuleer</button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="knb-card__form">
          <label className="knb-card__label">Reden (optioneel) — helpt dit type voorstel te vermijden.</label>
          <textarea className="knb-textarea" rows={2} value={rejectText} autoFocus
            onChange={e => setRejectText(e.target.value)}
            placeholder="Bv. 'Te specifiek / eenmalig' of 'Hoort niet in de kennisbank'." />
          <div className="knb-card__actions">
            <button className="knb-btn knb-btn--danger" disabled={busy}
              onClick={() => run('reject_kb_article_proposal', { p_proposal_id: p.id, p_reason: rejectText.trim() || null }, 'Voorstel afgewezen')}>
              Definitief afwijzen
            </button>
            <button className="knb-btn" disabled={busy} onClick={() => { setMode('idle'); setRejectText('') }}>Annuleer</button>
          </div>
        </div>
      )}
    </article>
  )
}

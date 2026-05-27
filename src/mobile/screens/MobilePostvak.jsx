import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAutoDraft } from '../../hooks/useAutoDraft'
import MIcon from '../MIcon'

// MobilePostvak — mobiele inbox. Geport uit app/mobile-postvak.jsx.
// Hergebruikt useAutoDraft() (autodraft_mails) + de echte beslis-RPC
// submit_autodraft_decision (send = Outlook-concept, ignore = verplaats,
// amend = herschrijf). Desktop AutoDraftView blijft onaangeroerd.
const OPEN = ['pending', 'amended']
const TABS = [
  { key: 'for_you', label: 'Voor jou' },
  { key: 'not_for_you', label: 'Niet voor jou' },
  { key: 'done', label: 'Afgehandeld' },
]

// Velden defensief lezen — autodraft_mails-kolomnamen kunnen variëren.
const fromName = (m) => m.from_name || m.sender_name || m.sender || m.from_email || '—'
const subjectOf = (m) => m.subject || '(geen onderwerp)'
const snippetOf = (m) => m.summary || m.body_preview || m.snippet || m.preview || ''
const draftBodyOf = (m) => m.draft_body || m.draft || m.reply_draft || ''
const draftSubjOf = (m) => m.draft_subject || subjectOf(m)
const receivedOf = (m) => m.received_at || m.created_at
const initials = (n) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()

function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 3600000
  if (diff < 1) return `${Math.max(1, Math.round(diff * 60))}m`
  if (diff < 24) return `${Math.round(diff)}u`
  if (diff < 48) return 'gist'
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function MobilePostvak() {
  const { mails, categories, refresh } = useAutoDraft()
  const [tab, setTab] = useState('for_you')
  const [openId, setOpenId] = useState(null)
  const [handled, setHandled] = useState(() => new Set())

  const catLabel = useMemo(() => {
    const m = new Map()
    for (const c of (categories || [])) m.set(c.key || c.category_key, c.label || c.name)
    return m
  }, [categories])

  const counts = useMemo(() => {
    const c = { for_you: 0, not_for_you: 0, done: 0 }
    for (const m of (mails || [])) {
      if (handled.has(m.mail_id)) continue
      if (OPEN.includes(m.status)) {
        if (m.audience === 'for_you') c.for_you++
        else if (m.audience === 'not_for_you') c.not_for_you++
      } else c.done++
    }
    return c
  }, [mails, handled])

  const list = useMemo(() => {
    const rows = (mails || []).filter(m => {
      if (handled.has(m.mail_id)) return false
      if (tab === 'done') return !OPEN.includes(m.status)
      return OPEN.includes(m.status) && m.audience === tab
    })
    return rows.sort((a, b) => new Date(receivedOf(b)) - new Date(receivedOf(a))).slice(0, 80)
  }, [mails, tab, handled])

  const openMail = list.find(m => m.mail_id === openId) || (mails || []).find(m => m.mail_id === openId) || null

  const onHandled = (id) => { setHandled(prev => new Set(prev).add(id)); setOpenId(null); refresh() }

  return (
    <div className="m-dash">
      <header className="m-tk__head">
        <div className="m-tk__head-top">
          <div className="m-tk__eyebrow">WERKRUIMTE<span>Postvak</span></div>
        </div>
        <h1 className="m-greet m-adm__title">{counts.for_you} {counts.for_you === 1 ? 'mail wacht' : 'mails wachten'}</h1>
        <div className="m-greet-sub">{counts.not_for_you} niet voor jou · {counts.done} afgehandeld</div>
        <div className="m-tabpills">
          {TABS.map(t => (
            <button key={t.key} type="button" className={`m-tabpill ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}<span className="m-tabpill__cnt">{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="m-pv__body">
        {list.length === 0 ? (
          <div className="m-tl__empty">Geen mails in deze lijst.</div>
        ) : (
          list.map(m => {
            const cat = catLabel.get(m.category) || m.category || null
            return (
              <button key={m.mail_id} type="button" className={`m-thread ${OPEN.includes(m.status) ? 'is-unread' : ''}`} onClick={() => setOpenId(m.mail_id)}>
                <div className="m-thread__avatar">{initials(fromName(m))}</div>
                <div className="m-thread__main">
                  <div className="m-thread__top">
                    <span className="m-thread__who">{fromName(m)}</span>
                    <span className="m-thread__time">{timeAgo(receivedOf(m))}</span>
                  </div>
                  <div className="m-thread__subject">{subjectOf(m)}</div>
                  {snippetOf(m) && <div className="m-thread__snippet">{snippetOf(m)}</div>}
                  <div className="m-thread__chips">
                    {cat && <span className="m-thread__cat">{cat}</span>}
                    {draftBodyOf(m) && OPEN.includes(m.status) && <span className="m-thread__draft"><span className="m-thread__dot" />Draft klaar</span>}
                  </div>
                </div>
                <span className="m-thread__chev"><MIcon name="chevron" size={14} /></span>
              </button>
            )
          })
        )}
      </div>

      {openMail && <MailDetail mail={openMail} catLabel={catLabel} onClose={() => setOpenId(null)} onHandled={onHandled} />}
    </div>
  )
}

function MailDetail({ mail, catLabel, onClose, onHandled }) {
  const [busy, setBusy] = useState(null)   // 'send' | 'ignore' | 'amend'
  const [amend, setAmend] = useState(false)
  const [amendText, setAmendText] = useState('')
  const [err, setErr] = useState(null)
  const draft = draftBodyOf(mail)
  const cat = catLabel.get(mail.category) || mail.category

  const decide = async (action, extra = {}) => {
    setBusy(action); setErr(null)
    try {
      const { data, error } = await supabase.rpc('submit_autodraft_decision', { p_mail_id: mail.mail_id, p_action: action, ...extra })
      if (error || (data && data.ok === false)) { setErr((error?.message) || data?.reason || 'mislukt'); setBusy(null); return }
      onHandled(mail.mail_id)
    } catch (e) { setErr(String(e.message || e)); setBusy(null) }
  }

  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-mailsheet" role="dialog" aria-modal="true">
        <div className="m-mailsheet__head">
          <button type="button" className="m-iconbtn" onClick={onClose} aria-label="Terug"><MIcon name="chevron" size={18} /></button>
          <span className="m-mailsheet__crumb">{fromName(mail)}</span>
          <span style={{ width: 36 }} />
        </div>
        <div className="m-mailsheet__body">
          <div className="m-thread__chips" style={{ marginBottom: 6 }}>
            {cat && <span className="m-catpill">{cat}</span>}
          </div>
          <h1 className="m-mailsheet__subject">{subjectOf(mail)}</h1>
          <div className="m-mailsheet__from">
            <div className="m-thread__avatar">{initials(fromName(mail))}</div>
            <div className="m-mailsheet__fromtxt">
              <div className="m-mailsheet__fromname">{fromName(mail)}</div>
              <div className="m-mailsheet__frommail">{mail.from_email || ''}</div>
            </div>
          </div>
          {snippetOf(mail) && <div className="m-mailsheet__mail">{snippetOf(mail)}</div>}

          {draft ? (
            <div className="m-draft">
              <div className="m-draft__head"><span className="m-draft__dot" />Concept van Maestro<span className="m-draft__hint">klaar voor review</span></div>
              {draftSubjOf(mail) && <div className="m-draft__subj">{draftSubjOf(mail)}</div>}
              <div className="m-draft__body">{draft}</div>
            </div>
          ) : (
            <div className="m-tl__empty" style={{ marginTop: 12 }}>Geen concept — Maestro stelt voor te verplaatsen.</div>
          )}

          {amend && (
            <div className="m-feedback">
              <textarea className="m-feedback__input" rows={3} autoFocus value={amendText}
                onChange={(e) => setAmendText(e.target.value)} placeholder="Hoe moet Maestro 't concept aanpassen?" />
            </div>
          )}
          {err && <div className="m-quickadd__err">{err}</div>}
        </div>

        <div className="m-mailsheet__actions">
          {amend ? (
            <>
              <button type="button" className="m-admbtn" onClick={() => { setAmend(false); setAmendText('') }} disabled={!!busy}>Annuleer</button>
              <button type="button" className="m-admbtn m-admbtn--primary" disabled={!!busy || !amendText.trim()}
                onClick={() => decide('amend', { p_amend_text: amendText.trim() })}>
                {busy === 'amend' ? 'Bezig…' : '↻ Stuur aanpassing'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="m-admbtn m-admbtn--icon" disabled={!!busy} aria-label="Negeer/verplaats"
                onClick={() => decide('ignore', mail.target_folder ? { p_target_folder: mail.target_folder } : {})}>
                <MIcon name="close" size={18} />
              </button>
              <button type="button" className="m-admbtn" disabled={!!busy} onClick={() => setAmend(true)}>Bewerk</button>
              <button type="button" className="m-admbtn m-admbtn--primary" disabled={!!busy || !draft}
                onClick={() => decide('send')}>
                <MIcon name="check" size={16} color="#fff" stroke={2.2} /> {busy === 'send' ? 'Bezig…' : 'Verstuur concept'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

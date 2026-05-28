import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAutoDraft } from '../../hooks/useAutoDraft'
import MIcon from '../MIcon'

// MobilePostvak — mobiele inbox. Geport uit app/mobile-postvak.jsx.
// Hergebruikt useAutoDraft() (autodraft_mails, draft_variants) + de echte
// beslis-RPC submit_autodraft_decision (zelfde params als desktop MailDetail:
// p_final_body, p_chosen_variant_index/label, p_decision_kind). Desktop
// AutoDraftView blijft onaangeroerd.
const OPEN = ['pending', 'amended']
const TABS = [
  { key: 'for_you', label: 'Voor jou' },
  { key: 'not_for_you', label: 'Niet voor jou' },
  { key: 'done', label: 'Afgehandeld' },
]

const fromName = (m) => m.from_name || m.sender_name || m.sender || m.from_email || '—'
const subjectOf = (m) => m.subject || '(geen onderwerp)'
const snippetOf = (m) => m.summary || m.body_preview || m.snippet || m.preview || ''
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
  const { mails, categories, refresh, loading } = useAutoDraft()
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

  const openMail = (mails || []).find(m => m.mail_id === openId) || null
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
        {(mails || []).length === 0 && loading ? (
          <div className="m-skel-list">{[0, 1, 2, 3, 4].map(i => <div key={i} className="m-skel m-skel--thread" />)}</div>
        ) : list.length === 0 ? (
          <div className="m-tl__empty">Geen mails in deze lijst.</div>
        ) : (
          list.map(m => {
            const cat = catLabel.get(m.category) || m.category || null
            const variants = Array.isArray(m.draft_variants) ? m.draft_variants : []
            const hasDraft = variants.length > 0 || m.draft_body
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
                    {hasDraft && OPEN.includes(m.status) && (
                      <span className="m-thread__draft">
                        <span className="m-thread__dot" />
                        {variants.length > 1 ? `${variants.length} concepten` : 'Draft klaar'}
                      </span>
                    )}
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
  const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
  const initialIdx = Math.max(0, Math.min(mail.selected_variant_index || 0, Math.max(0, variants.length - 1)))
  const initialBody = (variants[initialIdx]?.body) || mail.draft_body || ''
  const initialSubject = (variants[initialIdx]?.subject) || mail.draft_subject || subjectOf(mail)

  const [variantIdx, setVariantIdx] = useState(initialIdx)
  const [draftBody, setDraftBody] = useState(initialBody)
  const [draftSubject, setDraftSubject] = useState(initialSubject)
  const [mode, setMode] = useState(null)   // null | 'amend'
  const [amendText, setAmendText] = useState('')
  const [busy, setBusy] = useState(null)   // 'send' | 'amend' | 'ignore'
  const [err, setErr] = useState(null)
  const cat = catLabel.get(mail.category) || mail.category

  // iOS-toetsenbord: til de sheet via visualViewport + verberg de tab bar + lock
  // achtergrond. Zelfde mechaniek als de Nieuwe-taak sheet.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('m-modal-open')
    const vv = window.visualViewport
    const apply = () => {
      if (!vv) return
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      root.style.setProperty('--m-kb', `${kb}px`)
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      root.style.setProperty('--m-kb', '0px')
      root.classList.remove('m-modal-open')
    }
  }, [])

  // Variant-wissel: zet body/subject vanuit gekozen variant + best-effort persist.
  const pickVariant = (idx) => {
    if (idx < 0 || idx >= variants.length) return
    const v = variants[idx]
    setVariantIdx(idx)
    if (typeof v?.subject === 'string') setDraftSubject(v.subject)
    if (typeof v?.body === 'string') setDraftBody(v.body)
    supabase.rpc('set_autodraft_variant', { p_mail_id: mail.mail_id, p_variant_index: idx }).then(null, () => { /* silent */ })
  }

  const decide = async (action) => {
    setBusy(action); setErr(null)
    const chosen = variants.length > 0 ? Math.max(0, Math.min(variantIdx, variants.length - 1)) : null
    const params = {
      p_mail_id: mail.mail_id,
      p_action: action,
      p_amend: action === 'amend' ? amendText.trim() : null,
      p_final_subject: action === 'send' ? draftSubject : null,
      p_final_body: action === 'send' ? draftBody : null,
      p_target_folder: action === 'ignore' ? (mail.target_folder || null) : null,
      p_decision_kind: action === 'ignore' ? 'mobile-ignore' : 'reply',
      p_final_to: null,
      p_chosen_variant_index: ['send', 'amend'].includes(action) ? chosen : null,
      p_chosen_variant_label: ['send', 'amend'].includes(action) && chosen != null ? (variants[chosen]?.label ?? null) : null,
    }
    try {
      const { data, error } = await supabase.rpc('submit_autodraft_decision', params)
      if (error || (data && data.ok === false)) { setErr((error?.message) || data?.reason || 'mislukt'); setBusy(null); return }
      onHandled(mail.mail_id)
    } catch (e) { setErr(String(e.message || e)); setBusy(null) }
  }

  const draft = draftBody

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

          {variants.length > 1 && (
            <div className="m-variants">
              {variants.map((v, i) => (
                <button key={i} type="button" className={`m-variant ${variantIdx === i ? 'is-active' : ''}`} onClick={() => pickVariant(i)}>
                  {v.label || v.tone || `Variant ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          {draft || variants.length > 0 ? (
            <div className="m-draft">
              <div className="m-draft__head">
                <span className="m-draft__dot" />Concept van Maestro
                <span className="m-draft__hint">{variants.length > 1 ? `${variants.length} varianten · bewerk gerust` : 'bewerk gerust'}</span>
              </div>
              {draftSubject && <div className="m-draft__subj">{draftSubject}</div>}
              <textarea
                className="m-draft__textarea"
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="Typ hier je antwoord…"
                rows={10}
              />
            </div>
          ) : (
            <div className="m-tl__empty" style={{ marginTop: 12 }}>Geen concept — Maestro stelt voor te verplaatsen.</div>
          )}

          {mode === 'amend' && (
            <div className="m-feedback">
              <div className="m-feedback__lbl">Aanwijzing voor Maestro</div>
              <textarea className="m-feedback__input" rows={3} autoFocus value={amendText}
                onChange={(e) => setAmendText(e.target.value)} placeholder="Bv. 'korter en zakelijker' of 'noem confidentiality eerst'" />
            </div>
          )}
          {err && <div className="m-quickadd__err">{err}</div>}
        </div>

        <div className="m-mailsheet__actions">
          {mode === 'amend' ? (
            <>
              <button type="button" className="m-admbtn" onClick={() => { setMode(null); setAmendText('') }} disabled={!!busy}>Annuleer</button>
              <button type="button" className="m-admbtn m-admbtn--primary" disabled={!!busy || !amendText.trim()} onClick={() => decide('amend')}>
                {busy === 'amend' ? 'Bezig…' : '↻ Stuur aanwijzing'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="m-admbtn m-admbtn--neg" disabled={!!busy} onClick={() => decide('ignore')}>
                <MIcon name="close" size={16} /> Negeer
              </button>
              <button type="button" className="m-admbtn" disabled={!!busy} onClick={() => setMode('amend')}>
                <MIcon name="refresh" size={14} /> Aanwijzing
              </button>
              <button type="button" className="m-admbtn m-admbtn--primary" disabled={!!busy || !draftBody.trim()} onClick={() => decide('send')}>
                <MIcon name="check" size={16} color="#fff" stroke={2.2} /> {busy === 'send' ? 'Bezig…' : 'Verstuur'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

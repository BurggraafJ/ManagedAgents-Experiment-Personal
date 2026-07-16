import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { sanitizeHtml } from '../../../lib/autodraft'
import { usePv2InlineImages } from '../../../hooks/usePv2Outlook'
import Ic from './pv2Icons'
import { Pv2Avatar } from './Pv2Row'
import Pv2Dock from './Pv2Dock'
import { catVars, msgTime, recipientEmails } from './pv2lib'

/* Pv2Detail — rechterpaneel (design: .detail): kop met onderwerp +
 * AI-confidence + tijdlijn/kennisbank-knoppen, de volledige conversatie
 * (nieuwste eerst, per bericht inklapbaar) en de Maestro-dock onderaan.
 * Bodies komen lazy uit mail_messages (truth-of-source). */

function bodyHtmlOf(m, fullBodies, inlineImages) {
  const full = fullBodies.get(m.id)
  const html = full?.body_html || m.body_html
  if (html) {
    let safe = sanitizeHtml(html)
    // Inline (cid:) afbeeldingen — vervangen door on-demand opgehaalde
    // data-URLs (outlook-live EF); niet-opgehaalde cid-imgs verbergen zodat
    // er geen kapotte plaatjes staan.
    if (safe.includes('cid:')) {
      const imgs = inlineImages || {}
      for (const [cid, dataUrl] of Object.entries(imgs)) {
        safe = safe.split(`cid:${cid}`).join(dataUrl)
      }
      safe = safe.replace(/<img[^>]+src="cid:[^"]*"[^>]*>/gi, '')
    }
    return { html: safe }
  }
  const text = full?.body_text || m.body_text || m.body_preview || ''
  return { text }
}

export default function Pv2Detail({
  mail, accent, catLabelText, activeMsg,
  mailMessages,
  onOpenRag, onOpenTimeline, onOpenKb,
  assistOpen, dockIn, openDock, closeDock, toggleDock,
  splitMode, onToggleSplit,
  markActioned, unmarkActioned,
  folderOptions, customerEmails,
  isFlagged, onToggleFlag, onSnooze, reminderStyle,
  signature, onEditSignature,
  portalEl,
}) {
  const scrollRef = useRef(null)
  const msgRefs = useRef({})
  const [closedMsgs, setClosedMsgs] = useState(() => new Set())
  const [fullBodies, setFullBodies] = useState(() => new Map())
  const { loadInlineImages, getInlineImages } = usePv2InlineImages()

  // Conversatie: alle mail_messages met dezelfde conversation_id (oud → nieuw);
  // valt terug op de mail zelf wanneer de thread (nog) niet gesynct is.
  const msgs = useMemo(() => {
    const conv = (mailMessages || [])
      .filter(m => mail.conversation_id && m.conversation_id === mail.conversation_id)
      .sort((a, b) => new Date(a.received_at) - new Date(b.received_at))
    if (conv.length > 0) return conv
    return [{
      id: mail.mail_id, from_name: mail.from_name, from_email: mail.from_email,
      to_recipients: mail.to_recipients, received_at: mail.received_at,
      body_preview: mail.body_preview, body_html: mail.body_html, body_text: mail.body_text,
      is_from_me: false,
    }]
  }, [mailMessages, mail])

  // Lazy full-bodies voor de conversatie (lijst-fetch heeft alleen previews).
  useEffect(() => {
    let cancelled = false
    const ids = msgs.map(m => m.id).filter(Boolean).slice(-20)
    if (ids.length === 0) return undefined
    supabase.from('mail_messages')
      .select('id,body_html,body_text,body_truncated')
      .in('id', ids)
      .then(({ data }) => {
        if (cancelled || !data) return
        setFullBodies(new Map(data.map(r => [r.id, r])))
      })
    return () => { cancelled = true }
  }, [mail.mail_id, msgs.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setClosedMsgs(new Set())
    setFullBodies(new Map())
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [mail.mail_id])

  // Inline (cid:) afbeeldingen on-demand ophalen voor de nieuwste berichten
  // die er een bevatten (max 3 — de rest volgt zodra opengeklapt/geladen).
  useEffect(() => {
    const candidates = msgs.slice(-3)
    for (const m of candidates) {
      const html = fullBodies.get(m.id)?.body_html || m.body_html || ''
      if (html.includes('cid:')) loadInlineImages(m.id)
    }
  }, [msgs, fullBodies, loadInlineImages])

  // Focus vanuit de thread-stapel links → open + scroll naar dat bericht.
  useEffect(() => {
    if (activeMsg == null) return
    setClosedMsgs(prev => { const n = new Set(prev); n.delete(activeMsg); return n })
    requestAnimationFrame(() => {
      const el = msgRefs.current[activeMsg]
      const sc = scrollRef.current
      if (el && sc) {
        const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 14
        sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      }
    })
  }, [activeMsg, mail.mail_id])

  const toggleMsg = i => setClosedMsgs(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n })

  const contacts = useMemo(() => {
    const seen = new Map()
    for (const m of msgs) {
      for (const r of [{ email: m.from_email, name: m.from_name }, ...recipientEmails(m.to_recipients), ...recipientEmails(m.cc_recipients)]) {
        const e = (r.email || '').toLowerCase()
        if (e && !e.includes('burggraaf@legal-mind.nl') && !seen.has(e)) seen.set(e, { email: r.email, name: r.name || r.email })
      }
    }
    return Array.from(seen.values()).slice(0, 12)
  }, [msgs])

  const style = catVars(accent)
  const score = mail.confidence ? Math.round(Number(mail.confidence) * 100) : null
  const waiting = !!mail.__no_draft_yet && !mail.category_key
  const isPlan = mail.category_key === 'in_te_plannen_afspraak'

  const convoEls = () => msgs.map((m, mi) => ({ m, mi })).reverse().map(({ m, mi }) => {
    const closed = closedMsgs.has(mi)
    const isActive = activeMsg != null && activeMsg === mi
    const body = bodyHtmlOf(m, fullBodies, getInlineImages(m.id))
    const toLabel = recipientEmails(m.to_recipients).map(r => r.name || r.email).slice(0, 3).join(', ')
    return (
      <div key={m.id || mi} className={`fmsg ${isActive ? 'is-active' : ''} ${closed ? 'is-closed' : ''}`}
           ref={el => { if (el) msgRefs.current[mi] = el }} style={style}>
        <div className="fmsg-head" onClick={() => toggleMsg(mi)}>
          <Pv2Avatar name={m.is_from_me ? 'Jelle Burggraaf' : m.from_name} email={m.from_email} size={32}/>
          <div className="fmsg-meta">
            <div className="fmsg-name">
              {m.is_from_me ? 'jij' : (m.from_name || m.from_email)}
              {mi === msgs.length - 1 && msgs.length > 1 && <span className="fmsg-latest">nieuwste</span>}
            </div>
            <div className="fmsg-recip">
              <span className="fmsg-email">{m.from_email}</span>
              <span className="fmsg-arrow">→</span>{toLabel || 'jij'}
            </div>
          </div>
          <span className="fmsg-time">{msgTime(m.received_at)}</span>
          <span className="fmsg-chev" style={{ transform: closed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform .2s var(--ease)' }}>
            <Ic n="chev" s={16}/>
          </span>
        </div>
        {!closed && (
          <div className="fmsg-body">
            {body.html
              ? <div dangerouslySetInnerHTML={{ __html: body.html }}/>
              : body.text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
          </div>
        )}
      </div>
    )
  })

  return (
    <section className="detail">
      <div className="det-head" style={style}>
        <div className="det-top">
          <div className="det-from">
            <div className="det-subject-title">{mail.subject || '(geen onderwerp)'}</div>
            {score != null && score > 0 && (
              <span className="score-label" title={`AI-confidence ${score}% · klik voor RAG-details`} onClick={() => onOpenRag(mail)}>
                <Ic n="check" s={11}/>{score}%
              </span>
            )}
          </div>
          <div className="det-tools det-headtools">
            <button className="hbtn icon" title="Tijdlijn van deze afzender" onClick={() => onOpenTimeline(mail)}><Ic n="history" s={15}/></button>
            <button className="hbtn icon" title="Relevante kennisbank-artikelen" onClick={() => onOpenKb(mail)}><Ic n="book" s={15}/></button>
          </div>
        </div>
        {(waiting || isPlan || mail.__awaiting) && (
          <div className="det-subjcat">
            {waiting && <span className="tag-ai static" title="AI heeft deze mail nog niet gecategoriseerd. Categorie wijzig je in de lijst links."><span className="ai-spin"/>Wacht op AI</span>}
            {mail.__awaiting && <span className="tag" style={style}><Ic n="hourglass" s={11}/>In afwachting · {catLabelText}</span>}
            {isPlan && <span className="tag" style={style}><Ic n="clock" s={11}/>In te plannen afspraak</span>}
          </div>
        )}
      </div>

      <div className="det-scroll" ref={scrollRef}>
        {convoEls()}
      </div>

      <Pv2Dock
        mail={mail} accent={accent} portalEl={portalEl}
        assistOpen={assistOpen} dockIn={dockIn} openDock={openDock} closeDock={closeDock} toggleDock={toggleDock}
        splitMode={splitMode} onToggleSplit={onToggleSplit}
        renderConvo={convoEls}
        onOpenTimeline={onOpenTimeline} onOpenRag={onOpenRag}
        markActioned={markActioned} unmarkActioned={unmarkActioned}
        folderOptions={folderOptions} customerEmails={customerEmails} contacts={contacts}
        isFlagged={isFlagged} onToggleFlag={onToggleFlag} onSnooze={onSnooze} reminderStyle={reminderStyle}
        signature={signature} onEditSignature={onEditSignature}/>
    </section>
  )
}

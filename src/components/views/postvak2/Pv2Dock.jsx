import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'
import { useActionProposals } from '../../../hooks/useActionProposals'
import { useMailActions } from '../../../hooks/useMailActions'
import Ic from './pv2Icons'
import Pv2DockMenu from './Pv2DockMenu'
import Pv2DockCompose from './Pv2DockCompose'
import { ComposeBody, RefineBar, useTaalcheck } from './Pv2Composer'
import { Pv2SpelcheckModal, Pv2RuleModal } from './Pv2Modals'
import { buildFollowupVariants } from './pv2Followup'
import { catVars } from './pv2lib'

/* Pv2Dock — de Maestro-dock onderin het detail (design: .dock + .dock-sheet).
 * Ingeklapt: één rustige balk met de voorgestelde actie. Uitgeklapt: glossy
 * vel met concept-varianten + composer + herschrijf-chips, of de actie-kaart
 * (doorsturen/verplaatsen/negeren via autodraft_action_decisions), of de
 * follow-up-flow voor In afwachting. Split-modus = lezen & schrijven naast
 * elkaar. Alle acties = variant 1-RPC's. */

const REFINE_PROMPTS = {
  'Korter': 'Maak het concept korter en directer.',
  'Vriendelijker': 'Maak de toon vriendelijker en warmer.',
  'Zakelijker': 'Maak de toon zakelijker en formeler.',
  'Voeg dank toe': 'Begin met een korte, oprechte bedankzin.',
  'Vraag om bevestiging': 'Sluit af met een korte, vriendelijke vraag om bevestiging.',
}
const ACTION_CATS = new Set(['forward', 'file', 'defer', 'delegate'])
const ACTION_ICON = { forward: 'send', file: 'folder-in', defer: 'archive', delegate: 'arrow-right', schedule: 'calendar' }

function pickInitialFolder(m, customerEmails) {
  if (m.target_folder) return m.target_folder
  const sender = (m.from_email || '').toLowerCase()
  if (sender && customerEmails.has(sender)) return 'Klanten/Customer Succes'
  return ''
}

export default function Pv2Dock({
  mail, accent, portalEl,
  assistOpen, dockIn, openDock, closeDock, toggleDock,
  splitMode, onToggleSplit,
  renderConvo,
  onOpenTimeline, onOpenRag,
  markActioned, unmarkActioned,
  folderOptions = [], customerEmails = new Set(), contacts = [],
  isFlagged, onToggleFlag, onSnooze, reminderStyle,
}) {
  const isAwaiting = !!mail.__awaiting
  const isSentDraft = !!mail.__sent_draft
  const { proposals, catalog } = useActionProposals(isAwaiting || isSentDraft ? null : mail.mail_id)
  const catalogMap = useMemo(() => new Map(catalog.map(c => [c.slug, c])), [catalog])
  const suggested = useMemo(() => proposals
    .filter(p => p.was_suggested && !p.outcome && !p.action_slug?.startsWith('delegate.'))
    .sort((a, b) => (a.suggested_rank || 99) - (b.suggested_rank || 99)).slice(0, 3), [proposals])
  const autopilot = useMemo(() => proposals.find(p =>
    p.outcome === 'autopilot' && p.undo_until && new Date(p.undo_until) > new Date() && !p.execution_result?.undone,
  ), [proposals])

  // Actieve keuze: 'concept' of een proposal-id. Default = top-voorstel als
  // dat een echte actie is (forward/file/defer), anders concept.
  const [sel, setSel] = useState('concept')
  const selProposal = useMemo(() => suggested.find(p => p.id === sel) || null, [suggested, sel])
  const selCategory = selProposal ? (catalogMap.get(selProposal.action_slug)?.category || selProposal.action_slug?.split('.')?.[0]) : null
  const isAction = !!selProposal && ACTION_CATS.has(selCategory)

  const replyProposal = useMemo(() => suggested.find(p => {
    const c = catalogMap.get(p.action_slug)?.category || p.action_slug?.split('.')?.[0]
    return c === 'reply' || c === 'schedule'
  }), [suggested, catalogMap])
  const variants = useMemo(() => {
    const pv = replyProposal?.payload?.variants
    if (Array.isArray(pv) && pv.length > 0) return pv
    return Array.isArray(mail.draft_variants) ? mail.draft_variants : []
  }, [replyProposal, mail.draft_variants])

  const [variant, setVariant] = useState(mail.selected_variant_index || 0)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [toList, setToList] = useState([])
  const [ccList, setCcList] = useState([])
  const [aiInput, setAiInput] = useState('')
  const [refining, setRefining] = useState(false)
  const [refineLabel, setRefineLabel] = useState('')
  const [primaryDD, setPrimaryDD] = useState(false)
  const [spelcheckOpen, setSpelcheckOpen] = useState(false)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [fuIdx, setFuIdx] = useState(0)
  const [fuText, setFuText] = useState('')
  const targetFolder = useMemo(() => pickInitialFolder(mail, customerEmails), [mail, customerEmails])

  const bodyRef = useRef(body); bodyRef.current = body
  const { tc, taalcheckBusy, runTaalcheck, acceptTaalcheck, rejectTaalcheck } = useTaalcheck({ getBody: () => bodyRef.current, setBody })

  const draftStateRef = useRef({})
  draftStateRef.current = { variantIndex: variant, amendText: aiInput, draftSubject: subject, draftBody: body, targetFolder }
  const { busy, submit, markProcessed, dismissAwaiting } = useMailActions({ mail, markActioned, unmarkActioned, draftStateRef })

  const fuVariants = useMemo(() => (isAwaiting ? buildFollowupVariants(mail) : []), [isAwaiting, mail])

  // Reset bij mailwissel (lees-eerst: dock dicht doet de View).
  useEffect(() => {
    const idx = Number.isInteger(mail.selected_variant_index) ? mail.selected_variant_index : 0
    const v = variants[Math.min(idx, Math.max(0, variants.length - 1))]
    setVariant(variants.length ? Math.min(idx, variants.length - 1) : 0)
    setSubject(v?.subject || mail.draft_subject || (mail.subject ? `RE: ${mail.subject.replace(/^(re|fw|fwd):\s*/i, '')}` : ''))
    setBody(v?.body || mail.draft_body || '')
    setToList(mail.from_email ? [mail.from_email] : [])
    setCcList([])
    setAiInput(''); setPrimaryDD(false); rejectTaalcheck()
    setFuIdx(0); setFuText(fuVariants[0]?.body || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail.mail_id, variants.length])
  useEffect(() => {
    const top = suggested[0]
    const cat = top ? (catalogMap.get(top.action_slug)?.category || top.action_slug?.split('.')?.[0]) : null
    setSel(top && ACTION_CATS.has(cat) ? top.id : 'concept')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail.mail_id, suggested.length])
  useEffect(() => {
    const c = e => { if (!e.target.closest('.act-wrap')) setPrimaryDD(false) }
    document.addEventListener('mousedown', c)
    return () => document.removeEventListener('mousedown', c)
  }, [])

  function pickVariant(i) {
    if (i < 0 || i >= variants.length) return
    setVariant(i)
    const v = variants[i]
    if (typeof v.subject === 'string' && v.subject) setSubject(v.subject)
    if (typeof v.body === 'string') setBody(v.body)
    if (!mail.__no_draft_yet) {
      supabase.rpc('set_autodraft_variant', { p_mail_id: mail.mail_id, p_variant_index: i }).then(null, () => {})
    }
  }

  // Herschrijven — synchroon via Grok-proxy; bij falen als amend naar de skill.
  async function rewriteSync(labelOrPrompt) {
    if (refining || tc) return
    const label = labelOrPrompt
    const prompt = REFINE_PROMPTS[labelOrPrompt] || labelOrPrompt
    setRefineLabel(label); setRefining(true)
    try {
      const { data: reqId, error: reqErr } = await supabase.rpc('autodraft_rewrite_request', {
        p_mail_id: mail.mail_id, p_prompt: `${prompt}\n\nHuidig concept:\n${bodyRef.current}`,
      })
      if (reqErr) throw new Error(reqErr.message)
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const { data: poll, error: pollErr } = await supabase.rpc('autodraft_rewrite_poll', { p_request_id: reqId })
        if (pollErr) throw new Error(pollErr.message)
        if (poll?.status === 'done') {
          const b = poll.body
          if (poll.status_code >= 200 && poll.status_code < 300 && b?.ok) {
            if (b.draft_body) setBody(b.draft_body)
            if (b.draft_subject) setSubject(b.draft_subject)
            setAiInput(''); setRefining(false)
            return
          }
          throw new Error(b?.error || b?.reason || `http_${poll.status_code}`)
        }
      }
      throw new Error('timeout — Maestro antwoordde niet op tijd')
    } catch (e) {
      // Fallback: als aanpassing in de skill-wachtrij (variant 1-gedrag).
      try {
        await supabase.rpc('submit_autodraft_decision', { p_mail_id: mail.mail_id, p_action: 'amend', p_amend: prompt })
        showToast({ kind: 'info', message: 'Herschrijven duurde te lang', detail: 'Als aanpassing naar de skill gestuurd — nieuwe varianten volgen.' })
      } catch {
        showToast({ kind: 'error', message: 'Herschrijven mislukt', detail: e.message })
      }
      setRefining(false)
    }
  }

  async function acceptProposal(p) {
    const row = p || selProposal
    if (!row) return
    try {
      const { data, error } = await supabase.rpc('submit_action_decision', {
        p_decision_id: row.id, p_outcome: 'accepted', p_payload_override: null,
      })
      if (error) throw error
      const name = catalogMap.get(row.action_slug)?.display_name || row.action_slug
      showToast({ message: `${name} goedgekeurd`, detail: data?.warning || 'Uitvoering binnen 15 min.' })
      closeDock()
    } catch (e) {
      showToast({ kind: 'error', message: 'Goedkeuren mislukt', detail: e.message || String(e) })
    }
  }
  async function rejectProposal() {
    if (!selProposal) return
    try {
      await supabase.rpc('submit_action_decision', { p_decision_id: selProposal.id, p_outcome: 'rejected', p_payload_override: null })
      showToast({ kind: 'info', message: 'Voorstel afgewezen' })
      setSel('concept')
    } catch (e) { showToast({ kind: 'error', message: 'Afwijzen mislukt', detail: e.message }) }
  }
  async function undoAutopilot() {
    try {
      const { data } = await supabase.rpc('undo_autopilot_decision', { p_decision_id: autopilot.id })
      showToast(data?.ok ? { message: 'Autopilot ongedaan gemaakt' } : { kind: 'error', message: 'Undo mislukt', detail: data?.error })
    } catch (e) { showToast({ kind: 'error', message: 'Undo mislukt', detail: e.message }) }
  }

  const doSend = () => submit('send', { subject, body, final_to: toList.length ? toList : null, target_folder: targetFolder || null })
  const approveNext = () => { if (isAction) acceptProposal(); else doSend() }
  const doArchive = () => submit('ignore', { target_folder: targetFolder || null })
  const doSpam = () => submit('spam')
  const doDelete = () => submit('ignore', { target_folder: 'Verwijderde items', decision_kind: 'delete' })

  // Sneltoetsen (variant 1): s = verstuur, i = negeer — niet in invoervelden.
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(tag) || document.activeElement?.isContentEditable) return
      if (isAwaiting || isSentDraft) return
      if (e.key.toLowerCase() === 's' && body.trim() && !isAction) { e.preventDefault(); doSend() }
      else if (e.key.toLowerCase() === 'i') { e.preventDefault(); doArchive() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, isAction, isAwaiting, isSentDraft, subject, toList])

  // Versleepbare vel-positie (persist zoals het design).
  const [dockLeft, setDockLeft] = useState(() => { const v = parseInt(localStorage.getItem('pvk2-dockleft') || '0', 10); return v >= 72 && v <= 820 ? v : 300 })
  const [dockTop, setDockTop] = useState(() => { const v = parseInt(localStorage.getItem('pvk2-docktop') || '0', 10); return v >= 40 && v <= 600 ? v : 70 })
  const dockDrag = useRef(false)
  function onDockResizeDown(e) { e.preventDefault(); e.stopPropagation(); dockDrag.current = true; document.body.style.cursor = 'nwse-resize'; document.body.style.userSelect = 'none' }
  useEffect(() => {
    function mv(e) {
      if (!dockDrag.current) return
      setDockLeft(Math.max(72, Math.min(window.innerWidth - 460, e.clientX)))
      setDockTop(Math.max(40, Math.min(window.innerHeight - 240, e.clientY)))
    }
    function up() {
      if (dockDrag.current) {
        dockDrag.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''
        try { localStorage.setItem('pvk2-dockleft', String(dockLeft)); localStorage.setItem('pvk2-docktop', String(dockTop)) } catch { /* ignore */ }
      }
    }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [dockLeft, dockTop])

  if (mail.__thread_member) return null

  const style = catVars(accent)
  const actTarget = selProposal ? (selProposal.payload?.to || selProposal.payload?.target_folder || catalogMap.get(selProposal.action_slug)?.target_value || '') : ''
  const actName = selProposal ? (catalogMap.get(selProposal.action_slug)?.display_name || selProposal.action_slug) : ''
  const barLine = isAwaiting
    ? `Wacht ${mail.days_waiting ?? '?'} ${mail.days_waiting === 1 ? 'dag' : 'dagen'} op reactie — afronden of follow-up sturen?`
    : isSentDraft
      ? `Concept staat klaar in Outlook${mail.days_since_placed != null ? ` · ${mail.days_since_placed}d geleden` : ''} — versturen doe je daar.`
      : isAction ? actName
        : (mail.suggested_reasoning ? String(mail.suggested_reasoning).slice(0, 140) : 'Concept op basis van vergelijkbare reacties')

  const menu = (up) => (
    <Pv2DockMenu onClose={() => setPrimaryDD(false)} up={up}
      proposals={suggested} catalogMap={catalogMap} currentProposalId={selProposal?.id}
      onSwitchProposal={p => { setSel(p.id); if (!assistOpen) openDock() }}
      conceptAvailable onSwitchConcept={() => { setSel('concept'); if (!assistOpen) openDock() }} isConcept={!isAction}
      onApproveNext={approveNext} onArchive={doArchive} onMarkProcessed={markProcessed}
      onSnooze={() => onSnooze(mail)} onTimeline={() => onOpenTimeline(mail)}
      onSpelcheck={!isAction ? () => setSpelcheckOpen(true) : null}
      onPin={() => onToggleFlag(mail.mail_id, !isFlagged)} isFlagged={isFlagged}
      onRag={() => onOpenRag(mail)} onSpam={doSpam} onDelete={doDelete}/>
  )

  const sheet = (assistOpen || splitMode) && portalEl ? createPortal(
    <div className={`dock-sheet ${splitMode ? 'is-split' : ''}`}
         style={splitMode
           ? { position: 'absolute', left: 118, right: 18, top: 58, bottom: 18, zIndex: 60, transform: dockIn ? 'translateY(0)' : 'translateY(34px)', transition: 'transform .42s cubic-bezier(0.22,1,0.36,1)' }
           : { position: 'absolute', left: dockLeft, right: 18, top: dockTop, bottom: 0, zIndex: 60, transform: dockIn ? 'translateY(0)' : 'translateY(34px)', transition: 'transform .42s cubic-bezier(0.22,1,0.36,1)' }}>
      {!splitMode && <div className="dock-resize" onMouseDown={onDockResizeDown} title="Versleep de hoek om de grootte aan te passen"><span/></div>}
      {splitMode && (
        <div className="dock-read clean">
          <button className="dock-read-close" onClick={() => { onToggleSplit(); openDock() }} title="Alleen concept tonen"><Ic n="x" s={14}/></button>
          {renderConvo()}
        </div>
      )}
      <div className="dock-write">
        <div className="dock-panel">
          {isAwaiting ? (
            <div className="dock-compose">
              <div className="newmail-head"><span className="newmail-title"><Ic n="hourglass" s={15}/> Follow-up · {mail.subject}</span></div>
              <div className="variants" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
                {fuVariants.map((v, i) => (
                  <button key={v.label} className={`variant-card ${fuIdx === i ? 'active' : ''}`} onClick={() => { setFuIdx(i); setFuText(v.body) }}>
                    <div className="variant-top"><span className="variant-num">v{i + 1}</span><span className="variant-title">{v.label}</span>
                      {fuIdx === i && <span className="variant-badge"><Ic n="check" s={9}/>actief</span>}</div>
                    <div className="variant-prev">{v.body.split('\n').filter(Boolean).slice(0, 2).join(' ')}</div>
                  </button>
                ))}
              </div>
              {reminderStyle && <div className="dock-reason"><b>Jouw reminder-stijl:</b> {reminderStyle}</div>}
              <div className="composer"><ComposeBody body={fuText} setBody={setFuText}/></div>
            </div>
          ) : isAction ? (
            <div className="actioncard uc">
              <div className="actioncard-flow">
                <span className="af-node af-mail"><Ic n="inbox" s={15}/>Deze mail</span>
                <span className="af-arrow"><Ic n="arrow-right" s={16}/></span>
                <span className="af-node af-target" style={{ '--ev': accent }}><Ic n={ACTION_ICON[selCategory] || 'zap'} s={15}/>{actTarget || actName}</span>
              </div>
              <div className="uc-badge"><Ic n={ACTION_ICON[selCategory] || 'zap'} s={22}/></div>
              <div className="uc-title">{actName}</div>
              <div className="uc-sub">{selProposal.classifier_reasoning || 'Voorgesteld door Maestro op basis van de mail-verrijking.'}</div>
              {selProposal.classifier_confidence != null && (
                <div className="uc-note"><Ic n="info" s={13}/> {Math.round(selProposal.classifier_confidence * 100)}% zeker · goedkeuren voert binnen 15 min uit</div>
              )}
              <div className="uc-switch">
                <span className="ac-lbl">Andere actie</span>
                <select className="uc-select" value={sel} onChange={e => setSel(e.target.value)}>
                  <option value="concept">Concept opstellen</option>
                  {suggested.filter(p => ACTION_CATS.has(catalogMap.get(p.action_slug)?.category || p.action_slug?.split('.')?.[0]))
                    .map(p => <option key={p.id} value={p.id}>{catalogMap.get(p.action_slug)?.display_name || p.action_slug}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <Pv2DockCompose
              variants={variants} variant={variant} onPickVariant={pickVariant} reasonShort={mail.suggested_reasoning}
              toList={toList} setToList={setToList} ccList={ccList} setCcList={setCcList} contacts={contacts}
              subject={subject} setSubject={setSubject}
              body={body} setBody={setBody} tc={tc} onAcceptTc={acceptTaalcheck} onRejectTc={rejectTaalcheck}
              refining={refining} refineLabel={refineLabel}/>
          )}
        </div>
        {!isAction && !isAwaiting && (
          <RefineBar chips={Object.keys(REFINE_PROMPTS)} onChip={rewriteSync}
                     aiInput={aiInput} setAiInput={setAiInput} onSubmit={rewriteSync} busy={refining} pinned
                     placeholder="Vertel Maestro hoe je deze mail anders wil…"
                     onTaalcheck={runTaalcheck} taalcheckBusy={taalcheckBusy} tcActive={!!tc}/>
        )}
        <div className="dock-foot">
          {isAwaiting ? (
            <>
              <button className="btn btn-ghost" onClick={() => setRuleOpen(true)} title="Leerregel: dit type mail hoort hier niet"><Ic n="shield-x" s={14}/> Regel</button>
              <span style={{ flex: 1 }}/>
              <a className="btn" href={`mailto:${encodeURIComponent((toList[0] || ''))}?subject=${encodeURIComponent(mail.subject ? `RE: ${mail.subject.replace(/^(re|fw|fwd):\s*/i, '')}` : '')}&body=${encodeURIComponent(fuText)}`}>
                <Ic n="send" s={14}/> Open in Outlook
              </a>
              <button className="btn" onClick={() => navigator.clipboard.writeText(fuText).then(() => showToast({ message: 'Follow-up gekopieerd' }))}>Kopieer</button>
              <button className="btn btn-primary" disabled={busy === 'dismiss'} onClick={() => { dismissAwaiting(); closeDock() }}>
                <Ic n="check" s={14}/> {busy === 'dismiss' ? 'Afronden…' : 'Afgerond'}
              </button>
            </>
          ) : isAction ? (
            <>
              <button className="btn btn-ghost" onClick={() => setSel('concept')}>Liever zelf beantwoorden</button>
              <button className="btn btn-ghost" onClick={rejectProposal}>✕ Wijs voorstel af</button>
              <span style={{ flex: 1 }}/>
              <div className="act-wrap">
                <div className="act-primary">
                  <button className="act-main" onClick={() => acceptProposal()}><Ic n={ACTION_ICON[selCategory] || 'zap'} s={14}/> {actName}</button>
                  <button className="act-split" onClick={e => { e.stopPropagation(); setPrimaryDD(v => !v) }}><Ic n="chev" s={12}/></button>
                </div>
                {primaryDD && menu(true)}
              </div>
            </>
          ) : (
            <>
              <button className="btn btn-ghost dock-reply" title="Beantwoorden (alleen afzender)" onClick={() => { setToList(mail.from_email ? [mail.from_email] : []); setCcList([]) }}><Ic n="reply" s={15}/></button>
              <button className="btn btn-ghost dock-reply" title="Beantwoord allen" onClick={() => {
                setToList(mail.from_email ? [mail.from_email] : [])
                setCcList(contacts.map(c => c.email).filter(e => e.toLowerCase() !== (mail.from_email || '').toLowerCase()))
              }}><Ic n="reply-all" s={15}/></button>
              <span className="dock-foot-meta"><Ic n="check" s={13}/> Auto-opgeslagen</span>
              <span style={{ flex: 1 }}/>
              <button className="btn dock-split-btn" onClick={onToggleSplit} title={splitMode ? 'Splitsen uit' : 'Lezen & schrijven naast elkaar'}><Ic n="columns" s={14}/> {splitMode ? 'Sluiten' : 'Split'}</button>
              <button className="btn dock-save" onClick={closeDock}>Bewaar</button>
              <div className="act-wrap">
                <div className="act-primary">
                  <button className="act-main" disabled={busy === 'send' || !body.trim()} onClick={doSend}><Ic n="send" s={14}/> {busy === 'send' ? 'Plaatsen…' : 'Plaats concept'}</button>
                  <button className="act-split" onClick={e => { e.stopPropagation(); setPrimaryDD(v => !v) }}><Ic n="chev" s={12}/></button>
                </div>
                {primaryDD && menu(true)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    portalEl,
  ) : null

  return (
    <>
      {sheet}
      {!splitMode && (
        <div className={`dock ${assistOpen ? 'is-open' : ''} ${isAction ? 'dock--action' : ''}`} style={style}>
          <div className="dock-bar">
            {autopilot ? (
              <div className="dock-grip" style={{ cursor: 'default' }}>
                <span className="dock-ico dock-ico--action"><Ic n="zap" s={15}/></span>
                <span className="dock-line"><b>Afgehandeld door AutoDraft</b> · {catalogMap.get(autopilot.action_slug)?.display_name || autopilot.action_slug}</span>
              </div>
            ) : (
              <button className="dock-grip" onClick={isSentDraft ? undefined : toggleDock} aria-expanded={assistOpen} style={isSentDraft ? { cursor: 'default' } : null}>
                <span className={`dock-ico ${isAction || isAwaiting ? 'dock-ico--action' : ''}`}>
                  <Ic n={isAwaiting ? 'hourglass' : isSentDraft ? 'send' : isAction ? (ACTION_ICON[selCategory] || 'zap') : 'sparkles'} s={15}/>
                </span>
                <span className="dock-line">{barLine}</span>
                {!isSentDraft && <span className="dock-chev" style={{ transform: assistOpen ? 'rotate(180deg)' : 'none' }}><Ic n="chev" s={15}/></span>}
              </button>
            )}
            <div className="dock-actions">
              {autopilot ? (
                <button className="btn" onClick={undoAutopilot}>↩ Ongedaan maken</button>
              ) : isAwaiting ? (
                <>
                  <button className="btn dock-split-btn" onClick={openDock}><Ic n="edit" s={14}/> Follow-up</button>
                  <div className="act-wrap">
                    <div className="act-primary">
                      <button className="act-main" disabled={busy === 'dismiss'} onClick={() => dismissAwaiting()}><Ic n="check" s={14}/> Afgerond</button>
                      <button className="act-split" onClick={e => { e.stopPropagation(); setPrimaryDD(v => !v) }}><Ic n="chev" s={12}/></button>
                    </div>
                    {!assistOpen && primaryDD && menu(true)}
                  </div>
                </>
              ) : isSentDraft ? null : (
                <>
                  <button className="btn dock-split-btn" onClick={onToggleSplit} title="Lezen & schrijven naast elkaar"><Ic n="columns" s={14}/> Split</button>
                  <div className="act-wrap">
                    <div className="act-primary">
                      <button className="act-main" onClick={isAction ? () => acceptProposal() : openDock}>
                        <Ic n={isAction ? (ACTION_ICON[selCategory] || 'zap') : 'edit'} s={14}/> {isAction ? 'Goedkeuren' : 'Plaats concept'}
                      </button>
                      <button className="act-split" onClick={e => { e.stopPropagation(); setPrimaryDD(v => !v) }}><Ic n="chev" s={12}/></button>
                    </div>
                    {!assistOpen && primaryDD && menu(true)}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {spelcheckOpen && (
        <Pv2SpelcheckModal draftBody={body} onClose={() => setSpelcheckOpen(false)}
          onApply={newBody => { setBody(newBody); setSpelcheckOpen(false); showToast({ message: 'Spelcheck toegepast' }) }}/>
      )}
      {ruleOpen && (
        <Pv2RuleModal folderOptions={folderOptions} onClose={() => setRuleOpen(false)}
          onConfirm={async ({ pattern, folder, reason }) => {
            setRuleOpen(false)
            try {
              await supabase.rpc('autodraft_upsert_ignore_rule', {
                p_pattern_type: 'subject_keyword', p_pattern_value: pattern,
                p_target_folder: folder || 'Archief/Overig', p_reason: reason || null,
                p_reason_kind: 'unwanted', p_name: pattern.slice(0, 60), p_active: true,
              })
            } catch { /* regel is best-effort; afronden gaat door */ }
            dismissAwaiting(reason || null)
            closeDock()
            showToast({ message: 'Leerregel opgeslagen', detail: 'Thread afgerond — soortgelijke mails gaan voortaan automatisch goed.' })
          }}/>
      )}
    </>
  )
}

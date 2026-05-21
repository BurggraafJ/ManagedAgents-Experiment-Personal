import { useEffect, useState, useMemo } from 'react'
import s from './zoeken.module.css'
import { Ico, SOURCE_ICONS } from './Icons'
import { supabase } from '../../../lib/supabase'
import { cleanText } from '../../../lib/rag'

// Slide-in panel rechts met chunks van laatste antwoord. Drie tabs:
// "Gebruikt"  — citation-nummers die echt in het antwoord voorkomen
// "Alle"      — alle terug-gestuurde interne chunks (mail/hubspot/notes/etc)
// "Web"       — citations uit Grok Live Search (alleen als web-search aanstond)
// Sluit via X-knop, Esc-toets of klik op scrim.
export default function SourcesPanel({
  open, citations, webCitations, totalChunks, highlightedNum, usedNs, onClose, onCiteClick,
}) {
  const [tab, setTab] = useState('used')

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset naar "Used" als panel her-opent, switch naar "All" als niets geciteerd,
  // en als er alleen web-bronnen zijn (geen interne) → web-tab direct openen.
  useEffect(() => {
    if (!open) return
    const hasInternal = (citations || []).length > 0
    const hasWeb = (webCitations || []).length > 0
    if (!hasInternal && hasWeb) setTab('web')
    else if (!usedNs || usedNs.size === 0) setTab('all')
    else setTab('used')
  }, [open, usedNs, citations, webCitations])

  const usedSet = usedNs || new Set()
  const usedList = useMemo(
    () => (citations || []).filter(c => usedSet.has(c.n)),
    [citations, usedSet]
  )
  const allList = citations || []
  const webList = webCitations || []

  const shown = tab === 'used' ? usedList : tab === 'all' ? allList : []
  const totalCount = totalChunks ?? allList.length

  // Token-schatting per tab: 1 token ≈ 4 chars (OpenAI/Anthropic ruwe benadering).
  // Voor interne chunks tellen we het preview-veld zoals dat naar Grok ging.
  // Voor web tellen we title + snippet + url.
  const tabTokens = useMemo(() => {
    const estimate = (text) => Math.ceil((text || '').length / 4)
    if (tab === 'web') {
      return webList.reduce((sum, c) => sum + estimate(
        (typeof c === 'object' ? `${c.title || ''} ${c.snippet || ''} ${c.url || ''}` : String(c || ''))
      ), 0)
    }
    const list = tab === 'used' ? usedList : allList
    return list.reduce((sum, c) => sum + estimate(c.preview), 0)
  }, [tab, usedList, allList, webList])
  const tabItemCount = tab === 'web' ? webList.length : (tab === 'used' ? usedList.length : allList.length)

  return (
    <>
      {open && <div className={s.scrim} onClick={onClose} aria-hidden />}
      <aside className={`${s.srcPanel} ${open ? s.srcPanelOpen : ''}`}
             aria-hidden={!open}
             aria-label="Bronnen voor antwoord">
        <div className={s.srcPanelHead}>
          <div className={s.srcPanelTitle}>
            <div className={s.srcPanelTitleH}>Bronnen</div>
            <div className={s.srcPanelTitleSub}>
              {totalCount === 0
                ? 'geen bronnen'
                : `${totalCount} chunk${totalCount === 1 ? '' : 's'} terug · ${usedSet.size} gebruikt in antwoord`}
            </div>
          </div>
          <button className={s.srcPanelClose} onClick={onClose} title="Sluit (Esc)" aria-label="Sluit bronnen-paneel">
            {Ico.close}
          </button>
        </div>

        <div className={s.srcPanelTabs}>
          <button
            type="button"
            className={`${s.srcPanelTab} ${tab === 'used' ? s.srcPanelTabActive : ''}`}
            onClick={() => setTab('used')}
            disabled={usedSet.size === 0}
            style={usedSet.size === 0 ? { opacity: 0.45 } : undefined}
          >
            Gebruikt <span className={s.srcPanelTabC}>{usedList.length}</span>
          </button>
          <button
            type="button"
            className={`${s.srcPanelTab} ${tab === 'all' ? s.srcPanelTabActive : ''}`}
            onClick={() => setTab('all')}
          >
            Interne bronnen <span className={s.srcPanelTabC}>{allList.length}</span>
          </button>
          <button
            type="button"
            className={`${s.srcPanelTab} ${tab === 'web' ? s.srcPanelTabActive : ''}`}
            onClick={() => setTab('web')}
            disabled={webList.length === 0}
            style={webList.length === 0 ? { opacity: 0.45 } : undefined}
            title={webList.length === 0 ? 'Geen web-bronnen voor deze vraag' : ''}
          >
            Web {Ico.globe && <span style={{ marginLeft: 2, verticalAlign: 'middle' }}>{Ico.globe}</span>} <span className={s.srcPanelTabC}>{webList.length}</span>
          </button>
        </div>

        <div className={s.srcPanelList}>
          {tab === 'web' ? (
            webList.length === 0 ? (
              <div style={{ padding: '24px 6px', textAlign: 'center', color: 'var(--neutral-400)', fontSize: 13 }}>
                Geen web-bronnen. Web-search was niet aan of Grok riep de tool niet aan.
              </div>
            ) : (
              webList.map((c, i) => <WebSourceCard key={i} cite={c} />)
            )
          ) : (
            <>
              {shown.length === 0 && (
                <div style={{ padding: '24px 6px', textAlign: 'center', color: 'var(--neutral-400)', fontSize: 13 }}>
                  {tab === 'used' ? 'Geen chunks expliciet geciteerd in het antwoord.' : 'Nog geen bronnen.'}
                </div>
              )}
              {shown.map((c) => (
                <SourceCard
                  key={c.n ?? c.chunk_id}
                  cite={c}
                  used={usedSet.has(c.n)}
                  highlighted={highlightedNum === c.n}
                  onClick={() => onCiteClick?.(c)}
                />
              ))}
            </>
          )}
        </div>
        <div className={s.srcPanelFoot}>
          <span>Geschatte context-omvang in deze tab:</span>
          <strong>~{(tabTokens / 1000).toFixed(tabTokens < 1000 ? 2 : 1)}k tokens</strong>
          <span className={s.srcPanelFootDim}>· {tabItemCount} {tabItemCount === 1 ? 'bron' : 'bronnen'}</span>
        </div>
      </aside>
    </>
  )
}

function SourceCard({ cite, used, highlighted, onClick }) {
  const src = cite.source || 'mail'
  const icoCls = SRC_ICO_CLASS[src] || s.icoMail
  const [expanded, setExpanded] = useState(false)
  // Auto-expand de gehighlighte bron zodat klik op [N] direct de body opent.
  useEffect(() => { if (highlighted) setExpanded(true) }, [highlighted])

  const handleClick = (e) => {
    e.stopPropagation()
    setExpanded(v => !v)
    onClick?.()
  }

  return (
    <div className={`${s.srcfull} ${highlighted ? s.srcfullHi : ''} ${expanded ? s.srcfullOpen : ''}`}
         onClick={handleClick}
         id={`v2-citation-${cite.n}`}>
      <div className={s.srcfullTop}>
        <span className={s.srcfullNum}>{cite.n ?? '·'}</span>
        <span className={`${s.srcfullIco} ${icoCls}`}>{SOURCE_ICONS[src] || SOURCE_ICONS.mail}</span>
        <span className={s.srcfullType}>{cite.subject || cite.title || src}</span>
        {cite.via === 'rpc_timeline' && (
          <span className={s.srcfullVia} title="Direct uit HubSpot-koppeling (geen vector-retrieval)">RPC</span>
        )}
        {!used && <span className={s.srcfullSim} title="Niet geciteerd in antwoord">context</span>}
        {cite.similarity != null && <span className={s.srcfullSim}>{Number(cite.similarity).toFixed(2)}</span>}
        <span className={s.srcfullCaret}>{expanded ? '▾' : '▸'}</span>
      </div>
      {!expanded && cite.preview && (
        <div className={s.srcfullTxt}>{cleanText(cite.preview).slice(0, 200)}</div>
      )}
      {expanded && <ExpandedSource cite={cite} />}
      <div className={s.srcfullFoot}>
        {cite.occurred_at && <strong>{formatTs(cite.occurred_at)}</strong>}
        {cite.ts && !cite.occurred_at && <strong>{formatTs(cite.ts)}</strong>}
        {cite.from_name && <span>· {cite.from_name}</span>}
      </div>
    </div>
  )
}

// Volledige body — voor mail-bronnen fetchen we de message uit mail_messages
// als de chunk een mail_id heeft. Voor andere types tonen we de meegegeven
// preview als volledige tekst.
function ExpandedSource({ cite }) {
  const isMail = cite.source === 'mail' || cite.source === 'engagement'
  const messageId = isMail ? cite.id : null
  const [body, setBody] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!messageId) return
    let cancelled = false
    setLoading(true)
    supabase.from('mail_messages')
      .select('body_text, body_html, body_preview, subject, from_name, from_email, received_at')
      .eq('id', messageId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setBody(data)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [messageId])

  if (isMail && messageId) {
    if (loading) return <div className={s.srcfullExpandLoading}>Body laden…</div>
    const text = body?.body_text || cleanText(body?.body_html || '') || body?.body_preview || cite.preview || '(geen body)'
    return (
      <div className={s.srcfullExpand}>
        {body?.subject && <div className={s.srcfullExpandSubj}>{body.subject}</div>}
        <pre className={s.srcfullExpandPre}>{text}</pre>
      </div>
    )
  }
  // Notes / events / agenda / jira — preview bevat al de essentie
  return (
    <div className={s.srcfullExpand}>
      <pre className={s.srcfullExpandPre}>{cleanText(cite.preview || '') || '(geen inhoud)'}</pre>
    </div>
  )
}

// Web-bronnen van Grok Live Search hebben een andere shape (url/title/snippet)
// dan onze interne chunks. Dedicated rendering met hostname-badge + snippet.
function WebSourceCard({ cite }) {
  const url = typeof cite === 'string' ? cite : cite.url
  const title = typeof cite === 'object' ? (cite.title || url) : url
  const snippet = typeof cite === 'object' ? cite.snippet : null
  if (!url) return null
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* ignore */ }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={s.srcfullWeb}>
      <div className={s.srcfullTop}>
        <span className={`${s.srcfullIco} ${s.icoWeb}`}>{Ico.globe}</span>
        <span className={s.srcfullType}>{title}</span>
        {host && <span className={s.srcfullVia} title={url}>{host}</span>}
      </div>
      {snippet && <div className={s.srcfullTxt}>{snippet.slice(0, 240)}</div>}
      <div className={s.srcfullFoot}>
        <span style={{ fontSize: 10.5, color: 'var(--neutral-400)', wordBreak: 'break-all' }}>{url}</span>
      </div>
    </a>
  )
}

const SRC_ICO_CLASS = {
  mail: s.icoMail,
  engagement: s.icoEngagement,
  deal: s.icoDeal,
  company: s.icoCompany,
  contact: s.icoContact,
  agenda: s.icoAgenda,
  event: s.icoEvent,
  meeting: s.icoMeeting,
  jira: s.icoJira,
  lesson: s.icoLesson,
}

function formatTs(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) + ' · ' +
           d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

import { useEffect } from 'react'
import s from './zoeken-v2.module.css'
import { Ico, SOURCE_ICONS } from './V2Icons'

// Slide-in panel rechts met alle citations / chunks van het laatste antwoord.
// Sluit via X-knop, Esc-toets of klik op scrim.
export default function V2SourcesPanel({ open, citations, totalChunks, highlightedNum, onClose, onCiteClick }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
              {totalChunks ? `${totalChunks} chunk${totalChunks === 1 ? '' : 's'} gelezen · gesorteerd op relevantie` : 'geen bronnen'}
            </div>
          </div>
          <button className={s.srcPanelClose} onClick={onClose} title="Sluit (Esc)" aria-label="Sluit bronnen-paneel">
            {Ico.close}
          </button>
        </div>
        <div className={s.srcPanelList}>
          {(!citations || citations.length === 0) && (
            <div style={{ padding: '24px 6px', textAlign: 'center', color: 'var(--neutral-400)', fontSize: 13 }}>
              Nog geen bronnen.
            </div>
          )}
          {(citations || []).map((c) => (
            <SourceCard
              key={c.n ?? c.chunk_id}
              cite={c}
              highlighted={highlightedNum === c.n}
              onClick={() => onCiteClick?.(c)}
            />
          ))}
        </div>
      </aside>
    </>
  )
}

function SourceCard({ cite, highlighted, onClick }) {
  const src = cite.source || 'mail'
  const icoCls = SRC_ICO_CLASS[src] || s.icoMail
  return (
    <div className={`${s.srcfull} ${highlighted ? s.srcfullHi : ''}`} onClick={onClick} id={`v2-citation-${cite.n}`}>
      <div className={s.srcfullTop}>
        <span className={s.srcfullNum}>{cite.n ?? '·'}</span>
        <span className={`${s.srcfullIco} ${icoCls}`}>{SOURCE_ICONS[src] || SOURCE_ICONS.mail}</span>
        <span className={s.srcfullType}>{cite.label || cite.title || src}</span>
        {cite.similarity != null && <span className={s.srcfullSim}>{Number(cite.similarity).toFixed(2)}</span>}
      </div>
      {cite.title && cite.label && cite.title !== cite.label && (
        <div className={s.srcfullTitle}>{cite.title}</div>
      )}
      {cite.preview && <div className={s.srcfullTxt}>{cite.preview}</div>}
      <div className={s.srcfullFoot}>
        {cite.ts && <><strong>{formatTs(cite.ts)}</strong></>}
        {cite.from_name && <span>· {cite.from_name}</span>}
      </div>
    </div>
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

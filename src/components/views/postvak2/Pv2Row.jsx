import { useEffect, useState } from 'react'
import Ic from './pv2Icons'
import { catVarsFor, catLabel, avatarPalette, initialsOf, rowTime } from './pv2lib'

/* Pv2Row — één mail-rij in de lijst (design: .row) + de Outlook-stijl
 * thread-stapel die onder de geselecteerde rij uitklapt (.tstack).
 * Functioneel contract uit variant 1: categorie-picker (optimistic persist),
 * ster/vlag-toggle, drag-naar-map, 3-puntjes snel-acties, thread-focus. */

export function Pv2Avatar({ name, email, size = 36 }) {
  const pal = avatarPalette(email)
  return (
    <span className={`av ${pal.tone ? `av-${pal.tone}` : ''}`} data-p={pal.p != null ? pal.p : undefined}
          style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {initialsOf(name, email)}
    </span>
  )
}

function CatPicker({ categories, categoriesByKey, onPick, onClose }) {
  useEffect(() => {
    const c = e => { if (!e.target.closest('.catpick-wrap')) onClose() }
    document.addEventListener('mousedown', c)
    return () => document.removeEventListener('mousedown', c)
  }, [onClose])
  return (
    <div className="dd catpick-dd" onClick={e => e.stopPropagation()}>
      <div className="dd-label">Categorie</div>
      {categories.map(c => (
        <button key={c.category_key} className="dd-item" onClick={() => onPick(c.category_key)}
                style={catVarsFor(c.category_key, categoriesByKey)}>
          <span className="catpick-dot" style={{ background: 'var(--cat)' }}/> {c.label}
        </button>
      ))}
    </div>
  )
}

export default function Pv2Row({
  it, catKey, categories, categoriesByKey,
  selected, onSelect, onChangeCategory,
  isFlagged, onToggleFlag,
  threadCount = 1, threadMsgs = [], activeMsg, onFocusMsg,
  onDragStart, onDragEnd,
  onOpenRag, onApprove, onReply, onSnooze, onDelete,
  bucket, onMoveBucket,
  unread,
}) {
  const [showMore, setShowMore] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const isThread = threadCount > 1
  const waiting = !!it.__no_draft_yet && !catKey
  const isAwaiting = !!it.__awaiting
  const isSentDraft = !!it.__sent_draft || !!it.__outlook_draft
  const style = catVarsFor(catKey, categoriesByKey)

  useEffect(() => {
    if (!showMore) return undefined
    const close = e => { if (!e.target.closest('.row-more-wrap')) setShowMore(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showMore])

  const hasConcept = (Array.isArray(it.draft_variants) && it.draft_variants.length > 0) || !!it.draft_body
  const isSkip = it.suggested_action === 'skip'
  const isPlan = catKey === 'in_te_plannen_afspraak'

  return (
    <div className={`row ${selected ? 'selected' : ''} ${unread ? 'unread' : ''} ${isThread ? 'is-thread' : ''}`}
         style={style} draggable={!isAwaiting && !isSentDraft}
         onClick={() => onSelect(it.mail_id)}
         onDragStart={e => {
           e.dataTransfer.effectAllowed = 'move'
           e.dataTransfer.setData('application/x-mail-id', it.mail_id)
           e.dataTransfer.setData('text/plain', it.mail_id)
           onDragStart && onDragStart(it.mail_id)
         }}
         onDragEnd={() => onDragEnd && onDragEnd()}>
      <div className="row-av"><Pv2Avatar name={it.from_name} email={it.from_email} size={36}/></div>
      <div className="row-main">
        <div className="row-from"><span>{it.from_name || it.from_email || '—'}</span></div>
        <div className="row-meta">
          <button type="button" className={`row-star ${isFlagged ? 'starred' : ''}`}
                  style={{ background: 'transparent', border: 0 }}
                  title={isFlagged ? 'Pin verwijderen' : 'Pin op postvak'}
                  onClick={e => { e.stopPropagation(); onToggleFlag && onToggleFlag(it.mail_id, !isFlagged) }}>
            <Ic n={isFlagged ? 'star-fill' : 'star'} s={13}/>
          </button>
          <span>{rowTime(it.received_at)}</span>
          <div className="row-more-wrap">
            <button className={`row-more ${showMore ? 'is-open' : ''}`} title="Meer"
                    onClick={e => { e.stopPropagation(); setShowMore(v => !v) }}>
              <Ic n="more" s={15}/>
            </button>
            {showMore && (
              <div className="dd row-more-dd" onClick={e => e.stopPropagation()}>
                <div className="dd-label">Snel</div>
                {!isAwaiting && !isSentDraft && (
                  <button className="dd-item" onClick={() => { setShowMore(false); onApprove && onApprove(it) }}>
                    <Ic n="check-circle" s={15}/> Goedkeuren + volgende
                  </button>
                )}
                <button className="dd-item" onClick={() => { setShowMore(false); onReply && onReply(it) }}>
                  <Ic n="reply" s={15}/> Beantwoorden
                </button>
                {!isAwaiting && !isSentDraft && (
                  <button className="dd-item" onClick={() => { setShowMore(false); onSnooze && onSnooze(it) }}>
                    <Ic n="hourglass" s={15}/> Stel uit · morgen 09:00
                  </button>
                )}
                <div className="dd-sep"/>
                {onMoveBucket && !isAwaiting && !isSentDraft && (
                  <button className="dd-item" onClick={() => { setShowMore(false); onMoveBucket(it, bucket === 'overig' ? 'prio' : 'overig') }}>
                    <Ic n="folder-in" s={15}/> Verplaats naar {bucket === 'overig' ? 'Prioriteit' : 'Overige'}
                  </button>
                )}
                <button className="dd-item" onClick={() => { setShowMore(false); onToggleFlag && onToggleFlag(it.mail_id, !isFlagged) }}>
                  <Ic n="pin" s={15}/> {isFlagged ? 'Pin verwijderen' : 'Pin op postvak'}
                </button>
                <button className="dd-item" onClick={() => { setShowMore(false); onOpenRag && onOpenRag(it) }}>
                  <Ic n="cube" s={15}/> RAG-details{it.confidence ? ` (${Math.round(it.confidence * 100)}%)` : ''}
                </button>
                {!isAwaiting && !isSentDraft && (
                  <>
                    <div className="dd-sep"/>
                    <button className="dd-item danger" onClick={() => { setShowMore(false); onDelete && onDelete(it) }}>
                      <Ic n="trash" s={15}/> Verwijderen
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="row-subject">{it.subject || '(geen onderwerp)'}</div>
        <div className="row-snippet">{it.body_preview || ''}</div>
        <div className="row-foot">
          <div className="catpick-wrap" onClick={e => e.stopPropagation()}>
            {waiting ? (
              <button className="tag-ai" title="AI heeft deze mail nog niet gecategoriseerd — klik om handmatig te kiezen"
                      onClick={() => setCatOpen(v => !v)}>
                <span className="ai-spin"/>Wacht op AI
              </button>
            ) : (
              <button className="tag tag-btn" style={style} title="Categorie wijzigen" onClick={() => setCatOpen(v => !v)}>
                <span className="tag-dot"/>{catLabel(catKey, categoriesByKey)}<Ic n="chev" s={10}/>
              </button>
            )}
            {catOpen && (
              <CatPicker categories={categories} categoriesByKey={categoriesByKey}
                         onPick={k => { onChangeCategory && onChangeCategory(it.mail_id, k); setCatOpen(false) }}
                         onClose={() => setCatOpen(false)}/>
            )}
          </div>
          {isPlan && <span className="tag" style={catVarsFor('', categoriesByKey)}><Ic n="clock" s={11}/>In te plannen</span>}
          {isAwaiting && <span className="await-days">{it.days_waiting != null ? `${it.days_waiting}d wachten` : 'wacht op reactie'}</span>}
          {isSentDraft && (it.__outlook_draft
            ? <span className="tag-sug"><Ic n="edit" s={11}/>Concept · Outlook</span>
            : <span className="tag-sug"><Ic n="send" s={11}/>In Outlook{it.days_since_placed != null ? ` · ${it.days_since_placed}d` : ''}</span>)}
          {!waiting && !isAwaiting && !isSentDraft && (isSkip
            ? <span className="tag-action" title={it.suggested_reasoning || ''}><Ic n="zap" s={11}/>Archiveren{it.target_folder ? ` → ${it.target_folder.split('/').pop()}` : ''}</span>
            : hasConcept
              ? <span className="tag-sug"><Ic n="edit" s={11}/>Concept</span>
              : null)}
          {isThread && <span className="thread-count" title={`${threadCount} berichten in deze conversatie`}><Ic n="layers" s={12}/>{threadCount}</span>}
        </div>

        {/* Outlook-stijl thread-stapel — klapt uit onder de geselecteerde rij */}
        {isThread && threadMsgs.length > 0 && (
          <div className={`tstack ${selected ? 'open' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="tstack-inner">
              {threadMsgs.map((m, i, arr) => {
                const last = i === arr.length - 1
                const isActive = activeMsg != null ? activeMsg === i : last
                return (
                  <div key={m.id || i} className={`tcard ${isActive ? 'is-active' : ''}`}
                       style={{ transitionDelay: (selected ? i * 55 : 0) + 'ms' }}
                       onClick={() => onFocusMsg && onFocusMsg(i)}>
                    <div className="tcard-row">
                      <Pv2Avatar name={m.from_name} email={m.from_email} size={18}/>
                      <span className="tcard-name">{m.is_from_me ? 'jij' : (m.from_name || m.from_email)}</span>
                      <span className="tcard-snip">{m.body_preview || m.subject || ''}</span>
                      <span className="tcard-time">{rowTime(m.received_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

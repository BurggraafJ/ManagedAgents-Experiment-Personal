import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import MIcon from './MIcon'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { relTime } from '../lib/rag'

// =============================================================================
// MobileHistorySheet — Geschiedenis op de telefoon (v1.157)
// =============================================================================
// Was tot v1.156 MobilePromptHistorySheet: één lijst met de losse VRAGEN die je
// zelf tikte (localStorage). Jelle: die lijst helpt niet — je wil je GESPREKKEN
// terugzien, precies wat de desktop-topbar onder "Geschiedenis" al had
// (HistoryPanel op rag_chat_sessions). Op de telefoon bestond dat pad niet, ook
// al zat de data al in useRagChat (sessions/loadSession/deleteSession).
//
// Dus: dezelfde sheet, twee tabbladen, en het PRIMAIRE tabblad is Gesprekken.
// De vragenlijst blijft bestaan onder "Vragen" — hergebruik van een eerder
// getypte vraag is nog steeds nuttig, alleen niet als hoofdingang.
//
// Zelfde schil als MobileAnswerSheet: portal naar `.shell--m` (daar staan de
// --m-*-tokens én daar ligt de tabbar, dus de sheet komt erbovenop), sleepbaar
// greepje, en `m-modal-open` voor de scroll-lock.
// =============================================================================

const sheetHost = () => (typeof document === 'undefined'
  ? null
  : document.querySelector('.shell--m') || document.body)

export default function MobileHistorySheet({
  open, onClose,
  // gesprekken (rag_chat_sessions, via useRagChat)
  sessions = [], sessionsLoading = false, currentSessionId = null,
  onPickSession, onDeleteSession, onNewSession,
  // losse vragen (localStorage, via usePromptHistory)
  prompts = [], onPickPrompt, onClearPrompts,
}) {
  const [tab, setTab] = useState('gesprekken')
  // Elke keer dat de sheet opengaat staat Gesprekken voorop. Een "onthouden"
  // tabblad zou betekenen dat één uitstapje naar Vragen de hoofdingang
  // permanent verlegt, en dat is precies de klacht die dit oplost.
  useEffect(() => { if (open) setTab('gesprekken') }, [open])

  // Zelfde vergrendeling als de andere sheets: `m-modal-open` verbergt tabbar
  // + FAB en lockt de achtergrond-scroll.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.classList.add('m-modal-open')
    return () => root.classList.remove('m-modal-open')
  }, [open])

  const drag = useSheetDrag({ onClose, enabled: open })
  const host = open ? sheetHost() : null
  if (!open || !host) return null

  const sub = tab === 'gesprekken'
    ? (sessionsLoading
      ? 'laden…'
      : sessions.length === 0
        ? 'nog geen gesprekken'
        : `${sessions.length} ${sessions.length === 1 ? 'gesprek' : 'gesprekken'}`)
    : (prompts.length === 0 ? 'nog geen vragen' : `${prompts.length} ${prompts.length === 1 ? 'vraag' : 'vragen'}`)

  return createPortal(
    <>
      <div className="m-scrim" onClick={onClose} />
      <div
        className={`m-sheet m-hist ${drag.dragging ? 'is-dragging' : ''}`}
        style={drag.dragStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Geschiedenis"
      >
        <div className="m-sheet__drag" {...drag.handleProps}>
          <div className="m-drawer__grab" />
          <div className="m-hist__head">
            <div className="m-hist__titlerow">
              <span className="m-hist__title">Geschiedenis</span>
              <div className="m-hist__headacts">
                {tab === 'vragen' && prompts.length > 0 && (
                  <button
                    type="button"
                    className="m-qhist__clear"
                    onClick={() => { if (window.confirm('Alle eerdere vragen wissen?')) onClearPrompts?.() }}
                  >
                    Wissen
                  </button>
                )}
                <button type="button" className="m-drawer__close" onClick={onClose} aria-label="Sluiten">
                  <MIcon name="close" size={16} />
                </button>
              </div>
            </div>
            <div className="m-hist__sub">{sub}</div>
          </div>
        </div>

        <div className="m-hist__segwrap">
          <div className="m-ansheet__seg">
            <button type="button" className={tab === 'gesprekken' ? 'is-active' : ''} onClick={() => setTab('gesprekken')}>
              Gesprekken {sessions.length ? <em>{sessions.length}</em> : null}
            </button>
            <button type="button" className={tab === 'vragen' ? 'is-active' : ''} onClick={() => setTab('vragen')}>
              Vragen {prompts.length ? <em>{prompts.length}</em> : null}
            </button>
          </div>
        </div>

        <div className="m-sheet__body m-hist__body">
          {tab === 'gesprekken'
            ? <SessionList
                sessions={sessions}
                loading={sessionsLoading}
                currentSessionId={currentSessionId}
                onPick={onPickSession}
                onDelete={onDeleteSession}
              />
            : <PromptList prompts={prompts} onPick={onPickPrompt} />}
        </div>

        {tab === 'gesprekken' && onNewSession && (
          <div className="m-sheet__cta">
            <button type="button" className="m-sheet__add" onClick={onNewSession}>
              <MIcon name="plus" size={16} /> Nieuw gesprek
            </button>
          </div>
        )}
      </div>
    </>,
    host,
  )
}

// Eén rij per gesprek: titel, aantal berichten en hoe lang geleden — dezelfde
// drie feiten als HistoryPanel op desktop. Tik = laad dat gesprek.
function SessionList({ sessions, loading, currentSessionId, onPick, onDelete }) {
  if (loading && sessions.length === 0) {
    return <div className="m-hist__state">Gesprekken laden…</div>
  }
  if (sessions.length === 0) {
    return (
      <div className="m-qhist__empty">
        <div className="m-qhist__emptyico"><MIcon name="chat" size={20} /></div>
        <div className="m-qhist__emptytitle">Nog geen gesprekken</div>
        <div className="m-qhist__emptysub">Stel een vraag aan Maestro — elk gesprek komt hier te staan en je pakt het op elk apparaat weer op.</div>
      </div>
    )
  }
  return sessions.map(sess => (
    <div key={sess.id} className={`m-hist__row ${sess.id === currentSessionId ? 'is-active' : ''}`}>
      <button type="button" className="m-hist__main" onClick={() => onPick?.(sess.id)}>
        <span className="m-hist__q">{sess.title || '(zonder titel)'}</span>
        <span className="m-hist__meta">
          {sess.message_count > 0 ? `${sess.message_count} berichten · ` : ''}{relTime(sess.updated_at)} geleden
        </span>
      </button>
      <button
        type="button"
        className="m-hist__del"
        aria-label="Verwijder gesprek"
        onClick={() => { if (window.confirm(`Verwijder gesprek "${sess.title || 'zonder titel'}"?`)) onDelete?.(sess.id) }}
      >
        <MIcon name="close" size={13} />
      </button>
    </div>
  ))
}

// De losse vragen (nieuwste eerst, localStorage). Tik → hij staat in de
// composer, nog niet verstuurd, zodat je hem kunt bijschaven.
function PromptList({ prompts, onPick }) {
  if (prompts.length === 0) {
    return (
      <div className="m-qhist__empty">
        <div className="m-qhist__emptyico"><MIcon name="clock" size={20} /></div>
        <div className="m-qhist__emptytitle">Nog geen vragen gesteld</div>
        <div className="m-qhist__emptysub">Wat je aan Maestro vraagt komt hier vanzelf te staan — ook na een reload.</div>
      </div>
    )
  }
  return prompts.map(item => (
    <button key={item.ts} type="button" className="m-qhist__row" onClick={() => onPick?.(item.q)}>
      <span className="m-qhist__ico"><MIcon name="clock" size={13} /></span>
      <span className="m-qhist__q">{item.q}</span>
      <span className="m-qhist__time">{relTime(item.ts)}</span>
    </button>
  ))
}

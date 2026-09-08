import { useEffect, useRef, useState } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { relTime } from '../../../lib/rag'

// =============================================================================
// HistoryPopover — "Geschiedenis" onder de composer (v1.157)
// =============================================================================
// Heette tot v1.156 PromptHistoryPopover en toonde alléén de losse VRAGEN die je
// zelf tikte (localStorage). Jelle: die lijst helpt niet — je wil je GESPREKKEN
// terugzien. Die zaten al in rag_chat_sessions en hangen in de topbar onder
// "Geschiedenis" (HistoryPanel), maar niet op de plek waar je zit: de composer.
//
// Nu twee tabbladen in dezelfde .libPopover-schil, met Gesprekken voorop:
//   • Gesprekken → tik laadt de sessie (chat.loadSession), kruisje verwijdert,
//     en er staat een "Nieuw gesprek"-regel bovenaan.
//   • Vragen     → het oude gedrag: tik vult de composer, verstuurt niet.
// Zelfde tweedeling en dezelfde woorden als de mobiele MobileHistorySheet, zodat
// je het maar één keer hoeft te leren.
// =============================================================================
export default function HistoryPopover({
  open, onClose, anchorRef,
  sessions = [], sessionsLoading = false, currentSessionId = null,
  onPickSession, onDeleteSession, onNewSession,
  prompts = [], onPickPrompt, onClearPrompts,
}) {
  const popRef = useRef(null)
  const [tab, setTab] = useState('gesprekken')
  // Bij elke opening staat Gesprekken voorop — de hoofdingang verschuift niet
  // doordat je één keer bij Vragen bent geweest.
  useEffect(() => { if (open) setTab('gesprekken') }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchorRef, onClose])

  if (!open) return null
  return (
    <div ref={popRef} className={s.libPopover} role="menu" aria-label="Geschiedenis">
      <div className={s.qhistTabs} role="tablist">
        <button
          type="button" role="tab" aria-selected={tab === 'gesprekken'}
          className={`${s.qhistTab} ${tab === 'gesprekken' ? s.qhistTabOn : ''}`}
          onClick={() => setTab('gesprekken')}
        >
          Gesprekken{sessions.length > 0 ? ` · ${sessions.length}` : ''}
        </button>
        <button
          type="button" role="tab" aria-selected={tab === 'vragen'}
          className={`${s.qhistTab} ${tab === 'vragen' ? s.qhistTabOn : ''}`}
          onClick={() => setTab('vragen')}
        >
          Vragen{prompts.length > 0 ? ` · ${prompts.length}` : ''}
        </button>
        {tab === 'vragen' && prompts.length > 0 && (
          <button
            type="button"
            className={s.qhistClear}
            onClick={() => { if (window.confirm('Alle eerdere vragen wissen?')) onClearPrompts?.() }}
          >
            Wissen
          </button>
        )}
      </div>

      {tab === 'gesprekken' ? (
        <>
          {onNewSession && (
            <button type="button" className={s.qhistNew} onClick={onNewSession} role="menuitem">
              {Ico.plus} Nieuw gesprek
            </button>
          )}
          {sessionsLoading && sessions.length === 0 && (
            <div className={s.qhistEmpty}>Gesprekken laden…</div>
          )}
          {!sessionsLoading && sessions.length === 0 && (
            <div className={s.qhistEmpty}>
              Nog geen gesprekken.<br />
              Stel een vraag — elk gesprek komt hier te staan.
            </div>
          )}
          {sessions.map(sess => (
            <div key={sess.id} className={`${s.sessRow} ${sess.id === currentSessionId ? s.sessRowOn : ''}`}>
              <button
                type="button"
                className={s.sessMain}
                onClick={() => onPickSession?.(sess.id)}
                role="menuitem"
                title={sess.title || '(zonder titel)'}
              >
                <span className={s.qhistQ}>{sess.title || '(zonder titel)'}</span>
                {/* Zelfde drie feiten als het topbar-paneel (HistoryPanel):
                    titel, aantal berichten, hoe lang geleden. */}
                <span className={s.sessMeta}>
                  {sess.message_count > 0 ? `${sess.message_count} berichten · ` : ''}{relTime(sess.updated_at)} geleden
                </span>
              </button>
              <button
                type="button"
                className={s.sessDel}
                title="Verwijder dit gesprek"
                aria-label="Verwijder gesprek"
                onClick={() => { if (window.confirm(`Verwijder gesprek "${sess.title || 'zonder titel'}"?`)) onDeleteSession?.(sess.id) }}
              >
                {Ico.close}
              </button>
            </div>
          ))}
        </>
      ) : prompts.length === 0 ? (
        <div className={s.qhistEmpty}>
          Nog geen vragen gesteld.<br />
          Wat je verstuurt komt hier vanzelf te staan — ook na een reload.
        </div>
      ) : prompts.map(item => (
        <button
          key={item.ts}
          type="button"
          className={s.qhistItem}
          onClick={() => onPickPrompt?.(item.q)}
          role="menuitem"
          title={item.q}
        >
          <span className={s.qhistIco}>{Ico.clock}</span>
          <span className={s.qhistQ}>{item.q}</span>
          <span className={s.qhistTime}>{relTime(item.ts)}</span>
        </button>
      ))}
    </div>
  )
}

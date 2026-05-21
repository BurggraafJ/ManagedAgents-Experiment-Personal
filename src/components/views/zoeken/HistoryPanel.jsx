import { useEffect } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { relTime } from '../../../lib/rag'

// Geschiedenis-paneel (slide-in vanaf rechts) met persistent chat-sessies
// uit Supabase tabel rag_chat_sessions. Eén rij per gesprek, recentste
// eerst. Klik = laad die sessie. X-knop verwijdert permanent (na bevestiging).
export default function HistoryPanel({
  open, sessions, currentSessionId, loading,
  onClose, onPick, onDelete, onNew,
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {open && <div className={s.scrim} onClick={onClose} aria-hidden />}
      <aside className={`${s.histPanel} ${open ? s.histPanelOpen : ''}`}
             aria-hidden={!open}
             aria-label="Geschiedenis van gesprekken">
        <div className={s.histHead}>
          <div className={s.histTitle}>
            <div className={s.histTitleH}>Geschiedenis</div>
            <div className={s.histTitleSub}>
              {loading
                ? 'laden…'
                : sessions.length === 0
                ? 'nog geen gesprekken'
                : `${sessions.length} ${sessions.length === 1 ? 'gesprek' : 'gesprekken'}`}
            </div>
          </div>
          <button className={s.histClose} onClick={onClose} title="Sluit (Esc)">
            {Ico.close}
          </button>
        </div>
        <div className={s.histToolbar}>
          <button className={s.histNewBtn} onClick={onNew}>
            {Ico.plus} Nieuw gesprek
          </button>
        </div>
        <div className={s.histList}>
          {sessions.length === 0 && !loading && (
            <div className={s.histEmpty}>Stel een vraag om je eerste gesprek op te bouwen.</div>
          )}
          {sessions.map((sess) => (
            <SessionRow
              key={sess.id}
              sess={sess}
              active={sess.id === currentSessionId}
              onPick={() => onPick?.(sess.id)}
              onDelete={() => {
                if (window.confirm(`Verwijder gesprek "${sess.title}"?`)) onDelete?.(sess.id)
              }}
            />
          ))}
        </div>
      </aside>
    </>
  )
}

function SessionRow({ sess, active, onPick, onDelete }) {
  return (
    <div className={`${s.histItem} ${active ? s.histItemActive : ''}`}>
      <button type="button" className={s.histItemMain} onClick={onPick}>
        <div className={s.histItemQ}>{sess.title || '(zonder titel)'}</div>
        <div className={s.histItemMeta}>
          {sess.message_count > 0 && <>{sess.message_count} berichten · </>}
          {relTime(sess.updated_at)} geleden
        </div>
      </button>
      <button
        type="button"
        className={s.histItemDel}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        title="Verwijder dit gesprek"
        aria-label="Verwijder gesprek"
      >
        {Ico.close}
      </button>
    </div>
  )
}

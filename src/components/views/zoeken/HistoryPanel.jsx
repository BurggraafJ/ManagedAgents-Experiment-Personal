import { useEffect } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { relTime } from '../../../lib/rag'

// Geschiedenis-paneel rechts (slide-in) met alle user-vragen in deze sessie.
// Klik = scrollt naar die positie in de thread. Niet persistent over
// sessies (alleen huidige messages-array).
export default function HistoryPanel({ open, messages, onClose, onJump }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Vind alle user-vragen met hun index in messages-array.
  const userQuestions = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user') userQuestions.push({ idx: i, content: m.content, ts: m.ts })
  }
  // Recentste bovenaan
  userQuestions.reverse()

  return (
    <>
      {open && <div className={s.scrim} onClick={onClose} aria-hidden />}
      <aside className={`${s.histPanel} ${open ? s.histPanelOpen : ''}`}
             aria-hidden={!open}
             aria-label="Geschiedenis van vragen in dit gesprek">
        <div className={s.histHead}>
          <div className={s.histTitle}>
            <div className={s.histTitleH}>Geschiedenis</div>
            <div className={s.histTitleSub}>
              {userQuestions.length === 0 ? 'nog geen vragen' : `${userQuestions.length} ${userQuestions.length === 1 ? 'vraag' : 'vragen'} in dit gesprek`}
            </div>
          </div>
          <button className={s.histClose} onClick={onClose} title="Sluit (Esc)">
            {Ico.close}
          </button>
        </div>
        <div className={s.histList}>
          {userQuestions.length === 0 && (
            <div className={s.histEmpty}>Stel een vraag om geschiedenis op te bouwen.</div>
          )}
          {userQuestions.map((q) => (
            <button
              key={q.idx}
              type="button"
              className={s.histItem}
              onClick={() => { onJump?.(q.idx); onClose?.() }}
            >
              <div className={s.histItemQ}>{q.content}</div>
              {q.ts && <div className={s.histItemTs}>{relTime(q.ts)} geleden</div>}
            </button>
          ))}
        </div>
      </aside>
    </>
  )
}

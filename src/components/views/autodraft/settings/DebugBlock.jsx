import { useState } from 'react'
import { AGENT } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

export default function DebugBlock({ recentRuns, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const runs = (recentRuns || [])
    .filter(r => r.agent_name === AGENT || r.agent_name === 'auto-draft-execute')
    .slice(0, 20)
  return (
    <section className="va-block">
      {alwaysOpen ? (
        <div className={`va-block__head ${styles.cursorDefault}`}>
          <span className="va-block__title">Debug · recente runs</span>
          <span className="muted va-block__hint">alleen om te zien waar iets faalt</span>
        </div>
      ) : (
        <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
          <span className="va-block__caret">{open ? '▾' : '▸'}</span>
          <span className="va-block__title">Debug · recente runs</span>
          <span className="muted va-block__hint">alleen om te zien waar iets faalt</span>
        </button>
      )}
      {open && (
        <div className="va-block__body">
          {runs.length === 0 ? (
            <div className={`empty empty--compact ${styles.debugEmpty}`}>Geen runs.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Skill</th><th>Start</th><th>Status</th><th>Opmerking</th></tr></thead>
                <tbody>
                  {runs.map(r => {
                    const s = r.stats || {}
                    const note = s.error || s.blocker || s.note || ''
                    return (
                      <tr key={r.id || r.started_at}>
                        <td className={`mono ${styles.tableMono11}`}>{r.agent_name}</td>
                        <td className={`mono ${styles.tableMono11}`}>
                          {new Date(r.started_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td><span className={`pill s-${r.status}`}>{r.status}</span></td>
                        <td className={`muted ${styles.tableNote}`}>
                          {typeof note === 'string' ? note.slice(0, 120) : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

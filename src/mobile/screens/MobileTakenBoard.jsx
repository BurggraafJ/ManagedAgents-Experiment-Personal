import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import MIcon from '../MIcon'
import MobileTaskRow from './MobileTakenRow'
import { STAGES, STAGE_LABEL, STAGE_HINT, stageOf, tagsForStage, groupBy } from '../../lib/taskViews'

// Projectbord op mobiel (A2): terugknop, projectkop met voortgang, fase-strip
// (3 tegels die naar de sectie springen) en drie gestapelde fase-secties
// Te doen → Bezig → Testen. Fase wisselen = tik op de rij → keuze-sheet
// (zelfde `wip`/`testen`-tags als het desktop-bord). Afvinken via de cirkel.
export default function MobileTakenBoard({ project: p, onBack, onComplete }) {
  const [sheetTask, setSheetTask] = useState(null)
  // Optimistische fase-wissel: override tot de server-rij dezelfde fase heeft.
  const [stageOv, setStageOv] = useState(() => new Map())
  useEffect(() => {
    if (stageOv.size === 0) return
    const next = new Map(stageOv)
    let changed = false
    for (const t of p.open) if (next.has(t.id) && stageOf(t) === next.get(t.id)) { next.delete(t.id); changed = true }
    if (changed) setStageOv(next)
  }, [p.open])

  const by = useMemo(
    () => groupBy(p.open, t => stageOv.get(t.id) || stageOf(t)),
    [p.open, stageOv],
  )

  const moveStage = async (task, stage) => {
    setSheetTask(null)
    if ((stageOv.get(task.id) || stageOf(task)) === stage) return
    setStageOv(prev => new Map(prev).set(task.id, stage))
    const { error } = await supabase.from('tasks').update({ tags: tagsForStage(task.tags, stage) }).eq('id', task.id)
    if (error) setStageOv(prev => { const n = new Map(prev); n.delete(task.id); return n })
  }

  const jump = (s) => document.getElementById(`m-tkstage-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const pct = p.total ? (p.done.length / p.total) * 100 : 0

  return (
    <>
      <header className="m-pv__head m-tk__head m-tkboard__head">
        <button type="button" className="m-tk__back" onClick={onBack}>
          <span className="m-tk__back-ic"><MIcon name="chevron" size={20} color="#121212" stroke={2.2} /></span>Projecten
        </button>
        <div className="m-tkboard__title">
          <span className="m-tkboard__icon">{p.icon || '📁'}</span>{p.name}
          <span className="m-projrow__prog">{p.done.length}/{p.total} klaar</span>
        </div>
        <div className="m-tkbar m-tkbar--head"><span style={{ width: `${pct}%`, background: p.color || '#7c8aff' }} /></div>
        <div className="m-tkstrip" role="tablist" aria-label="Fases">
          {STAGES.map(s => (
            <button key={s} type="button" className={`m-tkstrip__cell m-tkstrip__cell--${s}`} onClick={() => jump(s)}>
              <b>{(by.get(s) || []).length}</b><span>{STAGE_LABEL[s]}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="m-tk__body">
        {STAGES.map(s => {
          const rows = by.get(s) || []
          return (
            <section key={s} id={`m-tkstage-${s}`} className="m-tkgroup">
              <header className={`m-tkgroup__head m-tkgroup__head--stage m-tkgroup__head--${s}`}>
                <i className="m-tkgroup__mark" />{STAGE_LABEL[s]}<em>{STAGE_HINT[s]}</em><span>{rows.length}</span>
              </header>
              {rows.map(t => <MobileTaskRow key={t.id} task={t} variant="board" onComplete={onComplete} onTap={setSheetTask} />)}
              {rows.length === 0 && <div className="m-tkgroup__empty">Nog niets in {STAGE_LABEL[s].toLowerCase()}</div>}
            </section>
          )
        })}
      </div>

      {sheetTask && (
        <>
          <div className="m-scrim" onClick={() => setSheetTask(null)} />
          <div className="m-sheet m-tksheet" role="dialog" aria-modal="true" aria-label="Taak verplaatsen">
            <div className="m-drawer__grab" />
            <div className="m-sheet__head">
              <span className="m-drawer__title m-tksheet__title">{sheetTask.title}</span>
              <button type="button" className="m-drawer__close" onClick={() => setSheetTask(null)} aria-label="Sluiten">
                <MIcon name="close" size={16} />
              </button>
            </div>
            <div className="m-sheet__body m-tksheet__body">
              <div className="m-field__label">Verplaats naar</div>
              {STAGES.map(s => {
                const cur = (stageOv.get(sheetTask.id) || stageOf(sheetTask)) === s
                return (
                  <button key={s} type="button" className={`m-tksheet__opt m-tksheet__opt--${s} ${cur ? 'is-current' : ''}`} onClick={() => moveStage(sheetTask, s)}>
                    <i />{STAGE_LABEL[s]}<em>{STAGE_HINT[s]}</em>{cur && <MIcon name="check" size={16} color="#121212" stroke={2.4} />}
                  </button>
                )
              })}
              <button type="button" className="m-tksheet__done" onClick={() => { const id = sheetTask.id; setSheetTask(null); onComplete(id) }}>
                <MIcon name="check" size={16} color="#fff" stroke={2.6} />Afronden
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

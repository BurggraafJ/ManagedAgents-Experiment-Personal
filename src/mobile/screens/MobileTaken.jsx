import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useTasks } from '../../hooks/useTasks'
import { useOptimisticTasks } from '../../hooks/useOptimisticTasks'
import { useLongPressDrag } from '../../hooks/useLongPressDrag'
import MIcon from '../MIcon'
import MobileNewTask from './MobileNewTask'
import MobileTaskRow from './MobileTakenRow'
import MobileTaskSheet from './MobileTaskSheet'
import MobileTakenBoard from './MobileTakenBoard'
import { mockupPrioToDb } from '../../components/views/taken-v2/v2-helpers'
import {
  isMijnTask, prioOf, PRIOS, PRIO_LABEL, dueOf, sortByDue, groupBy, deriveProjects,
  STAGES, STAGE_LABEL,
} from '../../lib/taskViews'

// MobileTaken (v1.125, design "A2") — Postvak-achtige iOS-segment
// Mijn taken | Projecten. Mijn taken groepeert op prioriteit (Hoog/Middel/Laag,
// sticky koppen), datum rechts als meta. Projecten = projectlijst → bord met
// drie gestapelde fases (MobileTakenBoard). Jira / Sales / Nieuw bestaan niet
// meer in de UI (product-cut 2026-09-01). Afvinken = status 'done'
// (optimistisch verborgen). FAB opent de MobileNewTask-sheet.
//
// v1.205 — twee dingen die de desktop al had en de telefoon niet:
//   • ingedrukt houden en slepen naar een andere prio-groep (of de backlog),
//     via useLongPressDrag. De groepskoppen zijn de drop-zones.
//   • tikken op een rij opent het taakdetail (MobileTaskSheet) met een
//     beschrijving. Geen zijpaneel op een telefoon, dus een sheet.
const SEGS = [{ key: 'mijn', label: 'Mijn taken' }, { key: 'proj', label: 'Projecten' }]

export default function MobileTaken() {
  const { tasks: rawTasks, projects, refresh } = useTasks()
  const { merged: tasks, applyOptimistic } = useOptimisticTasks(rawTasks)
  const [seg, setSeg] = useState('mijn')
  const [projId, setProjId] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [backlogOpen, setBacklogOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [justDone, setJustDone] = useState(() => new Set())

  const complete = async (id) => {
    setJustDone(prev => new Set(prev).add(id))
    const { error } = await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id)
    if (error) setJustDone(prev => { const n = new Set(prev); n.delete(id); return n })
    else refresh()
  }

  // Elke mutatie langs één pad: eerst lokaal tonen, dan wegschrijven.
  const mutate = useCallback(async (id, patch) => {
    applyOptimistic(id, patch)
    await supabase.from('tasks').update(patch).eq('id', id)
  }, [applyOptimistic])

  // Optimistisch: afgevinkte rijen meteen weg, ook uit de tellers.
  const live = useMemo(() => tasks.filter(t => !justDone.has(t.id)), [tasks, justDone])
  const mijn = useMemo(() => sortByDue(live.filter(t => isMijnTask(t) && !t.in_backlog)), [live])
  const backlog = useMemo(() => sortByDue(live.filter(t => isMijnTask(t) && t.in_backlog)), [live])
  const projList = useMemo(() => deriveProjects(live, projects), [live, projects])
  const byPrio = useMemo(() => groupBy(mijn, prioOf), [mijn])

  const overdue = mijn.filter(t => dueOf(t).bucket === 'overdue').length
  const today = mijn.filter(t => dueOf(t).bucket === 'today').length
  const projOpen = projList.reduce((n, p) => n + p.open.length, 0)
  const projActive = projList.filter(p => p.open.length > 0).length
  const counts = { mijn: mijn.length, proj: projActive }
  const proj = projList.find(p => p.id === projId) || null
  const detailTask = detailId ? tasks.find(t => t.id === detailId) : null

  // Sleep-doel → wat er verandert. 'backlog' parkeert (de prio blijft staan),
  // een prio-groep zet de prio én haalt de taak zo nodig uit de backlog.
  // Landt een taak waar hij al stond, dan gebeurt er niets — geen lege update
  // die de realtime-lus wakker maakt.
  const byId = useMemo(() => new Map(live.map(t => [t.id, t])), [live])
  const onDropTask = useCallback((id, zone) => {
    const t = byId.get(id)
    if (!t) return
    if (zone === 'backlog') {
      if (t.in_backlog) return
      return mutate(id, { in_backlog: true })
    }
    if (!PRIOS.includes(zone)) return
    const patch = {}
    if (prioOf(t) !== zone) patch.priority = mockupPrioToDb(zone)
    if (t.in_backlog) patch.in_backlog = false
    if (Object.keys(patch).length === 0) return
    mutate(id, patch)
  }, [byId, mutate])

  const { drag, rowProps, swallowClick } = useLongPressDrag({ onDrop: onDropTask })
  // Tijdens een sleep staan alle drie de groepen er, ook de lege: anders kun
  // je niet naar een groep slepen die op dat moment toevallig geen taak heeft.
  const groupKeys = drag ? PRIOS : PRIOS.filter(k => byPrio.has(k))

  // Sticky groepskoppen moeten ónder de sticky header blijven hangen →
  // header-hoogte als CSS-var op de container (data-driven, mag inline).
  const headRef = useRef(null)
  const [headH, setHeadH] = useState(0)
  useEffect(() => {
    const el = headRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setHeadH(el.offsetHeight))
    ro.observe(el)
    setHeadH(el.offsetHeight)
    return () => ro.disconnect()
  }, [seg])

  return (
    <div className="m-dash m-tk" style={{ '--m-tk-head-h': `${headH}px` }}>
      {seg === 'proj' && proj ? (
        <MobileTakenBoard project={proj} onBack={() => setProjId(null)} onComplete={complete} />
      ) : (
        <>
          <header className="m-pv__head m-tk__head" ref={headRef}>
            <div className="m-tk__head-top">
              <div className="m-tk__eyebrow">WERKRUIMTE<span>Taken</span></div>
              <span className="m-tk__stats">
                {seg === 'mijn' ? `${overdue} verlopen · ${today} vandaag` : `${projOpen} open in ${projActive} ${projActive === 1 ? 'project' : 'projecten'}`}
              </span>
            </div>
            <div className="m-pvseg m-tk__seg" role="tablist">
              {SEGS.map(s => (
                <button key={s.key} type="button" role="tab" aria-selected={seg === s.key}
                  className={`m-pvseg__btn ${seg === s.key ? 'is-active' : ''}`} onClick={() => setSeg(s.key)}>
                  {s.label}<span className="m-tk__segcnt">{counts[s.key]}</span>
                </button>
              ))}
            </div>
          </header>

          <div className="m-tk__body" onClickCapture={swallowClick}>
            {seg === 'mijn' ? (
              <>
                {mijn.length === 0 && !drag && <div className="m-tk__empty">Geen open taken. Lekker bezig.</div>}
                {groupKeys.map(k => {
                  const rows = byPrio.get(k) || []
                  return (
                    <section key={k} data-dropzone={k}
                      className={`m-tkgroup ${drag ? 'is-target' : ''} ${drag?.zone === k ? 'is-over' : ''}`}>
                      <header className={`m-tkgroup__head m-tkgroup__head--${k}`}>
                        <i className="m-tkgroup__mark" />{PRIO_LABEL[k]}<span>{rows.length}</span>
                      </header>
                      {rows.map(t => (
                        <MobileTaskRow
                          key={t.id} task={t} onComplete={complete} onTap={() => setDetailId(t.id)}
                          dragging={drag?.id === t.id} dragProps={rowProps(t.id, t.title)}
                        />
                      ))}
                      {rows.length === 0 && <div className="m-tkgroup__empty">Sleep een taak hierheen</div>}
                    </section>
                  )
                })}
                {(backlog.length > 0 || drag) && (
                  <>
                    <button type="button" data-dropzone="backlog"
                      className={`m-tk__backlog ${drag ? 'is-target' : ''} ${drag?.zone === 'backlog' ? 'is-over' : ''}`}
                      onClick={() => setBacklogOpen(o => !o)} aria-expanded={backlogOpen}>
                      Backlog · {backlog.length} geparkeerd {drag ? '— laat hier los om te parkeren' : (backlogOpen ? '▴' : '▾')}
                    </button>
                    {backlogOpen && (
                      <section className="m-tkgroup m-tkgroup--backlog">
                        {backlog.map(t => (
                          <MobileTaskRow
                            key={t.id} task={t} onComplete={complete} onTap={() => setDetailId(t.id)}
                            dragging={drag?.id === t.id} dragProps={rowProps(t.id, t.title)}
                          />
                        ))}
                      </section>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {projList.length === 0 && <div className="m-tk__empty">Nog geen projecten.</div>}
                {projList.map(p => <ProjectRow key={p.id} p={p} onOpen={() => setProjId(p.id)} />)}
              </>
            )}
          </div>
        </>
      )}

      <button type="button" className="m-fab" onClick={() => setNewOpen(true)} aria-label="Nieuwe taak">
        <MIcon name="plus" size={24} color="#fff" stroke={2.2} />
      </button>
      <MobileNewTask open={newOpen} onClose={() => setNewOpen(false)} onCreated={refresh} projectId={seg === 'proj' ? proj?.id : null} />

      {/* Het sleepbeeld volgt de vinger. Positie is een gemeten afmeting, dus
          inline (CLAUDE.md § conventies); alle vormgeving staat in mobile.css. */}
      {drag && (
        <div className="m-tkghost" style={{ left: `${drag.left}px`, top: `${drag.top}px`, width: `${drag.width}px` }} aria-hidden>
          <span className="m-tkghost__title">{drag.label}</span>
          <span className="m-tkghost__hint">
            {drag.zone === 'backlog' ? '→ Backlog' : drag.zone ? `→ ${PRIO_LABEL[drag.zone]}` : 'sleep naar een groep'}
          </span>
        </div>
      )}

      {detailTask && (
        <MobileTaskSheet task={detailTask} onClose={() => setDetailId(null)} onMutate={mutate} onComplete={complete} />
      )}
    </div>
  )
}

/** Projectrij: icoon, naam, voortgang x/y + balk in projectkleur, fase-tellers. */
export function ProjectRow({ p, onOpen }) {
  const pct = p.total ? Math.round((p.done.length / p.total) * 100) : 0
  return (
    <button type="button" className="m-projrow" onClick={onOpen}>
      <span className="m-projrow__icon">{p.icon || '📁'}</span>
      <span className="m-projrow__main">
        <span className="m-projrow__top">
          <span className="m-projrow__name">{p.name}</span>
          <span className="m-projrow__prog">{p.done.length}/{p.total}</span>
        </span>
        <span className="m-tkbar"><span style={{ width: `${pct}%`, background: p.color || '#7c8aff' }} /></span>
        <span className="m-stagedots">
          {STAGES.map(s => (
            <span key={s} className={`m-stagedots__it m-stagedots__it--${s}`}><i />{STAGE_LABEL[s]} <b>{p.stageCount[s]}</b></span>
          ))}
        </span>
      </span>
      <MIcon name="chevron" size={18} color="#a6a6a6" stroke={2} />
    </button>
  )
}

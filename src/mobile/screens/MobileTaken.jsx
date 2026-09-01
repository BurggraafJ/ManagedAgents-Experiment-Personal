import { useState, useMemo, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useTasks } from '../../hooks/useTasks'
import MIcon from '../MIcon'
import MobileNewTask from './MobileNewTask'
import MobileTaskRow from './MobileTakenRow'
import MobileTakenBoard from './MobileTakenBoard'
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
const SEGS = [{ key: 'mijn', label: 'Mijn taken' }, { key: 'proj', label: 'Projecten' }]

export default function MobileTaken() {
  const { tasks, projects, refresh } = useTasks()
  const [seg, setSeg] = useState('mijn')
  const [projId, setProjId] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [backlogOpen, setBacklogOpen] = useState(false)
  const [justDone, setJustDone] = useState(() => new Set())

  const complete = async (id) => {
    setJustDone(prev => new Set(prev).add(id))
    const { error } = await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id)
    if (error) setJustDone(prev => { const n = new Set(prev); n.delete(id); return n })
    else refresh()
  }

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

          <div className="m-tk__body">
            {seg === 'mijn' ? (
              <>
                {mijn.length === 0 && <div className="m-tk__empty">Geen open taken. Lekker bezig.</div>}
                {PRIOS.filter(k => byPrio.has(k)).map(k => (
                  <section key={k} className="m-tkgroup">
                    <header className={`m-tkgroup__head m-tkgroup__head--${k}`}>
                      <i className="m-tkgroup__mark" />{PRIO_LABEL[k]}<span>{byPrio.get(k).length}</span>
                    </header>
                    {byPrio.get(k).map(t => <MobileTaskRow key={t.id} task={t} onComplete={complete} />)}
                  </section>
                ))}
                {backlog.length > 0 && (
                  <>
                    <button type="button" className="m-tk__backlog" onClick={() => setBacklogOpen(o => !o)} aria-expanded={backlogOpen}>
                      Backlog · {backlog.length} geparkeerd {backlogOpen ? '▴' : '▾'}
                    </button>
                    {backlogOpen && (
                      <section className="m-tkgroup m-tkgroup--backlog">
                        {backlog.map(t => <MobileTaskRow key={t.id} task={t} onComplete={complete} />)}
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

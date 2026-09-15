import { useEffect, useRef, useState } from 'react'
import MIcon from '../MIcon'
import { useSheetDrag } from '../../hooks/useSheetDrag'
import { keyboardInset } from '../../lib/keyboardInset'
import { TASK_TYPES } from '../../components/views/taken-v2/V2TypePop'
import { mockupPrioToDb, ymd } from '../../components/views/taken-v2/v2-helpers'
import { PRIOS, PRIO_LABEL, prioOf } from '../../lib/taskViews'

/* MobileTaskSheet — het mobiele detail van één taak (v1.205).
 *
 * De desktop heeft een zijpaneel (V2TaskDetail); op de telefoon is er geen
 * ruimte naast de lijst, dus wordt het dezelfde inhoud als bottom-sheet. Geen
 * nieuwe navigatie-structuur, geen eigen route: hij hoort bij de rij waar je
 * op tikte en gaat weer dicht waar je hem opende.
 *
 * Wat erin moet (de reden dat hij bestaat): een beschrijving schrijven en
 * teruglezen. De rest — prioriteit, deadline, categorie, backlog, afronden,
 * weggooien — is dezelfde set als het zijpaneel, zodat mobiel en desktop niet
 * uit elkaar lopen over wat je met een taak kunt.
 *
 * Opslaan gebeurt op blur (net als het zijpaneel) plus expliciet bij het
 * sluiten: op een telefoon sluit je een sheet vaker met een veeg dan met een
 * tik buiten het veld, en dan heeft de textarea nooit blur gehad.
 */
function isoPlusDays(days) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days)
  return ymd(d)
}

export default function MobileTaskSheet({ task, onClose, onMutate, onComplete }) {
  const [title, setTitle] = useState(task.title || '')
  const [notes, setNotes] = useState(task.notes || '')
  const [confirmDel, setConfirmDel] = useState(false)
  const notesRef = useRef(null)
  const latest = useRef({ title, notes })
  latest.current = { title, notes }

  const drag = useSheetDrag({ onClose: () => close() })

  useEffect(() => {
    setTitle(task.title || '')
    setNotes(task.notes || '')
    setConfirmDel(false)
  }, [task.id])

  // Tabbar + FAB weg en achtergrond-scroll op slot zolang de sheet openstaat;
  // en de sheet boven het toetsenbord houden (zelfde aanpak als MobileNewTask).
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('m-modal-open')
    const vv = window.visualViewport
    const apply = () => root.style.setProperty('--m-kb', `${keyboardInset(vv)}px`)
    if (vv) {
      apply()
      vv.addEventListener('resize', apply)
      vv.addEventListener('scroll', apply)
    }
    return () => {
      if (vv) {
        vv.removeEventListener('resize', apply)
        vv.removeEventListener('scroll', apply)
      }
      root.style.setProperty('--m-kb', '0px')
      root.classList.remove('m-modal-open')
    }
  }, [])

  const save = (patch) => onMutate?.(task.id, patch)

  // Alles wat nog niet is weggeschreven meenemen — een veeg omlaag is ook een
  // "klaar", niet een "annuleer".
  const flush = () => {
    const patch = {}
    const t = latest.current.title.trim()
    if (t && t !== (task.title || '')) patch.title = t
    if (latest.current.notes !== (task.notes || '')) patch.notes = latest.current.notes || null
    if (Object.keys(patch).length) save(patch)
  }
  const close = () => { flush(); onClose?.() }

  const prio = prioOf(task)
  const deadline = task.deadline || ''
  const deadPresets = [
    { key: isoPlusDays(0), label: 'Vandaag' },
    { key: isoPlusDays(1), label: 'Morgen' },
    { key: isoPlusDays(7), label: 'Deze week' },
  ]
  const done = task.status === 'done'

  return (
    <>
      <div className="m-scrim" onClick={close} />
      <div className="m-sheet m-tkdetail" role="dialog" aria-modal="true" aria-label="Taakdetail" style={drag.dragStyle}>
        <div className="m-sheet__drag" {...drag.handleProps}>
          <div className="m-drawer__grab" aria-hidden />
        </div>
        <div className="m-sheet__head">
          <span className={`m-tkdetail__prio m-tkdetail__prio--${prio}`}>{PRIO_LABEL[prio]}</span>
          {task.in_backlog && <span className="m-tkdetail__flag">Backlog</span>}
          <button type="button" className="m-drawer__close" onClick={close} aria-label="Sluiten">
            <MIcon name="close" size={16} />
          </button>
        </div>

        <div className="m-sheet__body m-tkdetail__body">
          <textarea
            className="m-tkdetail__title"
            value={title}
            rows={2}
            placeholder="Taak-titel…"
            onChange={e => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim()
              if (t && t !== (task.title || '')) save({ title: t })
            }}
          />

          <div className="m-field">
            <div className="m-field__label">Beschrijving</div>
            <textarea
              ref={notesRef}
              className="m-tkdetail__notes"
              value={notes}
              rows={6}
              placeholder="Wat moet er gebeuren? Context, links, afspraken…"
              onChange={e => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (task.notes || '')) save({ notes: notes || null }) }}
            />
          </div>

          <div className="m-field">
            <div className="m-field__label">Prioriteit</div>
            <div className="m-seg">
              {PRIOS.map(p => (
                <button
                  key={p} type="button"
                  className={`m-segbtn m-segbtn--${p} ${prio === p ? 'is-active' : ''}`}
                  onClick={() => save({ priority: mockupPrioToDb(p) })}
                ><span className="m-segbtn__dot" />{PRIO_LABEL[p]}</button>
              ))}
            </div>
          </div>

          <div className="m-field">
            <div className="m-field__label">Deadline</div>
            <div className="m-deadchips">
              {deadPresets.map(d => (
                <button
                  key={d.key} type="button"
                  className={`m-deadchip ${deadline === d.key ? 'is-active' : ''}`}
                  onClick={() => save({ deadline: deadline === d.key ? null : d.key, deadline_kind: 'day' })}
                >{d.label}</button>
              ))}
              <label className={`m-deadchip m-deadchip--date ${deadline && !deadPresets.some(d => d.key === deadline) ? 'is-active' : ''}`}>
                <MIcon name="cal" size={13} />
                <span>{deadline && !deadPresets.some(d => d.key === deadline) ? deadline : 'Kies datum'}</span>
                <input type="date" value={deadline} onChange={e => save({ deadline: e.target.value || null, deadline_kind: 'day' })} />
              </label>
            </div>
          </div>

          <div className="m-field">
            <div className="m-field__label">Categorie</div>
            <div className="m-deadchips">
              {TASK_TYPES.map(ty => (
                <button
                  key={ty.id} type="button"
                  className={`m-deadchip ${task.task_type === ty.id ? 'is-active' : ''}`}
                  onClick={() => save({ task_type: task.task_type === ty.id ? null : ty.id, task_type_suggested: false })}
                >{ty.icon} {ty.label}</button>
              ))}
            </div>
            {task.task_type && task.task_type_suggested && (
              <p className="m-tkdetail__hint">Voorstel van de taken-skill — tik om te bevestigen of kies een andere.</p>
            )}
          </div>

          {task.ai_reasoning && (
            <div className="m-field">
              <div className="m-field__label">AI-notitie</div>
              <p className="m-tkdetail__ai">{task.ai_reasoning}</p>
            </div>
          )}

          <div className="m-field m-tkdetail__acties">
            <button type="button" className="m-admbtn" onClick={() => save({ in_backlog: !task.in_backlog })}>
              {task.in_backlog ? 'Terug uit backlog' : 'Parkeer in backlog'}
            </button>
            {confirmDel ? (
              <button type="button" className="m-admbtn m-admbtn--warn" onClick={() => { save({ status: 'dropped' }); onClose?.() }}>
                Zeker weten? Weggooien
              </button>
            ) : (
              <button type="button" className="m-admbtn m-admbtn--warn" onClick={() => setConfirmDel(true)}>Weggooien</button>
            )}
          </div>
        </div>

        <div className="m-sheet__cta">
          <button
            type="button" className="m-sheet__add m-tkdetail__done"
            onClick={() => {
              flush()
              if (done) save({ status: 'open', completed_at: null })
              else onComplete?.(task.id)
              onClose?.()
            }}
          >
            <MIcon name="check" size={18} color="#fff" stroke={2.4} />{done ? 'Heropen taak' : 'Markeer als afgerond'}
          </button>
        </div>
      </div>
    </>
  )
}

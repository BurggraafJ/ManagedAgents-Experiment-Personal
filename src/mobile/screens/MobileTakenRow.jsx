import { useState } from 'react'
import MIcon from '../MIcon'
import { TYPE_BY_ID } from '../../components/views/taken-v2/V2TypePop'
import { dueOf, prioOf } from '../../lib/taskViews'

// Eén platte taak-rij (A2-look: hairline, ronde afvinkcirkel, datum rechts).
// Bij afvinken: korte "gedaan"-animatie (vinkje + doorstreep + fade) vóór de
// rij uit de lijst valt — zodat de tik voelbaar registreert.
//   variant 'mijn'  → taaktype als grijze subregel
//   variant 'board' → rood bolletje vóór de titel bij prio Hoog, geen subregel
export default function MobileTaskRow({ task, variant = 'mijn', onComplete, onTap }) {
  const [completing, setCompleting] = useState(false)
  const tick = () => {
    if (completing) return
    setCompleting(true)
    setTimeout(() => onComplete(task.id), 300)
  }
  const due = dueOf(task)
  const type = task.task_type ? TYPE_BY_ID[task.task_type]?.label : null
  const hoog = prioOf(task) === 'hoog'
  const Main = onTap ? 'button' : 'div'
  return (
    <div className={`m-tkrow ${completing ? 'is-completing' : ''}`}>
      <button type="button" className="m-tkrow__check" onClick={tick} aria-label="Afvinken" aria-pressed={completing}>
        <MIcon name="check" size={14} color="#fff" stroke={2.6} />
      </button>
      <Main className="m-tkrow__main" onClick={onTap ? () => onTap(task) : undefined} type={onTap ? 'button' : undefined}>
        <div className="m-tkrow__title">
          {variant === 'board' && hoog && <span className="m-tkrow__dot" aria-label="Hoog" />}
          {task.title || '(taak zonder titel)'}
        </div>
        {variant === 'mijn' && type && <div className="m-tkrow__sub">{type}</div>}
      </Main>
      <span className={`m-tkrow__due m-tkrow__due--${due.bucket}`}>{due.bucket === 'none' ? '—' : due.label}</span>
    </div>
  )
}

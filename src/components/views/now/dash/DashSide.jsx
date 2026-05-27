import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { truncate } from '../../../../lib/now'
import Icon from '../Icon'

// DashSide — rechter kolom: snelle taak-capture + aankomende taken +
// "Morgen"-kaart. Capture schrijft direct naar tasks (zelfde payload als de
// Taken-quick-capture: source 'manual', ai_processed false → de taken-skill
// kent later project/deadline/prio toe). Verstuurt nooit mail o.i.d.

function CaptureCard() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  const add = async () => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true); setErr(false)
    const { error } = await supabase
      .from('tasks')
      .insert({ title: trimmed, source: 'manual', ai_processed: false })
    setBusy(false)
    if (error) { setErr(true); return }
    setText('')
  }

  return (
    <div className="side-card">
      <h3 className="side-card__title">Snelle taak toevoegen</h3>
      <div className="capture">
        <input
          className="capture__input"
          placeholder="Bv. Stibbe terugbellen vrijdag…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="capture__add" title="Toevoegen" onClick={add} disabled={busy || !text.trim()}>
          <Icon size={16}><path d="M12 5v14M5 12h14" /></Icon>
        </button>
      </div>
      <div className={`capture__hint ${err ? 'capture__hint--err' : ''}`}>
        {err
          ? 'Toevoegen mislukt — probeer opnieuw.'
          : <>Tip: typ <kbd>vrijdag</kbd> of <kbd>volgende week</kbd> en Maestro plant 'm.</>}
      </div>
    </div>
  )
}

function UpcomingTasks({ tasks, openTotal, goto }) {
  return (
    <div className="side-card">
      <h3 className="side-card__title side-card__title-row">
        <span>Aankomende taken</span>
        <a className="side-card__title-link" href="/taken" onClick={(e) => { e.preventDefault(); goto('/taken') }}>
          {tasks.length} van {openTotal} →
        </a>
      </h3>
      {tasks.length === 0 ? (
        <div className="up__empty">Geen openstaande taken — alles afgevinkt.</div>
      ) : (
        <div className="up">
          {tasks.map(t => (
            <a className="up__row" key={t.id} href="/taken" onClick={(e) => { e.preventDefault(); goto('/taken') }}>
              <div className={`up__date ${t.dateCls}`}>{t.dateLabel}<small>{t.dateSub}</small></div>
              <div className="up__body">
                <div className="up__title">{truncate(t.title, 60)}</div>
                <div className="up__meta"><span className={`up__prio ${t.prioCls}`} />{t.meta}</div>
              </div>
            </a>
          ))}
        </div>
      )}
      <a className="up__more" href="/taken" onClick={(e) => { e.preventDefault(); goto('/taken') }}>Bekijk alle taken →</a>
    </div>
  )
}

function TomorrowCard({ tomorrow, goto }) {
  const evs = tomorrow.events
  return (
    <div className="side-card dark">
      <h3 className="side-card__title">Morgen — {tomorrow.label}</h3>
      {evs.length === 0 ? (
        <div className="tomo-empty">Nog niets ingepland voor morgen.</div>
      ) : (
        <>
          {evs.slice(0, 4).map(e => (
            <div className="tomo-row" key={e.id}>
              <div className="tomo-row__time">{e.time}</div>
              <div className="tomo-row__lbl">
                {truncate(e.label, 42)}
                {e.location && <small>{truncate(e.location, 38)}</small>}
              </div>
            </div>
          ))}
          <div className="tomo-foot">{evs.length} {evs.length === 1 ? 'item' : 'items'} totaal</div>
        </>
      )}
    </div>
  )
}

export default function DashSide({ vm, goto }) {
  return (
    <aside className="side">
      <CaptureCard />
      <UpcomingTasks tasks={vm.upcomingTasks} openTotal={vm.openTaskTotal} goto={goto} />
      <TomorrowCard tomorrow={vm.tomorrow} goto={goto} />
    </aside>
  )
}

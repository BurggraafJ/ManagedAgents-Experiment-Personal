import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { truncate } from '../../lib/now'
import { useDashboard } from '../../hooks/useDashboard'
import MIcon from '../MIcon'

// MobileDashboard — mobiele "Vandaag"-cockpit. Geport uit
// app/mobile-dashboard-v2.jsx (MobileDashboard). Hergebruikt HETZELFDE
// useDashboard()-viewmodel als de desktop NowView — nul extra queries, nul
// data-duplicatie. Layout: hero → snelle-taak → NU-kaart → 3 wachtrij-rijen
// (mini-ring) → "Nu & vanmiddag"-timeline. De bottom tab bar zit in de shell.
const RING_R = 18
const RING_C = 2 * Math.PI * RING_R
const QUEUE_ICON = { admin: 'admin', taken: 'task', postvak: 'mail' }

function firstNameOf(name) { return (name || 'Jelle').trim().split(/\s+/)[0] }
function initialsOf(name) {
  return (name || 'Jelle Burggraaf').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export default function MobileDashboard({ badges = {}, profile = null, onOpenMore }) {
  const navigate = useNavigate()
  const goto = (p) => navigate(p)
  const vm = useDashboard({ badges })

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  // Zelfde payload als de desktop quick-capture (DashSide): de taken-skill kent
  // later project/deadline/prio toe. Verstuurt nooit mail o.i.d.
  const addTask = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true); setErr(false)
    const { error } = await supabase.from('tasks').insert({ title: t, source: 'manual', ai_processed: false })
    setBusy(false)
    if (error) { setErr(true); return }
    setText('')
  }

  const compactDate = new Date().toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
  const itemsLine = vm.itemsToGo > 0
    ? `Nog ${vm.itemsToGo} ${vm.itemsToGo === 1 ? 'item' : 'items'} te gaan.`
    : 'Niets meer op de agenda vandaag.'

  return (
    <div className="m-dash">
      <header className="m-dash__head">
        <div className="m-dash__head-top">
          <div className="m-brand">
            <div className="m-logo">
              <svg viewBox="0 0 36 38" width="14" height="14" fill="#fff" aria-hidden="true">
                <path d="M26 20.1c.4 0 .8.2 1.1.5L36 29.5l-3.5.1c-.4 0-.7.3-.7.7v2.7c0 .4-.4.7-.8.7h-2.8c-.4 0-.8.4-.8.8V38L18 28.7 8.7 38v-3.5c0-.4-.4-.8-.8-.8H5.1c-.4 0-.8-.4-.8-.8V30.3c0-.4-.4-.8-.8-.8L0 29.5l8.9-8.9c.3-.3.6-.5 1-.5H26Z" />
                <path d="M18 5.9 26.1 0v11.3c0 .4-.2.7-.5 1L18.9 17.7a1 1 0 0 1-1.5 0L10.4 12.3c-.3-.2-.5-.6-.5-1V0L18 5.9Z" />
              </svg>
            </div>
            <div className="m-date">{compactDate} · {vm.clock}</div>
          </div>
          <button type="button" className="m-avatar" onClick={onOpenMore} aria-label="Menu">
            {initialsOf(profile?.display_name)}
          </button>
        </div>
        <h1 className="m-greet">{vm.greeting}<br />{firstNameOf(profile?.display_name)}.</h1>
        <div className="m-greet-sub">
          <strong>{vm.doneTotal} verwerkt vandaag.</strong> {itemsLine}
        </div>
      </header>

      <div className="m-dash__list">
        {/* Snelle taak toevoegen */}
        <div className="m-quickadd">
          <input
            className="m-quickadd__input"
            placeholder="Snelle taak toevoegen…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTask() }}
          />
          <button type="button" className="m-quickadd__btn" onClick={addTask} disabled={busy || !text.trim()} aria-label="Taak toevoegen">
            <MIcon name="plus" size={18} stroke={2.2} />
          </button>
        </div>
        {err && <div className="m-quickadd__err">Toevoegen mislukt — probeer opnieuw.</div>}

        {/* NU-kaart */}
        {vm.nu ? (
          <div className="m-nu">
            <div className="m-nu__glow" />
            <div className="m-nu__row">
              <div className="m-nu__icon"><MIcon name="clock" size={18} color="#fff" /></div>
              <div className="m-nu__body">
                <div className="m-nu__eyebrow">{vm.nu.eyebrow}</div>
                <div className="m-nu__title">{vm.nu.title}</div>
                {vm.nu.sub && <div className="m-nu__sub">{vm.nu.sub}</div>}
              </div>
            </div>
            <div className="m-nu__actions">
              {vm.nu.onlineUrl && (
                <a className="m-nu__alt" href={vm.nu.onlineUrl} target="_blank" rel="noreferrer">
                  <MIcon name="video" size={14} color="#fff" /> Vergaderlink
                </a>
              )}
              <button type="button" className="m-nu__cta" onClick={() => goto(`/agenda/briefing/${vm.nu.eventId}`)}>
                Bekijk briefing <MIcon name="chevron" size={13} color="#fff" stroke={2.2} />
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="m-nu m-nu--empty" onClick={() => goto('/agenda')}>
            <div className="m-nu__eyebrow">Agenda</div>
            <div className="m-nu__title">Geen meeting meer vandaag</div>
            <div className="m-nu__sub">Je middag is vrij — mooi moment om de wachtrijen leeg te maken.</div>
          </button>
        )}

        {/* Wachtrijen */}
        <div className="m-sec">
          <span className="m-sec__lbl">Wachtrijen</span>
          <span className="m-sec__count">{vm.totalOpen} open · {vm.doneTotal} vandaag</span>
        </div>
        {vm.queues.map(q => <QueueRow key={q.key} q={q} goto={goto} />)}

        {/* Nu & vanmiddag */}
        <div className="m-sec m-sec--mt">
          <span className="m-sec__lbl">Nu &amp; vanmiddag</span>
          <span className="m-sec__count">{vm.timeline.length} {vm.timeline.length === 1 ? 'item' : 'items'}</span>
        </div>
        {vm.timeline.length === 0 ? (
          <div className="m-tl__empty">Geen afspraken meer vandaag.</div>
        ) : (
          vm.timeline.map(it => <TimelineRow key={it.id} it={it} goto={goto} />)
        )}
      </div>
    </div>
  )
}

function QueueRow({ q, goto }) {
  const dash = (q.pct / 100) * RING_C
  return (
    <a
      className={`m-queue m-queue--${q.tone}`}
      href={q.href}
      onClick={(e) => { e.preventDefault(); goto(q.href) }}
    >
      <div className="m-queue__ring">
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle className="m-queue__ring-bg" cx="22" cy="22" r={RING_R} />
          <circle className="m-queue__ring-fg" cx="22" cy="22" r={RING_R} strokeDasharray={`${dash.toFixed(1)} ${RING_C.toFixed(1)}`} />
        </svg>
        <div className="m-queue__ico"><MIcon name={QUEUE_ICON[q.icon] || 'admin'} size={12} /></div>
      </div>

      <div className="m-queue__txt">
        <div className="m-queue__eyebrow-row">
          <span className="m-queue__eyebrow">{q.eyebrow}</span>
          <span className="m-queue__pct">· {q.pct}% klaar</span>
        </div>
        <div className="m-queue__title">{q.title}</div>
        <div className="m-queue__stats">
          <span className="m-queue__stat">
            <span className="m-queue__dot m-queue__dot--done" />
            <span className="m-queue__stat-num">{q.done}</span> vandaag
          </span>
          <span className="m-queue__stat m-queue__stat--open">
            <span className="m-queue__dot m-queue__dot--open" />
            <span className="m-queue__stat-num">{q.open}</span> open
          </span>
        </div>
      </div>

      <span className="m-queue__chev"><MIcon name="chevron" size={14} /></span>
    </a>
  )
}

function TimelineRow({ it, goto }) {
  return (
    <a
      className="m-tl"
      href={`/agenda/briefing/${it.id}`}
      onClick={(e) => { e.preventDefault(); goto(`/agenda/briefing/${it.id}`) }}
    >
      <div className="m-tl__time">{it.time}<small>{it.dur}</small></div>
      <div className="m-tl__spine"><div className={`m-tl__dot ${it.isNow ? 'm-tl__dot--now' : ''}`} /></div>
      <div className={`m-tl__card ${it.isNow ? 'm-tl__card--now' : ''}`}>
        <div className="m-tl__ico"><MIcon name="cal" size={12} /></div>
        <div className="m-tl__body">
          <div className="m-tl__title">{it.title}</div>
          <div className="m-tl__meta">
            {it.online && <span className="m-tl__tag m-tl__tag--info">Online</span>}
            {!it.online && it.location ? `${truncate(it.location, 22)} · ` : ''}
            {it.dur}{it.isNow ? ' · nu' : ''}
          </div>
        </div>
        <span className="m-tl__chev"><MIcon name="chevron" size={12} /></span>
      </div>
    </a>
  )
}

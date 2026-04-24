import { useContext, useMemo, useState, useEffect } from 'react'
import MicButton from '../../MicButton'
import {
  PipelineLookupContext,
  HubSpotUsersContext,
  CATEGORIES,
  CATEGORY_LABEL,
  buildPipelineLookup,
  formatDateTime,
} from '../hubspot-common'
import {
  filterAgentProposals,
  groupProposals,
  computeMetrics,
} from '../hubspot-shared.jsx'
import { useProposalActions, actionDetails } from '../../useProposalActions'

// Mobiele Daily Admin — "Stack"-layout (mobile design #1 uit design-proposals).
// Eén voorstel tegelijk fullscreen; navigeer met ‹ › of tabs onderin (Goedkeuren,
// Meer info nodig, Logboek, Cijfers). Gebouwd als standalone component zodat
// het desktop-pad (HubSpotInboxAView) onaangetast blijft.
//
// Wordt ALLEEN gerenderd op viewports ≤ 768px via HubSpotInboxCompactView.
// Hergebruikt useProposalActions (dus alle inline-edit / Opnieuw / Doorvoeren
// logica werkt identiek), en bouwt eigen PipelineLookupContext +
// HubSpotUsersContext providers zodat de mobile card-renderer dezelfde
// dropdown-data ziet als desktop.
//
// Zie Confluence "Software Development → Dashboard Agent — Mobile Layout"
// voor het architectuur-overzicht en beslisregels.
export default function MobileDailyAdmin({ data, onRefresh }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const hubspotUsers = data.hubspotUsers || []
  const all = useMemo(() => filterAgentProposals(data), [data])
  const buckets = useMemo(() => groupProposals(all), [all])

  const metrics = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const weekStart = data.weekStart || (() => {
      const d = new Date(now)
      d.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      d.setHours(0, 0, 0, 0)
      return d
    })()
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000)
    return computeMetrics(all, todayStart, weekStart, lastWeekStart)
  }, [all, data.weekStart])

  const [tab, setTab] = useState('to_review') // to_review | need_input | log | kpi

  const stack = tab === 'to_review' ? buckets.to_review
             : tab === 'need_input' ? buckets.need_input
             : []
  const [idx, setIdx] = useState(0)

  // Reset index bij tab-wissel of als de stack krimpt onder de huidige index
  // (bv. nadat iets is goedgekeurd en uit de lijst valt).
  useEffect(() => {
    if (idx >= stack.length) setIdx(Math.max(0, stack.length - 1))
  }, [stack.length, idx])
  useEffect(() => { setIdx(0) }, [tab])

  const current = stack[idx] || null

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <HubSpotUsersContext.Provider value={hubspotUsers}>
      <div className="mda-root">
        <header className="mda-top">
          <h1 className="mda-top__title">Daily Admin</h1>
          <span className="mda-top__counter">
            {(tab === 'to_review' || tab === 'need_input') && stack.length > 0 && (
              <>{idx + 1} / {stack.length}</>
            )}
          </span>
        </header>

        <main className="mda-body">
          {tab === 'to_review' || tab === 'need_input' ? (
            <StackPane
              stack={stack}
              idx={idx}
              current={current}
              onPrev={() => setIdx(i => Math.max(0, i - 1))}
              onNext={() => setIdx(i => Math.min(stack.length - 1, i + 1))}
              onRefresh={onRefresh}
              emptyLabel={tab === 'to_review' ? 'Geen voorstellen om goed te keuren.' : 'Geen open vragen.'}
            />
          ) : tab === 'log' ? (
            <LogPane processed={buckets.processed} />
          ) : (
            <KpiPane metrics={metrics} />
          )}
        </main>

        <nav className="mda-tabbar">
          <TabButton label="Goedkeuren"  icon="📥" count={buckets.to_review.length}  active={tab === 'to_review'}  onClick={() => setTab('to_review')} />
          <TabButton label="Info nodig"  icon="⚠️" count={buckets.need_input.length} active={tab === 'need_input'} onClick={() => setTab('need_input')} />
          <TabButton label="Logboek"     icon="📋" count={null}                      active={tab === 'log'}        onClick={() => setTab('log')} />
          <TabButton label="Cijfers"     icon="📊" count={null}                      active={tab === 'kpi'}        onClick={() => setTab('kpi')} />
        </nav>
      </div>
    </HubSpotUsersContext.Provider>
    </PipelineLookupContext.Provider>
  )
}

function TabButton({ label, icon, count, active, onClick }) {
  return (
    <button type="button" className={`mda-tab ${active ? 'is-on' : ''}`} onClick={onClick}>
      <span className="mda-tab__ico">{icon}</span>
      <span className="mda-tab__label">{label}</span>
      {count != null && count > 0 && <span className="mda-tab__cnt">{count}</span>}
    </button>
  )
}

function StackPane({ stack, idx, current, onPrev, onNext, onRefresh, emptyLabel }) {
  if (stack.length === 0) {
    return <div className="mda-empty">{emptyLabel}</div>
  }
  return (
    <>
      <div className="mda-arrows">
        <button type="button" className="mda-arrow" onClick={onPrev} disabled={idx === 0} aria-label="Vorige">‹</button>
        <button type="button" className="mda-arrow" onClick={onNext} disabled={idx >= stack.length - 1} aria-label="Volgende">›</button>
      </div>
      {current && <MobileProposalCard key={current.id} proposal={current} onRefresh={onRefresh} />}
    </>
  )
}

// Kern-card in Stack-weergave. Bevat alle capabilities van de desktop-kaart
// (inline-edit, Opnieuw/Doorvoeren, recruitment-default), maar layout is op
// 375px afgestemd. Key={current.id} in StackPane forceert remount bij item-
// wissel — lokale edit-state lekt niet tussen voorstellen.
function MobileProposalCard({ proposal, onRefresh }) {
  const lookup       = useContext(PipelineLookupContext)
  const hubspotUsers = useContext(HubSpotUsersContext)
  const A = useProposalActions(proposal, onRefresh)
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId     = ctx.pipeline_stage || ctx.deal_stage || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []

  const showNeedsInfo = A.needsInfo && !A.isRevised
  const amending = A.mode === 'amending'
  const activeCount = actions.length - A.removed.size

  return (
    <article className={`mda-card mda-card--${A.status} ${showNeedsInfo ? 'mda-card--needs' : ''}`}>
      <div className="mda-card__pills">
        <select
          className={`mda-card__cat cat-select cat-select--${A.cat}`}
          value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
          aria-label="Categorie"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <span className={`mda-pill mda-pill--${A.status}`}>{statusText(A.status)}</span>
        {showNeedsInfo && <span className="mda-pill mda-pill--warn">⚠ info nodig</span>}
        {A.isRevised   && <span className="mda-pill mda-pill--accent">✎ herzien</span>}
        {A.hasEdits    && <span className="mda-pill mda-pill--accent">● bewerkt</span>}
      </div>

      <h2 className="mda-card__subject">{proposal.subject}</h2>
      {proposal.summary && <p className="mda-card__summary">{proposal.summary}</p>}

      <div className="mda-card__submeta">
        {(pipelineLabel || pipelineRaw) && (
          <div><b>{pipelineLabel || `? ${pipelineRaw}`}{stageLabel && ` · ${stageLabel}`}</b><span>Pipeline</span></div>
        )}
        {dealOwner && <div><b>{dealOwner}</b><span>Owner</span></div>}
        {confidencePct != null && <div><b>{confidencePct}%</b><span>Confidence</span></div>}
        <div><b>{formatDateTime(proposal.created_at)}</b><span>Aangemaakt</span></div>
      </div>

      {actions.length > 0 && (
        <section className="mda-card__actions">
          <div className="mda-card__actions-head">
            Bij ✓ Goedkeuren — {activeCount} {activeCount === 1 ? 'actie' : 'acties'}
            {A.removed.size > 0 && <span className="muted"> · {A.removed.size} verwijderd</span>}
          </div>
          {actions.map((a, i) => (
            <MobileChipAction
              key={i}
              action={a}
              lookup={lookup}
              proposalContext={ctx}
              proposalCategory={A.cat}
              removed={A.removed.has(i)}
              edits={A.edits[i] || {}}
              onRemove={() => A.removeAction(i)}
              onRestore={() => A.restoreAction(i)}
              onPatch={(patch) => A.patchAction(i, patch)}
              hubspotUsers={hubspotUsers}
              disabled={A.busy}
              canEdit={A.isPending}
            />
          ))}
        </section>
      )}

      {A.liveAmendment && (
        <div className="mda-amendment">
          <span className="mda-amendment__label">Jouw feedback</span>
          <div className="mda-amendment__text">{A.liveAmendment}</div>
        </div>
      )}

      {A.isPending && (
        amending ? (
          <div className="mda-amend-form">
            <div className="textarea-wrap">
              <textarea
                className="mda-amend-input"
                value={A.amendText}
                onChange={e => A.setAmendText(e.target.value)}
                placeholder="Extra richtlijn (optioneel bij Doorvoeren)"
                rows={3} autoFocus
              />
              <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="mda-card__btns mda-card__btns--amend">
              <button className="mda-btn mda-btn--warn"    onClick={A.onAmend}           disabled={A.busy || !A.amendText.trim()}>↻ Opnieuw</button>
              <button className="mda-btn mda-btn--primary" onClick={A.onAmendAndAccept}  disabled={A.busy}>✓ Doorvoeren</button>
              <button className="mda-btn"                  onClick={() => { A.setMode('view'); A.setAmendText('') }} disabled={A.busy}>Annuleer</button>
            </div>
          </div>
        ) : showNeedsInfo ? (
          <div className="mda-card__btns">
            <button className="mda-btn mda-btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord</button>
            <button className="mda-btn"                  onClick={A.onReject}                  disabled={A.busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="mda-card__btns">
            <button className="mda-btn mda-btn--primary" onClick={A.onAccept}                   disabled={A.busy || activeCount === 0}>✓ Goedk.</button>
            <button className="mda-btn mda-btn--warn"    onClick={() => A.setMode('amending')}  disabled={A.busy}>✎ Aanp.</button>
            <button className="mda-btn"                  onClick={A.onReject}                   disabled={A.busy}>✕ Afw.</button>
          </div>
        )
      )}

      {A.err && <div className="mda-err">⚠ {A.err}</div>}
    </article>
  )
}

function statusText(s) {
  const map = {
    pending:  'In afwachting', amended:  'Aanpassing verstuurd',
    accepted: 'Goedgekeurd',   executed: 'Uitgevoerd',
    rejected: 'Afgewezen',     failed:   'Gefaald',
    expired:  'Verlopen',      superseded: 'Vervangen',
  }
  return map[s] || s
}

// Dezelfde deadline-presets als desktop, letterlijk gecopieerd om circular
// imports te vermijden. Bij toekomstige wijziging: consolideren in
// useProposalActions.js als `DUE_PRESETS` export.
const DUE_PRESETS = [
  { key: 'today',    label: 'Vandaag',  days: 0 },
  { key: 'tomorrow', label: 'Morgen',   days: 1 },
  { key: 'd3',       label: '+3 dagen', days: 3 },
  { key: 'w1',       label: '+1 week',  days: 7 },
  { key: 'w2',       label: '+2 weken', days: 14 },
  { key: 'm1',       label: '+1 maand', days: 30 },
]
function isoPlusDays(days) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function MobileChipAction({ action, lookup, proposalContext, proposalCategory, removed, edits, onRemove, onRestore, onPatch, hubspotUsers, disabled, canEdit }) {
  const mergedAction = { ...action, payload: { ...(action?.payload || {}), ...edits } }
  const d = actionDetails(mergedAction, lookup, proposalContext)
  const type = d.type
  const payload = mergedAction.payload || {}
  const isTask     = type === 'task'
  const isJiraCard = type === 'jira' || type === 'card'
  const needsAssignee = isTask || isJiraCard
  const needsDue      = isTask

  const currentAssignee =
    payload.assignee || payload.jira_assignee || payload.owner ||
    (proposalCategory === 'recruitment' ? 'Jelle Burggraaf' : '')

  // Verberg de rijen die via inline-edits worden getoond als dropdown.
  const suppressedRowKeys = new Set()
  if (canEdit && needsDue) suppressedRowKeys.add('Deadline')
  if (canEdit && needsAssignee) suppressedRowKeys.add('Toegewezen aan')
  const rowsForDisplay = d.rows.filter(([k]) => !suppressedRowKeys.has(k))

  return (
    <div className={`mda-chip ${removed ? 'mda-chip--removed' : ''}`}>
      <span className="mda-chip__ico" aria-hidden="true">{d.meta.icon}</span>
      <div className="mda-chip__body">
        <div className="mda-chip__head">
          <span className="mda-chip__type">{d.meta.label}</span>
          {d.title && <span className="mda-chip__title">{d.title}</span>}
          {removed && <span className="mda-chip__removed">verwijderd</span>}
        </div>
        {rowsForDisplay.length > 0 && (
          <dl className="mda-chip__rows">
            {rowsForDisplay.map(([k, v], i) => (
              <div key={i} className="mda-chip__row"><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        {canEdit && !removed && (needsDue || needsAssignee) && (
          <div className="mda-chip__edits">
            {needsDue && (
              <MobileDueControl
                value={payload.due || ''}
                onChange={due => onPatch({ due })}
                disabled={disabled}
              />
            )}
            {needsAssignee && (
              <MobileAssigneeControl
                value={currentAssignee}
                onChange={assignee => onPatch({ assignee })}
                users={hubspotUsers}
                disabled={disabled}
              />
            )}
          </div>
        )}
        {d.body && !removed && <div className="mda-chip__text">{d.body}</div>}
      </div>
      {canEdit && (
        <button
          type="button"
          className={`mda-chip__remove ${removed ? 'is-restore' : ''}`}
          onClick={removed ? onRestore : onRemove}
          disabled={disabled}
          aria-label={removed ? 'Actie terugzetten' : 'Actie verwijderen'}
        >
          {removed ? '↺' : '✕'}
        </button>
      )}
    </div>
  )
}

function MobileDueControl({ value, onChange, disabled }) {
  const [custom, setCustom] = useState(false)
  const presetKey = DUE_PRESETS.find(p => value === isoPlusDays(p.days))?.key
  const selected = custom || (value && !presetKey) ? 'custom' : (presetKey || '')

  function onSelect(e) {
    const key = e.target.value
    if (key === 'custom') { setCustom(true); return }
    setCustom(false)
    const preset = DUE_PRESETS.find(p => p.key === key)
    if (preset) onChange(isoPlusDays(preset.days))
    else onChange('')
  }
  return (
    <label className="mda-edit">
      <span className="mda-edit__label">Deadline</span>
      <select className="mda-edit__select" value={selected} onChange={onSelect} disabled={disabled}>
        <option value="">Geen</option>
        {DUE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        <option value="custom">Zelf kiezen…</option>
      </select>
      {selected === 'custom' && (
        <input
          type="date" className="mda-edit__date"
          value={value || ''} onChange={e => onChange(e.target.value)}
          disabled={disabled}
        />
      )}
    </label>
  )
}

function MobileAssigneeControl({ value, onChange, users, disabled }) {
  const options = Array.isArray(users) ? users : []
  const matchesKnown = options.some(u =>
    u.full_name === value || u.email === value || u.hubspot_owner_id === value
  )
  return (
    <label className="mda-edit">
      <span className="mda-edit__label">Toewijzen aan</span>
      <select className="mda-edit__select" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled}>
        <option value="">— kies —</option>
        {options.map(u => (
          <option key={u.hubspot_owner_id} value={u.full_name || u.email || u.hubspot_owner_id}>
            {u.full_name || u.email || u.hubspot_owner_id}{u.is_primary ? ' ★' : ''}
          </option>
        ))}
        {value && !matchesKnown && <option value={value}>{value} (handmatig)</option>}
      </select>
    </label>
  )
}

function LogPane({ processed }) {
  return (
    <div className="mda-log">
      <div className="mda-log__head">
        Logboek <span>{processed.length}</span>
      </div>
      {processed.length === 0 && <div className="mda-empty">Nog niets verwerkt.</div>}
      {processed.slice(0, 30).map(p => (
        <MobileLogLine key={p.id} proposal={p} />
      ))}
    </div>
  )
}

const LOG_STATUS = {
  amended:  { label: 'Wacht op volgende run' },
  accepted: { label: 'Goedgekeurd — wacht op run' },
  executed: { label: 'Uitgevoerd ✓' },
  rejected: { label: 'Afgewezen' },
  failed:   { label: 'Gefaald' },
}

function MobileLogLine({ proposal }) {
  const [open, setOpen] = useState(false)
  const when = proposal.executed_at || proposal.reviewed_at || proposal.created_at
  const meta = LOG_STATUS[proposal.status] || { label: proposal.status }
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  const exec = proposal.execution_result || null
  const hasDetails = actions.length > 0 || !!exec
  return (
    <div className={`mda-log-line mda-log-line--${proposal.status} ${open ? 'is-open' : ''}`}>
      <button type="button" className="mda-log-line__row" onClick={() => hasDetails && setOpen(v => !v)} disabled={!hasDetails}>
        <span className="mda-log-line__caret">{hasDetails ? (open ? '▾' : '▸') : ''}</span>
        <div className="mda-log-line__text">
          <div className="mda-log-line__status">{meta.label}</div>
          <div className="mda-log-line__subj">{proposal.subject}</div>
        </div>
        <span className="mda-log-line__time">{formatDateTime(when)}</span>
      </button>
      {open && hasDetails && (
        <div className="mda-log-line__body">
          {actions.map((a, i) => (
            <div key={i} className="mda-log-line__act">
              <span className="mda-log-line__act-t">{a.type}</span>
              <span>{a.label || (a.payload?.title || a.payload?.summary || a.payload?.content || '').slice(0, 60)}</span>
            </div>
          ))}
          {exec?.error && <div className="mda-log-line__err">⚠ {exec.error}</div>}
        </div>
      )}
    </div>
  )
}

function KpiPane({ metrics }) {
  return (
    <div className="mda-kpi-grid">
      <div className="mda-kpi"><span>{metrics.open}</span><em>Open voorstellen</em><small>{metrics.needs_input} wachten op input</small></div>
      <div className="mda-kpi"><span>{metrics.today_created}</span><em>Vandaag aangemaakt</em><small>{metrics.today_accepted} akkoord · {metrics.today_rejected} afwijs</small></div>
      <div className="mda-kpi"><span>{metrics.week_created}</span><em>Deze week</em><small>{metrics.week_trend != null ? `${metrics.week_trend > 0 ? '+' : ''}${metrics.week_trend}% vs vorige` : '—'}</small></div>
      <div className="mda-kpi"><span>{metrics.week_accepted}</span><em>Geaccepteerd (week)</em><small>uitgevoerd + accepted</small></div>
      <div className="mda-kpi"><span>{metrics.week_rejected}</span><em>Afgewezen (week)</em><small>rejected + failed</small></div>
    </div>
  )
}

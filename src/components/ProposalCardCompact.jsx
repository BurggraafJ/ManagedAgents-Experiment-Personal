import { useContext, useState } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, HubSpotUsersContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/hubspot-common'
import { useProposalActions, actionDetails } from './useProposalActions'

// ProposalCardCompact — Zen-stijl met inline-edit per actie.
//   Structuur:
//     1. meta-tags-rij (categorie-pill + status-pill)
//     2. subject + summary
//     3. submeta — 4 kolommen (Pipeline, Owner, CSM, Confidence)
//     4. chip-actions: elke actie heeft een ×-knop + inline edit voor
//        task-deadline en assignee (via dropdown van hubspot_users).
//     5. amendment-callout als er feedback is
//     6. action-knoppen:
//        - view mode: Goedkeuren (pakt edits mee) · Aanpassen · Afwijzen
//        - amending mode: Opnieuw (agent schrijft nieuw voorstel) ·
//          Doorvoeren (edits + tekst direct accept) · Annuleer
export default function ProposalCardCompact({ proposal, onRefresh }) {
  const lookup       = useContext(PipelineLookupContext)
  const hubspotUsers = useContext(HubSpotUsersContext)
  const A = useProposalActions(proposal, onRefresh)
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId     = ctx.pipeline_stage || ctx.deal_stage || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const csm       = ctx.csm_name || ctx.customer_success_manager || null
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []

  const showNeedsInfo = A.needsInfo && !A.isRevised
  const amending = A.mode === 'amending'

  // Effectief aantal actieve acties (zonder verwijderde), voor label.
  const activeCount = actions.length - A.removed.size

  return (
    <article className={`pcv7 pcv7--${A.status} ${A.isRevised ? 'pcv7--revised' : ''} ${showNeedsInfo ? 'pcv7--needs' : ''}`}>

      <div className="pcv7__meta">
        <select
          className={`pcv7__cat cat-select cat-select--${A.cat}`}
          value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
          aria-label="Categorie"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <span className={`pcv7__status pcv7__status--${A.status}`}>{statusText(A.status)}</span>
        {showNeedsInfo && <span className="pcv7__tag pcv7__tag--needs">⚠ meer info nodig</span>}
        {A.isRevised   && <span className="pcv7__tag pcv7__tag--revised">✎ herzien na feedback</span>}
        {A.hasEdits    && <span className="pcv7__tag pcv7__tag--edits">● bewerkt</span>}
        <span className="pcv7__spacer" />
        <span className="pcv7__time">{formatDateTime(proposal.created_at)}</span>
      </div>

      <h2 className="pcv7__subject">{proposal.subject}</h2>
      {proposal.summary && <p className="pcv7__summary">{proposal.summary}</p>}

      {(pipelineLabel || dealOwner || csm || confidencePct != null) && (
        <div className="pcv7__submeta">
          {(pipelineLabel || pipelineRaw) && (
            <span className="pcv7__submeta-item">
              <span className="pcv7__submeta-label">Pipeline</span>
              <span className="pcv7__submeta-val">
                {pipelineLabel || `? ${pipelineRaw}`}
                {stageLabel && <span className="pcv7__submeta-sub"> · {stageLabel}</span>}
              </span>
            </span>
          )}
          {dealOwner && (
            <span className="pcv7__submeta-item">
              <span className="pcv7__submeta-label">Owner</span>
              <span className="pcv7__submeta-val">{dealOwner}</span>
            </span>
          )}
          {csm && (
            <span className="pcv7__submeta-item">
              <span className="pcv7__submeta-label">CSM</span>
              <span className="pcv7__submeta-val">{csm}</span>
            </span>
          )}
          {confidencePct != null && (
            <span className="pcv7__submeta-item">
              <span className="pcv7__submeta-label">Confidence</span>
              <span className="pcv7__submeta-val">{confidencePct}%</span>
            </span>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <section className="pcv7__actions">
          <div className="pcv7__actions-head">
            <span className="pcv7__actions-label">
              Bij ✓ Goedkeuren — {activeCount} {activeCount === 1 ? 'actie' : 'acties'}
              {A.removed.size > 0 && <span className="muted"> · {A.removed.size} verwijderd</span>}
            </span>
          </div>
          <div className="pcv7__chips">
            {actions.map((a, i) => (
              <ChipAction
                key={i}
                action={a}
                index={i}
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
          </div>
        </section>
      )}

      {A.liveAmendment && (
        <div className="pcv7__amendment">
          <span className="pcv7__amendment-label">Jouw feedback</span>
          <div className="pcv7__amendment-text">{A.liveAmendment}</div>
        </div>
      )}

      {A.isPending && (
        amending ? (
          <div className="pcv7__amend-form">
            <div className="textarea-wrap">
              <textarea
                className="pcv7__amend-input"
                value={A.amendText}
                onChange={e => A.setAmendText(e.target.value)}
                placeholder="Extra richtlijn voor de agent (optioneel bij Doorvoeren)"
                rows={3} autoFocus
              />
              <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="pcv7__btns">
              <button
                className="btn btn--warning pcv7__btn"
                onClick={A.onAmend}
                disabled={A.busy || !A.amendText.trim()}
                title="Stuur feedback terug — agent schrijft een nieuw voorstel met jouw aanpassingen."
              >
                ↻ Opnieuw
              </button>
              <button
                className="btn btn--success pcv7__btn pcv7__btn--primary"
                onClick={A.onAmendAndAccept}
                disabled={A.busy}
                title="Accepteer direct met deze bewerkingen en eventuele extra richtlijn — geen re-review nodig."
              >
                ✓ Doorvoeren
              </button>
              <button
                className="btn btn--ghost pcv7__btn"
                onClick={() => { A.setMode('view'); A.setAmendText('') }}
                disabled={A.busy}
              >
                Annuleer
              </button>
            </div>
          </div>
        ) : showNeedsInfo ? (
          <div className="pcv7__btns">
            <button className="btn btn--warning pcv7__btn pcv7__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger pcv7__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="pcv7__btns">
            <button
              className="btn btn--success pcv7__btn pcv7__btn--primary"
              onClick={A.onAccept}
              disabled={A.busy || activeCount === 0}
              title={activeCount === 0 ? 'Alle acties zijn verwijderd — niets om goed te keuren.' : ''}
            >
              ✓ Goedkeuren{A.hasEdits ? ' (met bewerkingen)' : ''}
            </button>
            <button className="btn btn--warning pcv7__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
            <button className="btn btn--danger pcv7__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {A.err && <div className="pcv7__error">⚠ {A.err}</div>}
    </article>
  )
}

function statusText(s) {
  const map = {
    pending:  'In afwachting',
    amended:  'Aanpassing verstuurd',
    accepted: 'Goedgekeurd',
    executed: 'Uitgevoerd',
    rejected: 'Afgewezen',
    failed:   'Gefaald',
    expired:  'Verlopen',
    superseded: 'Vervangen',
  }
  return map[s] || s
}

// Relatieve deadline-opties — dropdown geeft een vriendelijke keuze,
// "Zelf kiezen" schakelt naar een date-input.
const DUE_PRESETS = [
  { key: 'today',   label: 'Vandaag',     days: 0 },
  { key: 'tomorrow',label: 'Morgen',      days: 1 },
  { key: 'd3',      label: '+3 dagen',    days: 3 },
  { key: 'w1',      label: '+1 week',     days: 7 },
  { key: 'w2',      label: '+2 weken',    days: 14 },
  { key: 'm1',      label: '+1 maand',    days: 30 },
]

function isoPlusDays(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function ChipAction({ action, index, lookup, proposalContext, proposalCategory, removed, edits, onRemove, onRestore, onPatch, hubspotUsers, disabled, canEdit }) {
  // Merge de override-edits in de payload voor weergave + actionDetails.
  const mergedAction = {
    ...action,
    payload: { ...(action?.payload || {}), ...edits },
  }
  const d = actionDetails(mergedAction, lookup, proposalContext)
  const type = d.type
  const payload = mergedAction.payload || {}

  const isTask    = type === 'task'
  const isJiraCard= type === 'jira' || type === 'card'
  const needsAssignee = isTask || isJiraCard
  const needsDue      = isTask

  // Huidige waarde van de assignee — voor de dropdown default.
  // Recruitment krijgt Jelle Burggraaf als fallback zodat er altijd
  // een voorstel-waarde in de dropdown staat (Jelle kan 'm veranderen).
  const currentAssignee =
    payload.assignee || payload.jira_assignee || payload.owner ||
    (proposalCategory === 'recruitment' ? 'Jelle Burggraaf' : '')

  // Rows in actionDetails tonen de huidige (effectieve) waarden. Bij edit-mode
  // verbergen we de rijen die door de dropdowns zelf getoond worden (dubbel).
  const suppressedRowKeys = new Set()
  if (canEdit && needsDue) suppressedRowKeys.add('Deadline')
  if (canEdit && needsAssignee) suppressedRowKeys.add('Toegewezen aan')
  const rowsForDisplay = d.rows.filter(([k]) => !suppressedRowKeys.has(k))

  return (
    <div className={`pcv7__chip pcv7__chip--${type} ${removed ? 'pcv7__chip--removed' : ''}`}>
      <span className="pcv7__chip-icon" aria-hidden="true">{d.meta.icon}</span>

      <div className="pcv7__chip-body">
        <div className="pcv7__chip-head">
          <span className="pcv7__chip-type">{d.meta.label}</span>
          {d.title && <span className="pcv7__chip-title">{d.title}</span>}
          {removed && <span className="pcv7__chip-removed-tag">verwijderd</span>}
        </div>

        {rowsForDisplay.length > 0 && (
          <dl className="pcv7__chip-rows">
            {rowsForDisplay.map(([k, v], i) => (
              <div key={i} className="pcv7__chip-row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Inline-edit controls — alleen zichtbaar in pending/amended en als niet verwijderd. */}
        {canEdit && !removed && (needsDue || needsAssignee) && (
          <div className="pcv7__chip-edits">
            {needsDue && (
              <DueControl
                value={payload.due || ''}
                onChange={due => onPatch({ due })}
                disabled={disabled}
              />
            )}
            {needsAssignee && (
              <AssigneeControl
                value={currentAssignee}
                onChange={assignee => onPatch({ assignee })}
                users={hubspotUsers}
                disabled={disabled}
              />
            )}
          </div>
        )}

        {d.body && !removed && <div className="pcv7__chip-text">{d.body}</div>}
      </div>

      {canEdit && (
        <button
          type="button"
          className={`pcv7__chip-remove ${removed ? 'is-restore' : ''}`}
          onClick={removed ? onRestore : onRemove}
          disabled={disabled}
          aria-label={removed ? 'Actie terugzetten' : 'Actie verwijderen'}
          title={removed ? 'Terugzetten' : 'Verwijderen'}
        >
          {removed ? '↺' : '✕'}
        </button>
      )}
    </div>
  )
}

function DueControl({ value, onChange, disabled }) {
  // Preset kiest → schrijf datum. "custom" → toon date-input ernaast.
  const [custom, setCustom] = useState(false)
  const presetKey = DUE_PRESETS.find(p => p.key && value === isoPlusDays(p.days))?.key
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
    <label className="pcv7__edit-field">
      <span className="pcv7__edit-label">Deadline</span>
      <span className="pcv7__edit-input-wrap">
        <select
          className="pcv7__edit-select"
          value={selected}
          onChange={onSelect}
          disabled={disabled}
        >
          <option value="">Geen</option>
          {DUE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom">Zelf kiezen…</option>
        </select>
        {selected === 'custom' && (
          <input
            type="date"
            className="pcv7__edit-date"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
          />
        )}
      </span>
    </label>
  )
}

function AssigneeControl({ value, onChange, users, disabled }) {
  const options = Array.isArray(users) ? users : []
  // Als de huidige waarde niet in de options zit, tonen we 'm als extra
  // optie met " (handmatig)" zodat Jelle zijn oude invoer niet verliest.
  const matchesKnown = options.some(u =>
    u.full_name === value ||
    u.email === value ||
    u.hubspot_owner_id === value
  )
  return (
    <label className="pcv7__edit-field">
      <span className="pcv7__edit-label">Toewijzen aan</span>
      <select
        className="pcv7__edit-select"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      >
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

import { useState } from 'react'
import RichTextEditor from './ui/RichTextEditor'
import { actionDetails } from './useProposalActions'

// ChipAction — één actie binnen een ProposalCard. Geëxtraheerd uit
// ProposalCardCompact.jsx (sessie 17 ronde 7) zodat de proposal-card-file
// onder de 400-LOC bestandscap blijft. Inhoudelijk geen wijzigingen.
//
// Renders één rec-card binnen .pcv7__chips:
//   - icon + type-label + title in chip-bar
//   - rows met huidige waarden (uit actionDetails)
//   - inline edit-controls (DueControl/AssigneeControl/TitleControl/ContentControl)
//     alleen in pending/amended status (canEdit=true) en als niet verwijderd
//   - body-text fallback (markdown voor notes)
//   - remove-button rechtsboven die toggelt naar ↺ restore voor verwijderde

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

export default function ChipAction({ action, index, lookup, proposalContext, proposalCategory, removed, edits, onRemove, onRestore, onPatch, hubspotUsers, disabled, canEdit }) {
  // Merge de override-edits in de payload voor weergave + actionDetails.
  const mergedAction = {
    ...action,
    payload: { ...(action?.payload || {}), ...edits },
  }
  const d = actionDetails(mergedAction, lookup, proposalContext)
  const type = d.type
  const payload = mergedAction.payload || {}

  const isTask    = type === 'task'
  const isNote    = type === 'note'
  const isJiraCard= type === 'jira' || type === 'card'
  const needsAssignee = isTask || isJiraCard
  const needsDue      = isTask
  const needsTitle    = isTask || isJiraCard
  const needsContent  = isNote

  // Huidige waarde van de assignee — voor de dropdown default.
  // Recruitment krijgt Jelle Burggraaf als fallback zodat er altijd
  // een voorstel-waarde in de dropdown staat (Jelle kan 'm veranderen).
  const currentAssignee =
    payload.assignee || payload.jira_assignee || payload.owner ||
    (proposalCategory === 'recruitment' ? 'Jelle Burggraaf' : '')

  const currentTitle   = payload.title || payload.summary || ''
  const currentContent = payload.content || payload.description || payload.note || payload.body || ''

  // Rows in actionDetails tonen de huidige (effectieve) waarden. Bij edit-mode
  // verbergen we de rijen die door de dropdowns zelf getoond worden (dubbel).
  const suppressedRowKeys = new Set()
  if (canEdit && needsDue) suppressedRowKeys.add('Deadline')
  if (canEdit && needsAssignee) suppressedRowKeys.add('Toegewezen aan')
  if (canEdit && needsTitle) suppressedRowKeys.add('Titel')
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
        {canEdit && !removed && needsTitle && (
          <TitleControl
            value={currentTitle}
            onChange={(v) => onPatch(isJiraCard ? { summary: v } : { title: v })}
            disabled={disabled}
          />
        )}

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

        {canEdit && !removed && needsContent && (
          <ContentControl
            value={currentContent}
            onChange={(v) => onPatch({ content: v })}
            disabled={disabled}
          />
        )}

        {/* d.body verbergen bij note-type wanneer ContentControl al getoond wordt — dubbel anders.
            Voor non-edit modes (executed/accepted) renderen we de note met markdown-bold zodat
            de stijl in het logboek consistent is met de preview-laag in edit-mode. */}
        {d.body && !removed && !(canEdit && needsContent) && (
          <div className="pcv7__chip-text" style={{ fontSize: 13, lineHeight: 1.55 }}>
            {isNote ? <NoteMarkdown text={String(d.body)} /> : d.body}
          </div>
        )}
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

function TitleControl({ value, onChange, disabled }) {
  return (
    <label className="pcv7__edit-field pcv7__edit-field--full">
      <span className="pcv7__edit-label">Titel</span>
      <input
        type="text"
        className="pcv7__edit-text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Titel van de actie"
      />
    </label>
  )
}

// Eén WYSIWYG-blok: label + RichTextEditor (contenteditable, markdown opslag,
// Ctrl/Cmd+B/I shortcuts). Sterretjes zijn onzichtbaar — ze worden als <b>/<i>
// gerendered. Op opslag converteert de editor terug naar `**bold**` markdown
// zodat de skill en HubSpot dezelfde tokens zien.
//
// Styling: één wit blok. Header (label + shortcuts) heeft ook witte achtergrond
// — geen surface-2 grijs meer. Editor-body heeft geen extra padding/margin
// rondom zodat er geen zichtbare grijze randjes aan de zijkant zijn.
function ContentControl({ value, onChange, disabled }) {
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        border: '1px solid var(--border, rgba(0,0,0,0.10))',
        borderRadius: 8,
        background: '#fff',
        overflow: 'hidden',
        marginTop: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
          background: '#fff',
        }}
      >
        <span className="pcv7__edit-label" style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Notitie</span>
        <span className="muted" style={{ fontSize: 10.5 }}>
          <kbd style={{ padding: '0 4px', border: '1px solid var(--border)', borderRadius: 3 }}>Ctrl+B</kbd> vet · <kbd style={{ padding: '0 4px', border: '1px solid var(--border)', borderRadius: 3 }}>Ctrl+I</kbd> cursief
        </span>
      </div>
      <div className="pcv7__note-rte">
        <RichTextEditor
          valueMd={value || ''}
          onChangeMd={onChange}
          placeholder="Inhoud van de notitie"
          minHeight={320}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

// Heel kleine markdown-renderer: ondersteunt **bold**, *italic*, en
// bullet-lijsten (regels die starten met "•" of "- ") + line-breaks.
// Bewust geen externe dependency — note-content is altijd kort + we
// willen geen DOMPurify/marked toevoegen voor 4 stijl-tokens.
function NoteMarkdown({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, idx) => (
        <div key={idx} style={{ minHeight: '1.4em', whiteSpace: 'pre-wrap' }}>
          <NoteInline text={line} />
        </div>
      ))}
    </>
  )
}

// Inline-parser voor één regel — bold (**), italic (*), inline-code (`).
function NoteInline({ text }) {
  if (!text) return <>{' '}</>
  const out = []
  let rest = text
  let key = 0
  // Volgorde: bold eerst (greedy match op **...**), dan italic, dan code
  while (rest.length > 0) {
    const bold = rest.match(/\*\*([^*]+)\*\*/)
    const italic = rest.match(/(?<!\*)\*([^*\n]+)\*(?!\*)/)
    const code = rest.match(/`([^`\n]+)`/)
    const candidates = [bold, italic, code].filter(m => m && m.index !== undefined)
    if (candidates.length === 0) {
      out.push(<span key={key++}>{rest}</span>)
      break
    }
    const next = candidates.reduce((a, b) => (a.index <= b.index ? a : b))
    const before = rest.slice(0, next.index)
    if (before) out.push(<span key={key++}>{before}</span>)
    if (next === bold) out.push(<strong key={key++}>{next[1]}</strong>)
    else if (next === italic) out.push(<em key={key++}>{next[1]}</em>)
    else out.push(<code key={key++} style={{ background: 'rgba(0,0,0,0.06)', padding: '0 4px', borderRadius: 3 }}>{next[1]}</code>)
    rest = rest.slice(next.index + next[0].length)
  }
  return <>{out}</>
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

import { useMemo, useState } from 'react'
import AgentCard     from '../AgentCard'
import { supabase }  from '../../lib/supabase'

const AGENT = 'hubspot-daily-sync'

const ACTION_STATUSES = new Set(['open', 'pending'])
const AUTO_HANDLED_STATUSES = new Set(['stale', 'expired', 'skipped', 'auto_resolved'])
const ANSWERED_STATUSES = new Set(['answered', 'resolved', 'done'])
// superseded = open_question is opgegaan in een proposal-rij, niet meer tonen
const HIDDEN_STATUSES = new Set(['superseded'])

const CATEGORIES = ['klant', 'partner', 'recruitment', 'overig']

const CATEGORY_LABEL = {
  klant:       'Klant',
  partner:     'Partner',
  recruitment: 'Recruitment',
  overig:      'Overig',
}

const CATEGORY_CLASS = {
  klant:       'cat cat--klant',
  partner:     'cat cat--partner',
  recruitment: 'cat cat--recruit',
  overig:      'cat cat--misc',
}

const STORAGE_KEY_FILTER = 'lm-dashboard-proposal-categories'

function loadFilterState() {
  if (typeof localStorage === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_FILTER)) } catch { return null }
}

function saveFilterState(s) {
  try { localStorage.setItem(STORAGE_KEY_FILTER, JSON.stringify(s)) } catch {}
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function summarizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null
  const entries = []
  if (ctx.company)      entries.push(['bedrijf', ctx.company])
  else if (ctx.bedrijf) entries.push(['bedrijf', ctx.bedrijf])
  if (ctx.deal_name)    entries.push(['deal', ctx.deal_name])
  if (ctx.dealstage)    entries.push(['stage', ctx.dealstage])
  if (ctx.contact)      entries.push(['contact', ctx.contact])
  if (ctx.email)        entries.push(['email', ctx.email])
  if (Array.isArray(ctx.emails) && ctx.emails.length) entries.push(['emails', ctx.emails.join(', ')])
  if (ctx.meeting_time) entries.push(['tijd', ctx.meeting_time])
  if (ctx.date)         entries.push(['datum', ctx.date])
  if (ctx.signed_by)    entries.push(['getekend door', ctx.signed_by])
  if (ctx.signed_on)    entries.push(['getekend op', ctx.signed_on])
  if (ctx.deal_id)      entries.push(['deal_id', ctx.deal_id])
  return entries.length > 0 ? entries : null
}

function extractArtifacts(q) {
  const artifacts = []
  const ctx = q.context || {}
  if (ctx.note_id || ctx.note_created)       artifacts.push('Note')
  if (ctx.task_id || ctx.task_created)       artifacts.push('Task')
  if (ctx.contact_id || ctx.contact_created) artifacts.push('Contact')
  if (ctx.deal_created)                      artifacts.push('Deal')
  if (ctx.stage_before && ctx.stage_after)   artifacts.push(`Stage: ${ctx.stage_before} → ${ctx.stage_after}`)
  else if (ctx.dealstage_after)              artifacts.push(`Stage → ${ctx.dealstage_after}`)
  if (ctx.email_sent)                        artifacts.push('E-mail')
  const text = [q.default_action, q.answer].filter(Boolean).join(' ').toLowerCase()
  if (text) {
    if (!artifacts.some(a => a.toLowerCase().includes('note'))    && /\bnote[s]?\b|notitie/.test(text))    artifacts.push('Note')
    if (!artifacts.some(a => a.toLowerCase().includes('task'))    && /\btask[s]?\b|taak/.test(text))       artifacts.push('Task')
    if (!artifacts.some(a => a.toLowerCase().includes('contact')) && /\bcontact/.test(text))              artifacts.push('Contact')
    if (/uitgesteld|overslaan|sla .* over|skip/i.test(q.default_action || '')) artifacts.push('Overgeslagen')
  }
  return artifacts
}

export default function HubSpotView({ data }) {
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []

  const allQs = data.questions.filter(q => q.agent_name === AGENT && !HIDDEN_STATUSES.has(q.status))
  // Open vragen voor AgentCard-badge (actie-nodig telling) — moet gedefinieerd zijn voor line 136
  const openQ = allQs.filter(q => ACTION_STATUSES.has(q.status))

  // Proposals — nieuw model
  const allProposals = (data.proposals || []).filter(p => p.agent_name === AGENT)

  // Filter-state: welke categorieën wil Jelle zien. Default: alles aan.
  const [catFilter, setCatFilter] = useState(() => {
    const saved = loadFilterState()
    return saved || { klant: true, partner: true, recruitment: true, overig: true }
  })
  const toggleCat = (c) => {
    setCatFilter(prev => {
      const next = { ...prev, [c]: !prev[c] }
      saveFilterState(next)
      return next
    })
  }

  const visibleProposals = allProposals.filter(p => catFilter[p.category] !== false)
  // Voorstellen: agent heeft concreet plan (needs_info=false). 3 knoppen.
  const readyProposals  = visibleProposals.filter(p => (p.status === 'pending' || p.status === 'amended') && !p.needs_info)
  // Input nodig: agent weet niet wat te doen. Tekstveld + Overslaan.
  const needInfo        = visibleProposals.filter(p => p.status === 'pending' && p.needs_info)
  const reviewedProposals = visibleProposals.filter(p => ['accepted', 'rejected', 'executed', 'failed'].includes(p.status))
  const perCatPending = CATEGORIES.reduce((acc, c) => {
    acc[c] = allProposals.filter(p => p.category === c &&
      ((p.status === 'pending' || p.status === 'amended') || (p.status === 'pending' && p.needs_info))
    ).length
    return acc
  }, {})

  // Chronologisch records-log: alle records die iets had — vragen + proposals + stale items
  // Sorteer op meest recente actie/activiteit.
  const records = useMemo(() => buildRecords(allQs, allProposals), [allQs, allProposals])

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <AgentCard
            agent={AGENT}
            schedule={schedule}
            latestRun={latestRun}
            history={history}
            openQuestions={openQ}
          />
        </div>
      </section>

      {/* Categorie-filter: geldt voor beide secties */}
      <div className="cat-filter">
        <span className="muted" style={{ fontSize: 11, marginRight: 6 }}>Toon:</span>
        {CATEGORIES.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => toggleCat(c)}
            className={`cat-filter__chip ${catFilter[c] === false ? 'is-off' : 'is-on'}`}
            title={catFilter[c] === false ? `Toon ${CATEGORY_LABEL[c]}-items` : `Verberg ${CATEGORY_LABEL[c]}-items`}
          >
            <span className={CATEGORY_CLASS[c]} style={{ marginRight: 6 }}>{CATEGORY_LABEL[c]}</span>
            <span className="cat-filter__count">{perCatPending[c] || 0}</span>
          </button>
        ))}
      </div>

      {/* Input nodig — agent weet niet wat te doen, vraagt input van Jelle */}
      {needInfo.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">
              Input nodig <span className="section__count">{needInfo.length}</span>
            </h2>
            <span className="section__hint">
              de agent heeft iets gezien maar weet niet wat er moet gebeuren — leg uit wat je wilt, daarna komt het in Voorstellen te staan. Overslaan = niks doen.
            </span>
          </div>
          <div className="stack stack--sm">
            {needInfo.map(p => <NeedsInfoCard key={p.id} proposal={p} />)}
          </div>
        </section>
      )}

      {/* Voorstellen — agent heeft concreet plan, 3 knoppen */}
      <section>
        <div className="section__head">
          <h2 className="section__title">
            Voorstellen {readyProposals.length > 0 && <span className="section__count">{readyProposals.length}</span>}
          </h2>
          <span className="section__hint">
            concrete plannen — accepteer, pas aan of wijs af. Niks wordt doorgevoerd zonder jouw groen licht.
          </span>
        </div>
        {readyProposals.length === 0 ? (
          <div className="empty">
            Geen voorstellen klaar voor review.
            {allProposals.length > 0 && needInfo.length === 0 && ' Alles is al afgehandeld of gefiltered.'}
            {needInfo.length > 0 && ' Vul bij "Input nodig" eerst wat instructies in — dan verschijnen er voorstellen.'}
          </div>
        ) : (
          <div className="stack stack--sm">
            {readyProposals.map(p => <ProposalCard key={p.id} proposal={p} />)}
          </div>
        )}
      </section>

      {/* Chronologische records-log: scrollbaar, toont alle records met wat/wanneer/status */}
      <section>
        <div className="section__head">
          <h2 className="section__title">
            Records {records.length > 0 && <span className="section__count">{records.length}</span>}
          </h2>
          <span className="section__hint">alles wat Daily Admin heeft aangeraakt — nieuwste boven</span>
        </div>
        {records.length === 0 ? (
          <div className="empty">Nog geen records.</div>
        ) : (
          <div className="records-log">
            {records.map(r => <RecordRow key={r.key} record={r} />)}
          </div>
        )}
      </section>

      {reviewedProposals.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">
              Beoordeelde voorstellen <span className="section__count">{reviewedProposals.length}</span>
            </h2>
            <span className="section__hint">historie van accepted/rejected/executed</span>
          </div>
          <div className="stack stack--sm">
            {reviewedProposals.slice(0, 20).map(p => <ProposalCard key={p.id} proposal={p} compact />)}
          </div>
        </section>
      )}
    </div>
  )
}

// ===== Input nodig card =====

function NeedsInfoCard({ proposal }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function call(rpc, payload) {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc(rpc, payload)
      if (error)           setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(false)
  }

  async function submit() {
    if (!text.trim()) return
    await call('amend_proposal', { proposal_id: proposal.id, amendment_text: text.trim() })
    setText('')
  }
  async function skip() {
    await call('reject_proposal', { proposal_id: proposal.id })
  }

  const cat = proposal.category || 'overig'
  const ctxEntries = summarizeContext(proposal.context) || []

  return (
    <div className="needs-info">
      <div className="needs-info__head">
        <span className={CATEGORY_CLASS[cat] || CATEGORY_CLASS.overig}>
          {CATEGORY_LABEL[cat] || cat}
        </span>
        <span className="needs-info__subject">{proposal.subject}</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{formatDateTime(proposal.created_at)}</span>
      </div>
      <div className="needs-info__question">{proposal.summary}</div>

      {ctxEntries.length > 0 && (
        <div className="inbox-item__ctx" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
          {ctxEntries.slice(0, 6).map(([k, v]) => (
            <span key={k} className="inbox-item__ctx-pill">
              <span className="muted">{k}:</span> {String(v)}
            </span>
          ))}
        </div>
      )}

      <textarea
        className="proposal__amend-input"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Wat moet er gebeuren? Bijv: 'Note maken dat CV binnenkomt volgende week' — Daily Admin leest dit bij de volgende run en maakt er een voorstel van."
        rows={3}
      />
      <div className="needs-info__btns">
        <button className="btn btn--accent" onClick={submit} disabled={busy || !text.trim()}>Versturen</button>
        <button className="btn btn--ghost"  onClick={skip}   disabled={busy}>Overslaan</button>
        {err && <span className="record-row__msg">⚠ {err}</span>}
      </div>
    </div>
  )
}

// ===== Proposal card =====

function ProposalCard({ proposal, compact }) {
  const [mode, setMode] = useState('view') // view | amending | recategorizing
  const [amendText, setAmendText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)

  const cat = proposal.category || 'overig'
  const status = proposal.status
  const isPending = status === 'pending' || status === 'amended'

  async function call(rpc, payload) {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc(rpc, payload)
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      // realtime refetch updatet de UI — geen lokale state nodig
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  async function onAccept() { await call('accept_proposal', { proposal_id: proposal.id }) }
  async function onReject() { await call('reject_proposal', { proposal_id: proposal.id }) }
  async function onAmend()  {
    if (!amendText.trim()) return
    await call('amend_proposal', { proposal_id: proposal.id, amendment_text: amendText.trim() })
    setMode('view'); setAmendText('')
  }
  async function onRecategorize(newCat) {
    if (newCat === cat) { setMode('view'); return }
    await call('recategorize_proposal', { proposal_id: proposal.id, new_category: newCat })
    setMode('view')
  }

  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  const firefliesOn = proposal.has_fireflies_context === true

  return (
    <div className={`proposal ${compact ? 'proposal--compact' : ''} proposal--${status}`}>
      <div className="proposal__head">
        {/* Klikbare category-pill — opent mini-dropdown om label te switchen */}
        <button
          type="button"
          className={`${CATEGORY_CLASS[cat] || CATEGORY_CLASS.overig} cat--clickable`}
          onClick={() => setMode(mode === 'recategorizing' ? 'view' : 'recategorizing')}
          title="Klik om de categorie te wijzigen"
          disabled={compact}
        >
          {CATEGORY_LABEL[cat] || cat}
          {!compact && <span style={{ marginLeft: 4, opacity: 0.6 }}>▾</span>}
        </button>
        <span className="proposal__subject">{proposal.subject}</span>
        <span className={`proposal__status proposal__status--${status}`}>{status}</span>
        <span
          className={`proposal__fireflies ${firefliesOn ? 'is-on' : 'is-off'}`}
          title={firefliesOn
            ? 'Fireflies-notulen gevonden — gebruikt voor note-content'
            : 'Geen Fireflies-koppeling beschikbaar — note op basis van agenda/mail'}
        >
          ff: {firefliesOn ? '✓' : '—'}
        </span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{formatDateTime(proposal.created_at)}</span>
      </div>

      {mode === 'recategorizing' && !compact && (
        <div className="proposal__recat">
          <span className="muted" style={{ fontSize: 11 }}>Wijzig naar:</span>
          {CATEGORIES.filter(c => c !== cat).map(c => (
            <button
              key={c}
              type="button"
              className={`${CATEGORY_CLASS[c]} cat--clickable`}
              onClick={() => onRecategorize(c)}
              disabled={busy}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
          <button type="button" className="btn btn--ghost" onClick={() => setMode('view')}>annuleer</button>
        </div>
      )}
      <div className="proposal__summary">{proposal.summary}</div>

      {actions.length > 0 && (
        <ul className="proposal__actions">
          {actions.map((a, i) => (
            <li key={i}>
              <span className="proposal__action-kind">{a.type || 'actie'}</span>
              <span>{a.label || a.description || JSON.stringify(a)}</span>
            </li>
          ))}
        </ul>
      )}

      {proposal.amendment && (
        <div className="proposal__amendment">
          <span className="muted">Jouw aanpassing: </span>{proposal.amendment}
        </div>
      )}

      {isPending && !compact && (
        mode === 'amending' ? (
          <div className="proposal__amend-form">
            <textarea
              className="proposal__amend-input"
              value={amendText}
              onChange={e => setAmendText(e.target.value)}
              placeholder="Beschrijf kort wat de agent anders moet doen — dit wordt bij de volgende run uitgevoerd."
              rows={3}
            />
            <div className="proposal__btns">
              <button className="btn btn--accent" onClick={onAmend} disabled={busy || !amendText.trim()}>Opslaan</button>
              <button className="btn btn--ghost"  onClick={() => { setMode('view'); setAmendText('') }}>Annuleer</button>
            </div>
          </div>
        ) : (
          <div className="proposal__btns">
            <button className="btn btn--accent" onClick={onAccept} disabled={busy}>✓ Accepteer</button>
            <button className="btn btn--ghost"  onClick={() => setMode('amending')} disabled={busy}>✎ Aanpassen</button>
            <button className="btn btn--ghost proposal__reject" onClick={onReject} disabled={busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {err && <div className="proposal__error">⚠ {err}</div>}
    </div>
  )
}

// ===== Chronologisch records-log =====

function buildRecords(questions, proposals) {
  const rows = []

  for (const q of questions) {
    const subject = q.context?.company || q.context?.bedrijf || q.context?.deal_name || null
    let kind, label
    if (ACTION_STATUSES.has(q.status))      { kind = 'needs_action';   label = 'actie nodig' }
    else if (ANSWERED_STATUSES.has(q.status)) { kind = 'answered';     label = 'door jou beantwoord' }
    else                                    { kind = 'auto_handled';  label = 'auto-afgehandeld' }
    rows.push({
      key: `q-${q.id}`,
      kind,
      label,
      subject: subject || '(geen bedrijf)',
      summary: q.question,
      artifacts: extractArtifacts(q),
      default_action: q.default_action,
      answer: q.answer,
      when: q.answered_at || q.expires_at || q.asked_at,
      category: 'klant',
      raw: q,
    })
  }

  for (const p of proposals) {
    let kind, label
    if (p.status === 'pending' || p.status === 'amended') { kind = 'needs_action';  label = 'voorstel open' }
    else if (p.status === 'accepted')                      { kind = 'accepted';     label = 'geaccepteerd' }
    else if (p.status === 'rejected')                      { kind = 'rejected';     label = 'afgewezen' }
    else if (p.status === 'executed')                      { kind = 'auto_handled'; label = 'uitgevoerd' }
    else                                                   { kind = 'auto_handled'; label = p.status }
    rows.push({
      key: `p-${p.id}`,
      kind,
      label,
      subject: p.subject,
      summary: p.summary,
      artifacts: (p.proposal?.actions || []).map(a => a.label || a.type).filter(Boolean),
      default_action: p.default_action,
      answer: p.amendment,
      when: p.reviewed_at || p.created_at,
      category: p.category || 'overig',
      raw: p,
    })
  }

  rows.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
  return rows
}

function RecordRow({ record }) {
  const [amendOpen, setAmendOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  // Amend is alleen zinvol voor proposals (record.key begint met 'p-')
  const isProposal = record.key.startsWith('p-')
  const proposalId = isProposal ? record.key.slice(2) : null
  // Bij proposal met status 'amended' kan niet nóg een amend erbij — wacht op skill-run
  const canAmend = isProposal && record.raw.status !== 'amended'

  async function submitAmend() {
    if (!text.trim() || !proposalId) return
    setBusy(true); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('amend_proposal', {
        proposal_id: proposalId, amendment_text: text.trim(),
      })
      if (error)        setMsg('⚠ ' + error.message)
      else if (!data?.ok) setMsg('⚠ ' + (data?.reason || 'mislukt'))
      else { setAmendOpen(false); setText(''); setMsg(null) }
    } catch (e) { setMsg('⚠ ' + (e.message || 'netwerkfout')) }
    setBusy(false)
  }

  return (
    <div className={`record-row record-row--${record.kind}`}>
      <div className="record-row__left">
        <div className="record-row__when">{formatDateTime(record.when)}</div>
        <span className={CATEGORY_CLASS[record.category] || CATEGORY_CLASS.overig}>
          {CATEGORY_LABEL[record.category] || record.category}
        </span>
      </div>
      <div className="record-row__body">
        <div className="record-row__head">
          <span className="record-row__subject">{record.subject}</span>
          <span className={`record-row__label record-row__label--${record.kind}`}>{record.label}</span>
          {canAmend && !amendOpen && (
            <button
              type="button"
              className="record-row__amend-btn"
              onClick={() => setAmendOpen(true)}
              title="Geef een aanpassing door — skill pakt die bij de volgende run op"
            >
              ✎ aanpassen
            </button>
          )}
        </div>
        <div className="record-row__summary">{record.summary}</div>
        {record.artifacts && record.artifacts.length > 0 && (
          <div className="record-row__artifacts">
            {record.artifacts.slice(0, 5).map((a, i) => (
              <span key={i} className="record-row__artifact">{a}</span>
            ))}
            {record.artifacts.length > 5 && <span className="muted" style={{ fontSize: 11 }}>+{record.artifacts.length - 5}</span>}
          </div>
        )}
        {record.raw?.amendment && (
          <div className="record-row__amendment">
            <span className="muted">Jouw aanpassing: </span>{record.raw.amendment}
          </div>
        )}
        {canAmend && amendOpen && (
          <div className="record-row__amend">
            <textarea
              className="proposal__amend-input"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Hoe moet de agent dit anders/alsnog doen? Skill leest dit bij de volgende run."
              rows={2}
            />
            <div className="record-row__amend-btns">
              <button className="btn btn--accent" onClick={submitAmend} disabled={busy || !text.trim()}>Opslaan</button>
              <button className="btn btn--ghost"  onClick={() => { setAmendOpen(false); setText(''); setMsg(null) }}>Annuleer</button>
              {msg && <span className="record-row__msg">{msg}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

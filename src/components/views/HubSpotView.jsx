import { useMemo, useState } from 'react'
import AgentCard     from '../AgentCard'
import QuestionCard  from '../QuestionCard'
import { supabase }  from '../../lib/supabase'

const AGENT = 'hubspot-daily-sync'

const ACTION_STATUSES = new Set(['open', 'pending'])
const AUTO_HANDLED_STATUSES = new Set(['stale', 'expired', 'skipped', 'auto_resolved'])
const ANSWERED_STATUSES = new Set(['answered', 'resolved', 'done'])

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

  const allQs = data.questions.filter(q => q.agent_name === AGENT)
  const openQ = allQs.filter(q => ACTION_STATUSES.has(q.status))

  // Proposals — nieuw model
  const allProposals = (data.proposals || []).filter(p => p.agent_name === AGENT)
  const pendingProposals = allProposals.filter(p => p.status === 'pending' || p.status === 'amended')
  const reviewedProposals = allProposals.filter(p => ['accepted', 'rejected', 'executed', 'failed'].includes(p.status))

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

      {/* Voorstellen — nieuw flow-model */}
      <section>
        <div className="section__head">
          <h2 className="section__title">
            Voorstellen {pendingProposals.length > 0 && <span className="section__count">{pendingProposals.length}</span>}
          </h2>
          <span className="section__hint">
            Acties die de agent zou willen doen — accepteer, pas aan of wijs af. Niks wordt doorgevoerd zonder jouw groen licht.
          </span>
        </div>
        {pendingProposals.length === 0 ? (
          <div className="empty">
            Geen openstaande voorstellen. Zodra Daily Admin wordt uitgebreid met het voorstel-model
            (CRM + Jira Partnerships + Recruitment-kanban) verschijnen hier per-record voorstellen
            met Accepteer / Aanpassen / Afwijzen knoppen.
          </div>
        ) : (
          <div className="stack stack--sm">
            {pendingProposals.map(p => <ProposalCard key={p.id} proposal={p} />)}
          </div>
        )}
      </section>

      {/* Fallback: klassieke open_questions zolang de skill nog vragen stelt i.p.v. voorstellen */}
      {openQ.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">
              Nog te doen {openQ.length > 0 && <span className="section__count">{openQ.length}</span>}
            </h2>
            <span className="section__hint">
              klassieke open vragen — blijven staan tot je ze afrondt
            </span>
          </div>
          <div className="stack">
            {openQ.map(q => <QuestionCard key={q.id} question={q} />)}
          </div>
        </section>
      )}

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

// ===== Proposal card =====

function ProposalCard({ proposal, compact }) {
  const [mode, setMode] = useState('view') // view | amending
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

  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []

  return (
    <div className={`proposal ${compact ? 'proposal--compact' : ''} proposal--${status}`}>
      <div className="proposal__head">
        <span className={CATEGORY_CLASS[cat] || CATEGORY_CLASS.overig}>
          {CATEGORY_LABEL[cat] || cat}
        </span>
        <span className="proposal__subject">{proposal.subject}</span>
        <span className={`proposal__status proposal__status--${status}`}>{status}</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{formatDateTime(proposal.created_at)}</span>
      </div>
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
      </div>
    </div>
  )
}

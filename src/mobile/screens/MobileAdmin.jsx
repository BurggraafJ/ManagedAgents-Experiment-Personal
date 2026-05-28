import { useState, useMemo, useEffect } from 'react'
import { useAdmin } from '../../hooks/useAdmin'
import { filterAgentProposals, groupProposals } from '../../components/views/hubspot-shared'
import { buildPipelineLookup, CATEGORY_LABEL, formatDateTime } from '../../components/views/hubspot-common'
import { useProposalActions, actionDetails, normalizeActionShape, TYPE_META } from '../../components/useProposalActions'
import MIcon from '../MIcon'

// MobileAdmin — review-één-per-keer. Geport uit app/mobile-admin.jsx.
// Hergebruikt de ECHTE actielaag: useAdmin() (proposals) + groupProposals()
// (buckets) + useProposalActions() (accept/reject/amend RPC's). Geen
// nagebouwde mutatie-logica. Desktop HubSpotInboxView blijft onaangeroerd.
const BUCKETS = [
  { key: 'is_new', label: 'Nieuw', tone: 'new' },
  { key: 'to_review', label: 'Goedkeuren', tone: 'rev' },
  { key: 'need_input', label: 'Meer info', tone: 'need' },
]
// Action-kind → mobiel icoon (voor de kind-pills bovenaan de kaart).
const KIND_ICON = {
  deal: 'admin', company: 'admin', contact: 'contacts', stage: 'admin',
  note: 'mail', task: 'task', jira: 'task', card: 'task', comment: 'mail',
  deal_property_update: 'admin', property_update: 'admin', company_update: 'admin',
  contact_update: 'contacts', update: 'admin',
}
const LOG_LABEL = {
  amended: 'Aanpassing verstuurd', accepted: 'Goedgekeurd — wacht op uitvoering',
  executed: 'Uitgevoerd', rejected: 'Afgewezen', failed: 'Gefaald', superseded: 'Vervangen',
}

export default function MobileAdmin() {
  const { proposals, pipelines, refresh, mutateProposal } = useAdmin()
  const lookup = useMemo(() => buildPipelineLookup(pipelines || []), [pipelines])
  const buckets = useMemo(() => groupProposals(filterAgentProposals(proposals)), [proposals])

  const [bucket, setBucket] = useState('to_review')
  const [idx, setIdx] = useState(0)
  const [logOpen, setLogOpen] = useState(false)

  const stack = buckets[bucket] || []
  useEffect(() => { setIdx(0) }, [bucket])
  useEffect(() => { if (idx >= stack.length) setIdx(Math.max(0, stack.length - 1)) }, [stack.length, idx])

  const current = stack[idx] || null
  const totalOpen = buckets.is_new.length + buckets.to_review.length + buckets.need_input.length

  const todayDone = useMemo(() => {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0)
    return buckets.processed.filter(p =>
      ['accepted', 'executed'].includes(p.status) &&
      new Date(p.executed_at || p.reviewed_at || p.created_at) >= t0
    ).length
  }, [buckets.processed])

  const activeBucket = BUCKETS.find(b => b.key === bucket)

  return (
    <div className="m-dash">
      <header className="m-adm__head">
        <div className="m-adm__head-top">
          <div className="m-tk__eyebrow">WERKRUIMTE<span>Administratie</span></div>
          <button type="button" className="m-adm__logbtn" onClick={() => setLogOpen(true)}>
            <MIcon name="check" size={13} /> Logboek<span>{buckets.processed.length}</span>
          </button>
        </div>
        <h1 className="m-greet m-adm__title">{totalOpen} te verwerken</h1>
        <div className="m-greet-sub">
          {todayDone > 0
            ? <><strong>{todayDone} vandaag al verwerkt</strong> — lekker bezig.</>
            : `${buckets.is_new.length} nieuw · ${buckets.to_review.length} goedkeuren · ${buckets.need_input.length} meer info`}
        </div>
        <div className="m-filterchips">
          {BUCKETS.map(b => (
            <button
              key={b.key}
              type="button"
              className={`m-filterchip m-filterchip--${b.tone} ${bucket === b.key ? 'is-active' : ''}`}
              onClick={() => setBucket(b.key)}
            >
              <span className="m-filterchip__cnt">{buckets[b.key].length}</span>{b.label}
            </button>
          ))}
        </div>
      </header>

      <div className="m-adm__body">
        {!current ? (
          <div className="m-tl__empty">Geen voorstellen in deze lijst.</div>
        ) : (
          <>
            <div className={`m-adm-group m-adm-group--${activeBucket?.tone}`}>
              <span>{activeBucket?.label}</span><span>{stack.length}</span>
            </div>
            <AdminCard
              key={current.id}
              proposal={current}
              lookup={lookup}
              onRefresh={refresh}
              onMutate={mutateProposal}
            />
            <div className="m-swipehint">
              <MIcon name="chevron" size={13} /> {idx + 1} / {stack.length} in deze lijst
            </div>
            {stack.slice(idx + 1, idx + 3).map(p => (
              <PeekRow key={p.id} proposal={p} lookup={lookup} />
            ))}
          </>
        )}
      </div>

      <MobileAdminLog open={logOpen} onClose={() => setLogOpen(false)} processed={buckets.processed} />
    </div>
  )
}

function PeekRow({ proposal, lookup }) {
  const ctx = proposal.context || {}
  const { pipelineLabel, stageLabel } = lookup.resolve(ctx.pipeline || ctx.pipeline_id, ctx.pipeline_stage || ctx.deal_stage)
  const sub = [pipelineLabel, stageLabel].filter(Boolean).join(' · ') || (CATEGORY_LABEL[proposal.category] || 'Overig')
  return (
    <div className="m-peek">
      <div className="m-peek__ico"><MIcon name="admin" size={13} /></div>
      <div className="m-peek__body">
        <div className="m-peek__title">{proposal.subject}</div>
        <div className="m-peek__sub">{sub}</div>
      </div>
      <MIcon name="chevron" size={13} />
    </div>
  )
}

function AdminCard({ proposal, lookup, onRefresh, onMutate }) {
  const A = useProposalActions(proposal, onRefresh, onMutate)
  const ctx = proposal.context || {}
  const { pipelineLabel, stageLabel } = lookup.resolve(ctx.pipeline || ctx.pipeline_id, ctx.pipeline_stage || ctx.deal_stage)
  const owner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  const kinds = Array.from(new Set(actions.map(a => normalizeActionShape(a).type).filter(Boolean)))
  const amending = A.mode === 'amending'

  const submeta = [proposal.agent_name, owner, confidencePct != null ? `${confidencePct}% zeker` : null].filter(Boolean)

  if (!A.isPending) {
    return (
      <div className="m-adm-card m-adm-card--done">
        <div className="m-adm-card__resolved">
          <MIcon name="check" size={18} /> Verwerkt — {A.status === 'accepted' ? 'goedgekeurd' : A.status === 'rejected' ? 'afgewezen' : A.status}
        </div>
        <div className="m-adm-card__subject">{proposal.subject}</div>
      </div>
    )
  }

  return (
    <div className="m-adm-card">
      <div className="m-adm-card__top">
        <div className="m-adm-card__pills">
          {kinds.length > 0
            ? kinds.slice(0, 3).map(k => (
                <span key={k} className="m-catpill"><MIcon name={KIND_ICON[k] || 'spark'} size={11} /> {TYPE_META[k]?.label || k}</span>
              ))
            : <span className="m-catpill">{CATEGORY_LABEL[A.cat] || 'Overig'}</span>}
          {pipelineLabel && <span className="m-srclabel">{pipelineLabel}{stageLabel ? ` · ${stageLabel}` : ''}</span>}
          {A.needsInfo && <span className="m-catpill m-catpill--warn">info nodig</span>}
        </div>
        <span className="m-adm-card__time">{formatDateTime(proposal.created_at)}</span>
      </div>

      <div className="m-adm-card__subject">{proposal.subject}</div>
      {submeta.length > 0 && (
        <div className="m-adm-card__submeta">
          {submeta.map((s, i) => <span key={i}>{s}</span>)}
        </div>
      )}

      {actions.length > 0 && (
        <div className="m-diffgrid">
          <div className="m-diffgrid__head">Bij goedkeuren — {actions.length} {actions.length === 1 ? 'actie' : 'acties'}</div>
          {actions.map((a, i) => {
            const d = actionDetails(a, lookup, ctx)
            return (
              <div key={i} className="m-diffaction">
                <div className="m-diffaction__type">{d.meta.label}{d.title ? ` · ${d.title}` : ''}</div>
                {d.rows.map(([k, v], j) => (
                  <div key={j} className="m-diffrow"><span className="m-diffrow__k">{k}</span><span className="m-diffrow__v">{v}</span></div>
                ))}
                {d.body && <div className="m-diffaction__body">{d.body}</div>}
              </div>
            )
          })}
        </div>
      )}

      {proposal.summary && (
        <div className="m-why">
          <div className="m-why__label">Waarom dit voorstel</div>
          <div className="m-why__text">{proposal.summary}</div>
        </div>
      )}

      {A.liveAmendment && (
        <div className="m-why">
          <div className="m-why__label">Jouw feedback</div>
          <div className="m-why__text">{A.liveAmendment}</div>
        </div>
      )}

      {amending ? (
        <div className="m-feedback">
          <textarea
            className="m-feedback__input"
            value={A.amendText}
            onChange={(e) => A.setAmendText(e.target.value)}
            placeholder="Extra richtlijn voor de agent…"
            rows={3}
            autoFocus
          />
        </div>
      ) : (
        <button type="button" className="m-feedbox" onClick={() => A.setMode('amending')}>+ feedback voor de agent…</button>
      )}

      {A.err && <div className="m-quickadd__err">{A.err}</div>}

      <div className="m-adm-actionbar">
        {amending ? (
          <>
            <button type="button" className="m-admbtn" onClick={() => { A.setMode('view'); A.setAmendText('') }} disabled={A.busy}>Annuleer</button>
            <button type="button" className="m-admbtn m-admbtn--warn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>↻ Opnieuw</button>
            <button type="button" className="m-admbtn m-admbtn--primary" onClick={A.onAmendAndAccept} disabled={A.busy}>✓ Doorvoeren</button>
          </>
        ) : (
          <>
            <button type="button" className="m-admbtn m-admbtn--neg" onClick={A.onReject} disabled={A.busy}>
              <MIcon name="close" size={16} /> Afwijzen
            </button>
            <button type="button" className="m-admbtn" onClick={() => A.setMode('amending')} disabled={A.busy}>
              <MIcon name="refresh" size={14} /> Bewerk
            </button>
            <button type="button" className="m-admbtn m-admbtn--primary" onClick={A.onAccept} disabled={A.busy}>
              <MIcon name="check" size={16} color="#fff" stroke={2.2} /> Goedkeur
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Logboek-popup — toont wat admin-execute al verwerkt heeft (akkoord/uitgevoerd/
// afgewezen). Read-only; opent vanuit de header-knop.
function MobileAdminLog({ open, onClose, processed }) {
  if (!open) return null
  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label="Logboek">
        <div className="m-drawer__grab" />
        <div className="m-sheet__head">
          <span className="m-drawer__title">Logboek <span className="m-log__cnt">{processed.length}</span></span>
          <button type="button" className="m-drawer__close" onClick={onClose} aria-label="Sluiten"><MIcon name="close" size={16} /></button>
        </div>
        <div className="m-sheet__body m-log">
          {processed.length === 0
            ? <div className="m-tl__empty">Nog niets verwerkt.</div>
            : processed.slice(0, 40).map(p => <LogLine key={p.id} p={p} />)}
        </div>
      </div>
    </>
  )
}

function LogLine({ p }) {
  const when = p.executed_at || p.reviewed_at || p.created_at
  const err = p.execution_result?.error
  return (
    <div className={`m-logline m-logline--${p.status}`}>
      <div className="m-logline__main">
        <div className="m-logline__status">{LOG_LABEL[p.status] || p.status}</div>
        <div className="m-logline__subj">{p.subject}</div>
        {err && <div className="m-logline__err">⚠ {err}</div>}
      </div>
      <div className="m-logline__time">{formatDateTime(when)}</div>
    </div>
  )
}

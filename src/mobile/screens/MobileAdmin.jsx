import { useState, useMemo, useEffect } from 'react'
import { useAdmin } from '../../hooks/useAdmin'
import { filterAgentProposals, groupProposals } from '../../components/views/hubspot-shared'
import { buildPipelineLookup, CATEGORY_LABEL, formatDateTime } from '../../components/views/hubspot-common'
import { useProposalActions, actionDetails, normalizeActionShape } from '../../components/useProposalActions'
import { useSpeechDictation } from '../../hooks/useSpeechDictation'
import MIcon from '../MIcon'

// MobileAdmin — compact "Admin C" drive-mode review, één voorstel per keer.
// Hergebruikt de ECHTE actielaag: useAdmin() (proposals) + groupProposals()
// (buckets) + useProposalActions() (accept/reject/amend/edit RPC's). Geen
// nagebouwde mutatie-logica. Desktop HubSpotInboxView blijft onaangeroerd.
// Spraak: mic-knop links van Nee → dicteer → wordt een extra note-actie;
// "Ja, door" accepteert dan via het bestaande hasEdits-pad.
const BUCKETS = [
  { key: 'is_new', label: 'Nieuw', tone: 'new' },
  { key: 'to_review', label: 'Goedkeuren', tone: 'rev' },
  { key: 'need_input', label: 'Meer info', tone: 'need' },
]
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

  return (
    <div className="m-dash m-dash--adm">
      <header className="m-adm__head">
        <div className="m-adm__head-top">
          <div className="m-tk__eyebrow">WERKRUIMTE<span>Administratie</span></div>
          <button type="button" className="m-adm__logbtn" onClick={() => setLogOpen(true)}>
            <MIcon name="check" size={13} /> Logboek<span>{buckets.processed.length}</span>
          </button>
        </div>
        <div className="m-adm__count">
          {totalOpen} te doen
          {stack.length > 0 && ` · ${idx + 1}/${stack.length}`}
          {todayDone > 0 && ` · ${todayDone} verwerkt vandaag`}
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
            <AdminCard
              key={current.id}
              proposal={current}
              lookup={lookup}
              onRefresh={refresh}
              onMutate={mutateProposal}
              pager={{ idx, total: stack.length, onPrev: () => setIdx((idx - 1 + stack.length) % stack.length), onNext: () => setIdx((idx + 1) % stack.length) }}
            />
          </>
        )}
      </div>

      <MobileAdminLog open={logOpen} onClose={() => setLogOpen(false)} processed={buckets.processed} />
    </div>
  )
}

function AdminCard({ proposal, lookup, onRefresh, onMutate, pager }) {
  const A = useProposalActions(proposal, onRefresh, onMutate)
  const ctx = proposal.context || {}
  const { pipelineLabel, stageLabel } = lookup.resolve(ctx.pipeline || ctx.pipeline_id, ctx.pipeline_stage || ctx.deal_stage)
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const actions = useMemo(() => {
    const raw = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
    return raw.map(normalizeActionShape)
  }, [proposal.proposal])
  const amending = A.mode === 'amending'
  const [whyOpen, setWhyOpen] = useState(false)

  // Spraak = herbeoordeling voor de agent (amendment), geen extra HubSpot-note.
  const voice = useSpeechDictation({
    lang: 'nl-NL',
    onFinal: (text) => { if (text) A.setAmendText(text) },
  })
  function removeExtra(i) {
    A.removeExtraAction(i)
  }

  // Versheid-chip: alléén feiten uit echte context — pipeline/stage, bestaande
  // Jira/REC-kaart (issueKey in de acties) en mail-aantallen. Niets verzinnen.
  const freshness = useMemo(() => {
    const seg = []
    if (pipelineLabel) seg.push(stageLabel ? `${pipelineLabel} · ${stageLabel}` : pipelineLabel)
    const keys = actions
      .filter(a => a?.type === 'jira' || a?.type === 'card')
      .map(a => a?.payload?.issueKey).filter(Boolean)
    if (keys.length > 0) seg.push(keys.join(', '))
    const mailN = Array.isArray(ctx.mail_ids) ? ctx.mail_ids.length
      : (ctx.mail_id || ctx.message_id || ctx.thread_id ? 1 : 0)
    if (mailN > 0) seg.push(`${mailN} ${mailN === 1 ? 'mail' : 'mails'}`)
    return seg
  }, [actions, pipelineLabel, stageLabel, ctx.mail_ids, ctx.mail_id, ctx.message_id, ctx.thread_id])

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

  const visibleCount = actions.filter((_, i) => !A.removed.has(i)).length + A.extraActions.length
  const onDeal = ctx.deal_id || ctx.deal_name ? ' — op de deal' : ''

  return (
    <div className="m-admc">
      <div className="m-admc__scroll">
      <h2 className="m-admc__title">{proposal.subject}</h2>
      <div className="m-admc__meta">
        {[proposal.agent_name || CATEGORY_LABEL[A.cat] || 'Overig',
          confidencePct != null ? `${confidencePct}% zeker` : null,
          formatDateTime(proposal.created_at)]
          .filter(Boolean).map((s, i) => <span key={i}>{s}</span>)}
      </div>
      {(freshness.length > 0 || A.needsInfo) && (
        <div className="m-admc__freshrow">
          {freshness.length > 0 && <span className="m-admc__fresh">{freshness.join(' · ')}</span>}
          {A.needsInfo && <span className="m-catpill m-catpill--warn">info nodig</span>}
        </div>
      )}

      <div className="m-adm-card m-admc__card">
        <div className="m-diffgrid m-admc__grid">
          <div className="m-diffgrid__head">{visibleCount} {visibleCount === 1 ? 'actie' : 'acties'}{onDeal}</div>
          {actions.map((a, i) => {
            if (A.removed.has(i)) {
              return (
                <div key={i} className="m-diffaction m-diffaction--removed">
                  <span className="m-diffaction__main">Actie verwijderd</span>
                  <button type="button" className="m-diffaction__restore" onClick={() => A.restoreAction(i)}>herstel</button>
                </div>
              )
            }
            const d = actionDetails(a, lookup, ctx)
            return (
              <div key={i} className="m-diffaction">
                <div className="m-diffaction__main">
                  <div className="m-diffaction__type">{d.meta.label}{d.title ? ` · ${d.title}` : ''}</div>
                  {d.rows.map(([k, v], j) => (
                    <div key={j} className="m-diffrow"><span className="m-diffrow__k">{k}</span><span className="m-diffrow__v">{v}</span></div>
                  ))}
                  {d.body && <div className="m-diffaction__body">{d.body}</div>}
                </div>
                <button type="button" className="m-diffaction__del" onClick={() => A.removeAction(i)} aria-label="Verwijder actie">
                  <MIcon name="close" size={13} stroke={2.4} />
                </button>
              </div>
            )
          })}
          {A.extraActions.map((a, i) => {
            const d = actionDetails(a, lookup, ctx)
            return (
              <div key={`x${i}`} className="m-diffaction">
                <div className="m-diffaction__main">
                  <div className="m-diffaction__type">{d.meta.label}</div>
                  {d.body && <div className="m-diffrow"><span className="m-diffrow__k">Inhoud</span><span className="m-diffrow__v">{d.body}</span></div>}
                </div>
                <button type="button" className="m-diffaction__del" onClick={() => removeExtra(i)} aria-label="Verwijder actie">
                  <MIcon name="close" size={13} stroke={2.4} />
                </button>
              </div>
            )
          })}
        </div>

        <button type="button" className="m-cwhy__row" onClick={() => setWhyOpen(o => !o)}>
          <span className="m-cwhy__txt">{proposal.summary ? `Waarom: ${proposal.summary}` : 'Opties'}</span>
          <span className="m-cwhy__more">{whyOpen ? 'sluit' : 'details'}</span>
        </button>
        {whyOpen && (
          <div className="m-cwhy__full">
            {proposal.summary && <div className="m-why__text">{proposal.summary}</div>}
            {A.liveAmendment && (
              <div className="m-why">
                <div className="m-why__label">Jouw feedback</div>
                <div className="m-why__text">{A.liveAmendment}</div>
              </div>
            )}
            {!amending && (
              <button type="button" className="m-cwhy__edit" onClick={() => A.setMode('amending')}>
                <MIcon name="refresh" size={13} /> Bewerk / feedback voor de agent
              </button>
            )}
          </div>
        )}

        {amending && (
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
        )}
      </div>

      {A.err && <div className="m-quickadd__err">{A.err}</div>}
      </div>

      {(voice.recording || voice.transcript || A.amendText) && (
        <div className={`m-speak ${voice.recording ? 'is-rec' : ''}`}>
          <div className="m-speak__label"><span className="m-speak__dot" /> {voice.recording ? 'Herbeoordeling · luistert' : 'Herbeoordeling'}</div>
          <div className="m-speak__text">{voice.transcript || A.amendText || 'Zeg wat de agent moet herzien.'}</div>
        </div>
      )}

      <div className="m-adm-actionbar m-admc__bar">
        {amending ? (
          <>
            <button type="button" className="m-admbtn" onClick={() => { A.setMode('view'); A.setAmendText('') }} disabled={A.busy}>Annuleer</button>
            <button type="button" className="m-admbtn m-admbtn--warn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>↻ Opnieuw</button>
            <button type="button" className="m-admbtn m-admbtn--primary" onClick={A.onAmendAndAccept} disabled={A.busy}>✓ Doorvoeren</button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`m-micbtn ${voice.recording ? 'is-rec' : ''}`}
              onClick={() => (voice.recording ? voice.stop() : voice.start())}
              disabled={A.busy || !voice.supported}
              aria-label={voice.recording ? 'Stop opname' : 'Spreek een herbeoordeling in'}
            ><span className="m-micbtn__dot" /></button>
            <button type="button" className="m-admbtn m-admbtn--neg m-admbtn--big" onClick={A.onReject} disabled={A.busy}>
              Nee
            </button>
            <button
              type="button"
              className="m-admbtn m-admbtn--primary m-admbtn--big"
              onClick={() => (voice.transcript.trim() || A.amendText.trim() ? A.onAmend() : A.onAccept())}
              disabled={A.busy || voice.recording}
            >
              {voice.transcript.trim() || A.amendText.trim() ? 'Opnieuw' : 'Ja, door'}
            </button>
          </>
        )}
      </div>
      {pager && (
        <div className="m-adm-pager">
          <button
            type="button" className="m-pagerbtn m-pagerbtn--prev" aria-label="Vorige voorstel"
            disabled={pager.total < 2}
            onClick={pager.onPrev}
          ><MIcon name="chevron" size={15} /></button>
          <span className="m-adm-pager__pos">{pager.idx + 1} / {pager.total}</span>
          <button
            type="button" className="m-pagerbtn" aria-label="Volgende voorstel"
            disabled={pager.total < 2}
            onClick={pager.onNext}
          ><MIcon name="chevron" size={15} /></button>
        </div>
      )}
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

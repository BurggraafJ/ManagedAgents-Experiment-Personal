import { useState } from 'react'
import AgentCard from '../AgentCard'
import { supabase } from '../../lib/supabase'
import MicButton from '../MicButton'

const AGENT = 'sales-on-road'

const STATUS_CLASS = {
  processed:      's-success',
  needs_review:   's-warning',
  pending:        's-idle',
  error:          's-error',
  skipped:        's-idle',
}

const STATUS_LABEL = {
  processed:    'verwerkt',
  needs_review: 'controle nodig',
  pending:      'bezig',
  error:        'fout',
  skipped:      'overgeslagen',
}

const INBOX_STATUS_LABEL = {
  pending:    'wacht op agent',
  processing: 'wordt verwerkt',
  done:       'verwerkt',
  error:      'fout',
  skipped:    'overgeslagen',
}

const INBOX_STATUS_CLASS = {
  pending:    's-idle',
  processing: 's-warning',
  done:       's-success',
  error:      's-error',
  skipped:    's-idle',
}

export default function SalesOnRoadView({ data }) {
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []

  const events = data.salesEvents || []
  const inbox  = data.salesOnRoadInbox || []
  const total         = events.length
  const processed     = events.filter(e => e.status === 'processed').length
  const needsReview   = events.filter(e => e.status === 'needs_review').length
  const errored       = events.filter(e => e.status === 'error').length

  const WEEK_MS = 7 * 86400000
  const thisWeekEvents = events.filter(e => Date.now() - new Date(e.created_at).getTime() < WEEK_MS)

  // Quick-capture state
  const [text, setText] = useState('')
  const [submitState, setSubmitState] = useState('idle') // idle | submitting | ok | error
  const [submitError, setSubmitError] = useState(null)

  async function submit() {
    if (submitState === 'submitting') return
    const trimmed = text.trim()
    if (!trimmed) return
    setSubmitState('submitting')
    setSubmitError(null)
    const { error } = await supabase.rpc('submit_sales_on_road_note', { p_text: trimmed })
    if (error) {
      setSubmitError(error.message)
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 4000)
      return
    }
    setText('')
    setSubmitState('ok')
    setTimeout(() => setSubmitState('idle'), 2000)
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {/* Quick-capture — vervangt Slack #sales-on-road als input-bron */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Nieuwe aantekening</h2>
          <span className="section__hint">na een kennismaking — agent verwerkt bij volgende run</span>
        </div>
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          <div className="textarea-wrap">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Bijv. Net bij Stellicher geweest, 8 advocaten, stuur offerte. Of: kennismaking met Joosten Advocaten — Tarik wil demo volgende week."
              rows={4}
              style={{
                width: '100%',
                background: 'var(--surface-3)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                padding: 'var(--s-4)',
                color: 'var(--text)',
                fontSize: 14,
                lineHeight: 1.55,
                fontFamily: 'var(--font)',
                resize: 'vertical',
                minHeight: 96,
              }}
              disabled={submitState === 'submitting'}
            />
            <MicButton
              onTranscript={t => setText(prev => prev ? `${prev} ${t}` : t)}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s-4)', fontSize: 12 }}>
            <span className="muted">Ctrl/⌘+Enter om te versturen</span>
            <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
              {submitState === 'ok' && <span className="s-success">✓ opgeslagen</span>}
              {submitState === 'error' && <span className="s-error" title={submitError}>✗ fout</span>}
              <button
                type="button"
                className="btn btn--accent"
                onClick={submit}
                disabled={submitState === 'submitting' || !text.trim()}
              >
                {submitState === 'submitting' ? 'Versturen…' : 'Versturen'}
              </button>
            </div>
          </div>
        </div>

        {inbox.length > 0 && (
          <div style={{ marginTop: 'var(--s-4)' }}>
            <div className="section__hint" style={{ marginBottom: 'var(--s-3)' }}>
              Laatste {Math.min(5, inbox.length)} aantekeningen
            </div>
            <div className="stack stack--sm">
              {inbox.slice(0, 5).map(item => (
                <div key={item.id} className="card" style={{ padding: 'var(--s-4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11 }}>
                    <span className="muted">{formatFullDate(item.created_at)}</span>
                    <span className={`pill ${INBOX_STATUS_CLASS[item.status] || 's-idle'}`} style={{ fontSize: 10 }}>
                      {INBOX_STATUS_LABEL[item.status] || item.status}
                    </span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}>
                    {item.raw_text}
                  </div>
                  {item.error && (
                    <div className="s-error" style={{ marginTop: 6, fontSize: 12 }}>{item.error}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
          <span className="section__hint">verwerkt aantekeningen uit inbox-tabel hierboven</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <AgentCard
            agent={AGENT}
            schedule={schedule}
            latestRun={latestRun}
            history={history}
            openQuestions={[]}
          />
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">Deze week</h2>
          <span className="section__hint">verwerkte gesprekken</span>
        </div>
        <div className="grid grid--kpi">
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{thisWeekEvents.length}</div>
            <div className="kpi__label">Gesprekken deze week</div>
          </div>
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{processed}</div>
            <div className="kpi__label">Totaal verwerkt</div>
          </div>
          <div className="kpi">
            <div className="kpi__value s-warning" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--warning)' }}>{needsReview}</div>
            <div className="kpi__label">Controle nodig</div>
          </div>
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums', color: errored > 0 ? 'var(--error)' : 'var(--accent)' }}>{errored}</div>
            <div className="kpi__label">Fouten</div>
          </div>
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">Gesprekken {total > 0 && <span className="section__count">{total}</span>}</h2>
          <span className="section__hint">nieuwste boven</span>
        </div>

        {events.length === 0 ? (
          <div className="empty">
            Nog geen gesprekken verwerkt. Drop een aantekening in het invoerblok hierboven —
            de agent pakt het op bij de volgende orchestrator-poll.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Wanneer</th>
                  <th>Bedrijf</th>
                  <th>Stage</th>
                  <th>Acties</th>
                  <th>Draft</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id}>
                    <td>{formatShortDate(e.created_at)}</td>
                    <td style={{ color: 'var(--text)', fontWeight: 500 }}>
                      {e.company_name || <span className="muted">—</span>}
                    </td>
                    <td>
                      {e.stage_before && e.stage_after && e.stage_before !== e.stage_after
                        ? <><span className="muted">{e.stage_before}</span> <span style={{ margin: '0 4px' }}>→</span> <span style={{ color: 'var(--accent)' }}>{e.stage_after}</span></>
                        : e.stage_after
                          ? <span style={{ color: 'var(--accent)' }}>{e.stage_after}</span>
                          : <span className="muted">—</span>}
                    </td>
                    <td>
                      {Array.isArray(e.actions) && e.actions.length > 0
                        ? <span className="muted" style={{ fontSize: 12 }}>{e.actions.join(' · ')}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      {e.outlook_draft_created
                        ? <span className="s-success">✓</span>
                        : e.license_requested
                          ? <span className="s-warning" title="licentie nog handmatig">⚠ licentie</span>
                          : <span className="muted">—</span>}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_CLASS[e.status] || 's-idle'}`}>
                        {STATUS_LABEL[e.status] || e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Laatste rauwe aantekeningen — collapsed per default */}
      {events.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Laatste aantekeningen</h2>
            <span className="section__hint">wat je schreef</span>
          </div>
          <div className="stack stack--sm">
            {events.slice(0, 5).map(e => (
              <div key={`msg-${e.id}`} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11 }}>
                  <span className="muted">{formatFullDate(e.created_at)}{e.company_name ? ` · ${e.company_name}` : ''}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}>
                  {e.raw_message}
                </div>
                {e.summary && (
                  <div className="inbox-item__default" style={{ marginTop: 10 }}>
                    <span className="muted">samenvatting: </span>{e.summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function formatShortDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatFullDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

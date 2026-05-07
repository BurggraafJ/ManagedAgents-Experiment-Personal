// =============================================================================
// RagDetailsModal — popover met top-chunks, lessons en meta voor één record
// =============================================================================
// Roept get_record_rag_details RPC aan; toont 4 secties:
//   1. Headline-stats (chunks, build_ms, intent)
//   2. Per-source bar (visueel)
//   3. Top 5 chunks met preview, source-tag, similarity
//   4. Lessons (indien aanwezig)
// =============================================================================

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SOURCE_COLORS = {
  meeting:    { bg: '#fef3c7', fg: '#92400e' },
  mail:       { bg: '#dbeafe', fg: '#1e40af' },
  engagement: { bg: '#e9d5ff', fg: '#6b21a8' },
  deal:       { bg: '#bbf7d0', fg: '#166534' },
  company:    { bg: '#fce7f3', fg: '#9f1239' },
  contact:    { bg: '#fce7f3', fg: '#9f1239' },
  jira:       { bg: '#dbeafe', fg: '#1e40af' },
  event:      { bg: '#fed7aa', fg: '#9a3412' },
  lesson:     { bg: '#cffafe', fg: '#155e75' },
}

const SOURCE_ICONS = {
  meeting: '🦟', mail: '✉', engagement: '📝', deal: '💼',
  company: '🏢', contact: '👤', jira: '🎫', event: '📅', lesson: '📚',
}

const FACT_TYPE_COLORS = {
  decision:    { bg: '#fef3c7', fg: '#92400e' },
  commitment:  { bg: '#dcfce7', fg: '#166534' },
  date:        { bg: '#dbeafe', fg: '#1e40af' },
  price:       { bg: '#fce7f3', fg: '#9f1239' },
  agreement:   { bg: '#dcfce7', fg: '#166534' },
  objection:   { bg: '#fee2e2', fg: '#991b1b' },
  rejection:   { bg: '#fee2e2', fg: '#991b1b' },
  risk:        { bg: '#fed7aa', fg: '#9a3412' },
  name:        { bg: '#f3f4f6', fg: '#374151' },
  question:    { bg: '#e0e7ff', fg: '#3730a3' },
  question_followup: { bg: '#e0e7ff', fg: '#3730a3' },
}

function fmtDate(d) {
  if (!d) return '?'
  try {
    return new Date(d).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
  } catch { return d }
}

function SourceChip({ source, n }) {
  const c = SOURCE_COLORS[source] || { bg: '#f3f4f6', fg: '#374151' }
  const icon = SOURCE_ICONS[source] || '•'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.fg,
    }}>
      <span>{icon}</span> {source} <span style={{ opacity: 0.6 }}>· {n}</span>
    </span>
  )
}

function FactChip({ type }) {
  const c = FACT_TYPE_COLORS[type] || { bg: '#f3f4f6', fg: '#374151' }
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      fontSize: 10, fontWeight: 600, background: c.bg, color: c.fg,
    }}>{type}</span>
  )
}

export default function RagDetailsModal({ recordType, recordId, onClose }) {
  const navigate = useNavigate()
  const [details, setDetails] = useState(null)
  const [outgoing, setOutgoing] = useState(null)
  const [agendaInfo, setAgendaInfo] = useState(null)   // {agenda_relevance, agenda_check_result} voor autodraft_mail
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('incoming')   // 'incoming' | 'outgoing'

  useEffect(() => {
    if (!recordType || !recordId) return
    let cancel = false
    setLoading(true)
    const calls = [
      supabase.rpc('get_record_rag_details', { p_record_type: recordType, p_record_id: recordId }),
      supabase.rpc('get_record_outgoing_usage', { p_record_type: recordType, p_record_id: recordId }),
    ]
    // Extra fetch voor agenda-info bij autodraft_mail records.
    // recordId hier is de autodraft_mails.id (zie AutoDraftView usage), dus zoek op id.
    if (recordType === 'autodraft_mail') {
      calls.push(
        supabase.from('autodraft_mails')
          .select('agenda_relevance, agenda_check_result, category_key, audience, status, suggested_action')
          .eq('id', recordId)
          .maybeSingle()
      )
    }
    Promise.all(calls).then((results) => {
      if (cancel) return
      const [incRes, outRes, agendaRes] = results
      if (incRes.error) setErr(incRes.error.message)
      else setDetails(incRes.data)
      if (!outRes.error) setOutgoing(outRes.data)
      if (agendaRes && !agendaRes.error) setAgendaInfo(agendaRes.data)
      setLoading(false)
    })
    return () => { cancel = true }
  }, [recordType, recordId])

  // Esc-key sluit modal
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const summary = details?.summary || {}
  const topChunks = details?.top_chunks || []
  const lessons = details?.lessons || []
  const meta = details?.retrieval_meta || {}

  // Per-source counts
  const sourceCounts = []
  for (const src of ['meeting', 'mail', 'engagement', 'deal', 'company', 'contact', 'jira', 'event', 'lesson']) {
    const n = summary[`n_${src}`] || 0
    if (n > 0) sourceCounts.push({ source: src, n })
  }

  const factTypes = summary.fact_types_breakdown || {}
  const factTypeEntries = Object.entries(factTypes).sort((a, b) => b[1] - a[1])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, maxWidth: 720, width: '100%',
          maxHeight: '85vh', overflow: 'auto', padding: 20,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>RAG-zicht per record</h3>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {recordType.replace('_', ' ')} · {recordId.slice(0, 8)}…
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', border: 0, fontSize: 22, cursor: 'pointer',
              color: '#6b7280', padding: 0, lineHeight: 1,
            }}
            aria-label="Sluiten"
          >×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '1px solid #e5e7eb' }}>
          <TabButton
            active={tab === 'incoming'}
            onClick={() => setTab('incoming')}
            label="↓ Inkomend"
            sub={summary.has_rag ? `${summary.total_chunks || 0} chunks` : 'geen RAG'}
            tone={summary.has_rag ? 'good' : 'mute'}
          />
          <TabButton
            active={tab === 'outgoing'}
            onClick={() => setTab('outgoing')}
            label="↑ Uitgaand"
            sub={outgoing ? `${outgoing.n_uses || 0}× gebruikt` : '…'}
            tone={outgoing && outgoing.n_uses > 0 ? 'good' : 'mute'}
          />
        </div>

        {loading && <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Laden…</div>}
        {err && <div style={{ padding: 12, color: '#991b1b', background: '#fee2e2', borderRadius: 6 }}>Fout: {err}</div>}

        {!loading && !err && tab === 'outgoing' && (
          <OutgoingTab outgoing={outgoing} recordType={recordType} />
        )}

        {!loading && !err && tab === 'incoming' && (!summary.has_rag) && (
          <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⊘</div>
            <strong>Geen RAG-context gebruikt voor dit record.</strong>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              De skill heeft geen <code>context-build</code>-call gedaan, of de bundle is niet gekoppeld via <code>trigger_ref_id</code>.
            </div>
          </div>
        )}

        {/* Agenda-check sectie — toont voor autodraft_mail records of de agenda
            is geraadpleegd voor deze mail (en wat het verdict was). */}
        {!loading && !err && tab === 'incoming' && agendaInfo && (
          <AgendaCheckSection agendaInfo={agendaInfo} />
        )}

        {!loading && !err && tab === 'incoming' && summary.has_rag && (
          <>
            {/* Headline stats */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
              marginBottom: 16, padding: '10px 12px',
              background: '#f9fafb', borderRadius: 8,
            }}>
              <Stat label="Chunks" value={summary.total_chunks || 0} />
              <Stat label="Build" value={summary.build_ms ? `${summary.build_ms}ms` : '—'} />
              <Stat label="Top sim" value={summary.avg_top_similarity ? Number(summary.avg_top_similarity).toFixed(2) : '—'} />
              <Stat label="Bron" value={summary.rag_source === 'legacy_prefill' ? 'legacy' : 'bundle'} sub={summary.reranked ? '· reranked' : ''} />
            </div>

            {/* Filters van het recept */}
            {(meta.filter_audience || meta.filter_meeting_category) && (
              <div style={{ marginBottom: 16, fontSize: 11, color: '#6b7280' }}>
                <strong>Filter:</strong>
                {meta.filter_audience && <> audience={JSON.stringify(meta.filter_audience)}</>}
                {meta.filter_meeting_category && <> · meeting_category={JSON.stringify(meta.filter_meeting_category)}</>}
              </div>
            )}

            {/* Per source */}
            {sourceCounts.length > 0 && (
              <Section title="Per bron">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {sourceCounts.map(({ source, n }) => <SourceChip key={source} source={source} n={n} />)}
                </div>
              </Section>
            )}

            {/* Meeting-laag breakdown */}
            {summary.has_fireflies && (
              <Section title="Fireflies-laag">
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <span><strong>{summary.n_meeting_macro || 0}</strong> macro</span>
                  <span><strong>{summary.n_meeting_topic || 0}</strong> topic</span>
                  <span><strong>{summary.n_meeting_salient || 0}</strong> salient</span>
                </div>
                {summary.meeting_categories && summary.meeting_categories.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Categorieën: {summary.meeting_categories.map((c, i) => (
                      <span key={i} style={{
                        display: 'inline-block', padding: '1px 6px', marginRight: 4,
                        background: '#fef3c7', color: '#92400e', borderRadius: 4, fontSize: 11,
                      }}>{c}</span>
                    ))}
                  </div>
                )}
                {factTypeEntries.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Feit-types:{' '}
                    {factTypeEntries.map(([t, n]) => (
                      <span key={t} style={{ marginRight: 6 }}>
                        <FactChip type={t} /> <span style={{ fontSize: 11, color: '#6b7280' }}>{n}</span>
                      </span>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* Top chunks */}
            {topChunks.length > 0 && (
              <Section title={`Top ${topChunks.length} chunks`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {topChunks.map((c, i) => (
                    <div key={i} style={{
                      padding: 8, background: '#fafafa', borderRadius: 6,
                      borderLeft: '3px solid ' + (SOURCE_COLORS[c.source]?.fg || '#9ca3af'),
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11 }}>
                        <span style={{ fontWeight: 700 }}>{i + 1}.</span>
                        <SourceChip source={c.source} n={c.chunk_type || ''} />
                        {c.fact_type && <FactChip type={c.fact_type} />}
                        {c.topic_title && <span style={{ color: '#6b7280' }}>· {c.topic_title}</span>}
                        {c.speaker && <span style={{ color: '#6b7280' }}>· {c.speaker}</span>}
                        <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 10 }}>
                          sim {c.similarity || '?'} · {fmtDate(c.occurred_at)}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                        {c.preview || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Lessons */}
            {Array.isArray(lessons) && lessons.length > 0 && (
              <Section title={`JelleMind-lessons (${lessons.length})`}>
                {lessons.map((l, i) => (
                  <div key={i} style={{
                    padding: 8, background: '#cffafe', borderRadius: 6, marginBottom: 6,
                    borderLeft: '3px solid #155e75',
                  }}>
                    <div style={{ fontSize: 10, color: '#155e75', fontWeight: 700, marginBottom: 4 }}>
                      📚 {l.mind_scope || 'lesson'} · sim {Number(l.similarity || 0).toFixed(2)}
                    </div>
                    <div style={{ fontSize: 12 }}>{l.lesson_text || l.text || '—'}</div>
                  </div>
                ))}
              </Section>
            )}

            {/* Footer-link */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e7eb', fontSize: 11, color: '#6b7280' }}>
              {details?.bundle_id && <>bundle_id: <code>{details.bundle_id.slice(0, 8)}…</code> · </>}
              <a
                href="/zoeken"
                onClick={(e) => { e.preventDefault(); onClose(); navigate('/zoeken') }}
                style={{ color: '#2563eb' }}
              >Open RagSearchView →</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label, sub, tone }) {
  const colors = {
    good: { fg: '#166534' },
    mute: { fg: '#6b7280' },
  }
  const c = colors[tone] || colors.mute
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '10px 12px', background: 'transparent', border: 0,
        borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        color: active ? '#111' : '#6b7280',
        fontWeight: active ? 700 : 500,
      }}
    >
      <div style={{ fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 10, color: active ? c.fg : '#9ca3af', marginTop: 2 }}>{sub}</div>
    </button>
  )
}

function OutgoingTab({ outgoing, recordType }) {
  if (!outgoing) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Laden…</div>
  }
  const ownChunks = outgoing.own_chunks || []
  const usedIn = outgoing.used_in_bundles || []

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 12, color: '#6b7280' }}>
        Hoe vaak wordt dit record (zijn chunks) opgehaald als bron in andere RAG-bundles?
      </div>

      {/* Top stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
        marginBottom: 14, padding: '10px 12px',
        background: '#f9fafb', borderRadius: 8,
      }}>
        <Stat label="Eigen chunks" value={outgoing.n_own_chunks || 0} sub="in chunks-tabel" />
        <Stat label="Bundle-uses" value={outgoing.n_uses || 0} sub="andere records" />
      </div>

      {/* Eigen chunks */}
      {ownChunks.length > 0 ? (
        <Section title="Eigen chunks van dit record">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ownChunks.map((c, i) => (
              <div key={i} style={{
                padding: 8, background: '#fafafa', borderRadius: 6,
                borderLeft: '3px solid #6b7280',
              }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
                  {c.chunk_type} · <code style={{ fontSize: 10 }}>{c.chunk_id?.slice(0, 8)}…</code>
                  {c.created_at && <> · gechunkt {fmtDate(c.created_at)}</>}
                </div>
                <div style={{ fontSize: 12, color: '#374151' }}>{c.preview || '—'}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <div style={{ padding: 16, background: '#fef3c7', borderRadius: 6, fontSize: 13, color: '#92400e', marginBottom: 12 }}>
          {recordType === 'agent_proposal'
            ? <>Voorstellen worden niet zelf gechunkt — alleen mails, meetings en HubSpot-records komen in de chunks-tabel. Outgoing-usage is dus altijd 0 voor proposals.</>
            : <>Dit record heeft nog geen chunks in de chunks-tabel. Mogelijk is de chunker nog niet door deze mail heen, of is hij gefilterd.</>
          }
        </div>
      )}

      {/* Bundle-uses */}
      {usedIn.length > 0 ? (
        <Section title={`Gebruikt in ${usedIn.length} bundle(s)`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {usedIn.map((b, i) => (
              <div key={i} style={{
                padding: 8, background: '#dcfce7', borderRadius: 6,
                borderLeft: '3px solid #166534', fontSize: 12,
              }}>
                <div style={{ fontWeight: 700, color: '#166534', marginBottom: 2 }}>
                  intent: {b.intent} {b.audience && <span style={{ opacity: 0.7 }}>· {b.audience}</span>}
                </div>
                <div style={{ color: '#374151', fontSize: 11 }}>
                  trigger: {b.trigger_type || '?'}
                  {b.trigger_ref_id && <> ({b.trigger_ref_id.slice(0, 12)}…)</>}
                  {b.rag_built_at && <> · {fmtDate(b.rag_built_at)}</>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : ownChunks.length > 0 && (
        <div style={{ padding: 12, background: '#f3f4f6', borderRadius: 6, fontSize: 12, color: '#6b7280' }}>
          Nog niet opgehaald als RAG-bron in een andere bundle. Zal pas verschijnen wanneer een skill (auto-draft, daily-admin, etc.) dit record's chunks ophaalt voor context.
        </div>
      )}

      {outgoing.note && (
        <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
          {outgoing.note}
        </div>
      )}
    </div>
  )
}

// AgendaCheckSection — toont per autodraft-mail of de agenda is geraadpleegd.
// Vier states: 🟢 ok / ⚠ conflict / 🟡 niet nodig / 🔴 niet uitgevoerd.
function AgendaCheckSection({ agendaInfo }) {
  const rel = agendaInfo.agenda_relevance || null
  const check = agendaInfo.agenda_check_result || null

  // Bepaal verdict-state:
  // - rel.relevant=true + check.verdict='ok'           → groen: geraadpleegd
  // - rel.relevant=true + check.verdict='conflict'     → oranje: conflict
  // - rel.relevant=true + check missing/no_slots       → rood: nog te checken
  // - rel.relevant=false                                → grijs: niet nodig
  // - rel=null + check=null                             → niet uitgevoerd / mail van vóór v10
  let state, icon, label, detail
  if (!rel && !check) {
    state = { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
    icon = '⊘'
    label = 'Agenda niet beoordeeld'
    detail = 'Mail is verwerkt vóór de agenda-gate live ging, of is nog niet door auto-draft v10 gegaan.'
  } else if (rel && rel.relevant === false) {
    state = { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
    icon = '🟡'
    label = 'Agenda niet relevant'
    detail = rel.reason || 'AI bepaalde dat een agenda-check niet nodig is voor deze mail.'
  } else if (rel && rel.relevant === true && check && check.verdict === 'ok') {
    state = { bg: '#dcfce7', fg: '#166534', border: '#86efac' }
    icon = '✓'
    label = 'Agenda geraadpleegd · ruimte gevonden'
    const slots = check.available_slots || check.slots_in_draft || []
    detail = slots.length > 0
      ? `${slots.length} slot${slots.length === 1 ? '' : 's'} beschikbaar in de gevraagde range.`
      : 'Geen conflicten gedetecteerd.'
  } else if (rel && rel.relevant === true && check && check.verdict === 'conflict') {
    state = { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' }
    icon = '⚠'
    label = 'Agenda geraadpleegd · conflict'
    detail = (check.conflicts && check.conflicts[0]?.detail) || 'Een of meer datums in de draft botsen met bestaande agenda.'
  } else if (rel && rel.relevant === true && (!check || check.verdict === 'no_slots')) {
    state = { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' }
    icon = '🔴'
    label = 'Agenda raadplegen vereist · nog niet gelukt'
    detail = check?.reason
      ? `Reden: ${check.reason}.`
      : 'AI markeerde deze mail als agenda-relevant, maar de check is nog niet uitgevoerd of leverde geen slots.'
  } else if (check && check.verdict === 'not_checked') {
    state = { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
    icon = '⊘'
    label = 'Geen datum-hints in draft'
    detail = check.reason === 'no_date_hints'
      ? 'De draft noemt geen concrete datums, dus geen agenda-check uitgevoerd.'
      : 'Geen datum-slots boven 0.7 confidence gedetecteerd.'
  } else {
    state = { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
    icon = '⊘'
    label = 'Agenda-status onbekend'
    detail = 'Geen standaard verdict — zie de jsonb hieronder.'
  }

  const slots = (check?.available_slots || check?.slots_in_draft || [])
  const conflicts = check?.conflicts || []

  return (
    <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, border: `1px solid ${state.border}`, background: state.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <strong style={{ fontSize: 13, color: state.fg }}>{label}</strong>
      </div>
      <div style={{ fontSize: 12, color: state.fg, opacity: 0.9 }}>{detail}</div>

      {rel && rel.relevant === true && rel.confidence != null && (
        <div style={{ marginTop: 6, fontSize: 11, color: state.fg, opacity: 0.8 }}>
          Confidence relevantie: {Number(rel.confidence).toFixed(2)}
          {rel.request_type && rel.request_type !== 'none' && <> · type: {rel.request_type}</>}
        </div>
      )}

      {slots.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, color: state.fg, fontWeight: 600 }}>
            Bekijk {slots.length} slot{slots.length === 1 ? '' : 's'}
          </summary>
          <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 11, color: state.fg }}>
            {slots.slice(0, 5).map((s, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {s.label || s.verbatim || `${fmtDate(s.start)} — ${fmtDate(s.end)}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      {conflicts.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, color: state.fg, fontWeight: 600 }}>
            Conflicten ({conflicts.length})
          </summary>
          <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 11, color: state.fg }}>
            {conflicts.map((c, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{c.reason}: {c.detail}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </h4>
      {children}
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label} {sub && <span style={{ opacity: 0.7 }}>{sub}</span>}
      </div>
    </div>
  )
}

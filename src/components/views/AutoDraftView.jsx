import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const AGENT = 'auto-draft'

// AutoDraftView v3.0 — configuratie-pagina ipv monitoring-dashboard.
//
// Wat Jelle hier doet: draft-templates beheren (tone-guide + body-skeleton
// per type), algemene agent-instructies schrijven, feedback geven op recente
// drafts zodat de skill leert. Monitoring (runs-tabel, Composio-health) is
// samengevouwen tot compacte strip + debug-collapse onderaan.
//
// v3.0 principe: de pagina moet Jelle HELPEN de agent beter te maken, niet
// hem in een meter-box laten kijken.
export default function AutoDraftView({ data }) {
  const latestRun = data.latestRuns?.[AGENT]
  const allRuns   = useMemo(() => (data.recentRuns || [])
    .filter(r => r.agent_name === AGENT)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at)),
    [data.recentRuns])

  const events   = data.draftEvents || []
  const feedback = data.draftFeedback || []
  const templates= (data.draftTemplates || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100))

  // Instructies voor auto-draft — herbruik van agent_config.custom_instructions
  const instructionsRow = (data.agentInstructions || []).find(r => r.agent_name === AGENT)
  const currentInstructions = instructionsRow?.config_value?.text || ''

  // Week-stats (summary strip)
  const weekStart = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const weekEvents = events.filter(e => new Date(e.created_at) >= weekStart)
  const weekDrafts = weekEvents.filter(e => e.action === 'drafted' || e.action === 'draft_created').length
  const weekSkips  = weekEvents.filter(e => e.action === 'skipped' || e.action === 'skip').length
  const weekFeedback = feedback.filter(f => new Date(f.created_at) >= weekStart)
  const weekGood   = weekFeedback.filter(f => f.rating === 'good').length
  const weekBad    = weekFeedback.filter(f => f.rating === 'bad').length

  // Composio/connectie-gezondheid — alleen tonen als er issues zijn.
  const recentConnectionIssue = allRuns.slice(0, 10).find(r => {
    const err = (r.stats?.error || '').toString().toLowerCase()
    return err.includes('composio_auth') || err.includes('composio_connection')
  })

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {/* Compacte status-strip — vervangt de oude AgentCard + Consistency-KPI's */}
      <StatusStrip
        latestRun={latestRun}
        weekDrafts={weekDrafts}
        weekSkips={weekSkips}
        weekGood={weekGood}
        weekBad={weekBad}
      />

      {recentConnectionIssue && (
        <div className="card" style={{
          padding: '14px 16px', borderLeft: '3px solid var(--error)',
          fontSize: 13, display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 18 }}>⛔</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Composio-connectie heeft een probleem</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Laatste gesignaleerd: {new Date(recentConnectionIssue.started_at).toLocaleString('nl-NL')} —{' '}
              <code>{recentConnectionIssue.stats?.error || 'onbekende fout'}</code>.
              Reconnect via <a href="https://app.composio.dev" target="_blank" rel="noreferrer">app.composio.dev</a>
              {' '}voor account <code>legal-mind</code>.
            </div>
          </div>
        </div>
      )}

      {/* Systeem-instructies voor auto-draft */}
      <InstructionsSection
        row={instructionsRow}
        currentInstructions={currentInstructions}
      />

      {/* Draft-templates editor */}
      <TemplatesSection templates={templates} />

      {/* Recente drafts met feedback-knoppen — Jelle rating */}
      <RecentDraftsSection
        events={events}
        feedback={feedback}
        templates={templates}
      />

      {/* Skip-reasons — wat gaat vaak mis, actionable */}
      <SkipReasonsSection events={weekEvents} />

      {/* Debug-collapse: de oude monitoring-details voor als het écht nodig is */}
      <DebugSection runs={allRuns} />
    </div>
  )
}

// ================== Status strip ==================

function StatusStrip({ latestRun, weekDrafts, weekSkips, weekGood, weekBad }) {
  const lastRunAgo = latestRun?.started_at
    ? humanAgo(new Date(latestRun.started_at))
    : '—'
  const lastStatus = latestRun?.status || 'onbekend'

  return (
    <section>
      <div className="grid grid--kpi">
        <MiniCell
          value={lastStatus}
          label={`Laatste run · ${lastRunAgo}`}
          tone={lastStatus === 'error' ? 'error' : lastStatus === 'warning' ? 'warning' : null}
        />
        <MiniCell value={weekDrafts} label="Drafts · deze week" accent />
        <MiniCell value={weekSkips}  label="Overgeslagen · deze week" muted />
        <MiniCell
          value={weekGood + weekBad === 0 ? '—' : `${weekGood} / ${weekBad}`}
          label="Feedback 👍 / 👎 · week"
          tone={weekBad > weekGood ? 'warning' : null}
        />
      </div>
    </section>
  )
}

function MiniCell({ value, label, accent, tone, muted }) {
  const color = accent ? 'var(--accent)'
              : tone === 'error' ? 'var(--error)'
              : tone === 'warning' ? 'var(--warning)'
              : muted ? 'var(--text-muted)'
              : 'var(--text)'
  return (
    <div className="kpi">
      <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums', color, fontSize: 20 }}>{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  )
}

// ================== Systeem-instructies ==================

function InstructionsSection({ row, currentInstructions }) {
  const [text, setText] = useState(currentInstructions)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
  }, [row?.updated_at])

  const dirty = text !== (row?.config_value?.text || '')

  async function onSave() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data, error } = await supabase.rpc('upsert_agent_instructions', {
        p_agent_name: AGENT,
        p_instructions: text,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else setSaved(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const updatedAt = row?.updated_at ? new Date(row.updated_at) : null

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Systeem-instructies</h2>
        <span className="section__hint">
          vrije tekst die de auto-draft agent bovenop z'n SKILL.md leest bij elke run
        </span>
      </div>
      <div className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Typ regels zoals <em>"Bij Nederlandse mails altijd tutoyeren"</em>,{' '}
          <em>"Drafts max 5 zinnen tenzij input-mail lang"</em>,{' '}
          <em>"Bij sales-mails: altijd verwijs naar meest recente meeting in Fireflies"</em>.
          {updatedAt && <span> · Laatst bewerkt {updatedAt.toLocaleString('nl-NL')}</span>}
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={busy}
          rows={8}
          placeholder={'Bijvoorbeeld:\n- Nederlandse mails altijd tutoyeren.\n- Max 5 zinnen tenzij input-mail lang.\n- Bij trial-eindemails: concreet nieuwe datum voorstellen.\n- Draft 1 altijd formeel, Draft 2 losser.'}
          style={{
            width: '100%', padding: 12, borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn--accent" onClick={onSave} disabled={busy || !dirty}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
          {saved && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ Opgeslagen</span>}
          {err   && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
        </div>
      </div>
    </section>
  )
}

// ================== Draft templates ==================

function TemplatesSection({ templates }) {
  const [collapsed, setCollapsed] = useState(true)
  const [activeKey, setActiveKey] = useState(null)

  useEffect(() => {
    if (!activeKey && templates.length > 0) setActiveKey(templates[0].template_key)
  }, [templates, activeKey])

  const active = templates.find(t => t.template_key === activeKey) || null
  const activeCount = templates.filter(t => t.active !== false).length

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Draft-templates <span className="section__count">{activeCount} / {templates.length}</span>
        </h2>
        <button
          type="button"
          className="btn btn--ghost"
          style={{ fontSize: 12, padding: '4px 10px' }}
          onClick={() => setCollapsed(v => !v)}
        >
          {collapsed ? '▸ toon editor' : '▾ verberg editor'}
        </button>
      </div>
      <div className="section__hint" style={{ marginBottom: 10 }}>
        Per type draft: naam, beschrijving, tone-guide, body-skeleton en wanneer toepassen.
        De skill kiest op basis van onderwerp/categorie een template en volgt de tone-guide.
      </div>

      {collapsed ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {templates.map(t => (
            <button
              key={t.template_key}
              type="button"
              className="card"
              style={{ textAlign: 'left', cursor: 'pointer',
                       opacity: t.active === false ? 0.55 : 1 }}
              onClick={() => { setActiveKey(t.template_key); setCollapsed(false) }}
            >
              <div className="kpi__label" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                {t.label}
                {t.active === false && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· uit</span>}
              </div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.4, minHeight: 34 }}>
                {(t.description || '').slice(0, 110)}{(t.description || '').length > 110 ? '…' : ''}
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 8 }}>
                key: <span className="mono">{t.template_key}</span>
              </div>
            </button>
          ))}
          {templates.length === 0 && (
            <div className="empty empty--compact">
              Geen templates geladen — check of de migration <span className="mono">add_draft_templates_and_feedback</span> is toegepast.
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: 'flex', gap: 2, padding: '8px 8px 0',
                        overflowX: 'auto', borderBottom: '1px solid var(--border)' }}>
            {templates.map(t => {
              const isActive = t.template_key === activeKey
              return (
                <button
                  key={t.template_key}
                  type="button"
                  onClick={() => setActiveKey(t.template_key)}
                  className="btn btn--ghost"
                  style={{
                    fontSize: 12, padding: '6px 12px',
                    borderRadius: '6px 6px 0 0', border: 'none',
                    background: isActive ? 'var(--bg-2)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: isActive ? 600 : 400,
                    whiteSpace: 'nowrap',
                    opacity: t.active === false ? 0.6 : 1,
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          {active && <TemplateEditor template={active} />}
        </div>
      )}
    </section>
  )
}

function TemplateEditor({ template }) {
  const [label, setLabel] = useState(template.label || '')
  const [description, setDescription] = useState(template.description || '')
  const [toneGuide, setToneGuide] = useState(template.tone_guide || '')
  const [bodyTemplate, setBodyTemplate] = useState(template.body_template || '')
  const [active, setActive] = useState(template.active !== false)
  const [subjectContains, setSubjectContains] = useState(
    (template.triggers?.subject_contains || []).join(', ')
  )
  const [senderDomains, setSenderDomains] = useState(
    (template.triggers?.sender_domains || []).join(', ')
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setLabel(template.label || '')
    setDescription(template.description || '')
    setToneGuide(template.tone_guide || '')
    setBodyTemplate(template.body_template || '')
    setActive(template.active !== false)
    setSubjectContains((template.triggers?.subject_contains || []).join(', '))
    setSenderDomains((template.triggers?.sender_domains || []).join(', '))
    setErr(null); setSaved(false)
  }, [template.template_key])

  const dirty =
    label !== (template.label || '') ||
    description !== (template.description || '') ||
    toneGuide !== (template.tone_guide || '') ||
    bodyTemplate !== (template.body_template || '') ||
    active !== (template.active !== false) ||
    subjectContains !== (template.triggers?.subject_contains || []).join(', ') ||
    senderDomains !== (template.triggers?.sender_domains || []).join(', ')

  async function onSave() {
    setBusy(true); setErr(null); setSaved(false)
    const triggers = {
      subject_contains: subjectContains.split(',').map(s => s.trim()).filter(Boolean),
      sender_domains:   senderDomains.split(',').map(s => s.trim()).filter(Boolean),
    }
    try {
      const { data, error } = await supabase.rpc('upsert_draft_template', {
        p_template_key: template.template_key,
        p_label: label.trim(),
        p_description: description,
        p_tone_guide: toneGuide,
        p_body_template: bodyTemplate,
        p_triggers: triggers,
        p_active: active,
        p_sort_order: template.sort_order ?? 100,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else setSaved(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  function onReset() {
    setLabel(template.label || '')
    setDescription(template.description || '')
    setToneGuide(template.tone_guide || '')
    setBodyTemplate(template.body_template || '')
    setActive(template.active !== false)
    setSubjectContains((template.triggers?.subject_contains || []).join(', '))
    setSenderDomains((template.triggers?.sender_domains || []).join(', '))
    setErr(null); setSaved(false)
  }

  const updatedAt = template.updated_at ? new Date(template.updated_at) : null

  return (
    <div style={{ padding: 16, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="mono muted" style={{ fontSize: 11 }}>key: {template.template_key}</span>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={active}
            onChange={e => setActive(e.target.checked)}
            disabled={busy}
          />
          Actief (de skill mag deze template gebruiken)
        </label>
        {updatedAt && (
          <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
            Laatst bewerkt {updatedAt.toLocaleString('nl-NL')}
          </span>
        )}
      </div>

      <Field label="Weergavenaam" hint="Zoals in de template-lijst getoond.">
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} disabled={busy} style={inputStyle} />
      </Field>

      <Field label="Korte omschrijving" hint="Wanneer is deze template van toepassing?">
        <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy}
                  rows={2} style={textareaStyle} />
      </Field>

      <Field label="Tone-guide" hint="Hoe klinkt de draft? Dit is het belangrijkste stuur voor de schrijfstijl.">
        <textarea value={toneGuide} onChange={e => setToneGuide(e.target.value)} disabled={busy}
                  rows={3} style={textareaStyle} />
      </Field>

      <Field label="Body-skeleton" hint="Structuur van de mail. Gebruik bullets / secties die de agent moet invullen. Geen copy-paste.">
        <textarea value={bodyTemplate} onChange={e => setBodyTemplate(e.target.value)} disabled={busy}
                  rows={8} style={textareaStyle} />
      </Field>

      <div className="section__hint" style={{ marginTop: 6, marginBottom: -4 }}>
        <strong>Wanneer toepassen</strong> — gescheiden door komma's. Leeg = alleen via naam/beschrijving gematcht.
      </div>
      <Field label="Subject bevat (keywords)" hint='bijv. "offerte, datavoorstel"'>
        <input type="text" value={subjectContains} onChange={e => setSubjectContains(e.target.value)} disabled={busy} style={inputStyle} />
      </Field>
      <Field label="Afzender-domeinen" hint='bijv. "legal-mind.nl, partner.com"'>
        <input type="text" value={senderDomains} onChange={e => setSenderDomains(e.target.value)} disabled={busy} style={inputStyle} />
      </Field>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button className="btn btn--accent" onClick={onSave} disabled={busy || !dirty}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="btn btn--ghost" onClick={onReset} disabled={busy || !dirty}>
          Ongedaan maken
        </button>
        {saved && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ Opgeslagen</span>}
        {err   && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="kpi__label">{label}</span>
      {hint && <span className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{hint}</span>}
      {children}
    </label>
  )
}

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
  fontFamily: 'inherit', fontSize: 13,
}
const textareaStyle = { ...inputStyle, lineHeight: 1.5, resize: 'vertical' }

// ================== Recent drafts + feedback ==================

function RecentDraftsSection({ events, feedback, templates }) {
  // Alleen drafts waar de skill daadwerkelijk een concept heeft geplaatst
  const drafts = events
    .filter(e => e.action === 'drafted' || e.action === 'draft_created')
    .slice(0, 20)

  const feedbackByEvent = useMemo(() => {
    const m = new Map()
    for (const f of feedback || []) {
      if (f.draft_event_id && !m.has(f.draft_event_id)) m.set(f.draft_event_id, f)
    }
    return m
  }, [feedback])

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Recente drafts {drafts.length > 0 && <span className="section__count">{drafts.length}</span>}
        </h2>
        <span className="section__hint">
          geef feedback zodat de skill bij de volgende run z'n toon bijstelt
        </span>
      </div>
      {drafts.length === 0 ? (
        <div className="empty">
          Nog geen drafts geplaatst, of <code>draft_events</code> schrijft nog niet.
          Skill versie ≥ 2.0 logt elke draft automatisch.
        </div>
      ) : (
        <div className="stack stack--sm">
          {drafts.map(e => (
            <DraftRow key={e.id || e.created_at}
              event={e}
              existingFeedback={feedbackByEvent.get(e.id)}
              templates={templates}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function DraftRow({ event, existingFeedback, templates }) {
  const [rating, setRating] = useState(existingFeedback?.rating || null)
  const [reason, setReason] = useState(existingFeedback?.reason || '')
  const [templateKey, setTemplateKey] = useState(existingFeedback?.template_key || '')
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState(!!existingFeedback)

  async function submit(newRating) {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('submit_draft_feedback', {
        p_draft_event_id: event.id || null,
        p_mail_id: event.mail_id || null,
        p_rating: newRating,
        p_reason: reason || null,
        p_template_key: templateKey || null,
        p_created_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else { setRating(newRating); setSent(true) }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="card" style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="mono muted" style={{ fontSize: 11, minWidth: 90 }}>
          {new Date(event.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
        <span style={{ flex: 1, fontWeight: 500, fontSize: 13, overflow: 'hidden',
                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.subject || '(geen onderwerp)'}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {event.sender_domain || (event.sender ? event.sender.split('@')[1] : '—')}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <RateBtn active={rating === 'good'}     disabled={busy} onClick={() => submit('good')}     title="Goede draft">👍</RateBtn>
          <RateBtn active={rating === 'mediocre'} disabled={busy} onClick={() => submit('mediocre')} title="Matig">🤔</RateBtn>
          <RateBtn active={rating === 'bad'}      disabled={busy} onClick={() => submit('bad')}      title="Slecht">👎</RateBtn>
          <button
            type="button"
            className="btn btn--ghost"
            style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        </div>
      </div>
      {sent && !expanded && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          ✓ Feedback opgeslagen — {rating}{existingFeedback ? ' (bij volgende run meegenomen)' : ''}
        </div>
      )}
      {expanded && (
        <div style={{ display: 'grid', gap: 8, marginTop: 10, paddingTop: 10,
                      borderTop: '1px dashed var(--border)' }}>
          <div className="muted" style={{ fontSize: 11 }}>
            Waarom deze rating? (optioneel) + welke template was beter geweest?
          </div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="bijv. Toon was te formeel, past niet bij deze klant"
            rows={2}
            style={textareaStyle}
          />
          <select value={templateKey} onChange={e => setTemplateKey(e.target.value)} style={inputStyle}>
            <option value="">— template die beter gepast had (optioneel) —</option>
            {templates.map(t => (
              <option key={t.template_key} value={t.template_key}>{t.label}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn--accent" disabled={busy || !rating}
              onClick={() => submit(rating)}>Feedback bijwerken</button>
            {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function RateBtn({ active, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '4px 10px', fontSize: 15, borderRadius: 18,
        border: '1px solid var(--border)',
        background: active ? 'var(--accent-soft)' : 'var(--surface-1)',
        color: active ? 'var(--accent)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  )
}

// ================== Skip reasons ==================

function SkipReasonsSection({ events }) {
  const reasons = new Map()
  for (const e of events || []) {
    if (!e.skip_reason) continue
    reasons.set(e.skip_reason, (reasons.get(e.skip_reason) || 0) + 1)
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (top.length === 0) return null
  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Wat wordt overgeslagen</h2>
        <span className="section__hint">top skip-redenen deze week · gebruik als input voor regels in systeem-instructies</span>
      </div>
      <div className="stack stack--sm">
        {top.map(([reason, count]) => (
          <div key={reason} className="card" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px',
          }}>
            <span style={{ color: 'var(--text)', fontSize: 13 }}>{reason}</span>
            <span className="agent-card__metric">
              {count}<span className="agent-card__metric-label">×</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ================== Debug (collapsed) ==================

function DebugSection({ runs }) {
  const [open, setOpen] = useState(false)
  const recent = runs.slice(0, 10)
  return (
    <section>
      <div className="section__head">
        <button
          type="button"
          className="btn btn--ghost"
          style={{ padding: 0, background: 'transparent', textAlign: 'left' }}
          onClick={() => setOpen(v => !v)}
        >
          <h2 className="section__title" style={{ display: 'inline' }}>
            {open ? '▾' : '▸'} Debug · laatste runs
          </h2>
        </button>
        <span className="section__hint">voor als je wil zien waar iets faalt (normaal niet nodig)</span>
      </div>
      {open && recent.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Start</th>
                <th>Status</th>
                <th className="num">Gescand</th>
                <th className="num">Drafts</th>
                <th>Opmerking</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(r => {
                const s = r.stats || {}
                const note = s.error || s.blocker || s.skip_reason || s.action || s.note || ''
                return (
                  <tr key={r.id || r.started_at}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {new Date(r.started_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td><span className={`pill s-${r.status}`}>{r.status}</span></td>
                    <td className="num">{s.mails_scanned || ''}</td>
                    <td className="num">{s.drafts_created || ''}</td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 360 }}>
                      {typeof note === 'string' ? note.slice(0, 80) : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && recent.length === 0 && <div className="empty">Geen runs beschikbaar.</div>}
    </section>
  )
}

// ================== Utils ==================

function humanAgo(date) {
  if (!date) return '—'
  const diff = Date.now() - date.getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'net'
  if (min < 60) return `${min}m geleden`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}u geleden`
  const d = Math.round(h / 24)
  return `${d}d geleden`
}

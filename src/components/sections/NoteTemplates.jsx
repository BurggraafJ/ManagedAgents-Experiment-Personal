import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// Notitie-templates per context. Agents (hubspot-daily-sync, sales-on-road,
// etc.) lezen hier hoe ze een notitie per context horen op te bouwen.
// Dashboard geeft een mini-editor zodat Jelle templates live kan aanpassen
// zonder code-push.
export default function NoteTemplates({ templates }) {
  const list = useMemo(
    () => (templates || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [templates],
  )

  const [collapsed, setCollapsed] = useState(true)
  const [activeContext, setActiveContext] = useState(null)

  useEffect(() => {
    if (!activeContext && list.length > 0) setActiveContext(list[0].context)
  }, [list, activeContext])

  const active = list.find(t => t.context === activeContext) || null

  return (
    <section id="note-templates">
      <div className="section__head">
        <h2 className="section__title">
          Notitie-templates <span className="section__count">{list.length}</span>
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
        Per context een eigen schrijfstijl. Agents lezen deze bij elke run — pas je de template aan, dan gebruikt de volgende run de nieuwe versie. Geen code-push nodig.
      </div>

      {collapsed ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {list.map(t => (
            <button
              key={t.context}
              type="button"
              className="card"
              style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => { setActiveContext(t.context); setCollapsed(false) }}
            >
              <div className="kpi__label" style={{ marginBottom: 6 }}>{t.label}</div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                {(t.description || '').slice(0, 110)}{(t.description || '').length > 110 ? '…' : ''}
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 8 }}>
                context: <span className="mono">{t.context}</span>
              </div>
            </button>
          ))}
          {list.length === 0 && (
            <div className="empty empty--compact">
              Geen templates geladen. Check of de migratie <span className="mono">create_note_templates</span> is toegepast.
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: 'flex', gap: 2, padding: '8px 8px 0 8px', overflowX: 'auto', borderBottom: '1px solid var(--border)' }}>
            {list.map(t => {
              const isActive = t.context === activeContext
              return (
                <button
                  key={t.context}
                  type="button"
                  onClick={() => setActiveContext(t.context)}
                  className="btn btn--ghost"
                  style={{
                    fontSize: 12,
                    padding: '6px 12px',
                    borderRadius: '6px 6px 0 0',
                    border: 'none',
                    background: isActive ? 'var(--bg-2)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: isActive ? 600 : 400,
                    whiteSpace: 'nowrap',
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
  const [bodyTemplate, setBodyTemplate] = useState(template.body_template || '')
  const [toneGuide, setToneGuide] = useState(template.tone_guide || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  // Reset velden als Jelle naar een andere context klikt.
  useEffect(() => {
    setLabel(template.label || '')
    setDescription(template.description || '')
    setBodyTemplate(template.body_template || '')
    setToneGuide(template.tone_guide || '')
    setErr(null)
    setSaved(false)
  }, [template.context])

  const dirty =
    label !== (template.label || '') ||
    description !== (template.description || '') ||
    bodyTemplate !== (template.body_template || '') ||
    toneGuide !== (template.tone_guide || '')

  async function onSave() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data, error } = await supabase.rpc('upsert_note_template', {
        p_context: template.context,
        p_label: label.trim(),
        p_description: description,
        p_body_template: bodyTemplate,
        p_tone_guide: toneGuide,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else setSaved(true)
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  function onReset() {
    setLabel(template.label || '')
    setDescription(template.description || '')
    setBodyTemplate(template.body_template || '')
    setToneGuide(template.tone_guide || '')
    setErr(null); setSaved(false)
  }

  const updatedAt = template.updated_at ? new Date(template.updated_at) : null

  return (
    <div style={{ padding: 16, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="mono muted" style={{ fontSize: 11 }}>context: {template.context}</span>
        {updatedAt && (
          <span className="muted" style={{ fontSize: 11 }}>
            · laatst bewerkt {updatedAt.toLocaleString('nl-NL')}{template.updated_by ? ` door ${template.updated_by}` : ''}
          </span>
        )}
      </div>

      <LabeledField label="Weergavenaam" hint="Zoals in deze editor getoond — niet gebruikt door agents.">
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          disabled={busy}
          style={inputStyle}
        />
      </LabeledField>

      <LabeledField label="Korte omschrijving" hint="Waar is deze template voor? Verschijnt ook op de cards hierboven.">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          disabled={busy}
          rows={2}
          style={textareaStyle}
        />
      </LabeledField>

      <LabeledField label="Tone-guide" hint="Hoe moet de agent klinken? Dit is het belangrijkste stuur voor de schrijfstijl.">
        <textarea
          value={toneGuide}
          onChange={e => setToneGuide(e.target.value)}
          disabled={busy}
          rows={3}
          style={textareaStyle}
        />
      </LabeledField>

      <LabeledField label="Body-template" hint="Structuur / skelet van de notitie. Gebruik bullet-punten of secties die de agent invult.">
        <textarea
          value={bodyTemplate}
          onChange={e => setBodyTemplate(e.target.value)}
          disabled={busy}
          rows={8}
          style={{ ...textareaStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
        />
      </LabeledField>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn--accent" onClick={onSave} disabled={busy || !dirty || !label.trim()}>
          {busy ? 'Opslaan…' : '💾 Opslaan'}
        </button>
        <button className="btn btn--ghost" onClick={onReset} disabled={busy || !dirty}>
          Reset
        </button>
        {saved && <span style={{ color: 'var(--success, #4ade80)', fontSize: 12 }}>✓ opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}

function LabeledField({ label, hint, children }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="kpi__label">{label}</span>
      {hint && <span className="muted" style={{ fontSize: 11, marginTop: -2 }}>{hint}</span>}
      {children}
    </label>
  )
}

const inputStyle = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
}

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  lineHeight: 1.5,
}

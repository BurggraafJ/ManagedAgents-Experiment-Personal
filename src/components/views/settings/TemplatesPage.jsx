import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { SettingsPage } from './SettingsLayout'

// TemplatesPage — gerendeerd als "Administratie Instructies" (notitie-templates
// per context). Tabs bovenaan, daaronder grote tekstvakken om in te schrijven.
// Tab-labels strippen we van eventuele "(toelichting)"-parentheses zodat het
// menu rustig blijft.

function stripParenthesis(label) {
  // Verwijder "(...)" achteraan en eventuele dubbele spaties die overblijven.
  return (label || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

export default function TemplatesPage({ templates }) {
  const list = useMemo(
    () => (templates || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [templates],
  )

  const [activeContext, setActiveContext] = useState(null)

  useEffect(() => {
    if (!activeContext && list.length > 0) setActiveContext(list[0].context)
  }, [list, activeContext])

  const active = list.find(t => t.context === activeContext) || null

  return (
    <SettingsPage title="Administratie">
      {list.length === 0 ? (
        <div className="empty empty--compact">
          Geen templates geladen. Check of de migratie <span className="mono">create_note_templates</span> is toegepast.
        </div>
      ) : (
        <div className="instructies">
          <div className="instructies__tabs" role="tablist">
            {list.map(t => {
              const active = t.context === activeContext
              return (
                <button
                  key={t.context}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`instructies__tab ${active ? 'is-active' : ''}`}
                  onClick={() => setActiveContext(t.context)}
                >
                  <span className="instructies__tab-label">{stripParenthesis(t.label)}</span>
                </button>
              )
            })}
          </div>

          {active && (
            <TemplateEditor key={active.context} template={active} />
          )}
        </div>
      )}
    </SettingsPage>
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

  useEffect(() => {
    setLabel(template.label || '')
    setDescription(template.description || '')
    setBodyTemplate(template.body_template || '')
    setToneGuide(template.tone_guide || '')
    setErr(null); setSaved(false)
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
    <div className="instructies__editor">
      <div className="instructies__meta">
        <span className="mono muted" style={{ fontSize: 11 }}>context: {template.context}</span>
        {updatedAt && (
          <span className="muted" style={{ fontSize: 11 }}>
            · laatst bewerkt {updatedAt.toLocaleString('nl-NL')}
            {template.updated_by ? ` door ${template.updated_by}` : ''}
          </span>
        )}
      </div>

      <FieldGroup label="Naam">
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          disabled={busy}
          className="settings-input"
          style={{ maxWidth: 480 }}
        />
      </FieldGroup>

      <FieldGroup label="Korte omschrijving">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          disabled={busy}
          rows={3}
          className="settings-textarea settings-textarea--big"
        />
      </FieldGroup>

      <FieldGroup label="Tone-guide">
        <textarea
          value={toneGuide}
          onChange={e => setToneGuide(e.target.value)}
          disabled={busy}
          rows={8}
          className="settings-textarea settings-textarea--big"
        />
      </FieldGroup>

      <FieldGroup label="Body-template">
        <textarea
          value={bodyTemplate}
          onChange={e => setBodyTemplate(e.target.value)}
          disabled={busy}
          rows={20}
          className="settings-textarea settings-textarea--big settings-textarea--mono"
        />
      </FieldGroup>

      <div className="instructies__actions">
        <button className="btn btn--accent" onClick={onSave} disabled={busy || !dirty || !label.trim()}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="btn btn--ghost" onClick={onReset} disabled={busy || !dirty}>
          Ongedaan maken
        </button>
        {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 13 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}

function FieldGroup({ label, children }) {
  return (
    <label className="field-group">
      <span className="field-group__label">{label}</span>
      {children}
    </label>
  )
}

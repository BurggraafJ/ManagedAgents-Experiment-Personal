import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useSupabaseQuery } from '../../../../hooks/useSupabaseQuery'
import MarkdownEditField from '../../../MarkdownEditField'
import { SettingsPage } from '../SettingsLayout'

function stripParenthesis(label) {
  return (label || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * TemplatesPage (v2) — note-templates per context met tabs + grote editor.
 * Daily-admin kiest per mail/event de juiste context en gebruikt body-template
 * + tone-guide om consistente notes te schrijven.
 */
export default function TemplatesPage() {
  const { data: templates } = useSupabaseQuery('note_templates', {
    orderBy: ['sort_order', { ascending: true }],
    realtime: true,
  })

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
    <SettingsPage
      title="Administratie"
      intro="Notitie-templates per context. Daily-admin kiest per mail/event de juiste context en gebruikt body-template + tone-guide om consistente notes te schrijven."
    >
      {list.length === 0 ? (
        <div className="sv2-stub">
          <div className="sv2-stub__title">Geen templates geladen</div>
          <div className="sv2-stub__hint">Check of de migratie <code>create_note_templates</code> is toegepast.</div>
        </div>
      ) : (
        <>
          <div className="sv2-tabs" role="tablist">
            {list.map(t => {
              const isActive = t.context === activeContext
              return (
                <button
                  key={t.context}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`sv2-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveContext(t.context)}
                >
                  <span>{stripParenthesis(t.label)}</span>
                </button>
              )
            })}
          </div>
          {active && <TemplateEditor key={active.context} template={active} />}
        </>
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
    } catch (e) { setErr(e.message || 'netwerkfout') }
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
    <>
      <div className="sv2-meta-row">
        <span>context: {template.context}</span>
        {updatedAt && (
          <>
            <span className="sv2-meta-row__sep">·</span>
            <span>
              bewerkt {updatedAt.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {template.updated_by ? ` door ${template.updated_by}` : ''}
            </span>
          </>
        )}
      </div>

      <div className="sv2-field" style={{ maxWidth: 520 }}>
        <label className="sv2-field__label">Naam</label>
        <input
          className="sv2-input"
          value={label}
          onChange={e => setLabel(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="sv2-field">
        <label className="sv2-field__label">Korte omschrijving</label>
        <textarea
          className="sv2-textarea"
          rows={3}
          value={description}
          onChange={e => setDescription(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="sv2-field">
        <label className="sv2-field__label">Tone-guide</label>
        <div className="sv2-editor sv2-editor--padded">
          <MarkdownEditField
            label="Tone-guide"
            value={toneGuide}
            onChange={setToneGuide}
            minHeight={220}
            placeholder="Beschrijf hoe de skill notes voor deze context moet schrijven — toon, persoon, do's & don'ts."
            disabled={busy}
            resetKey={template.context}
          />
        </div>
      </div>

      <div className="sv2-field">
        <label className="sv2-field__label">Body-template</label>
        <div className="sv2-editor sv2-editor--padded">
          <MarkdownEditField
            label="Body-template"
            value={bodyTemplate}
            onChange={setBodyTemplate}
            minHeight={520}
            placeholder="Skelet voor de note-body. **vet** voor headers, lijsten met -, plaatshouders zoals {deelnemers}."
            disabled={busy}
            resetKey={template.context}
          />
        </div>
      </div>

      <div className="sv2-actions">
        <button className="sv2-btn sv2-btn--primary" onClick={onSave} disabled={busy || !dirty || !label.trim()}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="sv2-btn sv2-btn--ghost" onClick={onReset} disabled={busy || !dirty}>
          Ongedaan maken
        </button>
        {!dirty && !saved && !err && <span className="sv2-actions__hint">geen wijzigingen</span>}
        {saved && <span className="sv2-actions__hint sv2-actions__hint--success">✓ Opgeslagen</span>}
        {err && <span className="sv2-actions__hint sv2-actions__hint--error">⚠ {err}</span>}
      </div>
    </>
  )
}

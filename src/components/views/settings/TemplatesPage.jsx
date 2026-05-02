import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { SettingsPage, SettingsRow } from './SettingsLayout'

// TemplatesPage — notitie-templates per context. Zelfde stijl als
// InstructiesPage: tab-rij met contexten, daaronder ÉÉN duidelijke editor.
// Gebruikt geen rich-text editor want de body is een skelet/structuur — daar
// wil je juist plain text zien (anders raakt de structuur visueel verloren).

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
    <SettingsPage
      title="Templates"
      intro="Per context een eigen schrijfstijl en structuur. Agents lezen deze bij elke run — pas je de template aan, dan gebruikt de volgende run de nieuwe versie. Geen code-push nodig."
    >
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
                  <span className="instructies__tab-label">{t.label}</span>
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

      <SettingsRow
        label="Weergavenaam"
        hint="Zoals in deze editor getoond — niet gebruikt door agents."
      >
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          disabled={busy}
          className="settings-input"
        />
      </SettingsRow>

      <SettingsRow
        label="Korte omschrijving"
        hint="Waar is deze template voor?"
        wide
      >
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          disabled={busy}
          rows={2}
          className="settings-textarea"
        />
      </SettingsRow>

      <SettingsRow
        label="Tone-guide"
        hint="Hoe moet de agent klinken? Dit is het belangrijkste stuur voor de schrijfstijl."
        wide
      >
        <textarea
          value={toneGuide}
          onChange={e => setToneGuide(e.target.value)}
          disabled={busy}
          rows={4}
          className="settings-textarea"
        />
      </SettingsRow>

      <SettingsRow
        label="Body-template"
        hint="Structuur / skelet van de notitie. Gebruik bullet-punten of secties die de agent invult."
        wide
      >
        <textarea
          value={bodyTemplate}
          onChange={e => setBodyTemplate(e.target.value)}
          disabled={busy}
          rows={12}
          className="settings-textarea settings-textarea--mono"
        />
      </SettingsRow>

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

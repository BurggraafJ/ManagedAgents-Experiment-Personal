import { useState, useMemo, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { SettingsPage } from './SettingsLayout'
import RichTextEditor from './RichTextEditor'
import { showToast } from '../../Toast'

// InstructiesPage — system-messages per agent. Vervangt de oude AgentInstructions
// section die in een grid van kleine kaartjes met collapse-toggle stond. Hier:
// agent-picker als horizontale tab-rij bovenaan, daaronder ÉÉN groot editor-vlak.
// Bedoeld om uitnodigend te zijn — instructies aanpassen is een van de meest
// terugkerende beheer-acties, dus geen muis-circus en niet "verstopt".

const PLACEHOLDERS = {
  'daily-admin':
    'Bijv.:\n- Maak alleen tasks voor deals in de Sales Pipeline (niet Customer Base).\n- Bij Customer Base: schrijf een note, geen task — tenzij er een expliciete actie in de mail staat.\n- Recruitment-kaarten altijd met assignee = huidige eigenaar in de kanban.\n- Bij partner-items: Jira-ticket op board Partnerships.',
  'auto-draft':
    'Bijv.:\n- Geen drafts voor nieuwsbrieven of noreply-afzenders.\n- Bij Nederlandse mails altijd tutoyeren.\n- Drafts max 5 zinnen tenzij de input-mail lang is.',
  'sales-on-road':
    'Bijv.:\n- Altijd een follow-up-mail klaarzetten in map "SalesAgent".\n- Deal-stage "Kennismaking" alleen als de match voldoende helder is — anders needs_info.',
  'sales-todos':
    'Bijv.:\n- Offerte-reminders: 3 dagen na verzenden, daarna elke 5 dagen.\n- Trial eindigt binnen 7 dagen → altijd een draft-mail voorbereiden.',
}

function friendlyName(s) {
  return s.display_name || s.agent_name
}

export default function InstructiesPage({ schedules, agentInstructions, autodraftCategories }) {
  const agents = useMemo(() => {
    return (schedules || [])
      .filter(s => !['orchestrator', 'agent-manager', 'dashboard-refresh'].includes(s.agent_name))
      .slice()
      .sort((a, b) => {
        if (a.agent_name === 'daily-admin') return -1
        if (b.agent_name === 'daily-admin') return 1
        return friendlyName(a).localeCompare(friendlyName(b))
      })
  }, [schedules])

  const lookup = useMemo(() => {
    const m = {}
    for (const row of agentInstructions || []) m[row.agent_name] = row
    return m
  }, [agentInstructions])

  const [activeAgent, setActiveAgent] = useState(null)
  const [view, setView] = useState('agents')  // 'agents' | 'preferences'

  useEffect(() => {
    if (!activeAgent && agents.length > 0) setActiveAgent(agents[0].agent_name)
  }, [agents, activeAgent])

  const activeSchedule = agents.find(a => a.agent_name === activeAgent) || null
  const activeRow = activeAgent ? lookup[activeAgent] : null

  return (
    <SettingsPage
      title="Agents"
      intro="Vrije-tekst richtlijnen per agent. De agent leest deze bij elke run als aanvulling op de SKILL.md. Plak gerust uit ChatGPT — bold en regel­einden blijven behouden."
    >
      {/* View-switch — algemene agent-instructies óf voorkeuren per categorie/tone/globaal */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { id: 'agents',      label: 'Per agent' },
          { id: 'preferences', label: 'Voorkeuren per categorie / tone' },
        ].map(opt => {
          const on = view === opt.id
          return (
            <button key={opt.id} type="button" onClick={() => setView(opt.id)}
              style={{
                padding: '6px 14px', borderRadius: 999,
                border: '1px solid var(--border)',
                background: on ? 'var(--accent-soft)' : 'var(--bg)',
                color: on ? 'var(--accent)' : 'var(--text)',
                fontFamily: 'inherit', fontSize: 12.5, fontWeight: on ? 600 : 400,
                cursor: 'pointer',
              }}>{opt.label}</button>
          )
        })}
      </div>

      {view === 'preferences' ? (
        <CategoryPreferencesPanel categories={autodraftCategories || []} />
      ) : agents.length === 0 ? (
        <div className="empty empty--compact">
          Geen agents geladen — check of <span className="mono">agent_schedules</span> rijen heeft.
        </div>
      ) : (
        <div className="instructies">
          <div className="instructies__tabs" role="tablist">
            {agents.map(s => {
              const active = s.agent_name === activeAgent
              const text = (lookup[s.agent_name]?.config_value?.text || '').trim()
              const has = text.length > 0
              return (
                <button
                  key={s.agent_name}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`instructies__tab ${active ? 'is-active' : ''}`}
                  onClick={() => setActiveAgent(s.agent_name)}
                >
                  <span className="instructies__tab-label">{friendlyName(s)}</span>
                  <span
                    className={`instructies__tab-dot ${has ? 'is-set' : 'is-empty'}`}
                    title={has ? 'Instructies ingesteld' : 'Geen instructies — gebruikt alleen SKILL.md'}
                  />
                </button>
              )
            })}
          </div>

          {activeSchedule && (
            <InstructionsEditor
              key={activeSchedule.agent_name}
              schedule={activeSchedule}
              row={activeRow}
            />
          )}
        </div>
      )}
    </SettingsPage>
  )
}

// Voorkeuren per scope — mail-categorie / draft-tone / globaal. Quick-vanuit
// het Postvak ingevoerde voorkeuren landen hier en kunnen worden bewerkt of
// verwijderd. De auto-draft skill leest deze bij elke scan-run en injecteert
// ze in de prompt voor de bijbehorende scope.
function CategoryPreferencesPanel({ categories }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    const { data, error } = await supabase
      .from('category_preferences')
      .select('*')
      .eq('active', true)
      .order('scope_type')
      .order('scope_value')
      .order('created_at', { ascending: false })
    if (error) setErr(error.message)
    setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime — meteen verschijnen na quick-add vanuit het Postvak
  useEffect(() => {
    const ch = supabase
      .channel('category-preferences-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'category_preferences' },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const grouped = useMemo(() => {
    const out = { mail_category: new Map(), draft_tone: new Map(), global: [] }
    for (const r of rows) {
      if (r.scope_type === 'global') { out.global.push(r); continue }
      const key = r.scope_value || '?'
      const map = out[r.scope_type]
      if (!map) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    return out
  }, [rows])

  const catLabel = useCallback((key) => {
    return categories.find(c => c.category_key === key)?.label || key
  }, [categories])

  if (loading) return <div className="empty empty--compact">Voorkeuren laden…</div>
  if (err) return <div className="empty empty--compact" style={{ color: 'var(--error, #b91c1c)' }}>⚠ {err}</div>

  const totalCount = rows.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{
        padding: '10px 14px', borderRadius: 8,
        background: 'var(--surface-1, #f8fafc)', border: '1px solid var(--border)',
        fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55,
      }}>
        {totalCount === 0
          ? <>Nog geen voorkeuren. Voeg ze toe vanuit het Postvak via <strong>⚡ Snel → 💡 Voorkeur toevoegen</strong>, of klik <em>Nieuw</em> hieronder.</>
          : <>{totalCount} actieve voorkeuren. Auto-draft leest ze bij de eerstvolgende scan-run en past ze toe op mails binnen de scope.</>}
      </div>

      <PreferenceGroup
        title="Per mail-categorie"
        emptyHint="Nog geen voorkeuren per mail-categorie."
        groups={Array.from(grouped.mail_category.entries()).map(([k, list]) => ({
          key: k, label: catLabel(k), rows: list,
        }))}
        scopeType="mail_category"
        scopeOptions={categories.map(c => ({ value: c.category_key, label: c.label }))}
      />

      <PreferenceGroup
        title="Per draft-tone"
        emptyHint="Nog geen voorkeuren per draft-tone."
        groups={Array.from(grouped.draft_tone.entries()).map(([k, list]) => ({
          key: k, label: k, rows: list,
        }))}
        scopeType="draft_tone"
        scopeOptions={[
          { value: 'concise', label: 'Kort & direct' },
          { value: 'warm',    label: 'Warm & uitgebreid' },
          { value: 'done',    label: 'Afgerond' },
          { value: 'formal',  label: 'Formeel' },
          { value: 'casual',  label: 'Informeel' },
        ]}
      />

      <PreferenceGroup
        title="Globaal (alle mails)"
        emptyHint="Nog geen globale voorkeuren."
        groups={grouped.global.length > 0 ? [{ key: '_global', label: 'Globaal', rows: grouped.global }] : []}
        scopeType="global"
        scopeOptions={[]}
      />
    </div>
  )
}

function PreferenceGroup({ title, emptyHint, groups, scopeType, scopeOptions }) {
  const [adding, setAdding] = useState(false)
  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg)' }}>
      <header style={{
        padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'var(--surface-1, #f8fafc)', borderBottom: '1px solid var(--border)',
      }}>
        <strong style={{ fontSize: 13.5 }}>{title}</strong>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}
            style={{
              padding: '4px 10px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
            }}>+ Nieuw</button>
        )}
      </header>

      <div style={{ padding: 12 }}>
        {adding && (
          <NewPreferenceForm
            scopeType={scopeType}
            scopeOptions={scopeOptions}
            onCancel={() => setAdding(false)}
            onSaved={() => setAdding(false)}
          />
        )}
        {groups.length === 0 && !adding ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '4px 2px' }}>{emptyHint}</div>
        ) : (
          groups.map(g => (
            <div key={g.key} style={{ marginBottom: 10 }}>
              {scopeType !== 'global' && (
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                  {g.label}
                </div>
              )}
              {g.rows.map(r => <PreferenceRow key={r.id} row={r} />)}
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function PreferenceRow({ row }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(row.preference_text)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const { data, error } = await supabase.rpc('update_category_preference', {
      p_id: row.id, p_preference_text: text,
    })
    setBusy(false)
    if (error) { showToast({ kind: 'error', message: 'Opslaan mislukt', detail: error.message }); return }
    if (data && data.ok === false) { showToast({ kind: 'error', message: 'Opslaan geweigerd', detail: data.reason }); return }
    setEditing(false)
    showToast({ message: 'Voorkeur bijgewerkt' })
  }

  async function remove() {
    if (!confirm('Voorkeur verwijderen?')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('deactivate_category_preference', { p_id: row.id })
    setBusy(false)
    if (error || (data && data.ok === false)) {
      showToast({ kind: 'error', message: 'Verwijderen mislukt', detail: error?.message || data?.reason })
      return
    }
    showToast({ message: 'Voorkeur verwijderd' })
  }

  if (editing) {
    return (
      <div style={{ background: 'var(--surface-1, #f8fafc)', padding: 8, borderRadius: 6, marginBottom: 6 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
          style={{
            width: '100%', padding: '8px 10px', border: '1px solid var(--border)',
            borderRadius: 6, background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
          }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button type="button" onClick={save} disabled={busy || !text.trim()}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
          <button type="button" onClick={() => { setText(row.preference_text); setEditing(false) }} disabled={busy}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
            Annuleer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      padding: '6px 8px', borderRadius: 6,
      background: 'transparent', border: '1px solid transparent',
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', flex: 1, whiteSpace: 'pre-wrap' }}>
        {row.preference_text}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
        {row.source === 'manual_quick' ? 'quick' : row.source}
      </span>
      <button type="button" onClick={() => setEditing(true)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 2 }}
        title="Bewerk">✎</button>
      <button type="button" onClick={remove} disabled={busy}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 2 }}
        title="Verwijder">×</button>
    </div>
  )
}

function NewPreferenceForm({ scopeType, scopeOptions, onCancel, onSaved }) {
  const [scopeValue, setScopeValue] = useState(scopeOptions[0]?.value || '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!text.trim()) return
    if (scopeType !== 'global' && !scopeValue) return
    setBusy(true)
    const { data, error } = await supabase.rpc('add_category_preference', {
      p_scope_type: scopeType,
      p_scope_value: scopeType === 'global' ? null : scopeValue,
      p_preference_text: text.trim(),
      p_source: 'manual_settings',
      p_origin_mail_id: null,
    })
    setBusy(false)
    if (error || (data && data.ok === false)) {
      showToast({ kind: 'error', message: 'Toevoegen mislukt', detail: error?.message || data?.reason })
      return
    }
    showToast({ message: 'Voorkeur toegevoegd' })
    onSaved()
  }

  return (
    <div style={{ background: 'var(--surface-1, #f8fafc)', padding: 10, borderRadius: 6, marginBottom: 12 }}>
      {scopeType !== 'global' && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            Scope
          </label>
          <select value={scopeValue} onChange={e => setScopeValue(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, minWidth: 220 }}>
            {scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus
        placeholder='bv. "Voor in te plannen afspraken altijd 3 concrete slots aanbieden, geen vage windows."'
        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, resize: 'vertical', lineHeight: 1.5 }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button type="button" onClick={save} disabled={busy || !text.trim() || (scopeType !== 'global' && !scopeValue)}
          style={{ padding: '6px 14px', fontSize: 12.5, borderRadius: 6, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
          {busy ? 'Toevoegen…' : 'Toevoegen'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          style={{ padding: '6px 14px', fontSize: 12.5, borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Annuleer
        </button>
      </div>
    </div>
  )
}

function InstructionsEditor({ schedule, row }) {
  const initialMd = row?.config_value?.text || ''
  const [text, setText] = useState(initialMd)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
  // resetKey triggert re-render van editor's innerHTML alleen bij agent-wissel
  // of wanneer server een nieuwe versie pusht — niet bij elke toetsaanslag.
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
    setResetKey(k => k + 1)
  }, [schedule.agent_name, row?.updated_at])

  const dirty = text !== (row?.config_value?.text || '')

  async function onSave() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data, error } = await supabase.rpc('upsert_agent_instructions', {
        p_agent_name: schedule.agent_name,
        p_instructions: text,
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
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
    setResetKey(k => k + 1)
  }

  const updatedAt = row?.updated_at ? new Date(row.updated_at) : null
  const updatedBy = row?.config_value?.updated_by

  return (
    <div className="instructies__editor">
      <div className="instructies__meta">
        <span className="mono muted" style={{ fontSize: 11 }}>
          agent: {schedule.agent_name}
        </span>
        {updatedAt ? (
          <span className="muted" style={{ fontSize: 11 }}>
            · laatst bewerkt {updatedAt.toLocaleString('nl-NL')}
            {updatedBy ? ` door ${updatedBy}` : ''}
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>
            · nog geen instructies opgeslagen
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }}>
          <kbd className="kbd">Ctrl/Cmd</kbd> + <kbd className="kbd">B</kbd> voor vet
        </span>
      </div>

      <div className="pcv7__note-rte" style={{ border: '1px solid var(--border, rgba(0,0,0,0.10))', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
        <RichTextEditor
          valueMd={text}
          onChangeMd={setText}
          resetKey={resetKey}
          disabled={busy}
          placeholder={PLACEHOLDERS[schedule.agent_name] || 'Bijv.: wanneer wel/niet een actie maken; welke pipelines/stages; naamconventies voor notes.'}
          minHeight={420}
        />
      </div>

      <div className="instructies__actions">
        <button
          className="btn btn--accent"
          onClick={onSave}
          disabled={busy || !dirty}
        >
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          className="btn btn--ghost"
          onClick={onReset}
          disabled={busy || !dirty}
        >
          Ongedaan maken
        </button>
        {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 13 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}

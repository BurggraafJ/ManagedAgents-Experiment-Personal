import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import styles from './AgendaView.module.css'

// AgendaRulesView v1 — Eigen pagina voor agenda spelregels (F.3 ronde 3)
// Bereikbaar via ⚙-knop in AgendaView. Geen sidebar-item (gear-pattern).

const RULE_TYPES = [
  { key: 'no_meetings_window', label: 'Geen meetings-window',
    desc: 'Blokkeer een tijdvak waarin geen afspraken mogen staan (bijv. vóór 10:00 of na 19:00).',
    paramHints: 'block_start, block_end (HH:MM)' },
  { key: 'traffic_window',     label: 'Verkeers-window',
    desc: 'Tijdvak om verkeer te vermijden (Jelle is niet op kantoor → niet inplannen).',
    paramHints: 'block_start, block_end (HH:MM), days [0-4]' },
  { key: 'travel_buffer',      label: 'Reistijd-buffer',
    desc: 'Buffer voor en/of na een fysieke afspraak voor reistijd.',
    paramHints: 'minutes, applies_to ("physical")' },
  { key: 'post_meeting_buffer', label: 'Post-meeting speling',
    desc: 'Speling na lange meetings (bijv. 15 min na 90+ min meeting).',
    paramHints: 'min_duration_minutes, buffer_minutes' },
  { key: 'time_block',         label: 'Tijd-blok / dag-blok',
    desc: 'Hele-dag of tijdvak-blok met type-restrictie (bijv. woensdag = geen klanten).',
    paramHints: 'day, forbidden_types[]' },
  { key: 'location_rule',      label: 'Locatieregel per dag',
    desc: 'Standaard werklocatie op bepaalde dagen (bijv. ma/wo/vr Amsterdam).',
    paramHints: 'days [0-6], location' },
  { key: 'regio_cluster',      label: 'Regio-clustering',
    desc: 'Bonus voor fysieke afspraken in dezelfde regio op dezelfde dag.',
    paramHints: 'bonus_score, max_distance_km' },
  { key: 'prefer_window',      label: 'Voorkeurs-window',
    desc: 'Liever bepaalde momenten voor bepaalde meeting-types.',
    paramHints: 'prefer[], meeting_type' },
  { key: 'custom',             label: 'Aangepast',
    desc: 'Vrij type — wordt door planner-skill gelezen maar niet automatisch toegepast.',
    paramHints: 'vrije jsonb' },
]

const DEFAULT_KEY_LIST = [
  'physical_meeting_buffer_60min', 'traffic_avoid_tue_thu_morning',
  'lunch_blocked_12_13', 'no_meetings_after_18', 'no_clients_on_wednesday',
  'no_meetings_before_09', 'traffic_window_09_10_all_days', 'location_mon_wed_fri_amsterdam',
  'traffic_window_18_19', 'post_long_meeting_buffer_15min',
  'regio_cluster_same_day', 'prefer_morning_or_late_for_clients',
]

export default function AgendaRulesView({ onNavigate }) {
  const [allRules, setAllRules] = useState(null)
  const [saving, setSaving]     = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [adding, setAdding]     = useState(false)
  const [newRule, setNewRule]   = useState({
    rule_key: '', rule_type: 'no_meetings_window', description: '',
    priority: 50, params: '{}',
  })
  const [addError, setAddError] = useState('')
  const [editing, setEditing]   = useState(null)

  const loadRules = useCallback(async () => {
    const { data: rows } = await supabase
      .from('agenda_planner_rules')
      .select('*')
      .order('priority', { ascending: false })
      .order('rule_type')
    setAllRules(rows || [])
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  const toggleRule = async (rule) => {
    setSaving(rule.id)
    await supabase.from('agenda_planner_rules').update({ enabled: !rule.enabled }).eq('id', rule.id)
    await loadRules()
    setSaving(null)
  }

  const deleteRule = async (rule) => {
    if (!window.confirm(`Spelregel "${rule.rule_key}" verwijderen?`)) return
    setSaving(rule.id)
    await supabase.from('agenda_planner_rules').delete().eq('id', rule.id)
    await loadRules()
    setSaving(null)
  }

  const startEdit = (rule) => {
    setEditing({
      id: rule.id,
      description: rule.description || '',
      priority: rule.priority,
      params: JSON.stringify(rule.params || {}, null, 2),
    })
  }

  const saveEdit = async () => {
    if (!editing) return
    let parsed
    try { parsed = JSON.parse(editing.params || '{}') }
    catch { window.alert('Params is geen geldige JSON.'); return }
    setSaving(editing.id)
    await supabase
      .from('agenda_planner_rules')
      .update({
        description: editing.description.trim(),
        priority: Number(editing.priority) || 50,
        params: parsed,
      })
      .eq('id', editing.id)
    setEditing(null)
    await loadRules()
    setSaving(null)
  }

  const addRule = async () => {
    setAddError('')
    if (!newRule.rule_key.trim()) { setAddError('Sleutel is verplicht.'); return }
    let parsedParams
    try { parsedParams = JSON.parse(newRule.params || '{}') }
    catch { setAddError('Params is geen geldige JSON.'); return }
    setSaving('new')
    const { error } = await supabase.from('agenda_planner_rules').insert({
      rule_key: newRule.rule_key.trim().toLowerCase().replace(/\s+/g, '_'),
      rule_type: newRule.rule_type,
      description: newRule.description.trim(),
      priority: Number(newRule.priority) || 50,
      params: parsedParams,
      enabled: true,
    })
    if (error) { setAddError(error.message); setSaving(null); return }
    setNewRule({ rule_key: '', rule_type: 'no_meetings_window', description: '', priority: 50, params: '{}' })
    setAdding(false)
    await loadRules()
    setSaving(null)
  }

  const DEFAULT_KEYS = useMemo(() => new Set(DEFAULT_KEY_LIST), [])

  const filteredRules = useMemo(() => {
    if (!allRules) return []
    if (filterType === 'all') return allRules
    return allRules.filter(r => r.rule_type === filterType)
  }, [allRules, filterType])

  const grouped = useMemo(() => {
    const map = {}
    for (const r of filteredRules) {
      if (!map[r.rule_type]) map[r.rule_type] = []
      map[r.rule_type].push(r)
    }
    return map
  }, [filteredRules])

  const enabledCount = useMemo(
    () => (allRules || []).filter(r => r.enabled).length,
    [allRules])
  const totalCount = (allRules || []).length

  return (
    <div className="agenda-rules-page">
      <div className="agenda-rules-page__header">
        <div>
          <button type="button" className="btn btn--ghost" onClick={() => onNavigate?.('agenda')}>← Terug naar agenda</button>
          <h1>Spelregels</h1>
          <p className="agenda-rules-page__subtitle">
            {enabledCount} actief van {totalCount} regels.
            Wijzig of voeg toe — wijzigingen werken direct door op de agenda.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setAdding(v => !v)}
        >
          {adding ? '× Sluit formulier' : '+ Nieuwe spelregel'}
        </button>
      </div>

      {adding && (
        <div className="agenda-rules-page__add">
          <h2>Nieuwe spelregel</h2>
          <div className="agenda-rules-page__form-grid">
            <label>
              <span>Sleutel (rule_key)</span>
              <input
                type="text"
                value={newRule.rule_key}
                placeholder="bijv. no_meetings_friday"
                onChange={e => setNewRule(p => ({ ...p, rule_key: e.target.value }))}
              />
            </label>
            <label>
              <span>Type</span>
              <select
                value={newRule.rule_type}
                onChange={e => setNewRule(p => ({ ...p, rule_type: e.target.value }))}
              >
                {RULE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className="span-2">
              <span>Beschrijving</span>
              <input
                type="text"
                value={newRule.description}
                placeholder="bijv. Vrijdagmiddag is werk-aan-jezelf-tijd"
                onChange={e => setNewRule(p => ({ ...p, description: e.target.value }))}
              />
            </label>
            <label>
              <span>Prioriteit (0–100)</span>
              <input
                type="number"
                value={newRule.priority}
                min="0" max="100"
                onChange={e => setNewRule(p => ({ ...p, priority: e.target.value }))}
              />
            </label>
            <label className="span-2">
              <span>Params (JSON)
                <em className="agenda-rules-page__hint">
                  &nbsp;hint: {RULE_TYPES.find(t => t.key === newRule.rule_type)?.paramHints}
                </em>
              </span>
              <textarea
                rows={4}
                value={newRule.params}
                onChange={e => setNewRule(p => ({ ...p, params: e.target.value }))}
              />
            </label>
          </div>
          {addError && <p className="agenda-rules-page__error">{addError}</p>}
          <div className="agenda-rules-page__form-actions">
            <button type="button" className="btn btn--ghost" onClick={() => { setAdding(false); setAddError('') }}>Annuleren</button>
            <button type="button" className="btn btn--primary" disabled={saving === 'new'} onClick={addRule}>
              {saving === 'new' ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
        </div>
      )}

      <div className="agenda-rules-page__filter">
        <label>
          <span>Filter op type</span>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">Alle types</option>
            {RULE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div className="agenda-rules-page__types">
        <h2>Beschikbare types</h2>
        <div className="agenda-rules-page__types-grid">
          {RULE_TYPES.map(t => (
            <div key={t.key} className="agenda-rules-page__type-card">
              <span className={styles.typeDot} data-color={t.key} />
              <strong>{t.label}</strong>
              <span className="agenda-rules-page__type-key">{t.key}</span>
              <span className="agenda-rules-page__type-desc">{t.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="agenda-rules-page__list">
        {!allRules ? (
          <p>Laden…</p>
        ) : Object.keys(grouped).length === 0 ? (
          <p className="agenda-rules-page__empty">Geen regels in deze categorie.</p>
        ) : (
          Object.entries(grouped).map(([type, rulesForType]) => {
            const typeMeta = RULE_TYPES.find(t => t.key === type) || { label: type, desc: '' }
            return (
              <div key={type} className="agenda-rules-page__group">
                <div className="agenda-rules-page__group-header">
                  <span className={styles.typeDot} data-color={type} />
                  <h3>{typeMeta.label}</h3>
                  <span className="agenda-rules-page__group-count">{rulesForType.length}</span>
                </div>
                <div className="agenda-rules-page__rules">
                  {rulesForType.map(rule => {
                    const isEditing = editing?.id === rule.id
                    return (
                      <div key={rule.id} className={`agenda-rules-page__rule ${rule.enabled ? 'is-enabled' : 'is-disabled'}`}>
                        <div className="agenda-rules-page__rule-row">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            disabled={saving === rule.id}
                            onChange={() => toggleRule(rule)}
                          />
                          <div className="agenda-rules-page__rule-info">
                            <strong className="agenda-rules-page__rule-title">{rule.rule_key}</strong>
                            <span className="agenda-rules-page__rule-prio">prio {rule.priority}</span>
                            {rule.description && !isEditing && <span className="agenda-rules-page__rule-desc">{rule.description}</span>}
                          </div>
                          <div className="agenda-rules-page__rule-actions">
                            {!isEditing && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--xs"
                                onClick={() => startEdit(rule)}
                              >Bewerken</button>
                            )}
                            {!DEFAULT_KEYS.has(rule.rule_key) && !isEditing && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--xs btn--danger"
                                onClick={() => deleteRule(rule)}
                              >Verwijder</button>
                            )}
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="agenda-rules-page__edit-form">
                            <label>
                              <span>Beschrijving</span>
                              <input
                                type="text"
                                value={editing.description}
                                onChange={e => setEditing(s => ({ ...s, description: e.target.value }))}
                              />
                            </label>
                            <label>
                              <span>Prioriteit</span>
                              <input
                                type="number" min="0" max="100"
                                value={editing.priority}
                                onChange={e => setEditing(s => ({ ...s, priority: e.target.value }))}
                              />
                            </label>
                            <label>
                              <span>Params (JSON)</span>
                              <textarea
                                rows={4}
                                value={editing.params}
                                onChange={e => setEditing(s => ({ ...s, params: e.target.value }))}
                              />
                            </label>
                            <div className="agenda-rules-page__form-actions">
                              <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>Annuleer</button>
                              <button type="button" className="btn btn--primary" disabled={saving === rule.id} onClick={saveEdit}>
                                {saving === rule.id ? 'Opslaan…' : 'Opslaan'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          rule.params && Object.keys(rule.params).length > 0 && (
                            <pre className="agenda-rules-page__rule-params">{JSON.stringify(rule.params, null, 2)}</pre>
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="agenda-rules-page__legend">
        <h2>Kleurenlegenda agenda-items</h2>
        <div className="agenda-rules-page__legend-grid">
          <span className="agenda-rules-page__legend-item"><span className="agenda-event agenda-event--filled agenda-event--client agenda-rules-page__swatch" />Klant</span>
          <span className="agenda-rules-page__legend-item"><span className="agenda-event agenda-event--filled agenda-event--internal agenda-rules-page__swatch" />Intern</span>
          <span className="agenda-rules-page__legend-item"><span className="agenda-event agenda-event--filled agenda-event--external agenda-rules-page__swatch" />Extern</span>
          <span className="agenda-rules-page__legend-item"><span className="agenda-event agenda-event--filled agenda-event--demo agenda-rules-page__swatch" />Demo</span>
          <span className="agenda-rules-page__legend-item"><span className="agenda-event agenda-event--filled agenda-event--partner agenda-rules-page__swatch" />Partner</span>
          <span className="agenda-rules-page__legend-item"><span className="agenda-event agenda-event--filled agenda-event--recruit agenda-rules-page__swatch" />Recruit</span>
          <span className="agenda-rules-page__legend-item"><span className="agenda-event agenda-event--filled agenda-event--allday agenda-rules-page__swatch" />Hele dag</span>
        </div>
        <p className="agenda-rules-page__legend-hint">
          Outlook-categoriekleuren (rood/oranje/blauw etc.) overrulen de type-kleur als je een categorie aan het event hebt gehangen.
        </p>
      </div>
    </div>
  )
}

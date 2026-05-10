import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase, createRealtimeChannel } from '../../../../lib/supabase'
import PreferenceRow from './PreferenceRow'
import NewPreferenceForm from './NewPreferenceForm'

// Voorkeuren per scope — mail-categorie / draft-tone / globaal. Quick-vanuit
// het Postvak ingevoerde voorkeuren landen hier en kunnen worden bewerkt of
// verwijderd. De auto-draft skill leest deze bij elke scan-run en injecteert
// ze in de prompt voor de bijbehorende scope.
export default function CategoryPreferencesPanel({ categories }) {
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
    const ch = createRealtimeChannel('category-preferences-realtime')
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

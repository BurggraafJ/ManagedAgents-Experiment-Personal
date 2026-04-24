import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// Skill-credentials editor. Leest de metadata uit skill_secrets_registry
// (geen plaintext — dashboard leest die nooit). Schrijft via RPC
// set_skill_secret die intern Supabase Vault gebruikt.
//
// Veiligheidsmodel:
// - anon mag alleen registry-rijen lezen (naam, last-4, updated_at)
// - Writes gaan via SECURITY DEFINER RPC; input wordt direct in vault gezet,
//   response bevat nooit plaintext.
// - Skills (service_role) roepen get_skill_secret(...) aan op runtime.
// - Deze UI laat zien of een secret is ingesteld, plus de laatste 4 tekens
//   als herkenbaarheid. Bewerken vervangt de oude waarde; vorige token
//   wordt uit vault weggegooid.
export default function SkillSecrets({ secrets }) {
  const rows = useMemo(() => {
    return (secrets || []).slice().sort((a, b) => {
      const ak = (a.skill_name || 'zzz') + ':' + (a.secret_name || '')
      const bk = (b.skill_name || 'zzz') + ':' + (b.secret_name || '')
      return ak.localeCompare(bk)
    })
  }, [secrets])

  const [editing, setEditing] = useState(null) // row object | null

  const configured = rows.filter(r => r.vault_secret_id).length
  const total = rows.length

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Skill-credentials <span className="section__count">{configured} / {total}</span>
        </h2>
        <span className="section__hint">
          API-tokens die skills gebruiken — opgeslagen in Supabase Vault, nooit plaintext in dashboard
        </span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="table" style={{ marginBottom: 0 }}>
          <thead>
            <tr>
              <th>Skill</th>
              <th>Secret</th>
              <th>Status</th>
              <th>Bijgewerkt</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isSet = !!r.vault_secret_id
              const updated = r.updated_at ? new Date(r.updated_at) : null
              return (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 12 }}>{r.skill_name}</td>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{r.secret_name}</div>
                    {r.description && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td>
                    {isSet ? (
                      <span className="pill s-success" style={{ fontSize: 11 }}>
                        ● ingesteld · ****{r.last_4 || '____'}
                      </span>
                    ) : (
                      <span className="pill s-idle" style={{ fontSize: 11 }}>○ leeg</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 11 }}>
                    {updated ? updated.toLocaleString('nl-NL') : '—'}
                    {r.updated_by && <div style={{ fontSize: 10 }}>door {r.updated_by}</div>}
                  </td>
                  <td>
                    <button
                      className="btn btn--ghost"
                      style={{ fontSize: 11, padding: '4px 10px', marginRight: 6 }}
                      onClick={() => setEditing(r)}
                    >
                      {isSet ? 'Bewerken' : 'Invullen'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan="5">
                  <div className="empty empty--compact">
                    Geen secrets geregistreerd. Voeg een regel toe aan
                    <code>skill_secrets_registry</code> (zie migration
                    <code>add_skill_secrets_via_vault</code>).
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <SecretEditModal
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function SecretEditModal({ row, onClose }) {
  const [value, setValue] = useState('')
  const [description, setDescription] = useState(row.description || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const isSet = !!row.vault_secret_id

  async function onSave() {
    if (!value.trim()) { setErr('Waarde mag niet leeg zijn'); return }
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_skill_secret', {
        p_skill_name: row.skill_name,
        p_secret_name: row.secret_name,
        p_plaintext: value.trim(),
        p_description: description || null,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'opslaan mislukt')
      else onClose()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function onDelete() {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('delete_skill_secret', {
        p_skill_name: row.skill_name,
        p_secret_name: row.secret_name,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'verwijderen mislukt')
      else onClose()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface-1)', maxWidth: 520, width: '100%',
          padding: 24, borderRadius: 16,
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>{row.secret_name}</h3>
        <div className="muted mono" style={{ fontSize: 11, marginBottom: 14 }}>
          skill: {row.skill_name}
        </div>

        {isSet && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 12,
            padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
            Huidige waarde eindigt op <code>****{row.last_4 || '____'}</code>.
            Door op Opslaan te klikken overschrijf je die.
            Dashboard kan de huidige plaintext niet lezen — alleen de skill met service_role.
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div className="kpi__label" style={{ marginBottom: 4 }}>Nieuwe waarde</div>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder={isSet ? 'Plak nieuwe token hier' : 'Plak token hier'}
            style={{
              width: '100%', padding: 10, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)', fontFamily: 'monospace', fontSize: 12,
              lineHeight: 1.5, resize: 'vertical',
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <div className="kpi__label" style={{ marginBottom: 4 }}>Beschrijving (optioneel)</div>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={busy}
            placeholder="Wat gebruikt deze token?"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)', fontFamily: 'inherit', fontSize: 13,
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn--accent" onClick={onSave} disabled={busy}>
            {busy ? 'Opslaan…' : (isSet ? 'Vervang waarde' : 'Opslaan')}
          </button>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>Annuleer</button>
          {isSet && (
            <>
              <span style={{ flex: 1 }} />
              {!confirmDelete ? (
                <button
                  className="btn btn--ghost"
                  style={{ color: 'var(--error)' }}
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                >
                  Verwijderen
                </button>
              ) : (
                <>
                  <span style={{ fontSize: 12, color: 'var(--error)' }}>Zeker weten?</span>
                  <button className="btn btn--danger" onClick={onDelete} disabled={busy}>
                    Ja, verwijder
                  </button>
                  <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                    Nee
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {err && (
          <div style={{ marginTop: 12, padding: '8px 12px',
            background: 'var(--error-dim)', color: 'var(--error)',
            borderRadius: 6, fontSize: 12 }}>
            ⚠ {err}
          </div>
        )}
      </div>
    </div>
  )
}

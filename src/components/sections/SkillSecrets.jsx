import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// Skill-credentials editor — combineert skill_secrets_registry (Vault-index)
// met secrets_inventory (rich metadata: display_name, categorie, rotation_url).
//
// Veiligheidsmodel:
// - Iedere geauthenticeerde gebruiker mag registry-metadata lezen (geen plaintext)
// - Writes gaan via SECURITY DEFINER RPC `set_skill_secret` → schrijft naar Vault
//   (encrypted at rest). Plaintext gaat eenmalig de browser → DB; nooit terug.
// - Skills (service_role) lezen runtime via `get_skill_secret_service` of direct
//   `vault.decrypted_secrets`. Anon-key kan er nooit bij.

const CATEGORY_META = {
  service_api: { label: 'Externe service-API', icon: '🌐' },
  eigen_infra: { label: 'Eigen infrastructuur', icon: '⚙️' },
  identifiers: { label: 'Identifiers', icon: '🆔' },
  null:        { label: 'Overig', icon: '🔑' },
}
const CATEGORY_ORDER = ['service_api', 'eigen_infra', 'identifiers', null]

export default function SkillSecrets({ secrets, secretsInventory }) {
  // Build a lookup van storage_ref → inventory-row (zelfde Vault-naam-pad)
  const inventoryByVaultName = useMemo(() => {
    const m = new Map()
    for (const inv of (secretsInventory || [])) {
      if (inv.storage_ref?.startsWith('skill:') && inv.status !== 'deprecated') {
        m.set(inv.storage_ref, inv)
      }
    }
    return m
  }, [secretsInventory])

  // Verrijk skill_secrets_registry rows met inventory-metadata
  const enriched = useMemo(() => {
    return (secrets || []).map(r => {
      const vaultName = `skill:${r.skill_name}:${r.secret_name}`
      const inv = inventoryByVaultName.get(vaultName) || null
      return { ...r, inv, category: inv?.category ?? null }
    })
  }, [secrets, inventoryByVaultName])

  // Groeperen op categorie
  const grouped = useMemo(() => {
    const map = {}
    for (const r of enriched) {
      const k = r.category ?? 'null'
      if (!map[k]) map[k] = []
      map[k].push(r)
    }
    for (const k in map) {
      map[k].sort((a, b) => {
        const aSet = !!a.vault_secret_id, bSet = !!b.vault_secret_id
        if (aSet !== bSet) return aSet ? 1 : -1   // leeg eerst (actie nodig)
        return ((a.inv?.display_name || a.secret_name) || '').localeCompare(b.inv?.display_name || b.secret_name || '')
      })
    }
    return map
  }, [enriched])

  const [editing, setEditing] = useState(null)
  const configured = enriched.filter(r => r.vault_secret_id).length
  const total = enriched.length

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Skill-credentials <span className="section__count">{configured} / {total}</span>
        </h2>
        <span className="section__hint">
          Tokens en API-keys voor je skills. Opgeslagen in Supabase Vault (encrypted at rest);
          dashboard ziet alleen de laatste 4 tekens. Plak hier nieuwe waardes na rotatie.
        </span>
      </div>

      <div className="stack" style={{ gap: 'var(--s-4)' }}>
        {CATEGORY_ORDER.map(cat => {
          const rows = grouped[cat ?? 'null']
          if (!rows || rows.length === 0) return null
          const meta = CATEGORY_META[cat ?? 'null']
          return (
            <div key={cat ?? 'null'}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                fontSize: 12, fontWeight: 600,
                color: 'var(--text-dim)', textTransform: 'uppercase',
                letterSpacing: 0.5, marginBottom: 6,
              }}>
                <span>{meta.icon} {meta.label}</span>
                <span className="muted" style={{ fontSize: 10, fontWeight: 400, textTransform: 'none' }}>
                  {rows.length} {rows.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table className="table" style={{ marginBottom: 0, fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Naam</th>
                      <th style={{ width: 120 }}>Status</th>
                      <th>Gebruikt door</th>
                      <th style={{ width: 110 }}>Bijgewerkt</th>
                      <th style={{ width: 200, textAlign: 'right' }}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <Row key={r.id || `${r.skill_name}:${r.secret_name}`} row={r} onEdit={() => setEditing(r)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <SecretEditModal row={editing} onClose={() => setEditing(null)} />
      )}
    </section>
  )
}

function Row({ row, onEdit }) {
  const isSet = !!row.vault_secret_id
  const updated = row.updated_at ? new Date(row.updated_at) : null
  const display = row.inv?.display_name || row.secret_name
  const purpose = row.inv?.purpose && row.inv.purpose !== '— niet ingevuld —' ? row.inv.purpose : null
  const usedBy = row.inv?.used_by || []

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 500 }}>{display}</div>
        <div className="mono muted" style={{ fontSize: 10 }}>
          {row.skill_name}:{row.secret_name}
        </div>
        {purpose && (
          <div className="muted" style={{ fontSize: 10, marginTop: 2, lineHeight: 1.4, maxWidth: 380 }}>
            {purpose}
          </div>
        )}
      </td>
      <td>
        {isSet ? (
          <span className="pill s-success" style={{ fontSize: 11 }}>
            ● ingesteld · ****{row.last_4 || '____'}
          </span>
        ) : (
          <span className="pill s-warning" style={{ fontSize: 11 }}>○ leeg</span>
        )}
      </td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {usedBy.length > 0 ? usedBy.map(u => (
            <span key={u} className="pill s-idle" style={{ fontSize: 10, padding: '2px 6px' }}>{u}</span>
          )) : (
            <span className="muted" style={{ fontSize: 10 }}>—</span>
          )}
        </div>
      </td>
      <td className="muted" style={{ fontSize: 10 }}>
        {updated ? updated.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
        {row.updated_by && <div style={{ fontSize: 9 }}>door {row.updated_by}</div>}
      </td>
      <td style={{ textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            className={isSet ? 'btn btn--ghost' : 'btn btn--accent'}
            style={{ fontSize: 10, padding: '4px 10px' }}
            onClick={onEdit}
          >
            {isSet ? 'Bewerken' : 'Invullen'}
          </button>
          {row.inv?.rotation_url && (
            <a
              href={row.inv.rotation_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
              style={{ fontSize: 10, padding: '4px 10px' }}
              title="Open vendor-dashboard om nieuwe key te genereren"
            >
              Roteer ↗
            </a>
          )}
        </div>
      </td>
    </tr>
  )
}

function SecretEditModal({ row, onClose }) {
  const [value, setValue] = useState('')
  const [description, setDescription] = useState(row.description || row.inv?.purpose || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const isSet = !!row.vault_secret_id
  const display = row.inv?.display_name || row.secret_name
  const rotationUrl = row.inv?.rotation_url

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
          background: 'var(--surface-1)', maxWidth: 560, width: '100%',
          padding: 24, borderRadius: 16,
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>{display}</h3>
        <div className="muted mono" style={{ fontSize: 11, marginBottom: 14 }}>
          skill:{row.skill_name}:{row.secret_name}
        </div>

        {isSet && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 12,
            padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
            Huidige waarde eindigt op <code>****{row.last_4 || '____'}</code>.
            Door op Opslaan te klikken overschrijf je die.
            Dashboard kan de huidige plaintext niet lezen — alleen de skill met service_role.
          </div>
        )}

        <div className="muted" style={{
          fontSize: 11, marginBottom: 12, padding: '8px 12px',
          background: '#16a34a22', borderRadius: 8, lineHeight: 1.5,
        }}>
          🔒 Wordt opgeslagen in <strong>Supabase Vault</strong> (encrypted at rest).
          De waarde gaat één keer door je browser naar de DB en is daarna alleen leesbaar
          voor skills met service_role.
        </div>

        {rotationUrl && (
          <div style={{ marginBottom: 14 }}>
            <a
              href={rotationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
              style={{ fontSize: 12 }}
            >
              ↗ Open vendor-dashboard om nieuwe key te genereren
            </a>
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
            autoFocus
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

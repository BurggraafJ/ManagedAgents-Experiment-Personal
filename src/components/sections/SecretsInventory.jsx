import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// SecretsInventory — centrale registry van alle API keys/secrets met rood/groen
// rotation-status (Fase 8, sessie 2026-04-27).
//
// 🔴 Rood   = key is via chat geleverd of legacy (potentieel gecompromitteerd in
//             AI-context history). Moet geroteerd worden.
// 🟢 Groen  = key is rechtstreeks via dashboard ingesteld in vendor (Composio/
//             Vercel/etc.) en de nieuwe waarde is direct in Edge Function secret
//             of agent_config gezet — nooit door chat gegaan.
//
// Werkstroom voor Jelle:
// 1. Klik rotation_url → genereer nieuwe key in vendor-dashboard
// 2. Voor agent_config-stored keys: klik "Bewerk waarde" hier → plak nieuwe key
//    → status wordt automatisch 🟢
// 3. Voor edge_function_secret-stored keys: plak in Supabase dashboard → klik
//    "Markeer geroteerd" hier
//
// Categorieën (max 3):
//   - service_api  : externe service API keys (Composio, Atlassian, OpenAI, ...)
//   - eigen_infra  : eigen infrastructuur (Vercel, GitHub, cron_secret)
//   - identifiers  : pointers/IDs (geen secret, ondersteunend)

const STATUS_META = {
  red_chat_legacy:        { color: '#dc2626', label: '🔴 Legacy', hint: 'Ooit via chat geleverd in vorige sessies' },
  red_chat_just_received: { color: '#dc2626', label: '🔴 Net via chat', hint: 'Recent in chat geplakt — direct rotatie aanbevolen' },
  green_dashboard_only:   { color: '#16a34a', label: '🟢 Dashboard-only', hint: 'Veilig — alleen via dashboard ingesteld' },
  unset:                  { color: '#94a3b8', label: '⚪ Unset', hint: 'Nog niet geconfigureerd' },
  deprecated:             { color: '#94a3b8', label: '⊘ Deprecated', hint: 'Niet meer in gebruik' },
}

const STORAGE_LABEL = {
  vault: 'Postgres Vault',
  agent_config: 'agent_config',
  edge_function_secret: 'Edge Function secret',
  dashboard_only: 'Frontend (publishable)',
  composio_managed: 'Composio (OAuth)',
  not_stored: 'Niet opgeslagen',
  deprecated: 'Niet meer in gebruik',
}

const CATEGORY_META = {
  service_api: { label: 'Service API keys', hint: 'Tokens naar externe services (Composio, Atlassian, OpenAI, HubSpot, LinkedIn)' },
  eigen_infra: { label: 'Eigen infrastructuur', hint: 'Tokens voor onze deploy/CI/cron (Vercel, GitHub, pg_cron)' },
  identifiers: { label: 'Pointers / Identifiers', hint: 'Geen secrets — connection-IDs, emails, user-IDs' },
  null: { label: 'Overig', hint: '' },
}

const CATEGORY_ORDER = ['service_api', 'eigen_infra', 'identifiers', null]

export default function SecretsInventory({ secretsInventory }) {
  const grouped = useMemo(() => {
    const map = {}
    for (const r of (secretsInventory || [])) {
      const k = r.category ?? 'null'
      if (!map[k]) map[k] = []
      map[k].push(r)
    }
    for (const k in map) {
      map[k].sort((a, b) => {
        const order = { red_chat_just_received: 0, red_chat_legacy: 1, unset: 2, green_dashboard_only: 3, deprecated: 4 }
        const oa = order[a.status] ?? 5, ob = order[b.status] ?? 5
        if (oa !== ob) return oa - ob
        return (a.key_name || '').localeCompare(b.key_name || '')
      })
    }
    return map
  }, [secretsInventory])

  const total = (secretsInventory || []).length
  const reds = (secretsInventory || []).filter(r => r.status?.startsWith('red')).length
  const greens = (secretsInventory || []).filter(r => r.status === 'green_dashboard_only').length

  const [editing, setEditing] = useState(null)

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          API Keys
          <span className="section__count">{greens}🟢 / {reds}🔴 / {total} totaal</span>
        </h2>
        <span className="section__hint">
          Centrale registry. Roteer rode keys in vendor-dashboard → plak hier of in juiste opslag.
        </span>
      </div>

      <div className="stack" style={{ gap: 'var(--s-4)' }}>
        {CATEGORY_ORDER.map(cat => {
          const rows = grouped[cat ?? 'null']
          if (!rows || rows.length === 0) return null
          const catKey = cat ?? 'null'
          const meta = CATEGORY_META[catKey] ?? CATEGORY_META.null
          return (
            <div key={catKey}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                fontSize: 12, fontWeight: 600,
                color: 'var(--text-dim)', textTransform: 'uppercase',
                letterSpacing: 0.5, marginBottom: 6,
              }}>
                <span>{meta.label}</span>
                <span className="muted" style={{ fontSize: 10, fontWeight: 400, textTransform: 'none' }}>
                  {meta.hint}
                </span>
              </div>
              <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table className="table" style={{ marginBottom: 0, fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Status</th>
                      <th>Key</th>
                      <th>Gebruikt door</th>
                      <th style={{ width: 130 }}>Opslag · Last 4</th>
                      <th style={{ width: 200, textAlign: 'right' }}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <KeyRow key={r.key_name} row={r} onEdit={() => setEditing(r)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
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

function KeyRow({ row, onEdit }) {
  const meta = STATUS_META[row.status] || STATUS_META.unset
  const since = row.last_status_change_at ? new Date(row.last_status_change_at) : null
  const editable = row.storage_location === 'agent_config'
  const isDeprecated = row.status === 'deprecated'

  return (
    <tr>
      <td>
        <span
          style={{
            display: 'inline-block',
            padding: '3px 8px', borderRadius: 6,
            fontSize: 11, fontWeight: 500,
            background: meta.color + '22', color: meta.color,
            whiteSpace: 'nowrap',
          }}
          title={meta.hint}
        >
          {meta.label}
        </span>
      </td>
      <td>
        <div style={{ fontWeight: 500 }}>{row.display_name || row.key_name}</div>
        <div className="mono muted" style={{ fontSize: 10 }}>{row.key_name}</div>
        {row.purpose && row.purpose !== '— niet ingevuld —' && (
          <div className="muted" style={{ fontSize: 10, marginTop: 2, lineHeight: 1.4, maxWidth: 380 }}>
            {row.purpose}
          </div>
        )}
        {since && (
          <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>
            sinds {since.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}
            {row.last_status_change_by && ` door ${row.last_status_change_by}`}
          </div>
        )}
      </td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {(row.used_by || []).map(u => (
            <span key={u} className="pill s-idle" style={{ fontSize: 10, padding: '2px 6px' }}>{u}</span>
          ))}
        </div>
      </td>
      <td className="muted" style={{ fontSize: 11 }}>
        <div>{STORAGE_LABEL[row.storage_location] || row.storage_location}</div>
        <div className="mono" style={{ fontSize: 11, marginTop: 2 }}>
          {row.last_4 ? <code>****{row.last_4}</code> : <span className="muted">—</span>}
        </div>
      </td>
      <td style={{ textAlign: 'right' }}>
        {!isDeprecated && (
          <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {editable && (
              <button
                className="btn btn--accent"
                style={{ fontSize: 10, padding: '4px 10px' }}
                onClick={onEdit}
                title="Plak nieuwe waarde — status wordt automatisch 🟢"
              >
                Bewerk waarde
              </button>
            )}
            {!editable && row.status?.startsWith('red') && (
              <MarkRotatedButton row={row} />
            )}
            {row.rotation_url && (
              <a
                href={row.rotation_url}
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
        )}
        {isDeprecated && <span className="muted" style={{ fontSize: 10 }}>—</span>}
      </td>
    </tr>
  )
}

function MarkRotatedButton({ row }) {
  const [confirming, setConfirming] = useState(false)
  const [last4, setLast4] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function onMark() {
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('mark_secret_rotated', {
        p_key_name: row.key_name,
        p_new_last_4: last4 || null,
        p_notes: null,
      })
      if (error) setErr(error.message)
      else setConfirming(false)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (!confirming) {
    return (
      <button
        className="btn btn--ghost"
        style={{ fontSize: 10, padding: '4px 10px' }}
        onClick={() => setConfirming(true)}
        title="Klik NA rotatie + handmatig instellen in juiste vendor-/Supabase-dashboard"
      >
        Markeer geroteerd
      </button>
    )
  }
  return (
    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input
        type="text"
        value={last4}
        onChange={e => setLast4(e.target.value.slice(-4))}
        placeholder="last 4"
        maxLength={4}
        disabled={busy}
        style={{
          width: 56, fontSize: 10, padding: '3px 6px', borderRadius: 4,
          border: '1px solid var(--border)', background: 'var(--bg)',
          color: 'var(--text)', fontFamily: 'monospace',
        }}
      />
      <button
        className="btn btn--accent"
        style={{ fontSize: 10, padding: '4px 8px' }}
        onClick={onMark}
        disabled={busy}
      >
        {busy ? '…' : 'OK'}
      </button>
      <button
        className="btn btn--ghost"
        style={{ fontSize: 10, padding: '4px 8px' }}
        onClick={() => setConfirming(false)}
        disabled={busy}
      >
        ✕
      </button>
      {err && <span style={{ fontSize: 9, color: 'var(--error)' }}>{err}</span>}
    </div>
  )
}

function SecretEditModal({ row, onClose }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function onSave() {
    if (!value.trim()) { setErr('Waarde mag niet leeg zijn'); return }
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_secret_value', {
        p_key_name: row.key_name,
        p_plaintext: value.trim(),
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.hint || data.reason || 'opslaan mislukt')
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
        <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>{row.display_name || row.key_name}</h3>
        <div className="muted mono" style={{ fontSize: 11, marginBottom: 14 }}>
          {row.key_name} · opslag: {STORAGE_LABEL[row.storage_location]} ({row.storage_ref})
        </div>

        {row.last_4 && (
          <div className="muted" style={{
            fontSize: 12, marginBottom: 12,
            padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8,
          }}>
            Huidige waarde eindigt op <code>****{row.last_4}</code>. Nieuwe waarde overschrijft.
          </div>
        )}

        <div className="muted" style={{
          fontSize: 11, marginBottom: 12, padding: '8px 12px',
          background: '#16a34a22', borderRadius: 8, lineHeight: 1.5,
        }}>
          🟢 <strong>Veilige route:</strong> nieuwe waarde wordt opgeslagen via deze knop.
          Status wordt automatisch <strong>🟢 Dashboard-only</strong> omdat de waarde NIET door
          chat-context is gegaan. Roteer eerst in vendor-dashboard, plak hier de nieuwe waarde.
        </div>

        {row.rotation_url && (
          <div style={{ marginBottom: 14 }}>
            <a
              href={row.rotation_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
              style={{ fontSize: 12 }}
            >
              ↗ Open vendor-dashboard om nieuwe key te genereren
            </a>
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 16 }}>
          <div className="kpi__label" style={{ marginBottom: 4 }}>Nieuwe waarde</div>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Plak nieuwe key/token hier"
            style={{
              width: '100%', padding: 10, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)', fontFamily: 'monospace', fontSize: 12,
              lineHeight: 1.5, resize: 'vertical',
            }}
            autoFocus
          />
        </label>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn--accent" onClick={onSave} disabled={busy}>
            {busy ? 'Opslaan…' : 'Opslaan & markeer 🟢'}
          </button>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>Annuleer</button>
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

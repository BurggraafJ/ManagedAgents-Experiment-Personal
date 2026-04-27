import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// SecretsInventory — centrale registry van alle API keys/secrets met rood/groen
// rotation-status (Fase 8, sessie 2026-04-27 #2).
//
// 🔴 Rood   = key is via chat geleverd of legacy (potentieel gecompromitteerd in
//             AI-context history). Moet geroteerd worden.
// 🟢 Groen  = key is rechtstreeks via dashboard ingesteld in vendor (Composio/
//             Vercel/etc.) en de nieuwe waarde is direct in Edge Function secret
//             of agent_config gezet — nooit door chat gegaan.
//
// Werkstroom voor Jelle:
// 1. Ga naar `rotation_url` (vendor dashboard) en genereer nieuwe key
// 2. Plak nieuwe waarde in juiste storage (Edge Function secret / agent_config /
//    Vault) via Supabase dashboard — NIET via chat
// 3. Klik "Markeer geroteerd" hier → status wordt 🟢, last_4 update
//
// Nieuwe keys via chat geregistreerd komen automatisch als 🔴 binnen.

const STATUS_META = {
  red_chat_legacy:      { color: '#dc2626', label: '🔴 Legacy', hint: 'Ooit via chat geleverd in vorige sessies' },
  red_chat_just_received: { color: '#dc2626', label: '🔴 Net via chat', hint: 'Recent in chat geplakt — direct rotatie aanbevolen' },
  green_dashboard_only: { color: '#16a34a', label: '🟢 Dashboard-only', hint: 'Veilig — alleen via dashboard ingesteld' },
  unset:                { color: '#94a3b8', label: '⚪ Unset', hint: 'Nog niet geconfigureerd' },
  deprecated:           { color: '#94a3b8', label: '⊘ Deprecated', hint: 'Niet meer in gebruik' },
}

const STORAGE_LABEL = {
  vault: 'Postgres Vault',
  agent_config: 'agent_config (is_secret)',
  edge_function_secret: 'Edge Function secret',
  dashboard_only: 'Frontend (publishable)',
  composio_managed: 'Composio (OAuth managed)',
  not_stored: 'Niet opgeslagen',
  deprecated: 'Niet meer in gebruik',
}

export default function SecretsInventory({ secretsInventory }) {
  const rows = useMemo(() => {
    return (secretsInventory || []).slice().sort((a, b) => {
      // Rood eerst, dan groen, dan unset/deprecated
      const order = { red_chat_just_received: 0, red_chat_legacy: 1, unset: 2, green_dashboard_only: 3, deprecated: 4 }
      const oa = order[a.status] ?? 5
      const ob = order[b.status] ?? 5
      if (oa !== ob) return oa - ob
      return (a.key_name || '').localeCompare(b.key_name || '')
    })
  }, [secretsInventory])

  const reds = rows.filter(r => r.status?.startsWith('red')).length
  const greens = rows.filter(r => r.status === 'green_dashboard_only').length

  const [confirming, setConfirming] = useState(null)  // key_name being rotated
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  async function onMarkRotated(keyName, newLast4) {
    setBusy(keyName); setErr(null)
    try {
      const { error } = await supabase.rpc('mark_secret_rotated', {
        p_key_name: keyName,
        p_new_last_4: newLast4 || null,
        p_notes: null,
      })
      if (error) setErr(error.message)
      else setConfirming(null)
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          API Keys <span className="section__count">{greens}🟢 / {reds}🔴 / {rows.length} totaal</span>
        </h2>
        <span className="section__hint">
          Centrale registry van alle keys met rotation-status. Roteer de rode in vendor-dashboards en markeer ze hier groen.
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="table" style={{ marginBottom: 0, fontSize: 12 }}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Key</th>
              <th>Gebruikt door</th>
              <th>Opslag</th>
              <th>Last 4</th>
              <th>Status sinds</th>
              <th style={{ width: 180 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const meta = STATUS_META[r.status] || STATUS_META.unset
              const since = r.last_status_change_at ? new Date(r.last_status_change_at) : null
              const isRed = r.status?.startsWith('red')
              return (
                <tr key={r.key_name}>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 500,
                      background: meta.color + '22',
                      color: meta.color,
                      whiteSpace: 'nowrap',
                    }} title={meta.hint}>
                      {meta.label}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.display_name || r.key_name}</div>
                    <div className="mono muted" style={{ fontSize: 10 }}>{r.key_name}</div>
                    {r.purpose && r.purpose !== '— niet ingevuld —' && (
                      <div className="muted" style={{ fontSize: 10, marginTop: 2, lineHeight: 1.4, maxWidth: 280 }}>
                        {r.purpose}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {(r.used_by || []).map(u => (
                        <span key={u} className="pill s-idle" style={{ fontSize: 10, padding: '2px 6px' }}>{u}</span>
                      ))}
                    </div>
                  </td>
                  <td className="muted" style={{ fontSize: 11 }}>
                    {STORAGE_LABEL[r.storage_location] || r.storage_location}
                    {r.storage_ref && (
                      <div className="mono" style={{ fontSize: 9, opacity: 0.7 }}>{r.storage_ref}</div>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {r.last_4 ? <code>****{r.last_4}</code> : <span className="muted">—</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 10 }}>
                    {since ? since.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    {r.last_status_change_by && (
                      <div style={{ fontSize: 9 }}>door {r.last_status_change_by}</div>
                    )}
                  </td>
                  <td>
                    {isRed && (
                      confirming === r.key_name ? (
                        <ConfirmRotated
                          row={r}
                          busy={busy === r.key_name}
                          onConfirm={(last4) => onMarkRotated(r.key_name, last4)}
                          onCancel={() => setConfirming(null)}
                        />
                      ) : (
                        <button
                          className="btn btn--ghost"
                          style={{ fontSize: 10, padding: '4px 8px' }}
                          onClick={() => setConfirming(r.key_name)}
                          title="Markeer als veilig — alleen klikken NA rotatie in vendor-dashboard"
                        >
                          Markeer geroteerd
                        </button>
                      )
                    )}
                    {r.status === 'green_dashboard_only' && (
                      <span className="muted" style={{ fontSize: 10 }}>—</span>
                    )}
                    {r.rotation_url && (
                      <a
                        href={r.rotation_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'block', fontSize: 10, marginTop: 4 }}
                      >
                        Rotation URL ↗
                      </a>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan="7">
                  <div className="empty empty--compact">
                    Geen keys in inventory. Voeg toe via SQL <code>register_secret_via_chat()</code> RPC of
                    direct INSERT in <code>secrets_inventory</code>.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {err && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--error-dim)', color: 'var(--error)', borderRadius: 6, fontSize: 12 }}>
          ⚠ {err}
        </div>
      )}

      <div className="card" style={{
        padding: 'var(--s-3)', marginTop: 'var(--s-3)', fontSize: 11,
        color: 'var(--text-muted)', borderStyle: 'dashed',
      }}>
        <strong style={{ color: 'var(--text-dim)' }}>Hoe groen worden:</strong>{' '}
        klik <em>Rotation URL</em> → genereer nieuwe key in vendor-dashboard → plak in juiste opslag
        (Edge Function secret via Supabase dashboard, of agent_config via SkillSecrets-sectie hieronder).
        <br />
        Klik daarna "Markeer geroteerd" en geef de last-4 chars op zodat het visueel matcht.
      </div>
    </section>
  )
}

function ConfirmRotated({ row, busy, onConfirm, onCancel }) {
  const [last4, setLast4] = useState('')
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="text"
        value={last4}
        onChange={e => setLast4(e.target.value.slice(-4))}
        placeholder="last 4"
        maxLength={4}
        disabled={busy}
        style={{
          width: 60, fontSize: 10, padding: '4px 6px', borderRadius: 4,
          border: '1px solid var(--border)', background: 'var(--bg)',
          color: 'var(--text)', fontFamily: 'monospace',
        }}
      />
      <button
        className="btn btn--accent"
        style={{ fontSize: 10, padding: '4px 8px' }}
        onClick={() => onConfirm(last4)}
        disabled={busy}
      >
        {busy ? '…' : 'OK'}
      </button>
      <button
        className="btn btn--ghost"
        style={{ fontSize: 10, padding: '4px 8px' }}
        onClick={onCancel}
        disabled={busy}
      >
        ✕
      </button>
    </div>
  )
}

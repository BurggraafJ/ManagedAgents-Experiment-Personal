import { useState, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { SettingsPage } from './SettingsLayout'

// ApiKeysPage — gemerge'de view die voorheen API Keys (SecretsInventory)
// + Skill Credentials (SkillSecrets) waren. Eén tabel, drie acties per
// rij: Roteer (link naar vendor + locatie eronder), Bewerk waarde, Toelichting
// (expand met purpose / used_by / storage_ref).
//
// Bewerk-waarde routing op storage_location:
//   - agent_config           → set_secret_value RPC
//   - vault (skill:NAME:KEY) → set_skill_secret RPC
//   - edge_function_secret   → handmatig in Supabase + mark_secret_rotated
//   - dashboard_only         → frontend env (geen edit-flow vanuit dashboard)
//   - composio_managed       → OAuth (ga naar Composio)

const STATUS_META = {
  red_chat_legacy:        { color: '#dc2626', label: '🔴 Legacy', hint: 'Ooit via chat geleverd in vorige sessies' },
  red_chat_just_received: { color: '#dc2626', label: '🔴 Net via chat', hint: 'Recent in chat geplakt — direct rotatie aanbevolen' },
  green_dashboard_only:   { color: '#16a34a', label: '🟢 Veilig', hint: 'Alleen via dashboard ingesteld' },
  unset:                  { color: '#94a3b8', label: '⚪ Unset', hint: 'Nog niet geconfigureerd' },
  deprecated:             { color: '#94a3b8', label: '⊘ Deprecated', hint: 'Niet meer in gebruik' },
}

const STORAGE_LABEL = {
  vault:                'Postgres Vault',
  agent_config:         'agent_config',
  edge_function_secret: 'Edge Function secret',
  dashboard_only:       'Frontend env',
  composio_managed:     'Composio (OAuth)',
  not_stored:           'Niet opgeslagen',
  deprecated:           'Niet meer in gebruik',
}

const CATEGORY_META = {
  service_api: { label: 'Service API keys' },
  eigen_infra: { label: 'Eigen infrastructuur' },
  identifiers: { label: 'Identifiers' },
  null:        { label: 'Overig' },
}
const CATEGORY_ORDER = ['service_api', 'eigen_infra', 'identifiers', null]

// Map vendor-host → vriendelijke locatie-naam onder de Roteer-knop
function rotationLocation(url) {
  if (!url) return null
  try {
    const host = new URL(url).host.replace(/^www\./, '')
    const map = {
      'app.composio.dev':            'Composio dashboard',
      'platform.openai.com':         'OpenAI platform',
      'app.hubspot.com':             'HubSpot dashboard',
      'id.atlassian.com':            'Atlassian id',
      'github.com':                  'GitHub settings',
      'vercel.com':                  'Vercel dashboard',
      'supabase.com':                'Supabase dashboard',
      'app.fireflies.ai':            'Fireflies dashboard',
      'console.anthropic.com':       'Anthropic console',
      'app.linkedin.com':            'LinkedIn',
      'business.linkedin.com':       'LinkedIn',
      'console.cloud.google.com':    'Google Cloud',
    }
    return map[host] || host
  } catch {
    return null
  }
}

// Merge: skillSecrets-rows die NIET als inventory-row aanwezig zijn,
// projecteren we als pseudo-inventory-rij zodat ze ook in dezelfde tabel
// verschijnen. In praktijk is de overlap groot — secretsInventory bevat
// al `skill:*`-rows — maar deze fallback voorkomt dat een nieuw geregistreerd
// skill-secret onzichtbaar blijft.
function mergeRows(secretsInventory, skillSecrets) {
  const inv = (secretsInventory || []).slice()
  const knownVaultRefs = new Set(
    inv.filter(r => r.storage_ref?.startsWith('skill:')).map(r => r.storage_ref),
  )
  for (const sk of (skillSecrets || [])) {
    const ref = `skill:${sk.skill_name}:${sk.secret_name}`
    if (!knownVaultRefs.has(ref)) {
      inv.push({
        key_name: ref,
        display_name: `${sk.skill_name} · ${sk.secret_name}`,
        category: 'service_api',
        status: sk.vault_secret_id ? 'green_dashboard_only' : 'unset',
        storage_location: 'vault',
        storage_ref: ref,
        last_4: sk.last_4,
        used_by: [sk.skill_name],
        purpose: sk.description || null,
        rotation_url: null,
        last_status_change_at: sk.updated_at,
        last_status_change_by: sk.updated_by,
      })
    }
  }
  return inv
}

export default function ApiKeysPage({ secretsInventory, skillSecrets }) {
  const allRows = useMemo(
    () => mergeRows(secretsInventory, skillSecrets),
    [secretsInventory, skillSecrets],
  )

  const grouped = useMemo(() => {
    const map = {}
    for (const r of allRows) {
      const k = r.category ?? 'null'
      if (!map[k]) map[k] = []
      map[k].push(r)
    }
    for (const k in map) {
      map[k].sort((a, b) => {
        const order = { red_chat_just_received: 0, red_chat_legacy: 1, unset: 2, green_dashboard_only: 3, deprecated: 4 }
        const oa = order[a.status] ?? 5, ob = order[b.status] ?? 5
        if (oa !== ob) return oa - ob
        return (a.display_name || a.key_name || '').localeCompare(b.display_name || b.key_name || '')
      })
    }
    return map
  }, [allRows])

  const total  = allRows.length
  const reds   = allRows.filter(r => r.status?.startsWith('red')).length
  const greens = allRows.filter(r => r.status === 'green_dashboard_only').length

  const [editing, setEditing] = useState(null)
  const [expanded, setExpanded] = useState(null)

  return (
    <SettingsPage title="API Keys">
      <div className="api-keys__summary">
        <span className="api-keys__summary-pill" style={{ color: '#16a34a' }}>{greens}🟢 veilig</span>
        <span className="api-keys__summary-pill" style={{ color: '#dc2626' }}>{reds}🔴 roteren</span>
        <span className="api-keys__summary-pill muted">{total} totaal</span>
      </div>

      <div className="stack" style={{ gap: 'var(--s-5)' }}>
        {CATEGORY_ORDER.map(cat => {
          const rows = grouped[cat ?? 'null']
          if (!rows || rows.length === 0) return null
          const meta = CATEGORY_META[cat ?? 'null']
          return (
            <div key={cat ?? 'null'}>
              <div className="api-keys__cat-label">{meta.label}</div>
              <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table className="api-keys__table">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Status</th>
                      <th>Naam</th>
                      <th style={{ width: 130 }}>Last 4</th>
                      <th style={{ width: 320, textAlign: 'right' }}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <Row
                        key={r.key_name}
                        row={r}
                        expanded={expanded === r.key_name}
                        onToggle={() => setExpanded(expanded === r.key_name ? null : r.key_name)}
                        onEdit={() => setEditing(r)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <EditModal row={editing} onClose={() => setEditing(null)} />
      )}
    </SettingsPage>
  )
}

function Row({ row, expanded, onToggle, onEdit }) {
  const meta = STATUS_META[row.status] || STATUS_META.unset
  const isDeprecated = row.status === 'deprecated'
  const rotLocation = rotationLocation(row.rotation_url)
  const usedBy = row.used_by || []

  return (
    <>
      <tr className={expanded ? 'api-keys__row is-expanded' : 'api-keys__row'}>
        <td>
          <span
            className="api-keys__status-pill"
            style={{ background: meta.color + '22', color: meta.color }}
            title={meta.hint}
          >
            {meta.label}
          </span>
        </td>
        <td>
          <div className="api-keys__name">{row.display_name || row.key_name}</div>
          <div className="api-keys__name-mono">{row.key_name}</div>
          {usedBy.length > 0 && (
            <div className="api-keys__usedby">
              {usedBy.map(u => (
                <span key={u} className="api-keys__usedby-pill">{u}</span>
              ))}
            </div>
          )}
        </td>
        <td className="api-keys__last4">
          {row.last_4 ? <code>****{row.last_4}</code> : <span className="muted">—</span>}
        </td>
        <td className="api-keys__actions">
          {!isDeprecated && (
            <div className="api-keys__action-cell">
              <div className="api-keys__action-row">
                {row.rotation_url ? (
                  <a
                    href={row.rotation_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--ghost api-keys__btn"
                    title={rotLocation ? `Open ${rotLocation}` : 'Open vendor-dashboard om nieuwe key te genereren'}
                  >
                    Roteer ↗
                  </a>
                ) : (
                  <span
                    className="btn btn--ghost api-keys__btn api-keys__btn--disabled"
                    title="Geen rotation-URL bekend voor deze key"
                    aria-disabled="true"
                  >
                    Roteer
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn--accent api-keys__btn"
                  onClick={onEdit}
                >
                  Bewerk
                </button>
                <button
                  type="button"
                  className="btn btn--ghost api-keys__btn"
                  onClick={onToggle}
                  aria-expanded={expanded}
                >
                  {expanded ? 'Info ▾' : 'Info ▸'}
                </button>
              </div>
              {rotLocation && (
                <div className="api-keys__action-caption">via {rotLocation}</div>
              )}
            </div>
          )}
        </td>
      </tr>
      {expanded && !isDeprecated && (
        <tr className="api-keys__detail-row">
          <td colSpan={4}>
            <DetailPanel row={row} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetailPanel({ row }) {
  const since = row.last_status_change_at ? new Date(row.last_status_change_at) : null
  return (
    <div className="api-keys__detail">
      {row.purpose && row.purpose !== '— niet ingevuld —' && (
        <div className="api-keys__detail-block">
          <div className="api-keys__detail-label">Waarvoor</div>
          <div className="api-keys__detail-text">{row.purpose}</div>
        </div>
      )}
      <div className="api-keys__detail-grid">
        <div>
          <div className="api-keys__detail-label">Opslaglocatie</div>
          <div className="api-keys__detail-text">
            {STORAGE_LABEL[row.storage_location] || row.storage_location}
            {row.storage_ref && (
              <span className="mono muted" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                {row.storage_ref}
              </span>
            )}
          </div>
        </div>
        {since && (
          <div>
            <div className="api-keys__detail-label">Laatst gewijzigd</div>
            <div className="api-keys__detail-text">
              {since.toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}
              {row.last_status_change_by && ` door ${row.last_status_change_by}`}
            </div>
          </div>
        )}
        {row.status?.startsWith('red') && row.storage_location !== 'agent_config' && row.storage_location !== 'vault' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <MarkRotatedInline row={row} />
          </div>
        )}
      </div>
    </div>
  )
}

function MarkRotatedInline({ row }) {
  const [last4, setLast4] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  async function onMark() {
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('mark_secret_rotated', {
        p_key_name: row.key_name,
        p_new_last_4: last4 || null,
        p_notes: null,
      })
      if (error) setErr(error.message)
      else setDone(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (done) return <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ Gemarkeerd als geroteerd</span>

  return (
    <div className="api-keys__mark-rotated">
      <div className="api-keys__detail-label">Edge Function secret? Plak nieuwe waarde in Supabase, vul hier de last 4 in:</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <input
          type="text"
          value={last4}
          onChange={e => setLast4(e.target.value.slice(-4))}
          placeholder="last 4"
          maxLength={4}
          disabled={busy}
          className="settings-input"
          style={{ width: 100, fontFamily: 'var(--mono)' }}
        />
        <button className="btn btn--accent" onClick={onMark} disabled={busy} style={{ fontSize: 12, padding: '6px 12px' }}>
          {busy ? '…' : 'Markeer geroteerd'}
        </button>
        {err && <span style={{ fontSize: 11, color: 'var(--error)' }}>{err}</span>}
      </div>
    </div>
  )
}

function EditModal({ row, onClose }) {
  const [value, setValue] = useState('')
  const [description, setDescription] = useState(row.purpose && row.purpose !== '— niet ingevuld —' ? row.purpose : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const isVaultSkill = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')
  const isAgentConfig = row.storage_location === 'agent_config'
  const isEdgeFnSecret = row.storage_location === 'edge_function_secret'
  const isComposioManaged = row.storage_location === 'composio_managed'

  async function onSave() {
    if (!value.trim()) { setErr('Waarde mag niet leeg zijn'); return }
    setBusy(true); setErr(null)
    try {
      let result
      if (isVaultSkill) {
        const parts = row.storage_ref.split(':')
        result = await supabase.rpc('set_skill_secret', {
          p_skill_name: parts[1],
          p_secret_name: parts.slice(2).join(':'),
          p_plaintext: value.trim(),
          p_description: description || null,
          p_updated_by: 'dashboard',
        })
      } else if (isAgentConfig) {
        result = await supabase.rpc('set_secret_value', {
          p_key_name: row.key_name,
          p_plaintext: value.trim(),
        })
      } else {
        setErr('Deze key kun je niet via dashboard bewerken — zie toelichting hieronder.')
        setBusy(false)
        return
      }
      if (result.error) setErr(result.error.message)
      else if (result.data && result.data.ok === false) setErr(result.data.hint || result.data.reason || 'opslaan mislukt')
      else onClose()
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  // Read-only modus voor keys die niet via dashboard te zetten zijn.
  const cannotEdit = isEdgeFnSecret || isComposioManaged || (!isVaultSkill && !isAgentConfig)

  return (
    <div role="dialog" aria-modal="true" className="api-keys__modal-backdrop" onClick={onClose}>
      <div className="card api-keys__modal" onClick={e => e.stopPropagation()}>
        <h3 className="api-keys__modal-title">{row.display_name || row.key_name}</h3>
        <div className="muted mono" style={{ fontSize: 11, marginBottom: 14 }}>
          {row.key_name} · {STORAGE_LABEL[row.storage_location]}
        </div>

        {row.last_4 && (
          <div className="api-keys__modal-current">
            Huidige waarde eindigt op <code>****{row.last_4}</code>. Nieuwe waarde overschrijft.
          </div>
        )}

        {cannotEdit ? (
          <div className="api-keys__modal-cannot">
            {isEdgeFnSecret && (
              <>
                <strong>Edge Function secret</strong> — bewerken kan alleen in het Supabase dashboard onder
                Project Settings → Edge Functions → Secrets. Klik daarna onderaan op
                <em> Markeer geroteerd</em> in de toelichting van deze key.
              </>
            )}
            {isComposioManaged && (
              <>
                <strong>Composio OAuth</strong> — vernieuw de connectie in het Composio dashboard.
                Geen plaintext om hier in te plakken.
              </>
            )}
            {!isEdgeFnSecret && !isComposioManaged && (
              <>Deze key heeft geen edit-flow vanuit dashboard. Zie storage_location in de toelichting.</>
            )}
          </div>
        ) : (
          <>
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

            <label style={{ display: 'block', marginBottom: 14 }}>
              <div className="kpi__label" style={{ marginBottom: 4 }}>Nieuwe waarde</div>
              <textarea
                value={value}
                onChange={e => setValue(e.target.value)}
                disabled={busy}
                rows={3}
                placeholder="Plak nieuwe key/token hier"
                autoFocus
                className="settings-textarea settings-textarea--mono"
              />
            </label>

            {isVaultSkill && (
              <label style={{ display: 'block', marginBottom: 16 }}>
                <div className="kpi__label" style={{ marginBottom: 4 }}>Beschrijving (optioneel)</div>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={busy}
                  className="settings-input"
                  style={{ maxWidth: 'none' }}
                />
              </label>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!cannotEdit && (
            <button className="btn btn--accent" onClick={onSave} disabled={busy}>
              {busy ? 'Opslaan…' : 'Opslaan'}
            </button>
          )}
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {cannotEdit ? 'Sluiten' : 'Annuleer'}
          </button>
        </div>

        {err && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--error-dim)', color: 'var(--error)', borderRadius: 6, fontSize: 12 }}>
            ⚠ {err}
          </div>
        )}
      </div>
    </div>
  )
}

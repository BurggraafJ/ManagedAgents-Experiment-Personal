import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { SettingsPage } from './SettingsLayout'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'

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
// verschijnen. Tegelijkertijd back-annoteren we registry-velden
// (last_accessed_at, access_count, delete_protection) op echte inventory-rows
// die naar Vault wijzen, zodat de UI ze als één rij kan tonen.
function mergeRows(secretsInventory, skillSecrets) {
  const skBy = new Map()
  for (const sk of (skillSecrets || [])) {
    skBy.set(`skill:${sk.skill_name}:${sk.secret_name}`, sk)
  }

  const inv = (secretsInventory || []).map(r => {
    if (r.storage_ref && r.storage_ref.startsWith('skill:')) {
      const sk = skBy.get(r.storage_ref)
      if (sk) {
        return {
          ...r,
          skill_name: sk.skill_name,
          secret_name: sk.secret_name,
          last_accessed_at: sk.last_accessed_at,
          access_count: sk.access_count,
          delete_protection: sk.delete_protection,
        }
      }
    }
    return r
  })

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
        skill_name: sk.skill_name,
        secret_name: sk.secret_name,
        last_accessed_at: sk.last_accessed_at,
        access_count: sk.access_count,
        delete_protection: sk.delete_protection,
      })
    }
  }
  return inv
}

// Format relative time like "2u geleden", "3d geleden", "—" if null.
function formatRelative(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 0) return d.toLocaleDateString('nl-NL')
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'net'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u geleden`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d geleden`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Compute expiry-status: { tone: 'ok'|'warn'|'crit'|'expired', label, daysLeft }
function expiryStatus(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0)  return { tone: 'expired', label: `Verlopen (${-days}d geleden)`, daysLeft: days }
  if (days <= 7)  return { tone: 'crit', label: `Nog ${days}d`, daysLeft: days }
  if (days <= 30) return { tone: 'warn', label: `Nog ${days}d`, daysLeft: days }
  return { tone: 'ok', label: `${d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })}`, daysLeft: days }
}

const EXPIRY_TONE_COLOR = {
  ok:      '#16a34a',
  warn:    '#d97706',
  crit:    '#dc2626',
  expired: '#dc2626',
}

export default function ApiKeysPage() {
  // Refactor 07 — hook-migratie: page fetcht zelf de twee tabellen die het
  // nodig heeft via useSupabaseQuery (Refactor 04). Eerder kwam dit als props
  // van SettingsView via de monoliet-data-prop. Realtime aan voor live updates
  // bij rotatie/delete-acties op secrets.
  const { data: secretsInventory } = useSupabaseQuery('secrets_inventory', {
    orderBy: ['status', { ascending: true }],
    realtime: true,
  })
  const { data: skillSecrets } = useSupabaseQuery('skill_secrets_registry', {
    select: 'id,skill_name,secret_name,description,last_4,vault_secret_id,updated_at,updated_by,last_accessed_at,access_count,delete_protection',
    orderBy: ['skill_name', { ascending: true }],
    realtime: true,
  })
  // Optimistic overrides — laat elk save direct in de UI zien zonder te wachten
  // op de realtime-refetch. Wordt automatisch gewist zodra de echte data
  // hetzelfde is (5s reaper) of bij navigatie weg van de pagina.
  const [overrides, setOverrides] = useState({})
  const applyOverride = (keyName, patch) => {
    setOverrides(prev => ({ ...prev, [keyName]: { ...prev[keyName], ...patch, _ts: Date.now() } }))
  }

  // Reap stale overrides na 8s — tegen die tijd is realtime sowieso bij.
  useEffect(() => {
    const t = setInterval(() => {
      setOverrides(prev => {
        const cutoff = Date.now() - 8000
        const next = {}
        let changed = false
        for (const [k, v] of Object.entries(prev)) {
          if (v._ts >= cutoff) next[k] = v
          else changed = true
        }
        return changed ? next : prev
      })
    }, 4000)
    return () => clearInterval(t)
  }, [])

  const allRows = useMemo(() => {
    const merged = mergeRows(secretsInventory, skillSecrets)
    return merged.map(r => {
      const o = overrides[r.key_name]
      if (!o) return r
      const { _ts, ...patch } = o
      return { ...r, ...patch }
    })
  }, [secretsInventory, skillSecrets, overrides])

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
                        applyOverride={applyOverride}
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
        <EditModal
          row={allRows.find(r => r.key_name === editing.key_name) || editing}
          onClose={() => setEditing(null)}
          applyOverride={applyOverride}
        />
      )}
    </SettingsPage>
  )
}

function Row({ row, expanded, onToggle, onEdit, applyOverride }) {
  const meta = STATUS_META[row.status] || STATUS_META.unset
  const isDeprecated = row.status === 'deprecated'
  const rotLocation = rotationLocation(row.rotation_url)
  const usedBy = row.used_by || []
  const exp = expiryStatus(row.expires_at)
  const lastUsed = formatRelative(row.last_accessed_at)
  const isVault = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')

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
          {exp && (
            <div
              style={{
                marginTop: 4,
                fontSize: 10,
                fontWeight: 600,
                color: EXPIRY_TONE_COLOR[exp.tone],
              }}
              title={`Verloopt op ${new Date(row.expires_at).toLocaleDateString('nl-NL')}`}
            >
              {exp.tone === 'expired' ? '⚠ ' : exp.tone === 'crit' ? '⏰ ' : exp.tone === 'warn' ? '⏳ ' : '🕒 '}
              {exp.label}
            </div>
          )}
          {isVault && row.delete_protection === false && (
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, color: '#dc2626' }} title="Slot is uit — kan handmatig verwijderd worden">
              🔓 Ontgrendeld
            </div>
          )}
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
          {isVault && lastUsed && (
            <div className="muted" style={{ fontSize: 10, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>🕒</span>
              <span>{lastUsed}</span>
              {row.access_count > 1 && (
                <span style={{ opacity: 0.7 }} title={`${row.access_count} keer gelezen`}>· {row.access_count}×</span>
              )}
            </div>
          )}
          {isVault && !lastUsed && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 500, marginTop: 4,
              padding: '2px 6px', borderRadius: 999,
              background: 'var(--surface-2)', color: 'var(--text-muted)',
              opacity: 0.7,
            }}
              title="Nog geen activiteit sinds last-used tracking aanstaat (2026-05-03)"
            >
              <span>🌱</span>
              <span>Nog ongebruikt</span>
            </div>
          )}
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
            <DetailPanel row={row} applyOverride={applyOverride} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetailPanel({ row, applyOverride }) {
  const since = row.last_status_change_at ? new Date(row.last_status_change_at) : null
  const isVault = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')
  const exp = expiryStatus(row.expires_at)

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
        {isVault && (
          <div>
            <div className="api-keys__detail-label">Laatst gebruikt</div>
            <div className="api-keys__detail-text">
              {row.last_accessed_at ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>
                      {new Date(row.last_accessed_at).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      ({formatRelative(row.last_accessed_at)})
                    </span>
                  </div>
                  {row.access_count > 0 && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {row.access_count} {row.access_count === 1 ? 'read' : 'reads'} totaal
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12, padding: '4px 10px', borderRadius: 999,
                  background: 'var(--surface-2)', color: 'var(--text-muted)',
                }}>
                  <span style={{ fontSize: 14 }}>🌱</span>
                  <span>Nog niet gelezen — wacht op eerste skill-read</span>
                </div>
              )}
            </div>
          </div>
        )}
        {!isVault && (row.storage_location === 'edge_function_secret' || row.storage_location === 'composio_managed') && (
          <div>
            <div className="api-keys__detail-label">Laatst gebruikt</div>
            <div className="api-keys__detail-text muted" style={{ fontSize: 12 }}>
              Niet meetbaar voor {STORAGE_LABEL[row.storage_location]}
            </div>
          </div>
        )}
        {row.expires_at && (
          <div>
            <div className="api-keys__detail-label">Verloopt</div>
            <div className="api-keys__detail-text" style={{ color: exp ? EXPIRY_TONE_COLOR[exp.tone] : 'inherit' }}>
              {new Date(row.expires_at).toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' })}
              {exp && <span style={{ fontSize: 11, marginLeft: 8 }}>({exp.label})</span>}
              {row.expiry_note && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{row.expiry_note}</div>
              )}
            </div>
          </div>
        )}
        {isVault && (
          <div style={{ gridColumn: '1 / -1' }}>
            <ProtectionAndDeleteRow row={row} applyOverride={applyOverride} />
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

function ProtectionAndDeleteRow({ row, applyOverride }) {
  const [protectedFlag, setProtectedFlag] = useState(row.delete_protection !== false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [confirming, setConfirming] = useState(false)

  // Sync wanneer parent row update krijgt via realtime
  useEffect(() => { setProtectedFlag(row.delete_protection !== false) }, [row.delete_protection])

  async function onToggleProtection(next) {
    // Optimistic — UI flipt direct
    setProtectedFlag(next)
    applyOverride?.(row.key_name, { delete_protection: next })
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_skill_secret_protection', {
        p_skill_name: row.skill_name,
        p_secret_name: row.secret_name,
        p_protected: next,
      })
      if (error) {
        setErr(error.message)
        // Rollback
        setProtectedFlag(!next)
        applyOverride?.(row.key_name, { delete_protection: !next })
      } else if (data && data.ok === false) {
        setErr(data.reason || 'wijzigen mislukt')
        setProtectedFlag(!next)
        applyOverride?.(row.key_name, { delete_protection: !next })
      }
    } catch (e) {
      setErr(e.message)
      setProtectedFlag(!next)
      applyOverride?.(row.key_name, { delete_protection: !next })
    }
    setBusy(false)
  }

  return (
    <div className="api-keys__protection">
      <div className="api-keys__detail-label">Verwijder-bescherming</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={protectedFlag}
            disabled={busy}
            onChange={e => onToggleProtection(e.target.checked)}
          />
          {protectedFlag ? '🔒 Vergrendeld — alleen jij kunt unsetten' : '🔓 Ontgrendeld — verwijderen mogelijk'}
        </label>
        {!protectedFlag && (
          <button
            type="button"
            className="btn"
            style={{ background: '#dc2626', color: 'white', fontSize: 12, padding: '6px 12px' }}
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            Verwijder definitief
          </button>
        )}
        {err && <span style={{ fontSize: 11, color: 'var(--error)' }}>{err}</span>}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
        Vergrendelde keys kunnen niet worden verwijderd door skills, Edge Functions, of Claude Code —
        alleen door jou via dit dashboard nadat je het slotje openzet. Edits/rotaties werken altijd.
      </div>

      {confirming && (
        <ConfirmDeleteModal
          row={row}
          onCancel={() => setConfirming(false)}
          onDone={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

function ConfirmDeleteModal({ row, onCancel, onDone }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const expected = row.secret_name || row.key_name
  const match = typed.trim() === expected

  async function onConfirm() {
    if (!match) return
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('delete_skill_secret', {
        p_skill_name: row.skill_name,
        p_secret_name: row.secret_name,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.hint || data.reason || 'verwijderen mislukt')
      else onDone()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div role="dialog" aria-modal="true" className="api-keys__modal-backdrop" onClick={onCancel}>
      <div className="card api-keys__modal" onClick={e => e.stopPropagation()}>
        <h3 className="api-keys__modal-title" style={{ color: '#dc2626' }}>Definitief verwijderen?</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
          Je staat op het punt <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>{row.storage_ref || row.key_name}</code> uit
          de Vault te verwijderen. Skills die deze key gebruiken zullen falen tot je een nieuwe waarde invult.
        </div>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <div className="kpi__label" style={{ marginBottom: 4 }}>
            Typ <code>{expected}</code> om te bevestigen
          </div>
          <input
            type="text"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            disabled={busy}
            autoFocus
            className="settings-input"
            style={{ fontFamily: 'var(--mono)', maxWidth: 'none' }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            style={{ background: match ? '#dc2626' : 'var(--surface-2)', color: match ? 'white' : 'var(--text-muted)' }}
            onClick={onConfirm}
            disabled={!match || busy}
          >
            {busy ? 'Bezig…' : 'Verwijder'}
          </button>
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>Annuleer</button>
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

function EditModal({ row, onClose, applyOverride }) {
  const [value, setValue] = useState('')
  const [description, setDescription] = useState(row.purpose && row.purpose !== '— niet ingevuld —' ? row.purpose : '')
  const [expiresAt, setExpiresAt] = useState(row.expires_at ? new Date(row.expires_at).toISOString().slice(0, 10) : '')
  const [expiryNote, setExpiryNote] = useState(row.expiry_note || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [savedLast4, setSavedLast4] = useState(null) // optimistic feedback tot realtime ververst
  const [expirySaved, setExpirySaved] = useState(false)

  const isVaultSkill = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')
  const isAgentConfig = row.storage_location === 'agent_config'
  const isEdgeFnSecret = row.storage_location === 'edge_function_secret'
  const isComposioManaged = row.storage_location === 'composio_managed'

  async function onSave() {
    if (!value.trim()) { setErr('Waarde mag niet leeg zijn'); return }
    setBusy(true); setErr(null)
    try {
      const trimmed = value.trim()
      const last4 = trimmed.slice(-4)
      let result
      if (isVaultSkill) {
        const parts = row.storage_ref.split(':')
        result = await supabase.rpc('set_skill_secret', {
          p_skill_name: parts[1],
          p_secret_name: parts.slice(2).join(':'),
          p_plaintext: trimmed,
          p_description: description || null,
          p_updated_by: 'dashboard',
        })
      } else if (isAgentConfig) {
        result = await supabase.rpc('set_secret_value', {
          p_key_name: row.key_name,
          p_plaintext: trimmed,
        })
      } else {
        setErr('Deze key kun je niet via dashboard bewerken — zie toelichting hieronder.')
        setBusy(false)
        return
      }
      if (result.error) {
        setErr(result.error.message)
        setBusy(false)
        return
      }
      if (result.data && result.data.ok === false) {
        setErr(result.data.hint || result.data.reason || 'opslaan mislukt')
        setBusy(false)
        return
      }

      // Sync inventory-status + last_4 zodat de tabel-status van rood/unset
      // naar groen springt. Niet kritiek als deze faalt — Vault/agent_config
      // zijn al correct geschreven.
      try {
        await supabase.rpc('mark_secret_rotated', {
          p_key_name: row.key_name,
          p_new_last_4: last4,
          p_notes: 'gewijzigd via dashboard',
        })
      } catch { /* niet kritiek */ }

      // Optimistic — toon nieuwe last_4 + groene status meteen in tabel
      applyOverride?.(row.key_name, {
        last_4: last4,
        status: 'green_dashboard_only',
        last_status_change_at: new Date().toISOString(),
      })
      setSavedLast4(last4)
      setTimeout(onClose, 900)
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  async function onMarkRotatedOnly(last4) {
    if (!last4 || last4.length === 0) { setErr('Vul de laatste 4 tekens in'); return }
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('mark_secret_rotated', {
        p_key_name: row.key_name,
        p_new_last_4: last4,
        p_notes: 'edge function secret — handmatig in Supabase ingevuld',
      })
      if (error) setErr(error.message)
      else {
        setSavedLast4(last4)
        setTimeout(onClose, 900)
        return
      }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function saveExpiry(rawDate, note) {
    const iso = rawDate ? new Date(rawDate + 'T00:00:00').toISOString() : null
    // Optimistic
    applyOverride?.(row.key_name, { expires_at: iso, expiry_note: note || null })
    setExpiresAt(rawDate)
    setExpiryNote(note || '')
    setExpirySaved(true)
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_secret_expiry', {
        p_key_name: row.key_name,
        p_expires_at: iso,
        p_expiry_note: note || null,
      })
      if (error) { setErr(error.message); setExpirySaved(false) }
      else if (data && data.ok === false) { setErr(data.reason || 'expiry instellen mislukt'); setExpirySaved(false) }
    } catch (e) { setErr(e.message); setExpirySaved(false) }
    setBusy(false)
    setTimeout(() => setExpirySaved(false), 1800)
  }

  function applyPreset(days) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    const iso = d.toISOString().slice(0, 10)
    saveExpiry(iso, expiryNote)
  }

  // Edge function secrets krijgen een eigen flow: handmatig in Supabase + last4 hier markeren.
  // composio_managed en onbekende storage_locations hebben helemaal geen edit-pad.
  const isMarkRotatedFlow = isEdgeFnSecret
  const cannotEdit = isComposioManaged || (!isVaultSkill && !isAgentConfig && !isEdgeFnSecret)
  // Expiry-editor heeft een echte inventory-rij nodig (created_at is dan gevuld).
  const canSetExpiry = !!row.created_at

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

        {savedLast4 ? (
          <div className="api-keys__modal-success">
            <span style={{ fontSize: 18 }}>✓</span>
            <div>
              <div style={{ fontWeight: 600 }}>Opgeslagen</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Status wordt bijgewerkt naar <strong style={{ color: 'var(--success)' }}>🟢 Veilig</strong> · last 4: <code>****{savedLast4}</code>
              </div>
            </div>
          </div>
        ) : cannotEdit ? (
          <div className="api-keys__modal-cannot">
            {isComposioManaged ? (
              <>
                <strong>Composio OAuth</strong> — vernieuw de connectie in het Composio dashboard.
                Geen plaintext om hier in te plakken.
              </>
            ) : (
              <>Deze key heeft geen edit-flow vanuit dashboard. Zie storage_location in de toelichting.</>
            )}
          </div>
        ) : isMarkRotatedFlow ? (
          <MarkRotatedModalForm
            row={row}
            busy={busy}
            onSubmit={onMarkRotatedOnly}
          />
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

        {!savedLast4 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {!cannotEdit && !isMarkRotatedFlow && (
              <button className="btn btn--accent" onClick={onSave} disabled={busy || !value.trim()}>
                {busy ? 'Opslaan…' : 'Opslaan'}
              </button>
            )}
            <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
              {cannotEdit ? 'Sluiten' : 'Annuleer'}
            </button>
          </div>
        )}

        {!savedLast4 && canSetExpiry && (
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="kpi__label">Verloopdatum</div>
              {expirySaved && (
                <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>✓ Opgeslagen</span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 12, lineHeight: 1.5 }}>
              Helpt rotaties op tijd plannen. Tabel toont oranje pill &lt;30d, rood &lt;7d.
            </div>

            {/* Quick-presets */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {[
                { days: 30,  label: '30 dagen' },
                { days: 90,  label: '90 dagen' },
                { days: 180, label: '180 dagen' },
                { days: 365, label: '1 jaar' },
              ].map(p => (
                <button
                  key={p.days}
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => applyPreset(p.days)}
                  disabled={busy}
                  style={{ fontSize: 11, padding: '4px 10px' }}
                >
                  + {p.label}
                </button>
              ))}
            </div>

            {/* Custom date + note */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="date"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                disabled={busy}
                className="settings-input"
                style={{ maxWidth: 170 }}
              />
              <input
                type="text"
                value={expiryNote}
                onChange={e => setExpiryNote(e.target.value)}
                disabled={busy}
                placeholder="Notitie (optioneel, bv. 'q3-rotatie')"
                className="settings-input"
                style={{ flex: 1, minWidth: 180 }}
              />
              <button
                className="btn btn--accent"
                onClick={() => saveExpiry(expiresAt, expiryNote)}
                disabled={busy}
                style={{ fontSize: 12 }}
              >
                Opslaan
              </button>
              {expiresAt && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => saveExpiry('', '')}
                  disabled={busy}
                  style={{ fontSize: 11, color: 'var(--text-muted)' }}
                  title="Verwijder verloopdatum"
                >
                  Wissen
                </button>
              )}
            </div>
          </div>
        )}

        {err && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--error-dim)', color: 'var(--error)', borderRadius: 6, fontSize: 12 }}>
            ⚠ {err}
          </div>
        )}
      </div>
    </div>
  )
}

function MarkRotatedModalForm({ row, busy, onSubmit }) {
  const [last4, setLast4] = useState('')
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="api-keys__modal-cannot" style={{ marginBottom: 14 }}>
        <strong>Edge Function secret</strong> — de waarde plak je in het Supabase dashboard
        onder <em>Project Settings → Edge Functions → Secrets</em>. Daarna vul je hieronder
        de laatste 4 tekens in zodat het overzicht deze rotatie als 🟢 Veilig markeert.
      </div>
      {row.rotation_url && (
        <div style={{ marginBottom: 12 }}>
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
        <div className="kpi__label" style={{ marginBottom: 4 }}>Laatste 4 tekens van de nieuwe waarde</div>
        <input
          type="text"
          value={last4}
          onChange={e => setLast4(e.target.value.slice(-4))}
          maxLength={4}
          placeholder="abcd"
          autoFocus
          disabled={busy}
          className="settings-input"
          style={{ fontFamily: 'var(--mono)', maxWidth: 160 }}
        />
      </label>
      <button
        className="btn btn--accent"
        onClick={() => onSubmit(last4)}
        disabled={busy || last4.length === 0}
      >
        {busy ? 'Markeren…' : 'Markeer geroteerd'}
      </button>
    </div>
  )
}

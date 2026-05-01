import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// =====================================================================
// ContactenView — F.5 Contactpersonen Source of Truth
// =====================================================================
// Lijst van alle contactpersonen, gevuld door:
//   - HubSpot-contacts mirror (hubspot_contacts)
//   - Outlook mail_messages senders + recipients
// Verrijking automatisch via nightly pg_cron (sync_contactpersonen_full):
//   - firm_type detectie via detect_firm_type()
//   - contact_type via lifecyclestage / firm_type / domein
//   - free-mail providers → persoonlijk
//   - tech-firms → leverancier
//
// Deze view geeft:
//   - statistiek-tegels (totalen per type)
//   - zoek + filter op contact_type / firm_type
//   - tabel met manual-override knop (contact_type wijzigen)
//   - "Sync nu" knop die de RPC aanroept
// =====================================================================

const CONTACT_TYPES = [
  'intern','klant','prospect','partner','leverancier',
  'advocatenorde','rechtbank','overheid','persoonlijk','overig',
]

const CONTACT_TYPE_LABEL = {
  intern:        'Intern',
  klant:         'Klant',
  prospect:      'Prospect',
  partner:       'Partner',
  leverancier:   'Leverancier',
  advocatenorde: 'Advocatenorde',
  rechtbank:     'Rechtbank',
  overheid:      'Overheid',
  persoonlijk:   'Persoonlijk',
  overig:        'Overig',
}

const CONTACT_TYPE_PILL = {
  intern:        's-success',
  klant:         's-success',
  prospect:      's-warning',
  partner:       '',
  leverancier:   's-idle',
  advocatenorde: 's-idle',
  rechtbank:     's-idle',
  overheid:      's-idle',
  persoonlijk:   's-idle',
  overig:        '',
}

const FIRM_TYPE_LABEL = {
  advocatenkantoor: 'Advocatenkantoor',
  rechtbank:        'Rechtbank',
  notariaat:        'Notariaat',
  overheid:         'Overheid',
  advocatenorde:    'Advocatenorde',
  tech:             'Tech / SaaS',
  consulting:       'Consulting',
  mediator:         'Mediator',
  internal:         'Intern',
  overig:           'Overig',
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

// =====================================================================

export default function ContactenView() {
  const [contacten, setContacten] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')   // contact_type
  const [filterFirm, setFilterFirm] = useState('')   // firm_type
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const [expanded, setExpanded] = useState(null)  // contact_id van uitgeklapte rij
  const [savingId, setSavingId] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      // Statistiek-tegels via groupering
      const { data: typeStats, error: e1 } = await supabase
        .from('contactpersonen')
        .select('contact_type', { count: 'exact', head: false })
        .eq('is_deleted', false)
      if (e1) throw e1

      // Tel per type
      const counts = {}
      for (const r of typeStats || []) {
        counts[r.contact_type] = (counts[r.contact_type] || 0) + 1
      }
      setStats({ total: typeStats?.length || 0, byType: counts })

      // Sync-state
      const { data: syncRows } = await supabase
        .from('contactpersonen_sync_state')
        .select('source, last_delta_sync, total_synced')
      if (syncRows && syncRows.length) {
        const latest = syncRows.reduce((a, b) =>
          new Date(a.last_delta_sync || 0) > new Date(b.last_delta_sync || 0) ? a : b
        )
        setLastSync(latest.last_delta_sync)
      }
    } catch (e) {
      console.error('[contacten] stats failed', e)
      setErr(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Lijst opnieuw laden bij filterwijziging
  const loadList = useCallback(async () => {
    setErr(null)
    try {
      let q = supabase
        .from('contactpersonen')
        .select('id, email, voornaam, achternaam, display_naam, telefoonnummer, functietitel, contact_type, firm_id, firm_naam, email_domein, sources, last_seen_at, first_seen_at, email_count, hubspot_contact_id, properties')
        .eq('is_deleted', false)
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (filterType) q = q.eq('contact_type', filterType)

      if (search.trim().length >= 2) {
        const s = search.trim()
        q = q.or(`email.ilike.%${s}%,display_naam.ilike.%${s}%,firm_naam.ilike.%${s}%,voornaam.ilike.%${s}%,achternaam.ilike.%${s}%`)
      }

      const { data, error } = await q
      if (error) throw error

      // Filter op firm_type client-side via aparte firms-fetch (omdat firm_type op de firm zit)
      let rows = data || []
      if (filterFirm) {
        const firmIds = [...new Set(rows.map(r => r.firm_id).filter(Boolean))]
        if (firmIds.length) {
          const { data: firms } = await supabase
            .from('firms')
            .select('id, firm_type')
            .in('id', firmIds)
          const allowed = new Set((firms || []).filter(f => f.firm_type === filterFirm).map(f => f.id))
          rows = rows.filter(r => allowed.has(r.firm_id))
        } else {
          rows = []
        }
      }

      setContacten(rows)
    } catch (e) {
      console.error('[contacten] load failed', e)
      setErr(e.message || String(e))
    }
  }, [search, filterType, filterFirm, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadList() }, [loadList])

  // Manual override: contact_type aanpassen
  const updateType = async (id, newType) => {
    setSavingId(id)
    try {
      const { error } = await supabase
        .from('contactpersonen')
        .update({
          contact_type: newType,
          properties: { manual_override: true, override_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
      // Update lokaal
      setContacten(prev => prev.map(c => c.id === id ? { ...c, contact_type: newType } : c))
      // Stats herladen
      load()
    } catch (e) {
      alert('Kon contact_type niet bijwerken: ' + (e.message || e))
    } finally {
      setSavingId(null)
    }
  }

  // Trigger sync RPC
  const triggerSync = async () => {
    setSyncing(true)
    try {
      const { data, error } = await supabase.rpc('sync_contactpersonen_full')
      if (error) throw error
      console.log('[contacten] sync result', data)
      await load()
      await loadList()
    } catch (e) {
      alert('Sync mislukt: ' + (e.message || e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="contacten-view">
      {/* Statistiek-strip */}
      {stats && (
        <div className="kpi-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s-3)', marginBottom: 'var(--s-5)' }}>
          <KpiTile label="Totaal" value={stats.total} />
          {CONTACT_TYPES.filter(t => stats.byType[t]).map(t => (
            <KpiTile key={t} label={CONTACT_TYPE_LABEL[t]} value={stats.byType[t] || 0} />
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="contacten-toolbar" style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', marginBottom: 'var(--s-4)', flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Zoek op naam, email of firm…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          style={{ flex: '1 1 240px', minWidth: 200 }}
        />
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(0) }}>
          <option value="">Alle contact-types</option>
          {CONTACT_TYPES.map(t => (
            <option key={t} value={t}>{CONTACT_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <select value={filterFirm} onChange={e => { setFilterFirm(e.target.value); setPage(0) }}>
          <option value="">Alle firm-types</option>
          {Object.entries(FIRM_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 12 }}>
          Laatste sync: {fmtDate(lastSync)}
        </span>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={triggerSync}
          disabled={syncing}
        >
          {syncing ? '⏳ Sync draait…' : '🔄 Sync nu'}
        </button>
      </div>

      {/* Lijst */}
      {err && <div className="banner banner--error" style={{ marginBottom: 'var(--s-3)' }}>{err}</div>}
      {loading && !contacten.length && <div className="muted">Laden…</div>}

      {!loading && !contacten.length && (
        <div className="muted" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
          Geen contacten gevonden met deze filters.
        </div>
      )}

      <div className="contacten-list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {contacten.map(c => (
          <ContactRow
            key={c.id}
            contact={c}
            expanded={expanded === c.id}
            onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
            onUpdateType={updateType}
            saving={savingId === c.id}
          />
        ))}
      </div>

      {/* Paginering */}
      {contacten.length === PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--s-3)', marginTop: 'var(--s-4)' }}>
          <button className="btn btn--ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
            ← Vorige
          </button>
          <span className="muted">Pagina {page + 1}</span>
          <button className="btn btn--ghost" onClick={() => setPage(p => p + 1)}>
            Volgende →
          </button>
        </div>
      )}
    </div>
  )
}

// =====================================================================

function KpiTile({ label, value }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 'var(--s-3)',
    }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 2 }}>{value.toLocaleString('nl-NL')}</div>
    </div>
  )
}

function ContactRow({ contact, expanded, onToggle, onUpdateType, saving }) {
  const c = contact
  const naam = c.display_naam || c.email
  const initials = (c.voornaam?.[0] || c.email?.[0] || '?').toUpperCase()
       + (c.achternaam?.[0] || '').toUpperCase()
  const isManual = c.properties?.manual_override === true

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 'var(--s-3)',
        cursor: 'pointer',
      }}
      onClick={onToggle}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto auto auto', gap: 'var(--s-3)', alignItems: 'center' }}>
        {/* Avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--bg-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600,
        }}>{initials}</div>

        {/* Naam + email + firm */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {naam}
            {isManual && <span title="Handmatig overschreven" style={{ marginLeft: 6, fontSize: 11, opacity: 0.6 }}>✎</span>}
          </div>
          <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.email}{c.firm_naam ? ` · ${c.firm_naam}` : ''}
          </div>
        </div>

        {/* Email count */}
        <div className="muted" style={{ fontSize: 12, textAlign: 'right' }}>
          {c.email_count > 0 ? `${c.email_count} mails` : '—'}
        </div>

        {/* Last seen */}
        <div className="muted" style={{ fontSize: 12, minWidth: 80, textAlign: 'right' }}>
          {fmtDate(c.last_seen_at)}
        </div>

        {/* Type-pill */}
        <span className={`pill ${CONTACT_TYPE_PILL[c.contact_type] || ''}`} style={{ fontSize: 11 }}>
          {CONTACT_TYPE_LABEL[c.contact_type] || c.contact_type}
        </span>
      </div>

      {expanded && (
        <div onClick={e => e.stopPropagation()} style={{ marginTop: 'var(--s-3)', paddingTop: 'var(--s-3)', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
          <Detail label="Email"           value={c.email} />
          <Detail label="Voornaam"        value={c.voornaam || '—'} />
          <Detail label="Achternaam"      value={c.achternaam || '—'} />
          <Detail label="Functietitel"    value={c.functietitel || '—'} />
          <Detail label="Telefoon"        value={c.telefoonnummer || '—'} />
          <Detail label="Firm"            value={c.firm_naam || '—'} />
          <Detail label="Email-domein"    value={c.email_domein || '—'} />
          <Detail label="Bronnen"         value={(c.sources || []).join(', ') || '—'} />
          <Detail label="Eerste contact"  value={fmtDate(c.first_seen_at)} />
          <Detail label="Laatste contact" value={fmtDate(c.last_seen_at)} />
          <Detail label="Aantal mails"    value={c.email_count ?? 0} />
          <Detail label="HubSpot ID"      value={c.hubspot_contact_id || '—'} />

          <div style={{ gridColumn: '1 / -1', marginTop: 'var(--s-2)' }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Contact-type aanpassen
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CONTACT_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`btn btn--ghost ${c.contact_type === t ? 'is-active' : ''}`}
                  disabled={saving || c.contact_type === t}
                  onClick={() => onUpdateType(c.id, t)}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  {CONTACT_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13 }}>{value}</div>
    </div>
  )
}

// =====================================================================
// Herbruikbare autocomplete-component voor contactpersonen
// Roept search_contactpersonen RPC aan bij ≥2 tekens.
// Usage:
//   <ContactAutocomplete value={email} onSelect={c => setEmail(c.email)} />
// =====================================================================

export function ContactAutocomplete({
  value = '',
  onSelect,
  placeholder = 'Zoek contactpersoon…',
  filterType = null,
  limit = 8,
  autoFocus = false,
}) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.rpc('search_contactpersonen', {
          query: query.trim(),
          limit_n: limit,
          filter_type: filterType,
        })
        if (error) throw error
        setResults(data || [])
        setOpen((data || []).length > 0)
        setActiveIdx(-1)
      } catch (e) {
        console.error('[autocomplete]', e)
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, filterType, limit])

  const pick = (c) => {
    if (!c) return
    setQuery(c.email)
    setOpen(false)
    onSelect?.(c)
  }

  const handleKeyDown = (e) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      pick(results[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ width: '100%' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 6, marginTop: 2, zIndex: 100,
          maxHeight: 320, overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>
          {loading && <div className="muted" style={{ padding: 'var(--s-2)', fontSize: 12 }}>Zoeken…</div>}
          {!loading && results.map((r, i) => (
            <div
              key={r.id}
              onMouseDown={() => pick(r)}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                background: i === activeIdx ? 'var(--bg-subtle)' : 'transparent',
                borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500 }}>{r.display_naam}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {r.email}{r.firm_naam ? ` · ${r.firm_naam}` : ''}
                {r.contact_type && r.contact_type !== 'overig' && (
                  <span style={{ marginLeft: 8, opacity: 0.7 }}>· {CONTACT_TYPE_LABEL[r.contact_type] || r.contact_type}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

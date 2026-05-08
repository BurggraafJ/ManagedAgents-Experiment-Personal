import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { countByType } from '../../../lib/contacten'
import ContactenStats from './ContactenStats'
import ContactenToolbar from './ContactenToolbar'
import ContactRow from './ContactRow'
import styles from './ContactenView.module.css'

const PAGE_SIZE = 50

/**
 * ContactenView — F.5 Contactpersonen Source of Truth.
 * Gevuld door HubSpot-contacts mirror + Outlook senders/recipients via
 * sync_contactpersonen_full pg_cron.
 *
 * Refactor 15 (Golf C): container <150 LOC. Sub-componenten Stats/Toolbar/
 * Row in deze folder. Constanten + helpers in lib/contacten.js. ContactAutocomplete
 * verhuisd naar components/domain/ voor hergebruik.
 *
 * Geen useSupabaseQuery omdat de fetch een complexe `or`-clause heeft die
 * onze hook niet ondersteunt — fetches blijven hier inline maar zonder de
 * monoliet-`data`-prop.
 */
export default function ContactenView() {
  const [contacten, setContacten] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterFirm, setFilterFirm] = useState('')
  const [page, setPage] = useState(0)

  const [expanded, setExpanded] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  const loadStats = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const { data: typeStats, error: e1 } = await supabase
        .from('contactpersonen')
        .select('contact_type', { count: 'exact', head: false })
        .eq('is_deleted', false)
      if (e1) throw e1
      const counts = countByType(typeStats)
      setStats({ total: typeStats?.length || 0, byType: counts })

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
      setErr(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

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

      // firm_type-filter via aparte firms-fetch (firm_type leeft op de firm).
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
      setErr(e.message || String(e))
    }
  }, [search, filterType, filterFirm, page])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadList() }, [loadList])

  async function updateType(id, newType) {
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
      setContacten(prev => prev.map(c => c.id === id ? { ...c, contact_type: newType } : c))
      loadStats()
    } catch (e) {
      alert('Kon contact_type niet bijwerken: ' + (e.message || e))
    } finally {
      setSavingId(null)
    }
  }

  async function triggerSync() {
    setSyncing(true)
    try {
      const { error } = await supabase.rpc('sync_contactpersonen_full')
      if (error) throw error
      await loadStats()
      await loadList()
    } catch (e) {
      alert('Sync mislukt: ' + (e.message || e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <ContactenStats stats={stats} />

      <ContactenToolbar
        search={search}
        onSearch={v => { setSearch(v); setPage(0) }}
        filterType={filterType}
        onFilterType={v => { setFilterType(v); setPage(0) }}
        filterFirm={filterFirm}
        onFilterFirm={v => { setFilterFirm(v); setPage(0) }}
        lastSync={lastSync}
        syncing={syncing}
        onSync={triggerSync}
      />

      {err && <div className="banner banner--error" style={{ marginBottom: 'var(--s-3)' }}>{err}</div>}
      {loading && !contacten.length && <div className="muted">Laden…</div>}

      {!loading && !contacten.length && (
        <div className={styles.empty}>Geen contacten gevonden met deze filters.</div>
      )}

      <div className={styles.list}>
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

      {contacten.length === PAGE_SIZE && (
        <div className={styles.pagination}>
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

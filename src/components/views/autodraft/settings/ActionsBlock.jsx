import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, createRealtimeChannel } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import NewActionModal from '../modals/NewActionModal'
import styles from '../autodraft.module.css'

/**
 * ActionsBlock — beheer-tab voor autodraft_actions catalog.
 *
 * AutoDraft v2 Fase 4 — read + enable/disable + stats per action_slug.
 * CRUD voor nieuwe acties komt via wizard later (Fase 4b).
 *
 * Hard cap: < 250 LOC.
 */
const CATEGORY_ORDER = ['reply', 'forward', 'file', 'schedule', 'delegate', 'defer']

function pct(n, total) {
  if (!total || total === 0) return null
  return Math.round((n / total) * 100)
}

function statusBadge(act) {
  if (!act.enabled) return { text: 'uit', cls: styles.actionStatusOff }
  const rate = pct(act.accepted_count, act.suggested_count)
  if (rate == null) return { text: 'aan', cls: styles.actionStatusIdle }
  if (rate >= 75) return { text: `${rate}%`, cls: styles.actionStatusGood }
  if (rate >= 50) return { text: `${rate}%`, cls: styles.actionStatusOk }
  return { text: `${rate}%`, cls: styles.actionStatusLow }
}

// v3.1 Fase 3 — autopilot (0 klikken) is HARD beperkt tot file.* en pas activeerbaar
// na aantoonbare acceptatie. De server-RPC dwingt dit ook af; dit is alleen de UI-staat.
const AUTOPILOT_MIN_ACCEPTED = 10
function autopilotState(act) {
  if (act.category !== 'file' || !act.autopilot_eligible) return { kind: 'na' }
  if ((act.accepted_count || 0) < AUTOPILOT_MIN_ACCEPTED) return { kind: 'locked', accepted: act.accepted_count || 0 }
  return { kind: 'toggle', on: !!act.autopilot_enabled }
}

export default function ActionsBlock() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [newOpen, setNewOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    try {
      setError(null)
      const { data, error } = await supabase
        .from('autodraft_actions')
        .select('*')
        .order('category')
        .order('slug')
      if (error) throw error
      setRows(data || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const ch = createRealtimeChannel('actions-catalog')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'autodraft_actions' },
        fetchAll,
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [fetchAll])

  const toggleEnabled = useCallback(async (row) => {
    setBusyId(row.id)
    try {
      const { error } = await supabase
        .from('autodraft_actions')
        .update({ enabled: !row.enabled, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error
      showToast(`${row.slug} ${row.enabled ? 'uitgezet' : 'aangezet'}`, 'success')
    } catch (e) {
      showToast(`Toggle mislukt: ${e.message}`, 'error')
    } finally {
      setBusyId(null)
    }
  }, [])

  const toggleAutopilot = useCallback(async (row) => {
    setBusyId(row.id)
    try {
      const { data, error } = await supabase.rpc('set_action_autopilot', {
        p_slug: row.slug,
        p_enabled: !row.autopilot_enabled,
      })
      if (error) throw error
      if (data?.ok) {
        showToast(`Autopilot ${data.autopilot_enabled ? 'AAN' : 'uit'} — ${row.slug}`, 'success')
      } else {
        const msg = data?.error === 'autopilot_only_file' ? 'Autopilot mag alleen voor file-acties (geen externe communicatie)'
          : data?.error === 'insufficient_calibration' ? `Nog te weinig acceptatie voor autopilot (${data.accepted}/${data.needed})`
          : data?.error === 'not_eligible' ? 'Deze actie is geen autopilot-kandidaat'
          : `Autopilot-wijziging geweigerd (${data?.error || 'onbekend'})`
        showToast(msg, 'error')
      }
    } catch (e) {
      showToast(`Autopilot-fout: ${e.message}`, 'error')
    } finally {
      setBusyId(null)
    }
  }, [])

  const grouped = useMemo(() => {
    const m = new Map(CATEGORY_ORDER.map(c => [c, []]))
    for (const r of rows) {
      const cat = r.category || 'overig'
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat).push(r)
    }
    return m
  }, [rows])

  if (loading) {
    return <div className={styles.actionProposalsLoading}>Catalog laden…</div>
  }
  if (error) {
    return <div className={styles.actionProposalsError}>Laden mislukt: {error}</div>
  }
  if (rows.length === 0) {
    return <div className={styles.actionProposalsLoading}>Geen acties in catalog.</div>
  }

  const totals = rows.reduce(
    (acc, r) => ({
      suggested: acc.suggested + (r.suggested_count || 0),
      accepted:  acc.accepted  + (r.accepted_count  || 0),
    }),
    { suggested: 0, accepted: 0 },
  )

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className={styles.actionsBlockHead}>
        <div>
          <h3 className={styles.actionsBlockTitle}>Actie-catalog</h3>
          <p className={styles.actionsBlockSub}>
            De skill kiest per mail acties uit deze lijst. Acceptance-rate komt
            uit jouw klikken in Postvak (Goedkeuren / Aanpassen / Negeren).{' '}
            <strong>Autopilot</strong> (0 klikken, 24u-undo) kan alléén voor file-acties
            én pas ná ≥{AUTOPILOT_MIN_ACCEPTED} geaccepteerd — earned autonomy.
          </p>
        </div>
        <div className={styles.actionsBlockTotals}>
          <span><strong>{totals.suggested}</strong> voorgesteld</span>
          <span><strong>{totals.accepted}</strong> geaccepteerd</span>
          <span><strong>{pct(totals.accepted, totals.suggested) ?? '—'}%</strong> overall</span>
          <button
            type="button"
            className={`btn btn--accent ${styles.actionsNewBtn}`}
            onClick={() => setNewOpen(true)}
            title="Voeg een eigen actie toe aan de catalog"
          >
            + Nieuwe actie
          </button>
        </div>
      </div>

      <NewActionModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={fetchAll}
      />

      {[...grouped.entries()].map(([category, items]) => (
        items.length > 0 && (
          <section key={category} className={styles.actionsBlockSection}>
            <h4 className={styles.actionsBlockSectionTitle}>{category}</h4>
            <table className={styles.actionsTable}>
              <thead>
                <tr>
                  <th>Slug</th>
                  <th>Naam</th>
                  <th>Target</th>
                  <th>Voorgesteld</th>
                  <th>Geaccepteerd</th>
                  <th>Acceptance</th>
                  <th>Status</th>
                  <th>Autopilot</th>
                </tr>
              </thead>
              <tbody>
                {items.map(act => {
                  const b = statusBadge(act)
                  const ap = autopilotState(act)
                  return (
                    <tr key={act.id} className={!act.enabled ? styles.actionsRowDisabled : undefined}>
                      <td><code>{act.slug}</code></td>
                      <td>{act.display_name}</td>
                      <td className={styles.actionsTableMuted}>
                        {act.target_value || '—'}
                      </td>
                      <td className={styles.actionsTableNumeric}>{act.suggested_count || 0}</td>
                      <td className={styles.actionsTableNumeric}>{act.accepted_count || 0}</td>
                      <td className={styles.actionsTableNumeric}>
                        {pct(act.accepted_count, act.suggested_count) ?? '—'}
                        {pct(act.accepted_count, act.suggested_count) != null && '%'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.actionsToggleBtn} ${b.cls}`}
                          disabled={busyId === act.id}
                          onClick={() => toggleEnabled(act)}
                          title={act.enabled ? 'Klik om uit te zetten' : 'Klik om aan te zetten'}
                        >
                          {busyId === act.id ? '…' : b.text}
                        </button>
                      </td>
                      <td>
                        {ap.kind === 'na' ? (
                          <span className={styles.actionsTableMuted}>—</span>
                        ) : ap.kind === 'locked' ? (
                          <button
                            type="button"
                            className={`${styles.actionsToggleBtn} ${styles.actionStatusOff}`}
                            disabled
                            title={`Autopilot kan pas aan na ≥${AUTOPILOT_MIN_ACCEPTED} geaccepteerd (nu ${ap.accepted}) — earned autonomy`}
                          >
                            🔒 {ap.accepted}/{AUTOPILOT_MIN_ACCEPTED}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`${styles.actionsToggleBtn} ${ap.on ? styles.actionStatusGood : styles.actionStatusIdle}`}
                            disabled={busyId === act.id}
                            onClick={() => toggleAutopilot(act)}
                            title={ap.on ? 'Autopilot AAN — klik om uit te zetten' : 'Autopilot uit — klik om aan te zetten (0 klikken, alleen file.*, 24u-undo)'}
                          >
                            {busyId === act.id ? '…' : (ap.on ? '🤖 aan' : 'uit')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )
      ))}
    </div>
  )
}

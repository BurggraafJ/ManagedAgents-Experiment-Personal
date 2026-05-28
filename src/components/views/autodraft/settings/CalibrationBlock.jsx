import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'

/**
 * CalibrationBlock — AutoDraft v3 kalibratie-stats per (action_slug, tier).
 *
 * Toont:
 *   - per slug + tier: suggested / accepted / amended / rejected / autopilot_done / undo
 *   - acceptance-rate (accept + amend) / suggested
 *   - vier-weken-window default
 *
 * Bedoeld als ondersteuning voor handmatige threshold-tuning. GEEN auto-adjust.
 */
const WINDOW_PRESETS = [
  { id: 7,  label: '7 dagen' },
  { id: 30, label: '30 dagen' },
  { id: 90, label: '90 dagen' },
]

function pct(n) {
  if (n == null) return '—'
  return `${Math.round(Number(n) * 100)}%`
}

function tierBadge(tier) {
  if (tier === 'autopilot') return <span className="cal-tier cal-tier-autopilot">autopilot</span>
  if (tier === 'one-click') return <span className="cal-tier cal-tier-oneclick">one-click</span>
  if (tier === 'reasoned')  return <span className="cal-tier cal-tier-reasoned">reasoned</span>
  return <span className="cal-tier cal-tier-legacy">legacy</span>
}

export default function CalibrationBlock() {
  const [days, setDays] = useState(30)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase.rpc('get_action_calibration_stats', { p_lookback_days: days })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message || String(err))
          setRows([])
        } else {
          setRows(data || [])
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const totals = rows.reduce((acc, r) => {
    acc.sugg += r.suggested || 0
    acc.acc  += r.accepted || 0
    acc.amd  += r.amended || 0
    acc.rej  += r.rejected || 0
    acc.ap   += r.autopilot_done || 0
    acc.undo += r.undo_count || 0
    return acc
  }, { sugg: 0, acc: 0, amd: 0, rej: 0, ap: 0, undo: 0 })

  return (
    <section className="cal-block">
      <header className="cal-head">
        <h3>Kalibratie & acceptance-stats</h3>
        <div className="cal-window">
          {WINDOW_PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`cal-window-btn ${days === p.id ? 'is-active' : ''}`}
              onClick={() => setDays(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <p className="cal-intro">
        Per actie hoe vaak voorgesteld, geaccepteerd, geamendeerd of genegeerd.
        Gebruik dit om te beslissen of je <em>autopilot</em> wilt aanzetten voor een
        slug (verwerkt in <em>Acties</em>-tab) of de confidence-drempels wilt aanpassen.
      </p>

      {error && <div className="cal-error">Fout: {error}</div>}
      {loading ? (
        <div className="cal-loading">Statistieken laden…</div>
      ) : rows.length === 0 ? (
        <div className="cal-empty">
          Nog geen beslissingen in dit window. Verwerk een aantal mails en kom terug.
        </div>
      ) : (
        <>
          <div className="cal-summary">
            <div><strong>{totals.sugg}</strong><span>voorgesteld</span></div>
            <div><strong>{totals.acc + totals.amd}</strong><span>geaccepteerd of geamendeerd</span></div>
            <div><strong>{totals.rej}</strong><span>genegeerd</span></div>
            <div><strong>{totals.ap}</strong><span>autopilot uitgevoerd</span></div>
            {totals.undo > 0 && (
              <div className="cal-summary-warn"><strong>{totals.undo}</strong><span>undo</span></div>
            )}
          </div>

          <table className="cal-table">
            <thead>
              <tr>
                <th>Actie</th>
                <th>Tier</th>
                <th className="cal-num">Voorgesteld</th>
                <th className="cal-num">Geaccepteerd</th>
                <th className="cal-num">Geamendeerd</th>
                <th className="cal-num">Genegeerd</th>
                <th className="cal-num">Autopilot</th>
                <th className="cal-num">Undo</th>
                <th className="cal-num">Accept-rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.action_slug}-${r.tier || 'null'}-${i}`}>
                  <td>
                    <div className="cal-slug">{r.display_name || r.action_slug}</div>
                    <div className="cal-slug-mono">{r.action_slug}</div>
                  </td>
                  <td>{tierBadge(r.tier)}</td>
                  <td className="cal-num">{r.suggested || 0}</td>
                  <td className="cal-num">{r.accepted || 0}</td>
                  <td className="cal-num">{r.amended || 0}</td>
                  <td className="cal-num">{r.rejected || 0}</td>
                  <td className="cal-num">{r.autopilot_done || 0}</td>
                  <td className="cal-num">{r.undo_count || 0}</td>
                  <td className="cal-num cal-rate">{pct(r.acceptance_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

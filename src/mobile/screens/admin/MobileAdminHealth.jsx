import { useEffect, useMemo, useState } from 'react'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { tone, summarize, sortBySeverity, TIER_LABELS, TIER_ORDER } from '../../../lib/agentHealth'
import { relativeTime } from '../../../lib/dateFormat'
import MIcon from '../../MIcon'
import { MSetHead } from '../MobileSettingsBits'

// Health (niveau 2) — dezelfde bron en drempels als de desktop HealthView
// (agent_runs_health_7d, lib/agentHealth), als lijst met kleur-dot en
// percentage-pill. Auto-refresh 60s.
const TIER_SHORT = { primary: 'Primary', secondary: 'Secondary', source: 'Source', infra: 'Infra' }

export default function MobileAdminHealth({ onBack }) {
  const [filter, setFilter] = useState('all')
  const { data: rows, loading, error, refresh } = useSupabaseQuery('agent_runs_health_7d', { initialData: null })

  useEffect(() => {
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [refresh])

  const summary = useMemo(() => rows ? summarize(rows) : null, [rows])
  const tiers = useMemo(() => TIER_ORDER.filter(t => (rows || []).some(r => r.tier === t)), [rows])
  const list = useMemo(() => {
    if (!rows) return []
    let l = rows
    if (filter === 'attention') l = rows.filter(r => ['error', 'warning'].includes(tone(r.success_pct === null ? null : Number(r.success_pct), r.runs_total)))
    else if (filter !== 'all') l = rows.filter(r => r.tier === filter)
    return sortBySeverity(l)
  }, [rows, filter])

  return (
    <div className="m-dash m-set m-ap">
      <MSetHead back={onBack} backLabel="Organisatie" title="Health" sub="Welke agent is ziek. Run-success over 7 dagen."
        meta={summary && (
          <>
            <b>{summary.ok}</b> van {summary.total} gezond
            {' · '}<span className={summary.critical + summary.warning > 0 ? 'is-warn' : ''}>{summary.critical + summary.warning} aandacht</span>
            {' · '}{summary.idle} stil
          </>
        )}
        titleRight={<button type="button" className="m-ap-refresh" onClick={refresh} disabled={loading} aria-label="Ververs"><MIcon name="refresh" size={17} /></button>} />
      <div className="m-set__body">
        {error && <div className="m-set__errline">⚠ Kon agent_runs_health_7d niet laden: {error}</div>}
        {!error && !rows && <div className="m-set__empty">Laden…</div>}

        {rows && (
          <div className="m-ap-chips">
            <Chip on={filter === 'all'} onClick={() => setFilter('all')}>Alle {rows.length}</Chip>
            <Chip on={filter === 'attention'} onClick={() => setFilter('attention')}>Alleen aandacht</Chip>
            {tiers.map(t => <Chip key={t} on={filter === t} onClick={() => setFilter(t)}>{TIER_SHORT[t] || TIER_LABELS[t] || t}</Chip>)}
          </div>
        )}

        {rows && (
          <div className="m-inset">
            {list.length === 0 && <div className="m-set__empty">Geen agents in deze filter.</div>}
            {list.map(r => <HealthRow key={r.agent_name} row={r} />)}
          </div>
        )}

        <p className="m-set__note"><MIcon name="activity" size={18} /><span>Bron agent_runs_health_7d · ≥95% groen · 80–95% geel · &lt;80% rood. Agent-overzicht staat op desktop onder Health.</span></p>
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button type="button" className={`m-ap-chip ${on ? 'is-active' : ''}`} onClick={onClick}>{children}</button>
}

function HealthRow({ row: r }) {
  const pct = r.success_pct === null ? null : Number(r.success_pct)
  const t = tone(pct, r.runs_total)
  const status = t === 'idle' ? 'stil' : t === 'success' ? 'gezond' : `${r.err_count ?? 0} van ${r.runs_total ?? 0} mislukt`
  return (
    <div className={`m-inset__row m-ap-row m-ap-row--${t}`}>
      <span className={`m-ap-dot m-ap-dot--${t}`} aria-hidden />
      <span className="m-ap-row__main">
        <span className="m-ap-row__title">{r.display_name || r.agent_name}{!r.enabled && <span className="m-ap-pill">uit</span>}</span>
        <span className="m-ap-row__sub">{r.agent_name} · {status} · laatste run {relativeTime(r.last_run_at) || '—'}</span>
      </span>
      <span className={`m-ap-pct m-ap-pct--${t}`}>{pct === null ? '—' : `${pct}%`}</span>
    </div>
  )
}

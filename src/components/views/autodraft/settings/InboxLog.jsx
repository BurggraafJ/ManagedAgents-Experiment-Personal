import { useState, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { formatDateTime, NL_WEEKDAYS } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

export default function InboxLog({ mails, decisions, alwaysOpen }) {
  // Default-filter 'verwerkt' = alleen echte verwerkings-acties (send/ignore/amend/
  // spam). Pin/flag-acties zijn UI-toggle, niet relevant voor traceability.
  const [filter, setFilter] = useState('processed')
  const [query, setQuery] = useState('')
  const [range, setRange] = useState('week')

  const mailById = useMemo(() => {
    const m = new Map()
    for (const x of mails) m.set(x.mail_id, x)
    return m
  }, [mails])

  const rangeStart = useMemo(() => {
    const d = new Date()
    if (range === 'today') { d.setHours(0,0,0,0); return d.getTime() }
    if (range === 'week')  { d.setDate(d.getDate() - 7); return d.getTime() }
    if (range === 'month') { d.setDate(d.getDate() - 30); return d.getTime() }
    return 0
  }, [range])

  const PROCESSED_ACTIONS = new Set(['send', 'ignore', 'amend', 'spam'])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return decisions
      .filter(d => {
        if (filter === 'all') return true
        if (filter === 'processed') return PROCESSED_ACTIONS.has(d.action)
        return d.action === filter
      })
      .filter(d => new Date(d.decided_at).getTime() >= rangeStart)
      .filter(d => {
        if (!q) return true
        const m = mailById.get(d.mail_id)
        return (m?.subject || '').toLowerCase().includes(q)
            || (m?.from_email || '').toLowerCase().includes(q)
      })
      .sort((a, b) => new Date(b.decided_at) - new Date(a.decided_at))
      .slice(0, 300)
  }, [decisions, filter, query, rangeStart, mailById])

  const counts = useMemo(() => {
    const c = { all: 0, processed: 0, send: 0, ignore: 0, amend: 0, spam: 0 }
    for (const d of decisions) {
      if (new Date(d.decided_at).getTime() < rangeStart) continue
      c.all++
      if (PROCESSED_ACTIONS.has(d.action)) c.processed++
      if (c[d.action] != null) c[d.action]++
    }
    return c
  }, [decisions, rangeStart])

  const byDay = useMemo(() => {
    const groups = new Map()
    for (const r of rows) {
      const d = new Date(r.decided_at)
      const key = d.toISOString().slice(0, 10)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(r)
    }
    return Array.from(groups.entries())
  }, [rows])

  function dayLabel(iso) {
    const today = new Date(); today.setHours(0,0,0,0)
    const date = new Date(iso); date.setHours(0,0,0,0)
    const ageDays = Math.round((today - date) / 86400000)
    if (ageDays === 0) return 'Vandaag'
    if (ageDays === 1) return 'Gisteren'
    if (ageDays <= 6) {
      const wd = NL_WEEKDAYS[date.getDay()]
      return wd.charAt(0).toUpperCase() + wd.slice(1)
    }
    return date.toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' })
  }

  const filterPill = (id, label, n) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className={`${styles.filterPill} ${filter === id ? styles.filterPillActive : ''}`}
    >
      {label} {n != null && <span className={styles.filterPillCount}>{n}</span>}
    </button>
  )

  return (
    <section className={styles.logSection}>
      <div className={styles.logHeaderStrip}>
        <h2 className={styles.logTitle}>📜 Logboek</h2>
        <p className={styles.logIntro}>
          Elke verwerkingsactie op je postvak — wat de agent of jij hebt gedaan met welke mail. Klik op een rij voor details en optioneel ongedaan maken.
        </p>
      </div>

      <VariantStats decisions={decisions} mailById={mailById} rangeStart={rangeStart} />

      <div className={styles.filterBar}>
        {filterPill('processed', 'Verwerkt door agent', counts.processed)}
        {filterPill('send',      '✓ Concept geplaatst', counts.send)}
        {filterPill('ignore',    '📂 Afgehandeld',      counts.ignore)}
        {filterPill('amend',     '✎ Aangepast',         counts.amend)}
        {filterPill('spam',      '⛔ Spam',              counts.spam)}
        {filterPill('all',       'Alle',                counts.all)}
        <span className={styles.filterDivider} />
        {['today', 'week', 'month', 'all'].map(r => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`${styles.filterPill} ${range === r ? styles.filterPillActive : ''}`}
          >
            {({ today: 'Vandaag', week: 'Week', month: 'Maand', all: 'Alles' })[r]}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Zoek op afzender of onderwerp"
          className={styles.filterSearch}
        />
      </div>

      {byDay.length === 0 ? (
        <div className={styles.logEmpty}>
          Geen acties in deze periode/filter.
        </div>
      ) : (
        <div className={styles.dayGroups}>
          {byDay.map(([dayKey, dayRows]) => (
            <div key={dayKey}>
              <div className={styles.dayHeader}>
                <span>{dayLabel(dayKey)}</span>
                <span className={styles.dayCount}>
                  {dayRows.length} {dayRows.length === 1 ? 'actie' : 'acties'}
                </span>
              </div>
              <div className={styles.dayRows}>
                {dayRows.map(d => {
                  const m = mailById.get(d.mail_id)
                  return <LogRow key={d.id} mail={m} decision={d} />
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// VariantStats — F.1.f.3 (sinds 2026-05-05) — meet welke draft-variant
// het vaakst gebruikt wordt per categorie.
function VariantStats({ decisions, mailById, rangeStart }) {
  const stats = useMemo(() => {
    const byCat = new Map()
    let totalAccepted = 0
    let totalAmended = 0
    for (const d of decisions) {
      if (new Date(d.decided_at).getTime() < rangeStart) continue
      if (!d.chosen_variant_label) continue
      const m = mailById.get(d.mail_id)
      const cat = m?.category_key || 'onbekend'
      if (d.action === 'send') {
        totalAccepted++
        if (!byCat.has(cat)) byCat.set(cat, new Map())
        const labelMap = byCat.get(cat)
        labelMap.set(d.chosen_variant_label, (labelMap.get(d.chosen_variant_label) || 0) + 1)
      } else if (d.action === 'amend') {
        totalAmended++
      }
    }
    const rows = Array.from(byCat.entries())
      .map(([cat, labelMap]) => {
        const total = Array.from(labelMap.values()).reduce((a, b) => a + b, 0)
        const variants = Array.from(labelMap.entries())
          .map(([label, n]) => ({ label, n, pct: total > 0 ? Math.round(100 * n / total) : 0 }))
          .sort((a, b) => b.n - a.n)
        return { cat, total, variants }
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
    return { rows, totalAccepted, totalAmended }
  }, [decisions, mailById, rangeStart])

  if (stats.totalAccepted === 0) return null

  const VARIANT_COLOR = {
    'Kort & direct':       '#3b82f6',
    'Warm & uitgebreid':   '#8b5cf6',
    'Formeel':             '#0ea5e9',
    'Informeel':           '#f59e0b',
    'Afgerond':            '#10b981',
    'Het is gebeurd':      '#10b981',
  }
  const colorFor = (label) => VARIANT_COLOR[label] || 'var(--text-muted)'

  return (
    <div className={styles.variantStatsBox}>
      <div className={styles.variantStatsHead}>
        <h3 className={styles.variantStatsTitle}>Variant-keuze per categorie</h3>
        <span className={styles.variantStatsMeta}>
          {stats.totalAccepted} accepted · {stats.totalAmended} amended (deze periode)
        </span>
      </div>
      <div className={styles.variantStatsBody}>
        {stats.rows.map(row => (
          <div key={row.cat} className={styles.variantStatsRow}>
            <span className={styles.variantStatsLabel}>{row.cat}</span>
            <div className={styles.variantStatsBar}>
              {row.variants.map(v => (
                <div
                  key={v.label}
                  title={`${v.label}: ${v.n} (${v.pct}%)`}
                  className={styles.variantBarSegment}
                  style={{ width: `${v.pct}%`, background: colorFor(v.label) }}
                >
                  {v.pct >= 18 && <span className={styles.variantBarPct}>{v.pct}%</span>}
                </div>
              ))}
            </div>
            <span className={styles.variantStatsTotal}>{row.total}</span>
          </div>
        ))}
      </div>
      <div className={styles.variantStatsLegend}>
        {Array.from(new Set(stats.rows.flatMap(r => r.variants.map(v => v.label)))).map(label => (
          <span key={label} className={styles.variantStatsLegendItem}>
            <span className={styles.variantStatsLegendSwatch} style={{ background: colorFor(label) }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function LogRow({ mail, decision }) {
  const [open, setOpen] = useState(false)
  const ACTION_INFO = {
    send:   { icon: '✓', label: 'Concept geplaatst in Outlook', tone: '#22c55e', who: 'Agent' },
    ignore: { icon: '📂', label: 'Verplaatst naar', tone: '#3b82f6', who: 'Agent' },
    amend:  { icon: '✎', label: 'Draft herschreven op feedback', tone: '#a855f7', who: 'Agent' },
    spam:   { icon: '⛔', label: 'Naar Junk verplaatst', tone: '#dc2626', who: 'Agent' },
    flag:   { icon: '★', label: 'Vlag aangezet', tone: '#f59e0b', who: 'Jij' },
    unflag: { icon: '☆', label: 'Vlag uit', tone: '#94a3b8', who: 'Jij' },
  }
  const info = ACTION_INFO[decision.action] || { icon: '·', label: decision.action, tone: '#94a3b8', who: '—' }
  const subject = mail?.subject || decision.final_subject || '(geen onderwerp)'
  const sender = mail?.from_email || ''
  const isFailed = decision.execution_status === 'failed'
  const isReverted = decision.execution_status === 'reverted'
  const isAlreadyDone = decision.target_folder === '__already_done__'

  return (
    <div
      className={styles.logRow}
      style={{
        borderLeft: `3px solid ${isFailed ? '#dc2626' : isReverted ? '#94a3b8' : info.tone}`,
        opacity: isReverted ? 0.6 : 1,
      }}
    >
      <button type="button" onClick={() => setOpen(v => !v)} className={styles.logRowBtn}>
        <span className={styles.logRowIcon} style={{ color: info.tone }}>{info.icon}</span>
        <div className={styles.logRowBody}>
          <div className={styles.logRowAction}>
            {info.label}
            {decision.action === 'ignore' && decision.target_folder && !isAlreadyDone && (
              <span className={styles.logRowFolderHint}> {decision.target_folder}</span>
            )}
            {isAlreadyDone && (
              <span className={styles.logRowFolderHint}> (al elders verwerkt)</span>
            )}
            {isFailed && <span className={styles.failedTag}>⚠ faalde</span>}
            {isReverted && <span className={styles.revertedTag}>↺ ongedaan</span>}
          </div>
          <div className={styles.logRowSubject}>
            <strong className={styles.logExpandTitle}>{subject}</strong>
            {sender && <> · {sender}</>}
          </div>
        </div>
        <div className={styles.logRowMeta}>
          <span className={styles.logRowTime}>
            {new Date(decision.decided_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className={styles.logRowWho}>{info.who}</span>
        </div>
      </button>
      {open && (
        <div className={styles.logRowExpand}>
          {decision.amend_instructions && (
            <div>
              <strong className={styles.logExpandTitle}>Jouw feedback:</strong> <em>{decision.amend_instructions}</em>
            </div>
          )}
          {decision.execution_error && <div className={styles.logExpandError}>⚠ {decision.execution_error}</div>}
          {decision.executed_at && <div>Uitgevoerd om {formatDateTime(decision.executed_at)}</div>}
          <div>Decision-id: <code className={styles.logExpandCode}>{decision.id}</code></div>
          {!isReverted && <RevertButton decision={decision} />}
        </div>
      )}
    </div>
  )
}

function RevertButton({ decision }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState(null)
  async function revert() {
    if (busy || done) return
    if (!confirm('Beslissing ongedaan maken? Mail keert terug in postvak.')) return
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('revert_autodraft_decision', { p_decision_id: decision.id })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else setDone(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  if (done) return <div className={styles.revertDone}>✓ Hersteld — mail terug in postvak</div>
  return (
    <div className={styles.revertWrap}>
      <button type="button" onClick={revert} disabled={busy} className={styles.revertBtn}>
        ↺ {busy ? 'Bezig…' : 'Maak ongedaan'}
      </button>
      {err && <span className={styles.revertErr}>⚠ {err}</span>}
    </div>
  )
}

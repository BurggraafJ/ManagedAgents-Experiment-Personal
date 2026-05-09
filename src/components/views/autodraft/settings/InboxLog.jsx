import { useState, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { formatDateTime, NL_WEEKDAYS } from '../../../../lib/autodraft'

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

  // Groepeer per dag voor visuele clustering
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
    <button key={id} type="button" onClick={() => setFilter(id)}
      style={{
        padding: '6px 14px', borderRadius: 999,
        border: '1px solid var(--border)',
        background: filter === id ? 'var(--accent-soft)' : 'var(--bg)',
        color: filter === id ? 'var(--accent)' : 'var(--text)',
        fontFamily: 'inherit', fontSize: 13, fontWeight: filter === id ? 600 : 400,
        cursor: 'pointer',
      }}>{label} {n != null && <span style={{ opacity: 0.6, marginLeft: 4 }}>{n}</span>}</button>
  )

  return (
    <section style={{ background: 'var(--bg)' }}>
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0, letterSpacing: '-0.01em' }}>
          📜 Logboek
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
          Elke verwerkingsactie op je postvak — wat de agent of jij hebt gedaan met welke mail. Klik op een rij voor details en optioneel ongedaan maken.
        </p>
      </div>

      {/* F.1.f.3 — variant-stats per categorie */}
      <VariantStats decisions={decisions} mailById={mailById} rangeStart={rangeStart} />

      {/* Filter-bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {filterPill('processed', 'Verwerkt door agent', counts.processed)}
        {filterPill('send',      '✓ Concept geplaatst', counts.send)}
        {filterPill('ignore',    '📂 Afgehandeld',      counts.ignore)}
        {filterPill('amend',     '✎ Aangepast',         counts.amend)}
        {filterPill('spam',      '⛔ Spam',              counts.spam)}
        {filterPill('all',       'Alle',                counts.all)}
        <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 6px' }} />
        {['today', 'week', 'month', 'all'].map(r => (
          <button key={r} type="button" onClick={() => setRange(r)}
            style={{
              padding: '6px 14px', borderRadius: 999,
              border: '1px solid var(--border)',
              background: range === r ? 'var(--accent-soft)' : 'var(--bg)',
              color: range === r ? 'var(--accent)' : 'var(--text)',
              fontFamily: 'inherit', fontSize: 13, fontWeight: range === r ? 600 : 400,
              cursor: 'pointer',
            }}>{({ today: 'Vandaag', week: 'Week', month: 'Maand', all: 'Alles' })[r]}</button>
        ))}
        <input type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Zoek op afzender of onderwerp"
          style={{
            flex: 1, minWidth: 220, marginLeft: 'auto',
            padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'inherit', fontSize: 13,
          }} />
      </div>

      {byDay.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', fontSize: 14, color: 'var(--text-muted)', background: 'var(--surface-1)', borderRadius: 8 }}>
          Geen acties in deze periode/filter.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {byDay.map(([dayKey, dayRows]) => (
            <div key={dayKey}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                fontSize: 13, fontWeight: 600, color: 'var(--text)',
                marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)',
              }}>
                <span>{dayLabel(dayKey)}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400 }}>
                  {dayRows.length} {dayRows.length === 1 ? 'actie' : 'acties'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
// het vaakst gebruikt wordt per categorie. Client-side aggregatie uit de
// decisions-prop (chosen_variant_label is sinds F.1.b in autodraft_decisions).
//
// Doel voor Jelle: zien welke schrijfstijl ("Kort & direct" / "Warm & uitgebreid"
// / "Afgerond") hij het vaakst kiest per mail-categorie, om te kunnen iteraten
// op categorie-instructies en eventueel categorieën te splitsen.
function VariantStats({ decisions, mailById, rangeStart }) {
  const stats = useMemo(() => {
    // Tellen per categorie+variant_label, alleen send (= geaccepteerd) decisions
    // sinds rangeStart, met chosen_variant_label gevuld (post-F.1.b).
    const byCat = new Map()  // category_key → Map<label, count>
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
    // Sorteer categorieën op total-send desc, top 5
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

  if (stats.totalAccepted === 0) {
    return null  // geen data nog — laat blok weg
  }

  // Kleur per variant-label (vaste mapping zodat zelfde variant altijd zelfde tint heeft)
  const VARIANT_COLOR = {
    'Kort & direct':       '#3b82f6',  // blauw
    'Warm & uitgebreid':   '#8b5cf6',  // paars
    'Formeel':             '#0ea5e9',  // cyaan
    'Informeel':           '#f59e0b',  // oranje
    'Afgerond':            '#10b981',  // groen
    'Het is gebeurd':      '#10b981',
  }
  const colorFor = (label) => VARIANT_COLOR[label] || 'var(--text-muted)'

  return (
    <div style={{
      marginBottom: 16, padding: '12px 14px',
      background: 'var(--surface-1)', borderRadius: 8,
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          Variant-keuze per categorie
        </h3>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {stats.totalAccepted} accepted · {stats.totalAmended} amended (deze periode)
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stats.rows.map(row => (
          <div key={row.cat} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ width: 160, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.cat}
            </span>
            <div style={{ flex: 1, display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', background: 'var(--bg)' }}>
              {row.variants.map(v => (
                <div key={v.label} title={`${v.label}: ${v.n} (${v.pct}%)`}
                  style={{ width: `${v.pct}%`, background: colorFor(v.label), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {v.pct >= 18 && (
                    <span style={{ fontSize: 10, color: 'white', fontWeight: 600, lineHeight: 1 }}>
                      {v.pct}%
                    </span>
                  )}
                </div>
              ))}
            </div>
            <span style={{ width: 32, textAlign: 'right', color: 'var(--text-muted)' }}>
              {row.total}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
        {Array.from(new Set(stats.rows.flatMap(r => r.variants.map(v => v.label)))).map(label => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(label) }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// LogRow — grotere log-regel met nadruk op WIE (agent/jij) en WAT (verwerking).
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
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${isFailed ? '#dc2626' : isReverted ? '#94a3b8' : info.tone}`,
      borderRadius: 6,
      background: 'var(--bg)',
      overflow: 'hidden',
      opacity: isReverted ? 0.6 : 1,
    }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
          padding: '10px 14px',
          border: 'none', background: 'transparent',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          color: 'var(--text)',
        }}>
        <span style={{ fontSize: 16, color: info.tone, flexShrink: 0 }}>{info.icon}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {info.label}
            {decision.action === 'ignore' && decision.target_folder && !isAlreadyDone && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> {decision.target_folder}</span>
            )}
            {isAlreadyDone && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> (al elders verwerkt)</span>
            )}
            {isFailed && <span style={{ color: '#dc2626', marginLeft: 6, fontSize: 11 }}>⚠ faalde</span>}
            {isReverted && <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>↺ ongedaan</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'var(--text)' }}>{subject}</strong>
            {sender && <> · {sender}</>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {new Date(decision.decided_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)', fontWeight: 500 }}>
            {info.who}
          </span>
        </div>
      </button>
      {open && (
        <div style={{ padding: '4px 14px 12px 32px', fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 4, borderTop: '1px solid var(--border)' }}>
          {decision.amend_instructions && <div><strong style={{ color: 'var(--text)' }}>Jouw feedback:</strong> <em>{decision.amend_instructions}</em></div>}
          {decision.execution_error && <div style={{ color: 'var(--error)' }}>⚠ {decision.execution_error}</div>}
          {decision.executed_at && <div>Uitgevoerd om {formatDateTime(decision.executed_at)}</div>}
          <div>Decision-id: <code style={{ fontSize: 10.5 }}>{decision.id}</code></div>
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
  if (done) return <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>✓ Hersteld — mail terug in postvak</div>
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" onClick={revert} disabled={busy}
        style={{
          padding: '4px 10px', fontSize: 11, borderRadius: 4,
          border: '1px solid var(--border)',
          background: 'var(--bg)', color: 'var(--text)',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        ↺ {busy ? 'Bezig…' : 'Maak ongedaan'}
      </button>
      {err && <span style={{ color: 'var(--error)', fontSize: 11, marginLeft: 8 }}>⚠ {err}</span>}
    </div>
  )
}

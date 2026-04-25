import { useState, useMemo, useEffect, useCallback, useRef, Component } from 'react'
import { supabase } from '../../lib/supabase'

// Mini-ErrorBoundary alleen voor MailDetail zodat een crash in één mail
// de rest van de inbox niet sloopt.
class DetailErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[autodraft detail crash]', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty empty--compact" style={{ padding: 24, color: 'var(--error)', textAlign: 'left' }}>
        <strong>⚠ Render-fout in deze mail</strong>
        <pre style={{ fontSize: 10, marginTop: 8, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 200 }}>
          {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
        </pre>
        <button className="btn btn--ghost" style={{ marginTop: 12 }} onClick={() => this.setState({ error: null })}>
          Probeer opnieuw
        </button>
      </div>
    )
  }
}

const AGENT = 'auto-draft'

// AutoDraftView v5 — volwaardig mail-postvak.
//
// Wat werkt nu:
//   - Lijst met álle ongelezen mails gegroepeerd op Vandaag / Gisteren / Week / Ouder.
//   - Filter-chips: Alles / Drafts / Skip-voorstel / Onbekend.
//   - Zoeken op afzender + onderwerp.
//   - Keyboard-navigatie: J/K of ↑/↓ door de lijst, Enter/Space opent,
//                        S=Verstuur, I=Negeer, A=Aanpassen.
//   - Scan-nu-knop triggert auto-draft direct (via RPC → orchestrator).
//   - Demo-banner wanneer alle mails seed-data zijn (mail_id begint met 'demo-').
//   - Inline draft-editor met directe Verzend / Negeer / Amend.
//   - Per-mail "Reset naar pending" als iets vast zit in de queue.
//   - Categorie-chips met zelflerende kleur.
//   - Lesson-voorstellen blok — learn-skill stelt regel voor, jij accepteert.
//   - Categorie-voorstellen blok (al langer).
//   - Logboek en geleerde regels onderaan.

export default function AutoDraftView({ data }) {
  const mails            = data.autodraftMails       || []
  const categories       = useMemo(() =>
    (data.autodraftCategories || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [data.autodraftCategories])
  const categoryProps    = data.autodraftCategoryProposals || []
  const lessonProps      = data.autodraftLessonProposals   || []
  const decisions        = data.autodraftDecisions         || []
  const folders          = data.autodraftFolders           || []
  const lessons          = data.autodraftLessons           || []

  // Telling per conversation_id voor thread-badges in lijst
  const threadCounts = useMemo(() => {
    const m = new Map()
    for (const x of mails) {
      if (!x.conversation_id) continue
      m.set(x.conversation_id, (m.get(x.conversation_id) || 0) + 1)
    }
    return m
  }, [mails])

  // Laatste run-info
  const latestScanRun = useMemo(() =>
    (data.recentRuns || []).find(r => r.agent_name === AGENT) || null,
    [data.recentRuns])
  const latestExecuteRun = useMemo(() =>
    (data.recentRuns || []).find(r => r.agent_name === 'auto-draft-execute') || null,
    [data.recentRuns])

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <TopStats
        mails={mails}
        decisions={decisions}
        latestScanRun={latestScanRun}
        latestExecuteRun={latestExecuteRun}
      />

      <InboxPanel
        mails={mails}
        categories={categories}
        folders={folders}
        lessons={lessons}
        threadCounts={threadCounts}
      />

      {(categoryProps.length > 0 || lessonProps.length > 0) && (
        <div className="ad-proposals-row">
          {categoryProps.length > 0 && <CategoryProposalsBlock proposals={categoryProps} />}
          {lessonProps.length   > 0 && <LessonProposalsBlock   proposals={lessonProps} categories={categories} />}
        </div>
      )}

      <CategoriesBlock categories={categories} folders={folders} />
      <InboxLog mails={mails} decisions={decisions} />
      <LessonsBlock lessons={lessons} categories={categories} />
      <SystemInstructionsBlock data={data} />
      <DebugBlock data={data} />
    </div>
  )
}

// =====================================================================
// INBOX PANEL — lijst + detail + demo-banner + zoek + filters + keyboard
// =====================================================================

const FILTER_PRESETS = [
  { id: 'all',   label: 'Alles',          match: () => true },
  { id: 'draft', label: '✎ Draft klaar',  match: m => m.suggested_action === 'draft' },
  { id: 'skip',  label: '🗂 Negeer-voorstel', match: m => m.suggested_action === 'skip' },
  { id: 'flag',  label: '⚠ Vlaggen',      match: m => m.suggested_action === 'flag' },
]

function TopStats({ mails, decisions, latestScanRun, latestExecuteRun }) {
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])
  const pending  = mails.filter(m => m.status === 'pending' || m.status === 'amended').length
  const queued   = mails.filter(m => String(m.status).startsWith('queued_')).length
  const todaySent = decisions.filter(d => d.action === 'send' && d.executed_at && new Date(d.executed_at) >= todayStart).length
  const failed   = decisions.filter(d => d.execution_status === 'failed').length

  const scanAgo = latestScanRun ? formatRelative(latestScanRun.started_at) : 'nog nooit'
  const scanMode = latestScanRun?.stats?.mode || 'scan'
  const scanFailed = latestScanRun?.status === 'error'

  return (
    <div className="ad-topstats">
      <Stat label="Wacht op jou"        value={pending} tone={pending > 10 ? 'warn' : 'accent'} />
      <Stat label="In wachtrij"         value={queued}  tone="muted" />
      <Stat label="Verstuurd vandaag"   value={todaySent} tone="success" />
      <Stat label={`Laatste scan (${scanMode})`} value={scanAgo} tone={scanFailed ? 'error' : 'muted'} smallValue />
      {failed > 0 && <Stat label="Gefaalde acties" value={failed} tone="error" />}
    </div>
  )
}

function Stat({ label, value, tone, smallValue }) {
  const color = tone === 'accent'  ? 'var(--accent)'
              : tone === 'success' ? 'var(--success)'
              : tone === 'warn'    ? 'var(--warning, #f59e0b)'
              : tone === 'error'   ? 'var(--error)'
              : 'var(--text)'
  return (
    <div className="ad-stat">
      <div className="ad-stat__value" style={{ color, fontSize: smallValue ? 14 : 22 }}>{value}</div>
      <div className="ad-stat__label">{label}</div>
    </div>
  )
}

function InboxPanel({ mails, categories, folders, lessons, threadCounts }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery]   = useState('')
  const [scanBusy, setScanBusy] = useState(false)
  const [scanMsg, setScanMsg]   = useState(null)

  const pending = useMemo(() => mails.filter(m => m.status === 'pending' || m.status === 'amended'), [mails])

  const filtered = useMemo(() => {
    const preset = FILTER_PRESETS.find(f => f.id === filter) || FILTER_PRESETS[0]
    const q = query.trim().toLowerCase()
    return pending.filter(m => {
      if (!preset.match(m)) return false
      if (!q) return true
      return (m.subject || '').toLowerCase().includes(q) ||
             (m.from_email || '').toLowerCase().includes(q) ||
             (m.from_name  || '').toLowerCase().includes(q)
    })
  }, [pending, filter, query])

  const buckets = useMemo(() => groupByAge(filtered), [filtered])
  const flat    = useMemo(() => [
    ...buckets.today, ...buckets.yesterday, ...buckets.week, ...buckets.older,
  ], [buckets])

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && flat.length > 0) setSelectedId(flat[0].mail_id)
    else if (selectedId && !flat.find(m => m.mail_id === selectedId)) setSelectedId(flat[0]?.mail_id || null)
  }, [flat, selectedId])
  const selected = flat.find(m => m.mail_id === selectedId) || null

  // Demo-data detectie — als >50% mails begint met 'demo-', tonen we banner
  const demoCount = mails.filter(m => String(m.mail_id).startsWith('demo-')).length
  const isDemo = mails.length > 0 && demoCount / mails.length > 0.5

  // Keyboard navigatie
  const rootRef = useRef(null)
  useEffect(() => {
    function onKey(e) {
      // Alleen ingrijpen als focus niet in textarea/input zit
      const tag = document.activeElement?.tagName
      if (['TEXTAREA','INPUT','SELECT'].includes(tag)) return
      if (!selected) return
      const idx = flat.findIndex(m => m.mail_id === selected.mail_id)
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        const next = flat[Math.min(flat.length - 1, idx + 1)]
        if (next) setSelectedId(next.mail_id)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = flat[Math.max(0, idx - 1)]
        if (prev) setSelectedId(prev.mail_id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flat, selected])

  async function onScan() {
    if (scanBusy) return
    setScanBusy(true); setScanMsg(null)
    try {
      const { data, error } = await supabase.rpc('trigger_autodraft_scan')
      if (error) setScanMsg({ err: error.message })
      else if (data && data.ok === false) setScanMsg({ err: data.reason })
      else setScanMsg({ ok: 'Scan aangevraagd — orchestrator pikt binnen 10 min op' })
    } catch (e) { setScanMsg({ err: e.message }) }
    setTimeout(() => setScanMsg(null), 6000)
    setScanBusy(false)
  }

  // Bulk-skip: alleen actief bij filter='skip' of als er meer dan 1 skip-voorstel is
  const skipMails = useMemo(() => pending.filter(m => m.suggested_action === 'skip'), [pending])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg]   = useState(null)
  async function bulkSkipAll() {
    if (bulkBusy || skipMails.length === 0) return
    if (!confirm(`Alle ${skipMails.length} mails met negeer-voorstel archiveren?`)) return
    setBulkBusy(true); setBulkMsg(null)
    try {
      const ids = skipMails.map(m => m.mail_id)
      const { data, error } = await supabase.rpc('bulk_skip_autodraft_mails', {
        p_mail_ids: ids, p_target_folder: null,
      })
      if (error) setBulkMsg({ err: error.message })
      else if (data && data.ok === false) setBulkMsg({ err: data.reason })
      else setBulkMsg({ ok: `${data.queued} mails in wachtrij` })
    } catch (e) { setBulkMsg({ err: e.message }) }
    setTimeout(() => setBulkMsg(null), 6000)
    setBulkBusy(false)
  }

  return (
    <section ref={rootRef}>
      {isDemo && (
        <div className="ad-demo-banner">
          🧪 <strong>Demo-data</strong> — deze mails zijn testgegevens (niet uit je Outlook).
          Klik <strong>Scan nu</strong> hierboven om de auto-draft skill echt te laten draaien op je inbox.
        </div>
      )}

      <div className="ad-inbox-head">
        <h2 className="section__title" style={{ margin: 0 }}>
          Postvak <span className="section__count">{pending.length}</span>
        </h2>

        <div className="ad-filter-chips">
          {FILTER_PRESETS.map(p => {
            const n = pending.filter(m => p.match(m)).length
            return (
              <button key={p.id} type="button"
                className={`cat-filter__chip ${filter === p.id ? 'is-on' : 'is-off'}`}
                onClick={() => setFilter(p.id)}>
                {p.label} <span className="cat-filter__count">{n}</span>
              </button>
            )
          })}
        </div>

        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="🔍 afzender of onderwerp…"
          className="ad-search"
        />

        <button
          type="button"
          className="btn btn--ghost ad-scan-btn"
          disabled={scanBusy}
          onClick={onScan}
          title="Trigger auto-draft skill direct"
        >
          {scanBusy ? 'Wordt aangevraagd…' : '↻ Scan nu'}
        </button>
        {scanMsg?.ok && <span style={{ color: 'var(--success)', fontSize: 11, marginLeft: 6 }}>✓ {scanMsg.ok}</span>}
        {scanMsg?.err && <span style={{ color: 'var(--error)',  fontSize: 11, marginLeft: 6 }}>⚠ {scanMsg.err}</span>}

        {skipMails.length >= 2 && (
          <button type="button" className="btn btn--ghost ad-bulk-btn"
            disabled={bulkBusy}
            onClick={bulkSkipAll}
            title={`Archiveer alle ${skipMails.length} mails met negeer-voorstel`}>
            {bulkBusy ? 'Bezig…' : `🗂️ Archiveer alle ${skipMails.length}`}
          </button>
        )}
        {bulkMsg?.ok  && <span style={{ color: 'var(--success)', fontSize: 11, marginLeft: 6 }}>✓ {bulkMsg.ok}</span>}
        {bulkMsg?.err && <span style={{ color: 'var(--error)',   fontSize: 11, marginLeft: 6 }}>⚠ {bulkMsg.err}</span>}
      </div>

      <div style={{
        background: '#fef3c7', border: '1px dashed #d97706',
        padding: '6px 10px', fontSize: 11, fontFamily: 'monospace',
        marginBottom: 4, color: '#92400e',
      }}>
        🐞 debug — filter:<b>{filter}</b> q:<b>"{query}"</b> ·
        mails:<b>{mails.length}</b> · pending:<b>{pending.length}</b> ·
        filtered:<b>{filtered.length}</b> · flat:<b>{flat.length}</b> ·
        today:<b>{buckets.today.length}</b> yest:<b>{buckets.yesterday.length}</b> week:<b>{buckets.week.length}</b> older:<b>{buckets.older.length}</b> ·
        selectedId:<b>{selectedId ? selectedId.slice(0, 14) + '…' : 'NULL'}</b> ·
        first-flat-mail-id:<b>{flat[0]?.mail_id?.slice(0,14)+'…' || 'NONE'}</b>
      </div>

      <div className="ad-split">
        <aside className="ad-list">
          {flat.length === 0 ? (
            <EmptyState
              hasAnyMails={pending.length > 0}
              onScan={onScan}
              scanBusy={scanBusy}
            />
          ) : (
            <>
              {renderBucket('Vandaag',    buckets.today,     categories, selectedId, setSelectedId, threadCounts)}
              {renderBucket('Gisteren',   buckets.yesterday, categories, selectedId, setSelectedId, threadCounts)}
              {renderBucket('Deze week',  buckets.week,      categories, selectedId, setSelectedId, threadCounts)}
              {renderBucket('Ouder',      buckets.older,     categories, selectedId, setSelectedId, threadCounts)}
            </>
          )}
        </aside>
        <main style={{
          overflowY: 'auto',
          maxHeight: '78vh',
          minHeight: 540,
          background: 'var(--surface-1)',
          color: 'var(--text)',
          padding: 0,
        }}>
          {selected ? (
            <DetailErrorBoundary key={selected.mail_id}>
              <div style={{
                background: '#fef3c7', padding: '6px 10px', fontSize: 11,
                fontFamily: 'monospace', color: '#92400e',
                borderBottom: '1px dashed #d97706',
              }}>
                🐞 detail render — mail_id:<b>{selected.mail_id?.slice(0,18)}…</b> ·
                from:<b>{selected.from_email}</b> ·
                subject-len:<b>{(selected.subject || '').length}</b> ·
                preview-len:<b>{(selected.body_preview || '').length}</b>
              </div>
              <MailDetail
                mail={selected}
                categories={categories}
                folders={folders}
                lessons={lessons}
                allMails={mails}
              />
            </DetailErrorBoundary>
          ) : (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
              Selecteer een mail links om te beginnen.
            </div>
          )}
        </main>
      </div>

      <div className="ad-hotkeys muted">
        ↑/↓ of J/K door lijst · in de detailpane: klik Verstuur/Negeer/Aanpassen
      </div>
    </section>
  )
}

function renderBucket(label, items, categories, selectedId, setSelectedId, threadCounts) {
  if (items.length === 0) return null
  return (
    <div className="ad-list-group">
      <div className="ad-list-group__head">
        <span>{label}</span>
        <span className="ad-list-group__count">{items.length}</span>
      </div>
      {items.map(m => (
        <MailRow key={m.mail_id} mail={m} categories={categories}
          threadCount={threadCounts?.get(m.conversation_id) || 0}
          selected={m.mail_id === selectedId} onSelect={() => setSelectedId(m.mail_id)} />
      ))}
    </div>
  )
}

function EmptyState({ hasAnyMails, onScan, scanBusy }) {
  return (
    <div className="ad-empty">
      <div className="ad-empty__icon">📭</div>
      <div className="ad-empty__title">
        {hasAnyMails ? 'Geen mails matchen je filter' : 'Nog geen mails gescand'}
      </div>
      <div className="ad-empty__hint">
        {hasAnyMails
          ? 'Pas de filter-chips of zoekbalk aan.'
          : 'De auto-draft skill haalt je inbox binnen zodra hij draait. Je kan nu triggeren.'}
      </div>
      {!hasAnyMails && (
        <button type="button" className="btn btn--accent" disabled={scanBusy} onClick={onScan}>
          {scanBusy ? 'Wordt aangevraagd…' : '↻ Scan nu'}
        </button>
      )}
    </div>
  )
}

// =====================================================================
// MAIL ROW
// =====================================================================

function MailRow({ mail, categories, selected, onSelect, threadCount }) {
  const cat = categories.find(c => c.category_key === mail.category_key)
  const isSkip = mail.suggested_action === 'skip'
  const isFlag = mail.suggested_action === 'flag'
  const age = formatRelative(mail.received_at)
  const catColor = cat?.color || 'var(--border)'
  const bg = selected ? 'var(--accent-soft)' : 'var(--bg)'

  return (
    <div role="button" tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'stretch',
        width: '100%', minHeight: 64, cursor: 'pointer',
        background: bg,
        borderBottom: '1px solid var(--border)',
        opacity: isSkip ? 0.7 : 1,
        transition: 'background 80ms',
      }}>
      <div style={{ width: 4, background: catColor, flexShrink: 0 }} title={cat?.label || 'ongecategoriseerd'} />
      <div style={{ flex: 1, padding: '10px 14px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
          <span style={{ fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mail.from_name || mail.from_email || '—'}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {age}
          </span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {mail.subject || '(geen onderwerp)'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          {cat && (
            <span style={{
              padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 500,
              background: colorWithAlpha(cat.color, 0.15), color: cat.color, whiteSpace: 'nowrap',
            }}>{cat.label}</span>
          )}
          {isSkip && <span style={tagStyle('dim')}>negeer-voorstel</span>}
          {isFlag && <span style={tagStyle('warn')}>vraag</span>}
          {mail.status === 'amended' && <span style={tagStyle('accent')}>✎ herschreven</span>}
          {threadCount > 1 && (
            <span style={tagStyle('thread')} title={`Thread van ${threadCount}`}>💬 {threadCount}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function tagStyle(variant) {
  const base = { padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }
  if (variant === 'warn')   return { ...base, background: 'color-mix(in srgb, var(--warning, #f59e0b) 18%, transparent)', color: 'var(--warning, #f59e0b)' }
  if (variant === 'accent') return { ...base, background: 'var(--accent-soft)', color: 'var(--accent)' }
  if (variant === 'thread') return { ...base, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }
  return { ...base, background: 'color-mix(in srgb, var(--text-muted) 15%, transparent)', color: 'var(--text-muted)' }
}

// =====================================================================
// MAIL DETAIL
// =====================================================================

function MailDetail({ mail, categories, folders, lessons, allMails }) {
  const [draftBody, setDraftBody]       = useState(mail.draft_body || '')
  const [draftSubject, setDraftSubject] = useState(mail.draft_subject || '')
  const [targetFolder, setTargetFolder] = useState(mail.target_folder || '')
  const [categoryKey, setCategoryKey]   = useState(mail.category_key || '')
  const [amendText, setAmendText]       = useState('')
  const [mode, setMode]                 = useState(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [busy, setBusy]                 = useState(null)
  const [err, setErr]                   = useState(null)

  const isSkipSuggested = mail.suggested_action === 'skip'
  const [collapsed, setCollapsed] = useState(isSkipSuggested)

  useEffect(() => {
    setDraftBody(mail.draft_body || '')
    setDraftSubject(mail.draft_subject || '')
    setTargetFolder(mail.target_folder || '')
    setCategoryKey(mail.category_key || '')
    setAmendText('')
    setMode(null)
    setShowOriginal(false)
    setCollapsed(mail.suggested_action === 'skip')
    setErr(null)
  }, [mail.mail_id])

  const cat = categories.find(c => c.category_key === categoryKey)
  const folderOptions = useMemo(() => {
    const fromFolders = folders.map(f => f.full_path || f.display_name).filter(Boolean)
    const fromCategories = categories.map(c => c.default_target_folder).filter(Boolean)
    return Array.from(new Set([...fromFolders, ...fromCategories])).sort()
  }, [folders, categories])

  const activeLessons = useMemo(() => lessons.filter(l =>
    (l.scope === 'global') ||
    (l.scope === 'category' && l.scope_value === categoryKey) ||
    (l.scope === 'domain' && mail.from_email && mail.from_email.endsWith('@' + l.scope_value)) ||
    (l.scope === 'sender' && l.scope_value === mail.from_email)
  ), [lessons, categoryKey, mail.from_email])

  const submit = useCallback(async (action) => {
    if (busy) return
    setErr(null); setBusy(action)
    try {
      const { data: rpcRes, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: mail.mail_id,
        p_action: action,
        p_amend: action === 'amend' ? amendText : null,
        p_final_subject: action === 'send' ? draftSubject : null,
        p_final_body:    action === 'send' ? draftBody    : null,
        p_target_folder: targetFolder || null,
      })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }, [busy, mail.mail_id, amendText, draftSubject, draftBody, targetFolder])

  const changeCategory = useCallback(async (newKey) => {
    setCategoryKey(newKey)
    try { await supabase.rpc('set_autodraft_mail_category', { p_mail_id: mail.mail_id, p_category_key: newKey }) } catch {}
  }, [mail.mail_id])

  async function resetToPending() {
    setBusy('reset'); setErr(null)
    try {
      const { data: rpcRes, error } = await supabase.rpc('reset_autodraft_mail_to_pending', { p_mail_id: mail.mail_id })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  // Keyboard shortcuts voor snelle actie (alleen als niet in input)
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      if (['TEXTAREA','INPUT','SELECT'].includes(tag)) return
      if (e.key.toLowerCase() === 's' && !collapsed && draftBody.trim()) { e.preventDefault(); submit('send') }
      else if (e.key.toLowerCase() === 'i') { e.preventDefault(); submit('ignore') }
      else if (e.key.toLowerCase() === 'a') { e.preventDefault(); setMode(m => m === 'amend' ? null : 'amend') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed, draftBody, submit])

  return (
    <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 400 }}>
      {mail.status === 'amended' && (
        <div style={{
          padding: '6px 10px', background: 'var(--accent-soft)', color: 'var(--accent)',
          borderRadius: 6, fontSize: 12,
        }}>
          ✎ Dit is een herschreven versie op basis van je vorige aanpassingsvoorstel.
        </div>
      )}

      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        paddingBottom: 12, borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text)' }}>
            <strong>{mail.from_name || '—'}</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>&lt;{mail.from_email || '—'}&gt;</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {formatDateTime(mail.received_at)}</span>
          </div>
          <div style={{
            fontSize: 15, fontWeight: 600, marginTop: 4, color: 'var(--text)',
            letterSpacing: '-0.01em',
          }}>{mail.subject || '(geen onderwerp)'}</div>
        </div>
        <div title={`Confidence: ${Math.round((mail.confidence || 0) * 100)}%`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{
            width: 44, height: 44, borderRadius: '50%',
            display: 'grid', placeItems: 'center',
            border: `2px solid ${confTone(mail.confidence) === 'high' ? '#4ade80' : confTone(mail.confidence) === 'mid' ? 'var(--accent)' : 'var(--text-muted)'}`,
            color: confTone(mail.confidence) === 'high' ? '#4ade80' : confTone(mail.confidence) === 'mid' ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: 600, fontSize: 11,
          }}>
            {Math.round((mail.confidence || 0) * 100)}%
          </span>
        </div>
      </div>

      {mail.suggested_reasoning && (
        <div className="ad-reasoning">
          <span className="ad-reasoning__label">Skill denkt:</span>{' '}{mail.suggested_reasoning}
        </div>
      )}

      <SenderContext mail={mail} allMails={allMails} />

      {mail.has_attachments && (
        <div className="ad-attachments-hint muted">📎 Mail bevat bijlagen — niet zichtbaar in dashboard, open Outlook indien nodig.</div>
      )}

      <div className="ad-meta-row">
        <label className="ad-meta-field">
          <span className="ad-meta-field__label">Categorie</span>
          <select value={categoryKey} onChange={e => changeCategory(e.target.value)} disabled={!!busy} className="ad-select">
            <option value="">— niet gecategoriseerd —</option>
            {categories.filter(c => c.active !== false).map(c => (
              <option key={c.category_key} value={c.category_key}>{c.label}</option>
            ))}
          </select>
          {cat?.handling_instructions && (
            <span className="ad-meta-field__hint" title={cat.handling_instructions}>ℹ️ instructies</span>
          )}
        </label>
        <label className="ad-meta-field">
          <span className="ad-meta-field__label">Na verwerken: map</span>
          <input type="text" value={targetFolder} onChange={e => setTargetFolder(e.target.value)}
            list="ad-folder-suggestions" disabled={!!busy}
            placeholder={cat?.default_target_folder || 'bv. Klanten/Afgehandeld'}
            className="ad-input" />
          <datalist id="ad-folder-suggestions">
            {folderOptions.map(f => <option key={f} value={f} />)}
          </datalist>
        </label>
      </div>

      {isSkipSuggested && (
        <div className="ad-skip-banner">
          <span>🗂️ Skill stelt voor: <strong>negeren en archiveren</strong>.</span>
          <button type="button" className="btn btn--ghost" onClick={() => setCollapsed(v => !v)} style={{ fontSize: 11, padding: '2px 8px' }}>
            {collapsed ? 'toch draft tonen' : 'weer inklappen'}
          </button>
        </div>
      )}

      <div className="ad-section">
        {(() => {
          const hasFullBody = !!(mail.body_html || mail.body_text)
          const previewOnly = !hasFullBody && !!mail.body_preview
          return (
            <>
              <button type="button" className="ad-section__head" onClick={() => setShowOriginal(v => !v)}>
                {showOriginal ? '▾' : '▸'} Originele mail
                {previewOnly && (
                  <span className="muted" style={{ fontSize: 10.5, marginLeft: 6 }}>
                    · alleen preview opgeslagen — open Outlook voor volledige tekst
                  </span>
                )}
              </button>
              {showOriginal && hasFullBody && (
                <div className="ad-original" dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(mail.body_html || `<pre>${escapeHtml(mail.body_text || '')}</pre>`)
                }} />
              )}
              {showOriginal && previewOnly && (
                <div className="ad-original ad-original--preview-only">
                  <div className="ad-preview-banner muted">
                    ⚠ Skill heeft alleen de preview opgeslagen ({(mail.body_preview || '').length} tekens).
                    Open Outlook voor de volledige mail. Volgende auto-draft-run heeft dit gefixt.
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', margin: 0, fontFamily: 'inherit' }}>
                    {mail.body_preview}
                  </pre>
                </div>
              )}
              {!showOriginal && mail.body_preview && (
                <div className="ad-preview muted">{mail.body_preview.slice(0, 240)}{mail.body_preview.length > 240 ? '…' : ''}</div>
              )}
            </>
          )
        })()}
      </div>

      {!collapsed && (
        <div className="ad-section ad-draft">
          <div className="ad-section__head ad-section__head--static">
            Voorgestelde antwoord
            {activeLessons.length > 0 && (
              <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                · {activeLessons.length} {activeLessons.length === 1 ? 'regel' : 'regels'} toegepast
              </span>
            )}
          </div>
          <input type="text" value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
            disabled={!!busy} className="ad-input ad-input--subject" placeholder="Onderwerp" />
          <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} disabled={!!busy}
            rows={Math.max(6, Math.min(20, (draftBody.split('\n').length || 1) + 2))}
            className="ad-textarea"
            placeholder="Skill heeft nog geen draft gemaakt — typ zelf je antwoord." />
        </div>
      )}

      <div className="ad-actions">
        <button type="button"
          className={`btn ad-btn ad-btn--send ${collapsed ? 'ad-btn--dim' : 'ad-btn--primary'}`}
          disabled={!!busy || collapsed || !draftBody.trim()}
          onClick={() => submit('send')}
          title="Sneltoets: S">
          {busy === 'send' ? 'Verzenden…' : '▶ Verstuur'} <kbd className="ad-kbd">S</kbd>
        </button>
        <button type="button"
          className={`btn ad-btn ad-btn--ignore ${collapsed ? 'ad-btn--primary' : ''}`}
          disabled={!!busy}
          onClick={() => submit('ignore')}
          title="Sneltoets: I">
          {busy === 'ignore' ? 'Archiveren…' : '🗂️ Negeer'} <kbd className="ad-kbd">I</kbd>
        </button>
        <button type="button"
          className={`btn ad-btn ad-btn--amend ${mode === 'amend' ? 'ad-btn--primary' : ''}`}
          disabled={!!busy}
          onClick={() => setMode(m => m === 'amend' ? null : 'amend')}
          title="Sneltoets: A">
          ✎ Aanpassing <kbd className="ad-kbd">A</kbd>
        </button>

        {(mail.status !== 'pending') && (
          <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={resetToPending}
            title="Haal uit de wachtrij zodat je opnieuw kan beslissen">
            ↺ reset
          </button>
        )}

        {err && <span style={{ color: 'var(--error)', fontSize: 12, marginLeft: 8 }}>⚠ {err}</span>}
      </div>

      {mode === 'amend' && (
        <div className="ad-amend">
          <label className="ad-meta-field__label" style={{ marginBottom: 4 }}>
            Wat moet anders? De skill herschrijft op basis van je correctie.
          </label>
          <textarea value={amendText} onChange={e => setAmendText(e.target.value)} disabled={!!busy}
            rows={3} className="ad-textarea"
            placeholder={'bv. "Korter en informeler", "Stel concrete datum voor", "Niet over prijs beginnen"…'}
            autoFocus />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn--accent" disabled={!!busy || !amendText.trim()}
              onClick={() => submit('amend')}>
              {busy === 'amend' ? 'Indienen…' : 'Stuur naar skill'}
            </button>
            <button type="button" className="btn btn--ghost"
              onClick={() => { setMode(null); setAmendText('') }} disabled={!!busy}>
              Annuleer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// SENDER CONTEXT — laatste contact + thread-historie
// =====================================================================

function SenderContext({ mail, allMails }) {
  const senderHistory = useMemo(() => {
    if (!mail.from_email || !allMails) return []
    return allMails
      .filter(m => m.from_email === mail.from_email && m.mail_id !== mail.mail_id)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
      .slice(0, 5)
  }, [mail, allMails])

  const threadMails = useMemo(() => {
    if (!mail.conversation_id || !allMails) return []
    return allMails
      .filter(m => m.conversation_id === mail.conversation_id && m.mail_id !== mail.mail_id)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [mail, allMails])

  if (senderHistory.length === 0 && threadMails.length === 0) return null

  return (
    <div className="ad-context">
      {threadMails.length > 0 && (
        <div className="ad-context__line">
          <strong>💬 Thread van {threadMails.length + 1}</strong>
          {threadMails.slice(0, 3).map(m => (
            <span key={m.mail_id} className="ad-context__pill" title={m.subject}>
              {formatRelative(m.received_at)} · {(m.subject || '').slice(0, 40)}
            </span>
          ))}
        </div>
      )}
      {senderHistory.length > 0 && (
        <div className="ad-context__line muted">
          <strong>Eerder van {mail.from_name || mail.from_email}:</strong>
          {senderHistory.slice(0, 3).map(m => {
            const status = m.status === 'sent' ? '✓ verstuurd'
                         : m.status === 'ignored' ? '🗂 genegeerd'
                         : m.status === 'pending' ? '⏳ open' : m.status
            return (
              <span key={m.mail_id} className="ad-context__pill">
                {formatRelative(m.received_at)} · {status}
              </span>
            )
          })}
          {senderHistory.length > 3 && <span className="muted">+{senderHistory.length - 3} ouder</span>}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// VOORSTELLEN (categorieën + lessen)
// =====================================================================

function CategoryProposalsBlock({ proposals }) {
  return (
    <section className="va-block ad-proposal-block">
      <div className="va-block__head" style={{ cursor: 'default' }}>
        <span className="va-block__caret">·</span>
        <span className="va-block__title">✨ Nieuwe categorie voorgesteld</span>
        <span className="va-block__count">{proposals.length}</span>
      </div>
      <div className="va-block__body">
        {proposals.map(p => <CategoryProposalCard key={p.id} proposal={p} />)}
      </div>
    </section>
  )
}

function CategoryProposalCard({ proposal }) {
  const [keyVal, setKeyVal]     = useState(proposal.proposed_key)
  const [label, setLabel]       = useState(proposal.proposed_label)
  const [instr, setInstr]       = useState(proposal.proposed_instructions || '')
  const [folder, setFolder]     = useState(proposal.proposed_folder || '')
  const [busy, setBusy]         = useState(null)
  const [err, setErr]           = useState(null)
  const [mode, setMode]         = useState(null)
  const [rejectReason, setRR]   = useState('')

  async function accept() {
    setBusy('accept'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('accept_autodraft_category_proposal', {
        p_proposal_id: proposal.id,
        p_category_key_override: keyVal,
        p_label_override: label,
        p_instructions_override: instr,
        p_folder_override: folder,
        p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  async function reject() {
    setBusy('reject'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('reject_autodraft_category_proposal', {
        p_proposal_id: proposal.id, p_reason: rejectReason || null, p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <div className="ad-proposal">
      <div className="ad-proposal__head">
        <strong>{proposal.proposed_label}</strong>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {new Date(proposal.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {proposal.reasoning && (
        <div className="ad-proposal__reasoning">
          <span className="ad-reasoning__label">Waarom:</span> {proposal.reasoning}
        </div>
      )}
      {proposal.example_subjects?.length > 0 && (
        <ul className="ad-proposal__examples">
          {proposal.example_subjects.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      <div className="ad-proposal__edit">
        <label><span>key</span><input value={keyVal} onChange={e => setKeyVal(e.target.value)} className="ad-input" /></label>
        <label><span>label</span><input value={label} onChange={e => setLabel(e.target.value)} className="ad-input" /></label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>instructies</span>
          <textarea value={instr} onChange={e => setInstr(e.target.value)} rows={3} className="ad-textarea" />
        </label>
        <label><span>map</span><input value={folder} onChange={e => setFolder(e.target.value)} className="ad-input" /></label>
      </div>
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={!!busy} onClick={accept}>
          {busy === 'accept' ? 'Accepteren…' : '✓ Accepteer'}
        </button>
        <button className="btn btn--ghost" disabled={!!busy} onClick={() => setMode(m => m === 'reject' ? null : 'reject')}>
          ✕ Afwijzen
        </button>
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
      {mode === 'reject' && (
        <div className="ad-amend">
          <textarea value={rejectReason} onChange={e => setRR(e.target.value)} rows={2}
            className="ad-textarea" placeholder="reden (optioneel)" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn--accent" disabled={!!busy} onClick={reject}>Bevestig</button>
            <button className="btn btn--ghost" onClick={() => setMode(null)} disabled={!!busy}>Annuleer</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LessonProposalsBlock({ proposals, categories }) {
  return (
    <section className="va-block ad-proposal-block">
      <div className="va-block__head" style={{ cursor: 'default' }}>
        <span className="va-block__caret">·</span>
        <span className="va-block__title">🧠 Nieuwe schrijfregel voorgesteld</span>
        <span className="va-block__count">{proposals.length}</span>
      </div>
      <div className="va-block__body">
        {proposals.map(p => <LessonProposalCard key={p.id} proposal={p} categories={categories} />)}
      </div>
    </section>
  )
}

function LessonProposalCard({ proposal, categories }) {
  const [text, setText] = useState(proposal.proposed_lesson)
  const [busy, setBusy] = useState(null)
  const [err, setErr]   = useState(null)
  const [rejectReason, setRR] = useState('')
  const [mode, setMode] = useState(null)

  const scopeLabel = proposal.scope === 'category'
    ? (categories.find(c => c.category_key === proposal.scope_value)?.label || proposal.scope_value)
    : proposal.scope === 'domain' ? `@${proposal.scope_value}`
    : proposal.scope === 'sender' ? proposal.scope_value
    : 'globaal'

  async function accept() {
    setBusy('accept'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('accept_autodraft_lesson_proposal', {
        p_proposal_id: proposal.id,
        p_lesson_override: text,
        p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  async function reject() {
    setBusy('reject'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('reject_autodraft_lesson_proposal', {
        p_proposal_id: proposal.id, p_reason: rejectReason || null, p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <div className="ad-proposal">
      <div className="ad-proposal__head">
        <span className="ad-row__cat" style={{
          background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
          color: 'var(--accent)',
        }}>{scopeLabel}</span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {new Date(proposal.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} className="ad-textarea" />
      {proposal.evidence && (
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          <span className="ad-reasoning__label">Bewijs:</span> {proposal.evidence}
        </div>
      )}
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={!!busy || !text.trim()} onClick={accept}>
          {busy === 'accept' ? 'Accepteren…' : '✓ Voeg regel toe'}
        </button>
        <button className="btn btn--ghost" disabled={!!busy} onClick={() => setMode(m => m === 'reject' ? null : 'reject')}>
          ✕ Afwijzen
        </button>
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
      {mode === 'reject' && (
        <div className="ad-amend">
          <textarea value={rejectReason} onChange={e => setRR(e.target.value)} rows={2}
            className="ad-textarea" placeholder="reden (optioneel)" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn--accent" disabled={!!busy} onClick={reject}>Bevestig</button>
            <button className="btn btn--ghost" onClick={() => setMode(null)} disabled={!!busy}>Annuleer</button>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// CATEGORIEBEHEER
// =====================================================================

function CategoriesBlock({ categories, folders }) {
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState(null)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Categorieën</span>
        <span className="va-block__count">{categories.length}</span>
        <span className="muted va-block__hint">kleur · instructies · doelmap · default actie</span>
      </button>
      {open && (
        <div className="va-block__body">
          <div className="ad-cat-grid">
            {categories.map(c => (
              <button key={c.category_key} type="button"
                className={`ad-cat-chip ${c.active === false ? 'is-off' : ''} ${editingKey === c.category_key ? 'is-selected' : ''}`}
                onClick={() => setEditingKey(c.category_key)}>
                <span className="ad-cat-chip__color" style={{ background: c.color || 'var(--border)' }} />
                <div className="ad-cat-chip__label">{c.label}</div>
                <div className="ad-cat-chip__key mono">{c.category_key}</div>
                <div className="ad-cat-chip__meta">
                  {c.default_action} · {c.default_target_folder || '(geen map)'}
                </div>
              </button>
            ))}
            <button type="button" className="ad-cat-chip ad-cat-chip--new" onClick={() => setEditingKey('__new__')}>
              + nieuwe categorie
            </button>
          </div>
          {editingKey && (
            <CategoryEditor key={editingKey}
              category={editingKey === '__new__' ? null : categories.find(c => c.category_key === editingKey)}
              onDone={() => setEditingKey(null)} folders={folders} />
          )}
        </div>
      )}
    </section>
  )
}

function CategoryEditor({ category, onDone }) {
  const [keyVal, setKeyVal]         = useState(category?.category_key || '')
  const [label, setLabel]           = useState(category?.label || '')
  const [description, setDescr]     = useState(category?.description || '')
  const [instructions, setInstr]    = useState(category?.handling_instructions || '')
  const [folder, setFolder]         = useState(category?.default_target_folder || '')
  const [defaultAction, setDA]      = useState(category?.default_action || 'draft')
  const [active, setActive]         = useState(category?.active !== false)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)
  const [ok, setOk]     = useState(false)

  async function save() {
    setBusy(true); setErr(null); setOk(false)
    try {
      const { data, error } = await supabase.rpc('upsert_autodraft_category', {
        p_category_key: keyVal, p_label: label, p_description: description,
        p_handling_instructions: instructions, p_default_target_folder: folder || null,
        p_default_action: defaultAction, p_active: active,
        p_sort_order: category?.sort_order ?? 100, p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else { setOk(true); setTimeout(onDone, 600) }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="ad-cat-editor">
      <div className="ad-proposal__edit">
        <label><span>key</span>
          <input value={keyVal} onChange={e => setKeyVal(e.target.value)} className="ad-input"
            disabled={!!category} placeholder="bv. klant_offerte" />
        </label>
        <label><span>label</span><input value={label} onChange={e => setLabel(e.target.value)} className="ad-input" /></label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>korte beschrijving</span>
          <input value={description} onChange={e => setDescr(e.target.value)} className="ad-input" />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>instructies (hoe behandelt de skill dit type mail?)</span>
          <textarea value={instructions} onChange={e => setInstr(e.target.value)} rows={5} className="ad-textarea" />
        </label>
        <label><span>default map</span>
          <input value={folder} onChange={e => setFolder(e.target.value)} className="ad-input" list="ad-folder-suggestions" />
        </label>
        <label><span>default actie</span>
          <select value={defaultAction} onChange={e => setDA(e.target.value)} className="ad-select">
            <option value="draft">draft schrijven</option>
            <option value="skip">negeren/archiveren</option>
            <option value="flag">vraag aan Jelle stellen</option>
          </select>
        </label>
        <label>
          <span>status</span>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> actief
          </label>
        </label>
      </div>
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={busy || !keyVal || !label} onClick={save}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="btn btn--ghost" onClick={onDone} disabled={busy}>Annuleer</button>
        {ok  && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}

// =====================================================================
// LOGBOEK + LESSEN
// =====================================================================

function InboxLog({ mails, decisions }) {
  const [open, setOpen] = useState(false)
  const processed = useMemo(() => mails
    .filter(m => ['sent','ignored','failed','stale'].includes(m.status) ||
                 String(m.status).startsWith('queued_'))
    .sort((a, b) => new Date(b.updated_at || b.scanned_at) - new Date(a.updated_at || a.scanned_at))
    .slice(0, 50),
    [mails])

  const latestDecisionByMail = useMemo(() => {
    const m = new Map()
    for (const d of decisions) if (!m.has(d.mail_id)) m.set(d.mail_id, d)
    return m
  }, [decisions])

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Logboek · Verwerkt</span>
        <span className="va-block__count">{processed.length}</span>
        <span className="muted va-block__hint">alles wat uit je postvak is — verstuurd, genegeerd of gefaald</span>
      </button>
      {open && (
        <div className="va-block__body">
          {processed.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>Nog niks verwerkt.</div>
          ) : (
            <div className="va-log-list">
              {processed.map(m => <LogLine key={m.mail_id} mail={m} decision={latestDecisionByMail.get(m.mail_id)} />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const STATUS_META = {
  queued_send:   { label: 'Wacht op verzending',       cls: 'amended'  },
  queued_ignore: { label: 'Wacht op archivering',      cls: 'amended'  },
  queued_amend:  { label: 'Wacht op herschrijf',       cls: 'accepted' },
  sent:          { label: 'Verstuurd ✓',               cls: 'executed' },
  ignored:       { label: 'Gearchiveerd',              cls: 'rejected' },
  failed:        { label: 'Gefaald',                   cls: 'failed'   },
  stale:         { label: 'Verdwenen',                 cls: 'rejected' },
}

function LogLine({ mail, decision }) {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[mail.status] || { label: mail.status, cls: 'rejected' }
  const when = mail.updated_at || mail.scanned_at
  const hasDetails = !!decision
  return (
    <div className={`va-log-line va-log-line--${meta.cls} ${open ? 'is-open' : ''}`}>
      <button type="button" className="va-log-line__row" disabled={!hasDetails}
        onClick={() => hasDetails && setOpen(v => !v)}>
        <span className="va-log-line__caret">{hasDetails ? (open ? '▾' : '▸') : ''}</span>
        <span className="va-log-line__status">{meta.label}</span>
        <span className="va-log-line__subject">{mail.subject || '(geen onderwerp)'}</span>
        <span className="va-log-line__time">{formatDateTime(when)}</span>
      </button>
      {open && decision && (
        <div className="va-log-line__body">
          <div style={{ fontSize: 12, display: 'grid', gap: 4 }}>
            <div><span className="muted">Actie:</span> {decision.action}</div>
            {decision.target_folder && <div><span className="muted">Map:</span> {decision.target_folder}</div>}
            {decision.amend_instructions && <div><span className="muted">Jouw correctie:</span> <em>{decision.amend_instructions}</em></div>}
            {decision.execution_error && <div style={{ color: 'var(--error)' }}>⚠ {decision.execution_error}</div>}
            {decision.executed_at && <div className="muted">Uitgevoerd: {formatDateTime(decision.executed_at)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function LessonsBlock({ lessons, categories }) {
  const [open, setOpen] = useState(false)
  const grouped = useMemo(() => {
    const m = new Map()
    for (const l of lessons) {
      const key = l.scope === 'category' ? (l.scope_value || 'onbekend') : l.scope
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(l)
    }
    return m
  }, [lessons])

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Geleerde regels</span>
        <span className="va-block__count">{lessons.length}</span>
        <span className="muted va-block__hint">uit amendments · skill leest ze bij elke draft</span>
      </button>
      {open && (
        <div className="va-block__body">
          {lessons.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>
              Nog geen regels. Zodra je een aanpassingsvoorstel indient, distilleert de skill er regels uit
              en vraagt hij ze via "Nieuwe schrijfregel voorgesteld" aan jou.
            </div>
          ) : (
            <div className="stack stack--sm">
              {[...grouped.entries()].map(([scope, items]) => {
                const cat = categories.find(c => c.category_key === scope)
                return (
                  <div key={scope}>
                    <div className="kpi__label" style={{ marginBottom: 6 }}>
                      {cat ? cat.label : scope === 'global' ? 'Globaal' : scope}
                    </div>
                    <ul className="ad-lessons">
                      {items.map(l => (
                        <li key={l.id}>
                          <span>{l.lesson}</span>
                          <span className="muted" style={{ fontSize: 11 }}>{l.times_applied}× toegepast</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// SYSTEEM-INSTRUCTIES + DEBUG
// =====================================================================

function SystemInstructionsBlock({ data }) {
  const [open, setOpen] = useState(false)
  const instructionsRow = (data.agentInstructions || []).find(r => r.agent_name === AGENT)
  const [text, setText] = useState(instructionsRow?.config_value?.text || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setText(instructionsRow?.config_value?.text || '')
    setErr(null); setSaved(false)
  }, [instructionsRow?.updated_at])

  const dirty = text !== (instructionsRow?.config_value?.text || '')

  async function save() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data: rpcRes, error } = await supabase.rpc('upsert_agent_instructions', {
        p_agent_name: AGENT, p_instructions: text, p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
      else setSaved(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Systeem-instructies</span>
        <span className="muted va-block__hint">globaal · wordt door elke run bovenop categorieën gelezen</span>
      </button>
      {open && (
        <div className="va-block__body" style={{ display: 'grid', gap: 10 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} disabled={busy} rows={8}
            className="ad-textarea"
            placeholder={'Bijvoorbeeld:\n- Nederlandse mails altijd tutoyeren.\n- Max 6 zinnen tenzij de mail lang is.\n- Nooit mijn telefoonnummer sturen.'} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--accent" onClick={save} disabled={busy || !dirty}>
              {busy ? 'Opslaan…' : 'Opslaan'}
            </button>
            {saved && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ opgeslagen</span>}
            {err   && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function DebugBlock({ data }) {
  const [open, setOpen] = useState(false)
  const runs = (data.recentRuns || [])
    .filter(r => r.agent_name === AGENT || r.agent_name === 'auto-draft-execute')
    .slice(0, 20)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Debug · recente runs</span>
        <span className="muted va-block__hint">alleen om te zien waar iets faalt</span>
      </button>
      {open && (
        <div className="va-block__body">
          {runs.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 10 }}>Geen runs.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Skill</th><th>Start</th><th>Status</th><th>Opmerking</th></tr></thead>
                <tbody>
                  {runs.map(r => {
                    const s = r.stats || {}
                    const note = s.error || s.blocker || s.note || ''
                    return (
                      <tr key={r.id || r.started_at}>
                        <td className="mono" style={{ fontSize: 11 }}>{r.agent_name}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {new Date(r.started_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td><span className={`pill s-${r.status}`}>{r.status}</span></td>
                        <td className="muted" style={{ fontSize: 11, maxWidth: 400 }}>
                          {typeof note === 'string' ? note.slice(0, 120) : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// UTILS
// =====================================================================

function groupByAge(mails) {
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const yStart = new Date(todayStart); yStart.setDate(yStart.getDate() - 1)
  const wStart = new Date(todayStart); wStart.setDate(wStart.getDate() - 6)
  const out = { today: [], yesterday: [], week: [], older: [] }
  for (const m of mails) {
    const d = new Date(m.received_at)
    if (d >= todayStart) out.today.push(m)
    else if (d >= yStart) out.yesterday.push(m)
    else if (d >= wStart) out.week.push(m)
    else out.older.push(m)
  }
  return out
}

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const min = Math.round((now - d) / 60000)
  if (min < 1) return 'net'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}u`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function confTone(c) {
  const n = Number(c || 0)
  if (n >= 0.75) return 'high'
  if (n >= 0.5) return 'mid'
  return 'low'
}

function colorWithAlpha(color, alpha) {
  if (!color) return 'var(--border)'
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

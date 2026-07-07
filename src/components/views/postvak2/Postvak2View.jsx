import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { useInboxOptimistic } from '../../../hooks/useInboxOptimistic'
import { useInboxKeyboard } from '../../../hooks/useInboxKeyboard'
import { usePv2Pools } from '../../../hooks/usePv2Pools'
import { usePv2Snoozes, tomorrowNine, plusOneDay } from '../../../hooks/usePv2Snoozes'
import { AGENT } from '../../../lib/autodraft'
import Ic from './pv2Icons'
import Pv2NavTabs, { PV2_TABS } from './Pv2NavTabs'
import Pv2ListPane from './Pv2ListPane'
import Pv2Detail from './Pv2Detail'
import Pv2Loader from './Pv2Loader'
import Pv2NewMail from './Pv2NewMail'
import Pv2Timeline from './Pv2Timeline'
import Pv2KbModal from './Pv2KbModal'
import { Pv2RagModal, Pv2ActionsModal } from './Pv2Modals'
import { accentFor, catLabel, minutesAgo } from './pv2lib'
import './postvak2.css'

/* Postvak2View — "Postvak variant 2" (/postvak2). Volledig nieuw design
 * (Claude Design "Postvak v2"), volledig de oude functionaliteit: zelfde
 * datalaag en RPC's als variant 1. De oude variant blijft op /postvak
 * staan tot Jelle deze goedkeurt. */

export default function Postvak2View() {
  const navigate = useNavigate()
  const {
    mails, decisions, categories: rawCategories, folders, mailMessages,
    ignoreRules, awaitingDismissed, hubspotCustomerEmails,
    awaitingReplyIndex, manualCategoryOverrides, loading, refresh,
  } = useAutoDraft()
  const { data: recentRuns } = useSupabaseQuery('agent_runs', {
    select: 'id,agent_name,status,started_at,completed_at',
    in: { agent_name: [AGENT, 'auto-draft-execute'] },
    orderBy: ['started_at', { ascending: false }],
    limit: 10,
  })
  const optimistic = useInboxOptimistic({ mails, mailMessages })
  const { snoozedIds, snooze } = usePv2Snoozes()

  const categories = useMemo(() =>
    (rawCategories || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [rawCategories])

  const [activeTab, setActiveTab] = useState('voor-jou')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [activeMsg, setActiveMsg] = useState(null)
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('pvk2-nav') === 'collapsed' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem('pvk2-nav', navCollapsed ? 'collapsed' : 'open') } catch { /* ignore */ } }, [navCollapsed])
  const [listW, setListW] = useState(() => { const v = parseInt(localStorage.getItem('pvk2-listw') || '0', 10); return v >= 300 && v <= 720 ? v : 408 })
  const [draggingRow, setDraggingRow] = useState(null)
  const [tabMenu, setTabMenu] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rag, setRag] = useState(null)
  const [timeline, setTimeline] = useState(null)
  const [kbFor, setKbFor] = useState(null)
  const [showActions, setShowActions] = useState(false)
  const [showNewMail, setShowNewMail] = useState(false)
  const [booting, setBooting] = useState(() => { try { return sessionStorage.getItem('pvk2-loaded') !== '1' } catch { return true } })
  const [dockOpen, setDockOpen] = useState(false)
  const [dockIn, setDockIn] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const dockT = useRef(null)
  const appRef = useRef(null)
  const [portalEl, setPortalEl] = useState(null)
  useEffect(() => { setPortalEl(appRef.current) }, [])

  function openDock() { setDockOpen(true); clearTimeout(dockT.current); dockT.current = setTimeout(() => setDockIn(true), 30) }
  function closeDock() { setDockIn(false); clearTimeout(dockT.current); dockT.current = setTimeout(() => setDockOpen(false), 320) }
  function toggleDock() { if (dockOpen) closeDock(); else openDock() }
  function toggleSplit() { setSplitMode(v => { const n = !v; if (n) { setDockOpen(false); setDockIn(true) } return n }) }

  const pools = usePv2Pools({
    mails, mailMessages, decisions, categories,
    ignoreRules, awaitingDismissed, hubspotCustomerEmails,
    awaitingReplyIndex, manualCategoryOverrides,
    categoryOverrides: optimistic.categoryOverrides,
    actionedIds: optimistic.actionedIds,
    flagOverrides: optimistic.flagOverrides,
    snoozedIds, activeTab, filter, query,
  })
  const { flat, groups, tabCounts, catFilters, catOf, categoriesByKey, threadCounts, customerEmails, skipMails } = pools

  // Selectie: eerste rij wanneer leeg of verdwenen; dock dicht bij wissel.
  const selected = useMemo(() => flat.find(m => m.mail_id === selectedId) || null, [flat, selectedId])
  useEffect(() => {
    if (!selectedId && flat.length > 0) setSelectedId(flat[0].mail_id)
    else if (selectedId && !flat.find(m => m.mail_id === selectedId)) setSelectedId(flat[0]?.mail_id || null)
  }, [flat, selectedId])
  const selectRow = useCallback(id => {
    setSelectedId(id); setActiveMsg(null); setDockIn(false); setDockOpen(false); setSplitMode(false)
  }, [])
  useInboxKeyboard({ flat, selected, setSelectedId })
  useEffect(() => { setFilter('all') }, [activeTab])

  // ⌘K → zoekveld in de nav-kolom.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setNavCollapsed(false)
        requestAnimationFrame(() => document.querySelector('.pvk2 .nav-search input')?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Scrollbars verschijnen alleen tijdens scrollen (design-gedrag).
  useEffect(() => {
    function onScroll(e) {
      const el = e.target
      if (!el || !el.classList) return
      el.classList.add('is-scrolling')
      clearTimeout(el.__sbT)
      el.__sbT = setTimeout(() => el.classList.remove('is-scrolling'), 280)
    }
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])
  useEffect(() => {
    if (!tabMenu) return undefined
    const c = e => { if (!e.target.closest('.cat-switch')) setTabMenu(false) }
    document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c)
  }, [tabMenu])
  useEffect(() => {
    if (!settingsOpen) return undefined
    const c = e => { if (!e.target.closest('.settings-wrap')) setSettingsOpen(false) }
    document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c)
  }, [settingsOpen])

  // Sleepbare splitter tussen lijst en detail.
  const cardRef = useRef(null)
  const dragSplit = useRef(false)
  function onSplitDown(e) { e.preventDefault(); dragSplit.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }
  useEffect(() => {
    function move(e) {
      if (!dragSplit.current || !cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      setListW(Math.round(Math.max(320, Math.min(rect.width - 420, e.clientX - rect.left))))
    }
    function up() {
      if (dragSplit.current) {
        dragSplit.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''
        try { localStorage.setItem('pvk2-listw', String(listW)) } catch { /* ignore */ }
      }
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [listW])

  // Drag mail → map (ignore-decision met target_folder, variant 1-flow).
  const dropToFolder = useCallback(async (mailId, folderId, folderLabel) => {
    setDraggingRow(null)
    optimistic.markActioned(mailId)
    try {
      const { data, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: mailId, p_action: 'ignore', p_target_folder: folderId, p_decision_kind: 'move-via-drag',
      })
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'geweigerd')
      showToast({ message: `Verplaatst naar ${folderLabel}`, detail: 'Outlook volgt binnen 15 min.' })
    } catch (e) {
      optimistic.unmarkActioned(mailId)
      showToast({ kind: 'error', message: 'Verplaatsen mislukt', detail: e.message })
    }
  }, [optimistic])

  // Rij-snelacties.
  const quickApprove = useCallback(async (it) => {
    optimistic.markActioned(it.mail_id)
    try {
      const variants = Array.isArray(it.draft_variants) ? it.draft_variants : []
      const idx = Math.min(it.selected_variant_index || 0, Math.max(0, variants.length - 1))
      const isSkip = it.suggested_action === 'skip'
      const { data, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: it.mail_id,
        p_action: isSkip ? 'ignore' : 'send',
        p_final_subject: isSkip ? null : (variants[idx]?.subject || it.draft_subject || null),
        p_final_body: isSkip ? null : (variants[idx]?.body || it.draft_body || null),
        p_target_folder: it.target_folder || null,
        p_chosen_variant_index: isSkip ? null : idx,
        p_chosen_variant_label: isSkip ? null : (variants[idx]?.label || null),
      })
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'geweigerd')
      showToast({ message: isSkip ? 'Genegeerd + volgende' : 'Concept geplaatst + volgende' })
    } catch (e) {
      optimistic.unmarkActioned(it.mail_id)
      showToast({ kind: 'error', message: 'Goedkeuren mislukt', detail: e.message })
    }
  }, [optimistic])
  const quickDelete = useCallback(async (it) => {
    optimistic.markActioned(it.mail_id)
    try {
      const { data, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: it.mail_id, p_action: 'ignore', p_target_folder: 'Verwijderde items', p_decision_kind: 'delete',
      })
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'geweigerd')
      showToast({ kind: 'info', message: 'Mail verwijderd', detail: 'Naar Verwijderde items.' })
    } catch (e) {
      optimistic.unmarkActioned(it.mail_id)
      showToast({ kind: 'error', message: 'Verwijderen mislukt', detail: e.message })
    }
  }, [optimistic])

  async function onScanNow() {
    setSettingsOpen(false)
    try {
      const { data, error } = await supabase.rpc('request_mail_sync_now')
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason)
      showToast({ message: 'Mail-sync + scan aangevraagd', detail: 'Verse data binnen 1-2 min.' })
    } catch (e) { showToast({ kind: 'error', message: 'Scan mislukt', detail: e.message }) }
  }
  async function onRescan() {
    setSettingsOpen(false)
    if (!window.confirm('Postvak opnieuw scannen?\n\nAlle huidige voorstellen worden vervangen door verse. Er wordt niets verstuurd.')) return
    try {
      const { data, error } = await supabase.rpc('autodraft_rescan_postvak')
      if (error) throw error
      showToast({ message: `Opnieuw scannen gestart — ${data?.drafts_wiped ?? 0} mails opnieuw ingepland` })
      refresh?.()
    } catch (e) { showToast({ kind: 'error', message: 'Opnieuw scannen mislukt', detail: e.message }) }
  }
  async function onBulkSkip() {
    setSettingsOpen(false)
    if (skipMails.length === 0) return
    if (!window.confirm(`Alle ${skipMails.length} mails met negeer-voorstel archiveren?`)) return
    try {
      const { data, error } = await supabase.rpc('bulk_skip_autodraft_mails', {
        p_mail_ids: skipMails.map(m => m.mail_id), p_target_folder: null,
      })
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason)
      showToast({ message: `${data?.queued ?? skipMails.length} mails in wachtrij` })
    } catch (e) { showToast({ kind: 'error', message: 'Bulk-archiveren mislukt', detail: e.message }) }
  }

  const latestRun = useMemo(() => (recentRuns || []).find(r => r.agent_name === AGENT) || null, [recentRuns])
  const syncMin = minutesAgo(latestRun?.completed_at || latestRun?.started_at)
  const activeLabel = PV2_TABS.find(t => t.id === activeTab)?.label || 'Voor jou'
  const selectedCat = selected ? catOf(selected) : ''
  const selectedAccent = accentFor(selectedCat, categoriesByKey)
  const folderOptions = useMemo(() => {
    const s = new Set()
    for (const f of (folders || [])) { const p = f.full_path || f.display_name; if (p) s.add(p) }
    for (const c of categories) if (c.default_target_folder) s.add(c.default_target_folder)
    return Array.from(s).sort()
  }, [folders, categories])

  const rowProps = useCallback(it => ({
    catKey: catOf(it), categories, categoriesByKey,
    selected: selectedId === it.mail_id, onSelect: selectRow,
    onChangeCategory: optimistic.changeCategoryOptimistic,
    isFlagged: pools.flaggedMailIds.has(it.mail_id), onToggleFlag: optimistic.handleToggleFlag,
    unread: pools.mailMessagesById.get(it.mail_id)?.is_read === false,
    threadCount: threadCounts.get(it.conversation_id) || 1,
    threadMsgs: selectedId === it.mail_id && (threadCounts.get(it.conversation_id) || 1) > 1
      ? (mailMessages || []).filter(m => m.conversation_id === it.conversation_id)
          .sort((a, b) => new Date(a.received_at) - new Date(b.received_at)).slice(-8)
      : [],
    activeMsg: selectedId === it.mail_id ? activeMsg : null,
    onFocusMsg: i => setActiveMsg(i),
    onDragStart: id => setDraggingRow(id), onDragEnd: () => setDraggingRow(null),
    onOpenRag: setRag, onApprove: quickApprove, onReply: m => { selectRow(m.mail_id); openDock() },
    onSnooze: m => snooze(m.mail_id, tomorrowNine(), 'morgen 09:00'), onDelete: quickDelete,
  }), [catOf, categories, categoriesByKey, selectedId, selectRow, optimistic, pools.flaggedMailIds,
       pools.mailMessagesById, threadCounts, mailMessages, activeMsg, quickApprove, quickDelete, snooze])

  return (
    <div className={`pvk2 ${draggingRow ? 'is-dragging' : ''}`}>
      <div ref={appRef} className={`app ${navCollapsed ? 'app--navcollapsed' : ''} ${dockOpen ? 'is-focusdock' : ''}`}>
        <Pv2NavTabs active={activeTab} setActive={t => { setActiveTab(t); closeDock() }} counts={tabCounts}
                    collapsed={navCollapsed} query={query} setQuery={setQuery}
                    folders={folders} categories={categories}
                    dragging={!!draggingRow} onDropFolder={dropToFolder}/>
        {/* Topbar op app-niveau: schuift bij hover over de vólle breedte
            uit, dus ook over de tabs-kolom links (review-ronde 1). */}
        <div className="topbar-zone">
          <div className="topbar-peek" title="Beweeg hierheen voor de menubalk"><span className="topbar-peek-grip"/></div>
          <header className="topbar">
              <div className="crumbs">
                <span className="crumb">Postvak</span>
                <Ic n="chev-r" s={12}/>
                <div className="cat-switch">
                  <button className="crumb crumb-current cat-switch-btn" onClick={() => setTabMenu(v => !v)} title="Wissel weergave">
                    {activeLabel}<Ic n="chev" s={12}/>
                  </button>
                  {tabMenu && (
                    <div className="dd dd-left" onClick={e => e.stopPropagation()}>
                      <div className="dd-label">Weergave</div>
                      {PV2_TABS.map(t => (
                        <button key={t.id} className={`dd-item ${activeTab === t.id ? 'is-active' : ''}`}
                                onClick={() => { setActiveTab(t.id); setTabMenu(false) }}>
                          <Ic n={t.icon} s={15}/> {t.label}
                          {tabCounts[t.id] != null && <span className="dd-kbd">{tabCounts[t.id]}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="topbar-right">
                <span className="sync-pill" title={latestRun ? `Laatste auto-draft-run: ${latestRun.status}` : 'Nog geen run-informatie'}>
                  <span className="sync-dot"/><span>Gesynct</span>
                  <span className="sync-meta">{syncMin != null ? (syncMin < 60 ? `${syncMin}m` : `${Math.round(syncMin / 60)}u`) : '—'}</span>
                </span>
                <div className="settings-wrap">
                  <button className={`btn btn-icon btn-ghost ${settingsOpen ? 'is-open' : ''}`} title="Instellingen" onClick={() => setSettingsOpen(v => !v)}>
                    <Ic n="settings" s={16}/>
                  </button>
                  {settingsOpen && (
                    <div className="dd settings-dd" onClick={e => e.stopPropagation()}>
                      <button className="dd-item" onClick={() => { setSettingsOpen(false); navigate('/postvak/instellingen') }}><Ic n="settings" s={15}/> Instellingencentrum openen</button>
                      <button className="dd-item" onClick={() => { setSettingsOpen(false); setShowActions(true) }}><Ic n="sparkles" s={15}/> Wat Maestro kan voorstellen…</button>
                      <div className="dd-sep"/>
                      <button className="dd-item" onClick={onScanNow}><Ic n="refresh" s={15}/> Scan nu (mail-sync + skill)</button>
                      <button className="dd-item" onClick={onRescan}><Ic n="zap" s={15}/> Postvak opnieuw scannen</button>
                      {skipMails.length > 0 && (
                        <button className="dd-item" onClick={onBulkSkip}><Ic n="archive" s={15}/> Archiveer alle negeer-voorstellen ({skipMails.length})</button>
                      )}
                    </div>
                  )}
                </div>
                <button className="btn btn-primary" onClick={() => setShowNewMail(true)}><Ic n="plus" s={14}/> Nieuw</button>
              </div>
          </header>
        </div>
        <main className="main">
          <div className="card" ref={cardRef} style={{ gridTemplateColumns: `${listW}px 6px 1fr` }}>
            <Pv2ListPane activeTab={activeTab} groups={groups} loading={loading}
                         hasMore={pools.hasMore} onLoadMore={pools.loadMore}
                         filter={filter} setFilter={setFilter} catFilters={catFilters}
                         listW={listW} navCollapsed={navCollapsed} onToggleNav={() => setNavCollapsed(c => !c)}
                         decisions={decisions} mails={mails} rowProps={rowProps}/>
            <div className="split" onMouseDown={onSplitDown} title="Versleep om te verdelen"><span className="split-grip"/></div>
            {selected ? (
              <Pv2Detail key={selected.mail_id}
                         mail={selected} accent={selectedAccent} catLabelText={catLabel(selectedCat, categoriesByKey)}
                         activeMsg={activeMsg} mailMessages={mailMessages}
                         onOpenRag={setRag} onOpenTimeline={setTimeline} onOpenKb={setKbFor}
                         assistOpen={dockOpen} dockIn={dockIn} openDock={openDock} closeDock={closeDock} toggleDock={toggleDock}
                         splitMode={splitMode} onToggleSplit={toggleSplit}
                         markActioned={optimistic.markActioned} unmarkActioned={optimistic.unmarkActioned}
                         folderOptions={folderOptions} customerEmails={customerEmails}
                         isFlagged={pools.flaggedMailIds.has(selected.mail_id)} onToggleFlag={optimistic.handleToggleFlag}
                         onSnooze={m => snooze(m.mail_id, plusOneDay(), 'over 1 dag')}
                         portalEl={portalEl}/>
            ) : (
              <section className="detail">
                <div className="list-empty" style={{ margin: 'auto' }}>
                  <div className="list-empty-ico"><Ic n="inbox" s={22}/></div>
                  <div className="list-empty-t">{loading ? 'Mails worden geladen…' : 'Selecteer een mail links'}</div>
                </div>
              </section>
            )}
          </div>
        </main>
        {/* Boot-loader op app-niveau = full-page overlay (review-ronde 1). */}
        {booting && <Pv2Loader counts={{ mails: (mailMessages || []).length, categorized: (mails || []).length, drafts: tabCounts['voor-jou'] }} onDone={() => setBooting(false)}/>}
        {(dockOpen || splitMode) && <div className="focus-scrim" onClick={() => { if (splitMode) toggleSplit(); else closeDock() }}/>}
        {showNewMail && <Pv2NewMail onClose={() => setShowNewMail(false)}/>}
      </div>
      {rag && <Pv2RagModal mail={rag} onClose={() => setRag(null)}/>}
      {timeline && <Pv2Timeline mail={timeline} catAccent={accentFor(catOf(timeline), categoriesByKey)} onClose={() => setTimeline(null)}/>}
      {kbFor && <Pv2KbModal mail={kbFor} onClose={() => setKbFor(null)}/>}
      {showActions && <Pv2ActionsModal onClose={() => setShowActions(false)}/>}
    </div>
  )
}

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import {
  PipelineLookupContext,
  HubSpotUsersContext,
  buildPipelineLookup,
} from '../hubspot-common'
import {
  filterAgentProposals,
  groupProposals,
  GROUP_META,
} from '../hubspot-shared.jsx'
import ProposalCard from './ProposalCard'
import ListRow from './ListRow'

// Lijst-kolom breedte clamps. Onder 280 wordt 't onleesbaar (titels truncen
// te aggressief), boven 600 verdwijnt het detail-paneel. localStorage-key
// persisteert tussen sessions.
const LIST_W_KEY  = 'adm-list-width'
const LIST_W_MIN  = 280
const LIST_W_MAX  = 600
const LIST_W_DEFAULT = 380

// Daily Admin · Maestro main desktop view — mockup-native JSX (Administratie.html).
// Bevat alleen filter-chips + inbox-split (lijst + detail). De drie info-blokken
// (Laatst verwerkt / Andere contactmomenten / Cijfers) zijn sinds 2026-05-13
// verhuisd naar AdminInfoPanel achter de "Informatie"-knop in de topbar.

const GROUP_ACCENT = {
  is_new:     'new',
  to_review:  'review',
  need_input: 'need',
}

export default function HubSpotInboxAView({
  proposals,
  pipelines,
  hubspotUsers,
  onRefresh,
  mutateProposal,
}) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(pipelines || []), [pipelines])
  const all = useMemo(() => filterAgentProposals(proposals), [proposals])

  const [statusFilter, setStatusFilter] = useState({ need_input: true, is_new: true, to_review: true })

  const buckets = useMemo(() => groupProposals(all), [all])

  const inboxList = useMemo(() => {
    const out = []
    if (statusFilter.is_new)     out.push(...buckets.is_new)
    if (statusFilter.to_review)  out.push(...buckets.to_review)
    if (statusFilter.need_input) out.push(...buckets.need_input)
    return out
  }, [buckets, statusFilter])

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && inboxList.length > 0) setSelectedId(inboxList[0].id)
    if (selectedId && !inboxList.find(p => p.id === selectedId)) setSelectedId(inboxList[0]?.id || null)
  }, [inboxList, selectedId])
  const selected = inboxList.find(p => p.id === selectedId) || null

  const hubspotUsersList = hubspotUsers || []

  // Drag-resize lijst-kolom. Init uit localStorage, schrijf bij elke release.
  const [listWidth, setListWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(LIST_W_KEY)
      const n = raw ? Number(raw) : NaN
      if (Number.isFinite(n) && n >= LIST_W_MIN && n <= LIST_W_MAX) return n
    } catch { /* localStorage onbeschikbaar */ }
    return LIST_W_DEFAULT
  })
  const dragRef = useRef(null)

  const onResizerMouseDown = useCallback((e) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: listWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [listWidth])

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const next = Math.max(LIST_W_MIN, Math.min(LIST_W_MAX, dragRef.current.startWidth + dx))
      setListWidth(next)
    }
    function onUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { localStorage.setItem(LIST_W_KEY, String(listWidth)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [listWidth])

  function onResizerDoubleClick() {
    setListWidth(LIST_W_DEFAULT)
    try { localStorage.setItem(LIST_W_KEY, String(LIST_W_DEFAULT)) } catch { /* ignore */ }
  }

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <HubSpotUsersContext.Provider value={hubspotUsersList}>
    <div className="adm">

      {/* Filter chips — mockup-native (count VOOR label) */}
      <div className="adm-filters">
        {['is_new', 'to_review', 'need_input'].map(g => {
          const active = statusFilter[g] !== false
          const accent = GROUP_ACCENT[g]
          const cls = [
            'filter-chip',
            active ? 'active' : '',
            active ? `accent-${accent}` : '',
          ].filter(Boolean).join(' ')
          return (
            <button
              key={g}
              type="button"
              className={cls}
              onClick={() => setStatusFilter(prev => ({ ...prev, [g]: !prev[g] }))}
              title={GROUP_META[g].hint}
            >
              <span className="filter-chip-count">{buckets[g].length}</span>
              {GROUP_META[g].label}
            </button>
          )
        })}
      </div>

      {/* Split: lijst + drag-handle + detail. Lijst-breedte komt uit state
       * (init via localStorage, opgeslagen bij elke release). 14px resizer-
       * kolom matcht de oude visuele gap-breedte. */}
      <div className="adm-split" style={{ gridTemplateColumns: `${listWidth}px 14px 1fr` }}>
        <aside className="adm-list">
          <div className="adm-list-scroll">
            {['is_new', 'to_review', 'need_input'].map(g => (
              buckets[g].length > 0 && statusFilter[g] !== false && (
                <div key={g} className="adm-list-group">
                  <div className={`adm-list-group-head adm-list-group-head--${GROUP_ACCENT[g]}`}>
                    {GROUP_META[g].label} <span>{buckets[g].length}</span>
                  </div>
                  {buckets[g].map(p => (
                    <ListRow
                      key={p.id}
                      proposal={p}
                      selected={p.id === selectedId}
                      onSelect={() => setSelectedId(p.id)}
                      pipelineLookup={pipelineLookup}
                    />
                  ))}
                </div>
              )
            ))}
            {inboxList.length === 0 && (
              <div className="adm-list-empty">
                Postvak leeg — alle voorstellen zijn verwerkt.
                <span>Bekijk de geschiedenis via "Informatie" rechtsboven.</span>
              </div>
            )}
          </div>
        </aside>

        <div
          className="adm-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Versleep om lijst-breedte aan te passen"
          title="Sleep om aan te passen · dubbelklik = reset"
          onMouseDown={onResizerMouseDown}
          onDoubleClick={onResizerDoubleClick}
        />

        <main className="adm-detail">
          {selected ? (
            <ProposalCard key={selected.id} proposal={selected} onRefresh={onRefresh} onMutate={mutateProposal} />
          ) : (
            <div className="adm-detail-empty">
              {inboxList.length === 0 ? 'Geen actieve voorstellen.' : 'Selecteer een item links.'}
            </div>
          )}
        </main>
      </div>

    </div>
    </HubSpotUsersContext.Provider>
    </PipelineLookupContext.Provider>
  )
}

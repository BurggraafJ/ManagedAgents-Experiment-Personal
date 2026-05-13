import { useMemo, useState, useEffect } from 'react'
import {
  PipelineLookupContext,
  HubSpotUsersContext,
  buildPipelineLookup,
} from '../../hubspot-common'
import {
  filterAgentProposals,
  groupProposals,
  GROUP_META,
} from '../../hubspot-shared.jsx'
import ProposalCardMaestro from './ProposalCardMaestro'
import ListRowMaestro from './ListRowMaestro'

// Daily Admin · Maestro main desktop view — mockup-native JSX (Administratie.html).
// Bevat alleen filter-chips + inbox-split (lijst + detail). De drie info-blokken
// (Laatst verwerkt / Andere contactmomenten / Cijfers) zijn sinds 2026-05-13
// verhuisd naar AdminInfoPanel achter de "Informatie"-knop in de topbar.

const GROUP_ACCENT = {
  is_new:     'new',
  to_review:  'review',
  need_input: 'need',
}

export default function HubSpotInboxAMaestroView({
  proposals,
  pipelines,
  hubspotUsers,
  onRefresh,
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

      {/* Split: lijst + detail */}
      <div className="adm-split">
        <aside className="adm-list">
          <div className="adm-list-scroll">
            {['is_new', 'to_review', 'need_input'].map(g => (
              buckets[g].length > 0 && statusFilter[g] !== false && (
                <div key={g} className="adm-list-group">
                  <div className={`adm-list-group-head adm-list-group-head--${GROUP_ACCENT[g]}`}>
                    {GROUP_META[g].label} <span>{buckets[g].length}</span>
                  </div>
                  {buckets[g].map(p => (
                    <ListRowMaestro
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

        <main className="adm-detail">
          {selected ? (
            <ProposalCardMaestro key={selected.id} proposal={selected} onRefresh={onRefresh} />
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

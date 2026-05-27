import { useNavigate } from 'react-router-dom'
import { useRagSearch } from '../../hooks/useRagSearch'
import { ALL_SOURCES } from '../../lib/rag'
import MIcon from '../MIcon'

// MobileZoeken — universele RAG-zoek. Geport uit app/mobile-zoeken.jsx.
// Hergebruikt useRagSearch() (rag-search Edge Function) → result.matches.
// Desktop RagSearchView blijft onaangeroerd.
const SOURCE_META = {
  mail: { label: 'Mails', icon: 'mail' },
  engagement: { label: 'Notes', icon: 'mail' },
  contact: { label: 'Contacten', icon: 'contacts' },
  company: { label: 'Bedrijven', icon: 'admin' },
  deal: { label: 'Deals', icon: 'admin' },
  meeting: { label: 'Meetings', icon: 'cal' },
  agenda: { label: 'Agenda', icon: 'cal' },
  note: { label: 'Notes', icon: 'mail' },
  chunk: { label: 'Kennis', icon: 'mind' },
}
const srcLabel = (s) => SOURCE_META[s]?.label || s
const srcIcon = (s) => SOURCE_META[s]?.icon || 'spark'

const titleOf = (m) => m.title || m.meta?.subject || m.meta?.name || m.meta?.full_name || m.meta?.from_name || m.meta?.dealname || m.meta?.from_email || srcLabel(m.source)
const snippetOf = (m) => m.content || m.text || m.chunk_text || m.snippet || m.meta?.body_preview || m.meta?.summary || ''
const simPct = (m) => (typeof m.similarity === 'number' ? `${Math.round(m.similarity * 100)}%` : '')

export default function MobileZoeken() {
  const navigate = useNavigate()
  const s = useRagSearch()

  const sourceCounts = s.counts || {}
  const allActive = (s.sources || []).length === ALL_SOURCES.length
  const pickSource = (src) => { if (src === 'all') s.setSources(ALL_SOURCES); else s.setSources([src]) }

  // Groepeer resultaten per source voor de lijst.
  const groups = []
  const seen = {}
  for (const m of (s.filteredMatches || [])) {
    if (!seen[m.source]) { seen[m.source] = []; groups.push(m.source) }
    seen[m.source].push(m)
  }

  return (
    <div className="m-zk">
      <header className="m-zk__head">
        <div className="m-zk__head-top">
          <button type="button" className="m-iconbtn" onClick={() => navigate('/')} aria-label="Terug"><MIcon name="chevron" size={18} /></button>
          <div className="m-zk__title">Zoeken</div>
        </div>
        <div className="m-zk__search">
          <MIcon name="search" size={16} />
          <input
            className="m-zk__input"
            placeholder="Zoek mails, contacten, deals, notes…"
            value={s.query}
            onChange={(e) => s.setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') s.run() }}
            autoFocus
          />
          {s.query && <button type="button" className="m-zk__clear" onClick={s.reset} aria-label="Wis"><MIcon name="close" size={13} stroke={2.2} /></button>}
        </div>
        <div className="m-zk__chips">
          <button type="button" className={`m-scopechip ${allActive ? 'is-active' : ''}`} onClick={() => pickSource('all')}>
            Alles{sourceCounts.all != null && <span className="m-scopechip__cnt">{sourceCounts.all}</span>}
          </button>
          {ALL_SOURCES.map(src => (
            <button key={src} type="button" className={`m-scopechip ${!allActive && (s.sources || []).includes(src) ? 'is-active' : ''}`} onClick={() => pickSource(src)}>
              <MIcon name={srcIcon(src)} size={11} /> {srcLabel(src)}{sourceCounts[src] ? <span className="m-scopechip__cnt">{sourceCounts[src]}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <div className="m-zk__body">
        {s.loading ? (
          <div className="m-zk__state">Zoeken…</div>
        ) : s.error ? (
          <div className="m-zk__state m-zk__state--err">{s.error}</div>
        ) : !s.result ? (
          <div className="m-zk__empty">
            <div className="m-zk__emptyico"><MIcon name="search" size={22} /></div>
            <div className="m-zk__emptytitle">Zoek door je hele werkruimte</div>
            <div className="m-zk__emptysub">Mails, contacten, deals, meetings en notes — in één zoekbalk. Typ en druk op enter.</div>
            <div className="m-zk__tip">
              <span className="m-zk__tipico"><MIcon name="spark" size={13} /></span>
              Tip: stel een hele vraag, bv. <em>"wat besprak ik laatst met Patrick?"</em>
            </div>
          </div>
        ) : (s.filteredMatches || []).length === 0 ? (
          <div className="m-zk__state">Geen resultaten voor "{s.result.query}".</div>
        ) : (
          <>
            {groups.map(src => (
              <div key={src} className="m-zk__group">
                <div className="m-zk__grouphead">{srcLabel(src)} · {seen[src].length}</div>
                {seen[src].map((m, i) => (
                  <div key={m.chunk_id || i} className="m-zk__res">
                    <div className="m-zk__resico"><MIcon name={srcIcon(src)} size={14} /></div>
                    <div className="m-zk__resbody">
                      <div className="m-zk__restitle">{titleOf(m)}</div>
                      {snippetOf(m) && <div className="m-zk__ressnip">{snippetOf(m)}</div>}
                    </div>
                    {simPct(m) && <span className="m-zk__ressim">{simPct(m)}</span>}
                  </div>
                ))}
              </div>
            ))}
            <div className="m-zk__foot">{s.filteredMatches.length} resultaten{s.result.took_ms ? ` · ${(s.result.took_ms / 1000).toFixed(2)}s` : ''}</div>
          </>
        )}
      </div>
    </div>
  )
}

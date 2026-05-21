import { useState, useRef, useEffect, useMemo } from 'react'
import s from './zoeken.module.css'
import { Ico, SOURCE_ICONS, SOURCE_LABELS } from './Icons'
import { useRagSearch } from '../../../hooks/useRagSearch'
import { ALL_SOURCES, DATE_PRESETS, AUDIENCE_FILTERS, fmtDate, fmtPct } from '../../../lib/rag'

// Records mode = handmatige RAG-search met list+preview master-detail.
// Hergebruikt rag-search Edge Function + log_search_feedback RPC.
// Geavanceerde filters (min_sim/top_k/rerank/max_per_source/audience) in popover.
export default function RecordsMode() {
  const hook = useRagSearch()
  const inputRef = useRef(null)
  const [activeSource, setActiveSource] = useState('all')
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [showAdv, setShowAdv] = useState(false)

  useEffect(() => { inputRef.current?.focus() }, [])

  const visibleMatches = useMemo(() => {
    if (activeSource === 'all') return hook.filteredMatches
    return hook.filteredMatches.filter(m => m.source === activeSource)
  }, [hook.filteredMatches, activeSource])

  const grouped = useMemo(() => {
    const groups = {}
    for (const m of visibleMatches) {
      const k = m.source
      if (!groups[k]) groups[k] = []
      groups[k].push(m)
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  }, [visibleMatches])

  // Selecteer automatisch eerste match bij nieuwe resultaten.
  useEffect(() => {
    if (visibleMatches.length > 0 && !visibleMatches.find(m => m.chunk_id === selectedMatch?.chunk_id)) {
      setSelectedMatch(visibleMatches[0])
    } else if (visibleMatches.length === 0) {
      setSelectedMatch(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hook.result])

  return (
    <section className={s.records}>
      <div className={s.rHead}>
        <div className={s.rHeadRow}>
          <label className={s.rSearch}>
            {Ico.search}
            <input
              ref={inputRef}
              type="search"
              value={hook.query}
              onChange={(e) => hook.setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') hook.run() }}
              placeholder="Stel een vraag of typ trefwoorden — bedrijf, persoon, dealnaam, e-mail-onderwerp…"
            />
            {hook.loading
              ? <span className={s.rSearchKbd}>…</span>
              : <span className={s.rSearchKbd}>⏎</span>}
          </label>
          <div className={s.advWrap}>
            <button type="button" className={s.advBtn} onClick={() => setShowAdv(v => !v)}>
              {Ico.sliders}
              Verfijn
            </button>
            {showAdv && (
              <AdvancedPopover
                hook={hook}
                onClose={() => setShowAdv(false)}
              />
            )}
          </div>
        </div>
        <Filters
          hook={hook}
          counts={hook.counts}
          active={activeSource}
          onPick={setActiveSource}
        />
      </div>

      <div className={s.rBody}>
        <div className={s.rList}>
          <div className={s.rListHead}>
            <div className={s.rListCount}>
              {hook.loading
                ? 'zoeken…'
                : hook.result
                ? <><strong>{visibleMatches.length}</strong> {visibleMatches.length === 1 ? 'record' : 'records'}</>
                : 'typ een zoekvraag'}
            </div>
            {hook.result && hook.result.min_similarity != null && (
              <span className={s.rListSort} title="Minimum similarity">
                ≥ {fmtPct(hook.result.min_similarity)}
              </span>
            )}
          </div>

          {hook.error && (
            <div style={{ padding: 18, color: '#991b1b', fontSize: 13 }}>
              {hook.error}
            </div>
          )}

          {!hook.error && grouped.length === 0 && hook.result && (
            <div style={{ padding: '24px 18px', color: 'var(--neutral-500)', fontSize: 13 }}>
              Niets gevonden boven {fmtPct(hook.result.min_similarity)} similarity. Verlaag de drempel in <em>Verfijn</em>.
            </div>
          )}

          {grouped.map(([src, matches]) => (
            <div key={src}>
              <div className={s.rListGroup}>{SOURCE_LABELS[src] || src} · {matches.length}</div>
              {matches.map((m) => (
                <ResultRow
                  key={m.chunk_id || `${src}-${m.id}`}
                  match={m}
                  active={selectedMatch?.chunk_id === m.chunk_id}
                  onClick={() => setSelectedMatch(m)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className={s.rPreview}>
          {selectedMatch ? (
            <RecordPreview match={selectedMatch} hook={hook} />
          ) : (
            <div className={s.rPreviewEmpty}>
              {Ico.search}
              <div className={s.rPreviewEmptyH}>Selecteer een record</div>
              <div className={s.rPreviewEmptyS}>De full text van de chunk verschijnt hier.</div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Filters({ hook, counts, active, onPick }) {
  return (
    <div className={s.rFilters}>
      <button className={`${s.rPill} ${active === 'all' ? s.rPillActive : ''}`} onClick={() => onPick('all')}>
        Alles <span className={s.rPillCount}>{counts.all || 0}</span>
      </button>
      {ALL_SOURCES.map((src) => (
        <button
          key={src}
          className={`${s.rPill} ${PILL_CLASS[src] || ''} ${active === src ? s.rPillActive : ''}`}
          onClick={() => onPick(src)}
          disabled={!counts[src]}
          style={{ opacity: counts[src] ? 1 : 0.45 }}
        >
          <span className={s.rPillDot} />
          {SOURCE_LABELS[src] || src}
          <span className={s.rPillCount}>{counts[src] || 0}</span>
        </button>
      ))}
      <span className={s.rPillSep} />
      {DATE_PRESETS.map((p) => (
        <button
          key={p.id}
          className={`${s.rPill} ${hook.datePresetId === p.id ? s.rPillActive : ''}`}
          onClick={() => hook.setDatePresetId(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

const PILL_CLASS = {
  mail: s.rPillMail,
  engagement: s.rPillMail,
  deal: s.rPillDeal,
  company: s.rPillCompany,
  contact: s.rPillContact,
  agenda: s.rPillAgenda,
  event: s.rPillAgenda,
  jira: s.rPillJira,
  meeting: s.rPillMeeting,
}

function AdvancedPopover({ hook, onClose }) {
  // Sluit op outside-click (klein scrim).
  useEffect(() => {
    const onDoc = (e) => {
      if (e.target.closest?.(`.${s.advPop}`) || e.target.closest?.(`.${s.advBtn}`)) return
      onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])
  return (
    <div className={s.advPop}>
      <div className={s.advRow}>
        <label>min similarity</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="range" min="0.2" max="0.9" step="0.05"
                 value={hook.minSim}
                 onChange={(e) => hook.setMinSim(parseFloat(e.target.value))}
                 style={{ width: 110 }} />
          <span style={{ minWidth: 32 }}>{Math.round(hook.minSim * 100)}%</span>
        </div>
      </div>
      <div className={s.advRow}>
        <label>top K</label>
        <select value={hook.topK} onChange={(e) => hook.setTopK(parseInt(e.target.value))}>
          {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className={s.advRow}>
        <label>max per source</label>
        <select value={hook.maxPerSource} onChange={(e) => hook.setMaxPerSource(parseInt(e.target.value))}>
          {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className={s.advRow}>
        <label>publiek</label>
        <select value={hook.audienceFilter} onChange={(e) => hook.setAudienceFilter(e.target.value)}>
          {AUDIENCE_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
      <div className={s.advRow}>
        <label>rerank (Haiku)</label>
        <input type="checkbox" checked={hook.enableRerank} onChange={(e) => hook.setEnableRerank(e.target.checked)} />
      </div>
      <div className={s.advNote}>
        Bron-filter staat altijd op alle bronnen — gebruik de pills bovenin om te filteren ná retrieval.
      </div>
    </div>
  )
}

function ResultRow({ match, active, onClick }) {
  const src = match.source
  const icoCls = ROW_ICO_CLASS[src] || s.icoMail
  return (
    <div className={`${s.rRow} ${active ? s.rRowActive : ''}`} onClick={onClick}>
      <div className={`${s.rRowIco} ${icoCls}`}>{SOURCE_ICONS[src] || SOURCE_ICONS.mail}</div>
      <div className={s.rRowMain}>
        <div className={s.rRowTitle}>{match.title || derivedTitle(match) || '(geen titel)'}</div>
        <div className={s.rRowMeta}>{rowMeta(match)}</div>
      </div>
      <div className={s.rRowDate}>{match.ts ? fmtShortDate(match.ts) : ''}</div>
    </div>
  )
}

const ROW_ICO_CLASS = {
  mail: s.icoMail,
  engagement: s.icoEngagement,
  deal: s.icoDeal,
  company: s.icoCompany,
  contact: s.icoContact,
  agenda: s.icoAgenda,
  event: s.icoEvent,
  meeting: s.icoMeeting,
  jira: s.icoJira,
  lesson: s.icoLesson,
}

function derivedTitle(m) {
  if (m.preview) return m.preview.split('\n').find(l => l.trim() && !l.startsWith('['))?.slice(0, 120)
  return null
}

function rowMeta(m) {
  const parts = []
  if (m.meta?.from_name) parts.push(<strong key="fn">{m.meta.from_name}</strong>)
  else if (m.meta?.from_email) parts.push(<strong key="fe">{m.meta.from_email}</strong>)
  if (m.meta?.company_name) parts.push(<span key="cn"> · {m.meta.company_name}</span>)
  if (m.similarity != null) parts.push(<span key="sim"> · {Math.round(m.similarity * 100)}%</span>)
  return parts.length > 0 ? parts : '—'
}

function fmtShortDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  } catch { return '' }
}

function RecordPreview({ match, hook }) {
  const fbState = hook.feedbackState[match.chunk_id]
  return (
    <>
      <div className={s.rPreviewBar}>
        <div className={s.rPreviewCrumbs}>
          {SOURCE_LABELS[match.source] || match.source} › <strong>{match.title || derivedTitle(match) || '(zonder titel)'}</strong>
        </div>
        <button
          className={`${s.asstAct} ${fbState === 'positive' ? s.asstActOn : ''}`}
          title="Nuttig" onClick={() => hook.submitFeedback(match, 'positive')}
        >{Ico.thumbsUp}</button>
        <button
          className={`${s.asstAct} ${fbState === 'negative' ? s.asstActOn : ''}`}
          title="Niet nuttig" onClick={() => hook.submitFeedback(match, 'negative')}
        >{Ico.thumbsDown}</button>
      </div>
      <div className={s.rPreviewBody}>
        <span className={s.rPreviewType}>
          {SOURCE_ICONS[match.source] || SOURCE_ICONS.mail}
          {SOURCE_LABELS[match.source] || match.source}
        </span>
        <h2 className={s.rPreviewTitle}>{match.title || derivedTitle(match) || '(geen titel)'}</h2>
        <dl className={s.rPreviewProps}>
          {match.ts && (<><dt>Datum</dt><dd>{fmtDate(match.ts)}</dd></>)}
          {match.meta?.from_name && (<><dt>Van</dt><dd>{match.meta.from_name}{match.meta.from_email ? ` <${match.meta.from_email}>` : ''}</dd></>)}
          {match.meta?.company_name && (<><dt>Bedrijf</dt><dd>{match.meta.company_name}</dd></>)}
          {match.similarity != null && (<><dt>Similarity</dt><dd>{fmtPct(match.similarity)}</dd></>)}
          {match.chunk_id && (<><dt>Chunk</dt><dd style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{match.chunk_id}</dd></>)}
        </dl>
        <div className={s.rPreviewTxt}>{match.preview || '(geen preview)'}</div>
      </div>
    </>
  )
}

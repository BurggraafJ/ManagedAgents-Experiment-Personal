import { useState, useRef, useEffect } from 'react'
import s from './zoeken-v2.module.css'
import { Ico } from './V2Icons'
import { useRagV2Chat } from '../../../../hooks/useRagV2Chat'
import { CHAT_SUGGESTIONS, makeAnswerParts, DATE_PRESETS, ALL_SOURCES } from '../../../../lib/rag'
import V2SourcesPanel from './V2SourcesPanel'
import { SourcesPopover, PeriodPopover, EntityPopover, ChatFilterTag } from './V2FilterPopovers'

// Chat-mode = vraag/antwoord-thread met slide-in sources-panel.
// Hergebruikt rag-chat Edge Function + makeAnswerParts() voor [bron #N] tags.
export default function V2ChatMode({ resetTick }) {
  const { messages, loading, send, reset } = useRagV2Chat()
  const [input, setInput] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMsgIdx, setPanelMsgIdx] = useState(null)
  const [highlightedCite, setHighlightedCite] = useState(null)

  // Composer-filter state — alle drie wordt mee verstuurd aan rag-chat.
  const [filterSources, setFilterSources] = useState([])     // [] = alle bronnen
  const [filterPeriod, setFilterPeriod] = useState('all')    // preset-id uit DATE_PRESETS
  const [filterEntity, setFilterEntity] = useState(null)     // { type, id, label, sub }

  const [openPop, setOpenPop] = useState(null)               // 'sources' | 'period' | 'entity' | null
  const sourcesAnchor = useRef(null)
  const periodAnchor = useRef(null)
  const entityAnchor = useRef(null)
  const inputRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { if (resetTick > 0) { reset(); setPanelOpen(false); setHighlightedCite(null) } }, [resetTick, reset])

  const buildSendOpts = () => {
    const opts = {}
    if (filterSources.length > 0 && filterSources.length < ALL_SOURCES.length) {
      opts.filter_sources = filterSources
    }
    const preset = DATE_PRESETS.find(p => p.id === filterPeriod)
    if (preset?.months) {
      const d = new Date()
      d.setMonth(d.getMonth() - preset.months)
      opts.filter_after = d.toISOString()
    }
    if (filterEntity) {
      opts.filter_entity_type = filterEntity.type
      opts.filter_entity_id = filterEntity.id
    }
    return opts
  }

  const submit = (override) => {
    const text = (override ?? input).trim()
    if (!text) return
    setInput('')
    send(text, buildSendOpts())
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  const openSources = (msgIdx, citeN) => {
    setPanelMsgIdx(msgIdx)
    setPanelOpen(true)
    if (citeN != null) {
      setHighlightedCite(citeN)
      setTimeout(() => {
        document.getElementById(`v2-citation-${citeN}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 60)
      setTimeout(() => setHighlightedCite(null), 2400)
    }
  }

  const panelMsg = panelMsgIdx != null ? messages[panelMsgIdx] : null

  return (
    <section className={s.chat}>
      <div className={s.chatScroll}>
        {messages.length === 0 ? (
          <EmptyState onPick={(q) => submit(q)} />
        ) : (
          <div className={s.thread}>
            {messages.map((m, i) => (
              <TurnRow key={i} m={m} idx={i} onOpenSources={openSources} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className={s.composer}>
        <div className={s.composerInner}>
          <div className={s.composerField}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Vraag iets over je mail, deals, contacten, Jira of agenda…"
              rows={1}
              className={s.composerInput}
            />
          </div>
          <div className={s.composerBar}>
            <div className={s.composerTags}>
              <div style={{ position: 'relative' }}>
                <ChatFilterTag
                  icon={Ico.globe}
                  label={filterSources.length === 0 ? 'Alle bronnen' : `${filterSources.length} ${filterSources.length === 1 ? 'bron' : 'bronnen'}`}
                  active={filterSources.length > 0}
                  onClick={(e) => {
                    if (filterSources.length > 0 && e.target.closest('svg')) { setFilterSources([]); return }
                    setOpenPop(openPop === 'sources' ? null : 'sources')
                  }}
                  anchorRef={sourcesAnchor}
                />
                <SourcesPopover
                  open={openPop === 'sources'}
                  value={filterSources}
                  onChange={setFilterSources}
                  onClose={() => setOpenPop(null)}
                  anchorRef={sourcesAnchor}
                />
              </div>
              <div style={{ position: 'relative' }}>
                <ChatFilterTag
                  icon={Ico.calendar}
                  label={DATE_PRESETS.find(p => p.id === filterPeriod)?.label || 'Periode'}
                  active={filterPeriod !== 'all'}
                  onClick={(e) => {
                    if (filterPeriod !== 'all' && e.target.closest('svg')) { setFilterPeriod('all'); return }
                    setOpenPop(openPop === 'period' ? null : 'period')
                  }}
                  anchorRef={periodAnchor}
                />
                <PeriodPopover
                  open={openPop === 'period'}
                  value={filterPeriod}
                  onChange={setFilterPeriod}
                  onClose={() => setOpenPop(null)}
                  anchorRef={periodAnchor}
                />
              </div>
              <div style={{ position: 'relative' }}>
                <ChatFilterTag
                  icon={filterEntity ? (filterEntity.type === 'contact' ? Ico.user : filterEntity.type === 'deal' ? Ico.deal : Ico.building) : Ico.building}
                  label={filterEntity ? filterEntity.label : 'Entity'}
                  active={!!filterEntity}
                  onClick={(e) => {
                    if (filterEntity && e.target.closest('svg')) { setFilterEntity(null); return }
                    setOpenPop(openPop === 'entity' ? null : 'entity')
                  }}
                  anchorRef={entityAnchor}
                />
                <EntityPopover
                  open={openPop === 'entity'}
                  value={filterEntity}
                  onChange={setFilterEntity}
                  onClose={() => setOpenPop(null)}
                  anchorRef={entityAnchor}
                />
              </div>
            </div>
            <button
              className={s.composerSend}
              onClick={() => submit()}
              disabled={loading || !input.trim()}
              title="Stuur (Enter)"
            >
              {Ico.send}
            </button>
          </div>
        </div>
        <div className={s.composerHint}>
          Maestro doorzoekt mail · HubSpot · Jira · agenda · meetings. Antwoorden bevatten altijd bronverwijzingen.
        </div>
      </div>

      <V2SourcesPanel
        open={panelOpen}
        citations={panelMsg?.citations || []}
        totalChunks={panelMsg?.chunk_count || (panelMsg?.citations || []).length}
        highlightedNum={highlightedCite}
        onClose={() => setPanelOpen(false)}
        onCiteClick={() => { /* citation is al de bron zelf */ }}
      />
    </section>
  )
}

function EmptyState({ onPick }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyBadge}>{Ico.sparkle}<span>Maestro · vector</span></div>
      <h1 className={s.emptyH}>Wat wil je <em>weten</em>?</h1>
      <p className={s.emptySub}>
        Stel je vraag in natuurlijke taal. Maestro zoekt door je mail, HubSpot, Jira en agenda en
        antwoordt met bronverwijzingen.
      </p>
      <div className={s.sugGrid}>
        {CHAT_SUGGESTIONS.map((q) => (
          <button key={q} type="button" className={s.sug} onClick={() => onPick(q)}>
            <span className={s.sugIco}>{Ico.sparkle}</span>
            <div className={s.sugMain}>
              <div className={s.sugQ}>{q}</div>
              <div className={s.sugHint}>klik om te vragen</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function TurnRow({ m, idx, onOpenSources }) {
  if (m.role === 'user') {
    return (
      <div className={s.user}>
        <div className={s.userAv}>JB</div>
        <div className={s.userBubble}>{m.content}</div>
      </div>
    )
  }
  return <AssistantTurn m={m} idx={idx} onOpenSources={onOpenSources} />
}

function AssistantTurn({ m, idx, onOpenSources }) {
  if (m.loading) {
    return (
      <div className={s.asst}>
        <div className={s.asstAv}>{Ico.sparkle}</div>
        <div className={s.asstMain}>
          <div className={s.asstMeta}><strong>Maestro</strong><span className={s.asstMetaDot} /><span>aan het zoeken &amp; redeneren…</span></div>
        </div>
      </div>
    )
  }
  if (m.error) {
    return (
      <div className={s.asst}>
        <div className={s.asstAv}>{Ico.sparkle}</div>
        <div className={s.asstMain}>
          <div className={s.errBubble}>Fout: {m.error}</div>
        </div>
      </div>
    )
  }
  const cites = m.citations || []
  const chunkCount = m.chunk_count ?? cites.length
  const timing = m.timing_ms ? `${(m.timing_ms / 1000).toFixed(1)} s` : null
  const confidence = m.confidence != null ? `${Math.round(m.confidence * 100)}% confidence` : null

  return (
    <div className={s.asst}>
      <div className={s.asstAv}>{Ico.sparkle}</div>
      <div className={s.asstMain}>
        <div className={s.asstMeta}>
          <strong>Maestro</strong>
          {chunkCount > 0 && <><span className={s.asstMetaDot} /><span>{chunkCount} chunks gelezen</span></>}
          {timing && <><span className={s.asstMetaDot} /><span>{timing}</span></>}
          {confidence && <><span className={s.asstMetaDot} /><span>{confidence}</span></>}
          {(m.knowledge_lessons?.length > 0) && (
            <span className={s.lessonBadge} title="JelleMind-lessons toegepast">
              {Ico.sparkle}
              {m.knowledge_lessons.length} {m.knowledge_lessons.length === 1 ? 'les' : 'lessen'}
            </span>
          )}
          {m.entity_used && (
            <span className={s.entityBadge} title={`Entity-aware retrieval — matched op "${m.entity_used.matched_term}"`}>
              {m.entity_used.entity_type === 'contact' ? Ico.user : m.entity_used.entity_type === 'deal' ? Ico.deal : Ico.building}
              <strong>{m.entity_used.name}</strong>
            </span>
          )}
        </div>
        <div className={s.asstBody}>
          {renderAnswer(m.content, (n) => onOpenSources(idx, n))}
        </div>
        {cites.length > 0 && (
          <div className={s.srcrow}>
            <span className={s.srcrowLbl}>Bronnen</span>
            {cites.slice(0, 4).map((c) => (
              <button key={c.n} type="button" className={s.srcchip} onClick={() => onOpenSources(idx, c.n)}>
                <span className={s.srcchipNum}>{c.n}</span>
                <span className={s.srcchipLbl}>{c.label || c.source}</span>
              </button>
            ))}
            {cites.length > 4 && (
              <button type="button" className={s.srcchipMore} onClick={() => onOpenSources(idx, null)}>
                + {cites.length - 4} meer
              </button>
            )}
          </div>
        )}
        <ChatActions m={m} idx={idx} />
      </div>
    </div>
  )
}

function ChatActions({ m, idx }) {
  const [picked, setPicked] = useState(null)
  const onCopy = () => {
    try { navigator.clipboard.writeText(m.content || '') } catch { /* ignore */ }
  }
  return (
    <div className={s.asstActions}>
      <button className={`${s.asstAct} ${picked === 'up' ? s.asstActOn : ''}`}
              title="Goed antwoord" onClick={() => setPicked('up')}>{Ico.thumbsUp}</button>
      <button className={`${s.asstAct} ${picked === 'down' ? s.asstActOn : ''}`}
              title="Niet goed" onClick={() => setPicked('down')}>{Ico.thumbsDown}</button>
      <button className={s.asstAct} title="Kopieer" onClick={onCopy}>{Ico.copy}</button>
    </div>
  )
}

function renderAnswer(text, onCite) {
  if (!text) return null
  return makeAnswerParts(text).map((p, i) => {
    if (p.type === 'cite') {
      return (
        <button key={i} type="button" className={s.cite} onClick={() => onCite(p.n)} title={`Spring naar bron #${p.n}`}>
          {p.n}
        </button>
      )
    }
    return <span key={i}>{p.value}</span>
  })
}

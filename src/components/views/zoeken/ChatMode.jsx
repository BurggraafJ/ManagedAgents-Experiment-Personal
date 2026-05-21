import { useState, useRef, useEffect, useCallback, memo } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { CHAT_SUGGESTIONS, DATE_PRESETS, ALL_SOURCES } from '../../../lib/rag'
import SourcesPanel from './SourcesPanel'
import { SourcesPopover, PeriodPopover, EntityPopover, ChatFilterTag } from './FilterPopovers'
import { LoadingSteps, RetrievalDebug, usedNsFor } from './ChatExtras'
import Markdown from './Markdown'
import { splitFollowUps, FollowupChips } from './Followups'

// Chat-mode = vraag/antwoord-thread met slide-in sources-panel.
// `chat`-prop bevat de gehoiste useRagChat hook: messages/send/sessionId/etc.
// History-panel + topbar-knop zit in parent RagSearchView.
export default function ChatMode({ chat }) {
  const { messages, loading, send } = chat
  const [input, setInput] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMsgIdx, setPanelMsgIdx] = useState(null)
  const [highlightedCite, setHighlightedCite] = useState(null)

  // Composer-filter state — wordt mee verstuurd aan rag-chat.
  const [filterSources, setFilterSources] = useState([])     // [] = alle bronnen
  const [filterPeriod, setFilterPeriod] = useState('all')    // preset-id uit DATE_PRESETS
  const [filterEntity, setFilterEntity] = useState(null)     // { type, id, label, sub }
  const [webSearch, setWebSearch] = useState(false)          // Grok Live Search — default uit

  const [openPop, setOpenPop] = useState(null)               // 'sources' | 'period' | 'entity' | null
  const sourcesAnchor = useRef(null)
  const periodAnchor = useRef(null)
  const entityAnchor = useRef(null)
  const inputRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Scroll-throttling: tijdens streaming gebeurt setMessages 60x/sec (rAF).
  // Een smooth-scroll animatie per delta = page-hang. We scrollen daarom
  // alleen als (a) aantal messages wijzigt, (b) streaming start of stopt,
  // én gebruiken behavior: 'auto' tijdens streaming (instant, geen animatie).
  const messageCount = messages.length
  const lastStreaming = messages[messages.length - 1]?.streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: lastStreaming ? 'auto' : 'smooth', block: 'end' })
  }, [messageCount, lastStreaming])

  // Bij sessie-switch (chat.sessionId verandert): sluit panel/highlight.
  useEffect(() => { setPanelOpen(false); setHighlightedCite(null) }, [chat.sessionId])

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
    if (webSearch) opts.web_search = true
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

  // Stable refs voor memo'd TurnRow — anders verandert de prop bij elke render.
  const openSources = useCallback((msgIdx, citeN) => {
    setPanelMsgIdx(msgIdx)
    setPanelOpen(true)
    if (citeN != null) {
      setHighlightedCite(citeN)
      setTimeout(() => {
        document.getElementById(`v2-citation-${citeN}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 60)
      setTimeout(() => setHighlightedCite(null), 2400)
    }
  }, [])

  // submit is closure over input + filters + send. Voor memo'd TurnRow.onFollowUp
  // is alleen de prompt-string belangrijk — geef daarom een lichte wrapper.
  const submitForFollowUp = useCallback((q) => {
    send(q, buildSendOpts())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, filterSources, filterPeriod, filterEntity])

  const panelMsg = panelMsgIdx != null ? messages[panelMsgIdx] : null

  return (
    <section className={s.chat}>
      <div className={s.chatScroll}>
        {messages.length === 0 ? (
          <EmptyState onPick={(q) => submit(q)} />
        ) : (
          <div className={s.thread}>
            {messages.map((m, i) => (
              <TurnRow key={i} m={m} idx={i} onOpenSources={openSources} onFollowUp={submitForFollowUp} />
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
        <div className={s.composerFoot}>
          <div className={s.composerToggles}>
            <button
              type="button"
              className={`${s.webToggle} ${webSearch ? s.webToggleOn : ''}`}
              onClick={() => setWebSearch(v => !v)}
              title={webSearch ? 'Web-search staat AAN voor deze vraag — klik om uit te zetten' : 'Web-search staat uit — klik om actuele info van het web mee te nemen'}
            >
              {Ico.globe}
              <span className={s.webToggleLabel}>Web</span>
              <span className={s.webToggleDot} />
            </button>
            <button
              type="button"
              className={`${s.webToggle} ${s.webToggleSoon}`}
              disabled
              title="SharePoint-overeenkomsten doorzoeken — binnenkort beschikbaar"
            >
              {Ico.docs}
              <span className={s.webToggleLabel}>SharePoint</span>
              <span className={s.soonBadge}>Soon</span>
            </button>
          </div>
          <div className={s.composerHint}>
            Maestro doorzoekt mail · HubSpot · Jira · agenda · meetings. Antwoorden bevatten altijd bronverwijzingen.
          </div>
        </div>
      </div>

      {/* HistoryPanel zit nu in parent RagSearchView en toont Supabase-sessions */}

      <SourcesPanel
        open={panelOpen}
        citations={panelMsg?.citations || []}
        webCitations={panelMsg?.web_citations || []}
        totalChunks={panelMsg?.chunk_count || (panelMsg?.citations || []).length}
        highlightedNum={highlightedCite}
        usedNs={usedNsFor(panelMsg)}
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

// Memo: alleen re-render als message-shallow-changed. Tijdens streaming
// muteren we voornamelijk het LAATSTE bericht — eerdere TurnRows blijven
// dan in cache en re-renderen niet meer per delta.
const TurnRow = memo(TurnRowInner, (prev, next) => {
  return prev.m === next.m
      && prev.idx === next.idx
      && prev.onOpenSources === next.onOpenSources
      && prev.onFollowUp === next.onFollowUp
})

function TurnRowInner({ m, idx, onOpenSources, onFollowUp }) {
  if (m.role === 'user') {
    return (
      <div className={s.user} data-msg-idx={idx}>
        <div className={s.userAv}>JB</div>
        <div className={s.userBubble}>{m.content}</div>
      </div>
    )
  }
  return <AssistantTurn m={m} idx={idx} onOpenSources={onOpenSources} onFollowUp={onFollowUp} />
}

function AssistantTurn({ m, idx, onOpenSources, onFollowUp }) {
  // Tijdens streaming heeft het bericht al content; toon dat liever dan
  // de LoadingSteps-skelton. Alleen het ALLEREERSTE loading-state (geen
  // content nog) krijgt de step-indicator.
  if (m.loading && !m.content) {
    return (
      <div className={s.asst}>
        <div className={s.asstAv}>{Ico.sparkle}</div>
        <div className={s.asstMain}>
          <div className={s.asstMeta}>
            <strong>Maestro</strong>
            <span className={s.asstMetaDot} />
            <span>aan het werk<span className={s.thinkingDots}><span /><span /><span /></span></span>
          </div>
          <LoadingSteps />
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
  const timing = m.timing_ms?.total ?? m.timing_ms
  const timingStr = typeof timing === 'number' ? `${(timing / 1000).toFixed(1)} s` : null
  const confidence = m.confidence != null ? `${Math.round(m.confidence * 100)}% confidence` : null
  const { main, followups } = splitFollowUps(m.content || '')

  return (
    <div className={s.asst}>
      <div className={s.asstAv}>{Ico.sparkle}</div>
      <div className={s.asstMain}>
        <div className={s.asstMeta}>
          <strong>Maestro</strong>
          {chunkCount > 0 && <><span className={s.asstMetaDot} /><span>{chunkCount} chunks gelezen</span></>}
          {timingStr && <><span className={s.asstMetaDot} /><span>{timingStr}</span></>}
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
          {/* Markdown ook tijdens streaming — useDeferredValue + 250ms
              throttle in hook + invalid-citation filter zorgt dat het
              snel blijft. Plain-text-modus was te lelijk volgens Jelle. */}
          <Markdown
            text={main}
            onCiteClick={(n) => onOpenSources(idx, n)}
            validCiteNs={cites.map(c => c.n)}
          />
        </div>
        {/* Web-search status-blok. Drie cases:
              1. web_search_enabled && web_search_used   → groen, met bronnen
              2. web_search_enabled && !web_search_used  → grijs, "niet nodig"
                 + extra rode warning als antwoord toch URLs/[[N]](url) bevat
                 (= Grok hallucineerde, prompt v3.11 zou dit moeten dichten).
              3. !web_search_enabled                     → niks (geen blok). */}
        {!m.streaming && m.web_search_enabled && (() => {
          const cites = Array.isArray(m.web_citations) ? m.web_citations : []
          const calls = m.web_search_calls ?? (m.web_search_used ? 1 : 0)
          const used = m.web_search_used ?? (cites.length > 0)
          // Hallucination-detector: link-citaten of plain https-URLs in antwoord
          // terwijl Grok de search-tool niet aanriep.
          const txt = m.content || ''
          const linkCiteRe = /\[\[?\d+\]?\]\(https?:\/\/[^)\s]+\)/
          const plainUrlRe = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i
          const looksHallucinated = !used && (linkCiteRe.test(txt) || plainUrlRe.test(txt))
          return (
            <div className={`${s.webCitesWrap} ${used ? s.webCitesUsed : s.webCitesSkipped}`}>
              <div className={s.webCitesHead}>
                {Ico.globe}
                {used ? (
                  <span>Web doorzocht · {calls} {calls === 1 ? 'zoekopdracht' : 'zoekopdrachten'} · {cites.length} {cites.length === 1 ? 'bron' : 'bronnen'}</span>
                ) : (
                  <span>Web-search stond aan maar Grok vond het niet nodig</span>
                )}
              </div>
              {looksHallucinated && (
                <div className={s.webCitesHallucinatedWarn}>
                  ⚠ Het antwoord lijkt URLs of externe bronnen te noemen, terwijl Grok geen web-search heeft gedaan. Behandel die met argwaan — mogelijk verzonnen.
                </div>
              )}
              {cites.length > 0 && (
                <ul className={s.webCitesList}>
                  {cites.slice(0, 8).map((c, i) => {
                    const url = typeof c === 'string' ? c : c.url
                    const title = typeof c === 'object' ? (c.title || url) : url
                    if (!url) return null
                    let host = ''
                    try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* ignore */ }
                    return (
                      <li key={i} className={s.webCiteItem}>
                        <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
                          <strong>{title}</strong>
                          {host && <span className={s.webCiteHost}>{host}</span>}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })()}
        {/* Bronnen + Vervolgvragen pas zichtbaar NA streaming — schoner
            en voorkomt re-render-storm tijdens delta-flow. */}
        {!m.streaming && <FollowupChips items={followups} onPick={onFollowUp} />}
        {!m.streaming && (
          <div className={s.asstActionRow}>
            {cites.length > 0 && (
              <button
                type="button"
                className={s.bronBtn}
                onClick={() => onOpenSources(idx, null)}
                title="Open bronnen-paneel"
              >
                {Ico.info}
                {cites.length} {cites.length === 1 ? 'bron' : 'bronnen'} bekijken
              </button>
            )}
            <ChatActions m={m} idx={idx} />
            <RetrievalDebug m={m} />
          </div>
        )}
      </div>
    </div>
  )
}

function ChatActions({ m }) {
  const [copied, setCopied] = useState(false)
  const onCopy = () => {
    try {
      navigator.clipboard.writeText(m.content || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* ignore */ }
  }
  return (
    <div className={s.asstActions}>
      <button className={`${s.asstAct} ${copied ? s.asstActOn : ''}`}
              title={copied ? 'Gekopieerd' : 'Kopieer antwoord'}
              onClick={onCopy}>{Ico.copy}</button>
    </div>
  )
}


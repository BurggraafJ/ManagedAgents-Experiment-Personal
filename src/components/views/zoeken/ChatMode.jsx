import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { CHAT_SUGGESTIONS, DATE_PRESETS, ALL_SOURCES } from '../../../lib/rag'
import SourcesPanel from './SourcesPanel'
import { SourcesPopover, PeriodPopover, EntityPopover, ChatFilterTag } from './FilterPopovers'
import { LoadingSteps, RetrievalDebug, usedNsFor } from './ChatExtras'
import Markdown from './Markdown'
import { splitFollowUps, FollowupChips } from './Followups'
import AnalyticsBlock from './AnalyticsBlock'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'

// Chat-mode = vraag/antwoord-thread met slide-in sources-panel.
// `chat`-prop bevat de gehoiste useRagChat hook: messages/send/sessionId/etc.
// History-panel + topbar-knop zit in parent RagSearchView.
export default function ChatMode({ chat }) {
  const { messages, loading, send, sendFeedback } = chat
  const [input, setInput] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMsgIdx, setPanelMsgIdx] = useState(null)
  const [highlightedCite, setHighlightedCite] = useState(null)

  // Composer-filter state — wordt mee verstuurd aan rag-chat.
  const [filterSources, setFilterSources] = useState([])     // [] = alle bronnen
  const [filterPeriod, setFilterPeriod] = useState('all')    // preset-id uit DATE_PRESETS
  const [filterEntity, setFilterEntity] = useState(null)     // { type, id, label, sub }
  const [webSearch, setWebSearch] = useState(false)          // Grok Live Search — default uit

  // Voorkeuren: 3 categorieën uit DB (rag_chat_writing_styles met category-veld).
  // style/tone/focus, elk in localStorage. Default-slug uit is_default=true.
  const { data: prefsData } = useSupabaseQuery('rag_chat_writing_styles', {
    select: 'category, slug, label, description, is_default, sort_order',
    orderBy: ['sort_order', { ascending: true }],
    initialData: [],
  })
  const prefsByCategory = useMemo(() => {
    const rows = Array.isArray(prefsData) ? prefsData : []
    const out = { style: [], tone: [], focus: [] }
    for (const r of rows) {
      const cat = r.category || 'style'
      if (out[cat]) out[cat].push(r)
    }
    return out
  }, [prefsData])
  const defaultFor = useCallback((cat) => {
    const list = prefsByCategory[cat] || []
    return (list.find(x => x.is_default) || list[0])?.slug || null
  }, [prefsByCategory])
  const [writingStyle, setWritingStyle] = useState(() => { try { return localStorage.getItem('rag-pref-style') || null } catch { return null } })
  const [tone, setTone]   = useState(() => { try { return localStorage.getItem('rag-pref-tone')  || null } catch { return null } })
  const [focus, setFocus] = useState(() => { try { return localStorage.getItem('rag-pref-focus') || null } catch { return null } })
  // Als prefs nog leeg of slug niet meer bestaat → default uit DB.
  useEffect(() => {
    if ((prefsByCategory.style || []).length === 0) return
    if (!writingStyle || !prefsByCategory.style.some(x => x.slug === writingStyle)) setWritingStyle(defaultFor('style'))
    if (!tone         || !prefsByCategory.tone.some(x => x.slug === tone))           setTone(defaultFor('tone'))
    if (!focus        || !prefsByCategory.focus.some(x => x.slug === focus))         setFocus(defaultFor('focus'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsByCategory])
  const onPickPref = useCallback((cat, slug) => {
    if (cat === 'style') { setWritingStyle(slug); try { localStorage.setItem('rag-pref-style', slug) } catch { /* ignore */ } }
    if (cat === 'tone')  { setTone(slug);          try { localStorage.setItem('rag-pref-tone',  slug) } catch { /* ignore */ } }
    if (cat === 'focus') { setFocus(slug);         try { localStorage.setItem('rag-pref-focus', slug) } catch { /* ignore */ } }
  }, [])
  const resetPrefsToDefaults = useCallback(() => {
    const dStyle = defaultFor('style'); const dTone = defaultFor('tone'); const dFocus = defaultFor('focus')
    if (dStyle) onPickPref('style', dStyle)
    if (dTone)  onPickPref('tone',  dTone)
    if (dFocus) onPickPref('focus', dFocus)
  }, [defaultFor, onPickPref])
  // Label voor de tag: actieve niet-default prefs.
  const prefAnyActive = useMemo(() => {
    const dStyle = defaultFor('style'); const dTone = defaultFor('tone'); const dFocus = defaultFor('focus')
    return (writingStyle && writingStyle !== dStyle) || (tone && tone !== dTone) || (focus && focus !== dFocus)
  }, [writingStyle, tone, focus, defaultFor])
  const prefSummaryLabel = useMemo(() => {
    if (!prefAnyActive) return 'Voorkeuren'
    const parts = []
    const dStyle = defaultFor('style'); const dTone = defaultFor('tone'); const dFocus = defaultFor('focus')
    const sLabel = prefsByCategory.style.find(x => x.slug === writingStyle)?.label
    const tLabel = prefsByCategory.tone.find(x => x.slug === tone)?.label
    const fLabel = prefsByCategory.focus.find(x => x.slug === focus)?.label
    if (writingStyle && writingStyle !== dStyle && sLabel) parts.push(sLabel)
    if (tone && tone !== dTone && tLabel) parts.push(tLabel)
    if (focus && focus !== dFocus && fLabel) parts.push(fLabel)
    return parts.length === 0 ? 'Voorkeuren' : parts.join(' · ')
  }, [prefAnyActive, prefsByCategory, writingStyle, tone, focus, defaultFor])
  const prefsAnchor = useRef(null)
  const libraryAnchor = useRef(null)

  // Prompt library — uit DB, klik vult input zonder versturen.
  const { data: libraryData } = useSupabaseQuery('rag_prompt_library', {
    select: 'id, label, prompt_text, sort_order',
    orderBy: ['sort_order', { ascending: true }],
    initialData: [],
  })
  const library = useMemo(() => (Array.isArray(libraryData) ? libraryData : []), [libraryData])
  const onPickPrompt = useCallback((text) => {
    setInput(text || '')
    setOpenPop(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

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
    if (writingStyle) opts.writing_style = writingStyle
    if (tone) opts.tone = tone
    if (focus) opts.focus = focus
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
          <EmptyState onPick={(q) => submit(q)} suggestions={library.length ? library.slice(0, 6).map(l => l.prompt_text).filter(Boolean) : null} />
        ) : (
          <div className={s.thread}>
            {messages.map((m, i) => (
              <TurnRow key={i} m={m} idx={i} onOpenSources={openSources} onFollowUp={submitForFollowUp} onFeedback={sendFeedback} currentWebSearch={webSearch} />
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
                  icon={Ico.sliders}
                  label={prefSummaryLabel}
                  active={prefAnyActive}
                  onClick={(e) => {
                    if (prefAnyActive && e.target.closest('svg')) { resetPrefsToDefaults(); return }
                    setOpenPop(openPop === 'prefs' ? null : 'prefs')
                  }}
                  anchorRef={prefsAnchor}
                />
                <PreferencesPopover
                  open={openPop === 'prefs'}
                  styles={prefsByCategory.style}
                  tones={prefsByCategory.tone}
                  focuses={prefsByCategory.focus}
                  style={writingStyle}
                  tone={tone}
                  focus={focus}
                  onPick={onPickPref}
                  onClose={() => setOpenPop(null)}
                  anchorRef={prefsAnchor}
                />
              </div>
              <div style={{ position: 'relative' }}>
                <ChatFilterTag
                  icon={Ico.sparkle}
                  label="Voorbeelden"
                  active={false}
                  onClick={() => setOpenPop(openPop === 'library' ? null : 'library')}
                  anchorRef={libraryAnchor}
                />
                <PromptLibraryPopover
                  open={openPop === 'library'}
                  items={library}
                  onPick={onPickPrompt}
                  onClose={() => setOpenPop(null)}
                  anchorRef={libraryAnchor}
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

function EmptyState({ onPick, suggestions }) {
  // F.1g: dynamische voorbeeldvragen uit rag_prompt_library (DB) met fallback op de statische set.
  const items = (suggestions && suggestions.length) ? suggestions : CHAT_SUGGESTIONS
  return (
    <div className={s.empty}>
      <div className={s.emptyBadge}>{Ico.sparkle}<span>Maestro · vector</span></div>
      <h1 className={s.emptyH}>Wat wil je <em>weten</em>?</h1>
      <p className={s.emptySub}>
        Stel je vraag in natuurlijke taal. Maestro zoekt door je mail, HubSpot, Jira en agenda en
        antwoordt met bronverwijzingen.
      </p>
      <div className={s.sugGrid}>
        {items.map((q) => (
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
      && prev.onFeedback === next.onFeedback
      && prev.currentWebSearch === next.currentWebSearch
})

function TurnRowInner({ m, idx, onOpenSources, onFollowUp, onFeedback, currentWebSearch }) {
  if (m.role === 'user') {
    return (
      <div className={s.user} data-msg-idx={idx}>
        <div className={s.userAv}>JB</div>
        <div className={s.userBubble}>{m.content}</div>
      </div>
    )
  }
  return <AssistantTurn m={m} idx={idx} onOpenSources={onOpenSources} onFollowUp={onFollowUp} onFeedback={onFeedback} currentWebSearch={currentWebSearch} />
}

function AssistantTurn({ m, idx, onOpenSources, onFollowUp, onFeedback, currentWebSearch }) {
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
          <LoadingSteps webSearch={m.web_search_enabled ?? currentWebSearch} />
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
        {/* Geen lompe web-search banner meer onder het antwoord. Status komt
            terug in de bestaande asstMeta-rij (chunk-count etc) en de bronnen
            zitten in het SourcesPanel onder de "Web"-tab. */}
        {/* Vragenbak-analytics (structured/sweep): exacte tabel + dekking-
            banner. Zichtbaar zodra meta binnen is (ook tijdens streaming —
            de data is dan al definitief). */}
        {m.analytics && <AnalyticsBlock analytics={m.analytics} />}
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
            <ChatActions m={m} idx={idx} onFeedback={onFeedback} />
            <RetrievalDebug m={m} />
          </div>
        )}
      </div>
    </div>
  )
}

function ChatActions({ m, onFeedback }) {
  const [copied, setCopied] = useState(false)
  const [fb, setFb] = useState(null)   // 'thumbs_up' | 'thumbs_down'
  const onCopy = () => {
    try {
      navigator.clipboard.writeText(m.content || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* ignore */ }
  }
  const giveFeedback = async (rating) => {
    if (fb) return
    setFb(rating)
    const ok = await onFeedback?.(m, rating)
    if (!ok) setFb(null)   // revert bij fout
  }
  return (
    <div className={s.asstActions}>
      <button className={`${s.asstAct} ${copied ? s.asstActOn : ''}`}
              title={copied ? 'Gekopieerd' : 'Kopieer antwoord'}
              onClick={onCopy}>{Ico.copy}</button>
      <button className={`${s.asstAct} ${fb === 'thumbs_up' ? s.asstActOn : ''}`}
              title="Goed antwoord — voedt de RAG-kwaliteitsmeting"
              onClick={() => giveFeedback('thumbs_up')} disabled={!!fb}>👍</button>
      <button className={`${s.asstAct} ${fb === 'thumbs_down' ? s.asstActOn : ''}`}
              title="Niet goed — voedt de RAG-kwaliteitsmeting"
              onClick={() => giveFeedback('thumbs_down')} disabled={!!fb}>👎</button>
    </div>
  )
}

// Voorkeuren-popover in de composer-bar. Drie categorieën uit DB:
//   - Schrijfstijl (lengte/vorm)
//   - Toon (formaliteit)
//   - Focus (inhoud-doel)
// Elke selectie wordt direct opgeslagen in localStorage en meegestuurd in body.
function PreferencesPopover({ open, styles, tones, focuses, style, tone, focus, onPick, onClose, anchorRef }) {
  const popRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const handle = (e) => {
      if (popRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') onClose?.() })
    return () => document.removeEventListener('mousedown', handle)
  }, [open, anchorRef, onClose])
  if (!open) return null
  return (
    <div ref={popRef} className={s.prefsPopover} role="dialog" aria-label="Voorkeuren">
      <PrefGroup title="Schrijfstijl" options={styles} value={style} onPick={(slug) => onPick('style', slug)} />
      <PrefGroup title="Toon"        options={tones}  value={tone}  onPick={(slug) => onPick('tone',  slug)} />
      <PrefGroup title="Focus"       options={focuses} value={focus} onPick={(slug) => onPick('focus', slug)} />
    </div>
  )
}

// Prompt library popover — lijst van voorbeelden uit DB. Klik vult input
// (verstuurt niet) zodat Jelle zelf nog kan tweaken voor versturen.
function PromptLibraryPopover({ open, items, onPick, onClose, anchorRef }) {
  const popRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const handle = (e) => {
      if (popRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, anchorRef, onClose])
  if (!open) return null
  return (
    <div ref={popRef} className={s.libPopover} role="menu" aria-label="Voorbeeld-prompts">
      <div className={s.libHeader}>Voorbeeld-prompts</div>
      {(!items || items.length === 0) ? (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--neutral-400)' }}>Geen voorbeelden ingesteld.</div>
      ) : items.map(item => (
        <button
          key={item.id}
          type="button"
          className={s.libItem}
          onClick={() => onPick(item.prompt_text)}
          role="menuitem"
        >
          <span className={s.libItemLabel}>{item.label}</span>
          <span className={s.libItemPreview}>{item.prompt_text}</span>
        </button>
      ))}
    </div>
  )
}

function PrefGroup({ title, options, value, onPick }) {
  if (!options || options.length === 0) return null
  return (
    <div className={s.prefsGroup}>
      <div className={s.prefsGroupTitle}>{title}</div>
      <div className={s.prefsOptions}>
        {options.map(opt => (
          <button
            key={opt.slug}
            type="button"
            className={`${s.prefsOption} ${value === opt.slug ? s.prefsOptionActive : ''}`}
            onClick={() => onPick(opt.slug)}
            title={opt.description || opt.label}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}


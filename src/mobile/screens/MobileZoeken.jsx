import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRagSearch } from '../../hooks/useRagSearch'
import { useRagChat } from '../../hooks/useRagChat'
import { ALL_SOURCES } from '../../lib/rag'
import Markdown from '../../components/views/zoeken/Markdown'
import MIcon from '../MIcon'

// MobileZoeken — universele RAG-zoek + Vraagbaak (chat). Geport uit
// app/mobile-zoeken.jsx (incl. ModeToggle + MobileVraagbaak). Hergebruikt
// useRagSearch (records) en useRagChat (streaming chat).
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
  // Default = Chat (Vraagbaak) — Jelle gebruikt mobiel vooral voor chat.
  const [mode, setMode] = useState('ask')

  return (
    <div className={`m-zk m-zk--${mode}`}>
      <header className="m-zk__head">
        <div className="m-modetoggle">
          <button type="button" className={`m-modetoggle__btn ${mode === 'ask' ? 'is-active' : ''}`} onClick={() => setMode('ask')}>
            <MIcon name="spark" size={12} /> Chat
          </button>
          <button type="button" className={`m-modetoggle__btn ${mode === 'search' ? 'is-active' : ''}`} onClick={() => setMode('search')}>
            <MIcon name="search" size={12} /> Zoeken
          </button>
        </div>
      </header>

      {mode === 'search' ? <SearchMode /> : <AskMode />}
    </div>
  )
}

function SearchMode() {
  const s = useRagSearch()
  const sourceCounts = s.counts || {}
  const allActive = (s.sources || []).length === ALL_SOURCES.length
  const pickSource = (src) => { if (src === 'all') s.setSources(ALL_SOURCES); else s.setSources([src]) }

  const groups = []
  const seen = {}
  for (const m of (s.filteredMatches || [])) {
    if (!seen[m.source]) { seen[m.source] = []; groups.push(m.source) }
    seen[m.source].push(m)
  }

  return (
    <>
      <div className="m-zk__searchwrap">
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
      </div>

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
              Tip: stel een hele vraag via <em>Chat</em> — bv. <em>"wat besprak ik laatst met Patrick?"</em>
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
    </>
  )
}

function AskMode() {
  const chat = useRagChat()
  const [text, setText] = useState('')
  const scrollRef = useRef(null)

  // Composer-lift bij open toetsenbord (visualViewport) + scroll-lock op de
  // mobiele shell zodat iOS niet zelf rare scroll-into-view-acties doet als
  // de input focus krijgt. Composer plakt netjes tegen het toetsenbord.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('m-zk-ask-active')
    const vv = window.visualViewport
    const apply = () => {
      if (!vv) return
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      root.style.setProperty('--m-kb', `${kb}px`)
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      root.style.setProperty('--m-kb', '0px')
      root.classList.remove('m-zk-ask-active')
    }
  }, [])

  // Auto-scroll naar laatste bericht bij nieuwe inhoud.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chat.messages.length, chat.messages[chat.messages.length - 1]?.content])

  const onSubmit = () => {
    const t = text.trim()
    if (!t || chat.loading) return
    setText('')
    chat.send(t)
  }

  return (
    <>
      <div className="m-vb__body" ref={scrollRef}>
        {chat.messages.length === 0 ? (
          <div className="m-zk__empty">
            <div className="m-zk__emptyico"><MIcon name="spark" size={22} /></div>
            <div className="m-zk__emptytitle">Vraag Maestro alles</div>
            <div className="m-zk__emptysub">Hele vragen werken het best — mails, meetings, contacten en notes worden meegenomen.</div>
            <div className="m-zk__suggestions">
              {[
                'Wat besprak ik laatst met Patrick?',
                'Welke offertes lopen er nog?',
                'Welke deals zijn deze week stilgevallen?',
              ].map(q => (
                <button key={q} type="button" className="m-zk__suggest" onClick={() => { setText(q) }}>
                  <MIcon name="spark" size={11} /> {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.messages.map((m, i) => (
            <ChatMessage key={i} m={m} />
          ))
        )}
      </div>

      <div className="m-vb__composer">
        <input
          className="m-vb__input"
          placeholder="Stel een vraag aan Maestro…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
        />
        <button type="button" className="m-vb__send" onClick={onSubmit} disabled={!text.trim() || chat.loading} aria-label="Versturen">
          <MIcon name={chat.loading ? 'refresh' : 'chevron'} size={16} color="#fff" stroke={2.4} />
        </button>
      </div>
    </>
  )
}

function ChatMessage({ m }) {
  if (m.role === 'user') {
    return <div className="m-bubble m-bubble--user"><div className="m-bubble__txt">{m.content}</div></div>
  }
  const isLoading = m.streaming || m.loading
  const citations = Array.isArray(m.citations) ? m.citations : []
  // Geldige citation-nummers — voorkomt dat hallucinated [bron #N]-tags die niet
  // matchen met een echte bron als rare code in lopende tekst blijven staan.
  const validCiteNs = citations.map(c => c.n).filter(n => Number.isFinite(n))
  return (
    <div className="m-bubble m-bubble--ai">
      <div className="m-bubble__head">
        <span className="m-bubble__ico"><MIcon name="spark" size={11} /></span>
        <span className="m-bubble__lbl">JelleMind</span>
        {m.timing_ms?.total_ms && <span className="m-bubble__time">{(m.timing_ms.total_ms / 1000).toFixed(1)}s</span>}
      </div>
      <div className="m-bubble__txt m-bubble__md">
        {m.content
          ? <Markdown text={m.content} validCiteNs={validCiteNs} />
          : (isLoading ? <span className="m-bubble__thinking">Denken…</span> : null)}
        {isLoading && m.content && <span className="m-bubble__caret">▍</span>}
      </div>
      {m.error && <div className="m-bubble__err">⚠ {m.error}</div>}
      {citations.length > 0 && (
        <div className="m-bubble__cites">
          <div className="m-bubble__citeshead">{citations.length} {citations.length === 1 ? 'bron' : 'bronnen'}</div>
          {citations.slice(0, 8).map((c, i) => (
            <div key={i} className="m-bubble__cite">
              <span className="m-bubble__citenum">{c.n ?? i + 1}</span>
              <span className="m-bubble__citeico"><MIcon name={srcIcon(c.source)} size={11} /></span>
              <div className="m-bubble__citebody">
                <div className="m-bubble__citetitle">{c.subject || c.from_name || srcLabel(c.source)}</div>
                {c.preview && <div className="m-bubble__citesnip">{c.preview}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

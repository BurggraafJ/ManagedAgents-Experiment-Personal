// LegalAIView — Legal AI Thought Leadership dashboard-tab.
//
// Layout:
//   ┌─ Header: track-toggle [A — Advocatuur] [B — Bedrijfsleven] ┬ status-pills ┐
//   ├─ Hero: vandaag's artikel ─────────────────────────────────────────────────┤
//   │   TLDR (3 bullets) · Body (markdown) · 🔴 Tegengeluid                      │
//   │   Vision-updates voorstellen [Accept] [Reject] [Amend]                     │
//   │   [🎤 Voice note] [Maak LinkedIn-post]                                     │
//   ├─ Vision-tracker per track ────────────────────────────────────────────────┤
//   │   Stellingen + confidence-bars + evidence/counter-evidence                 │
//   ├─ Topics & players ────────────────────────────────────────────────────────┤
//   │   Wat we volgen, last_researched_at                                        │
//   └─ Archive: lijst eerdere artikelen ────────────────────────────────────────┘
//
// Backend: legal_ai_articles / legal_ai_theses / legal_ai_topics / legal_ai_players
//          / legal_ai_findings (tegengeluid-finding-lookup)
// Status: F.4 stub — toont skeleton + lege state. F.5-F.7 (voice/LinkedIn/bias-flag)
//         worden later toegevoegd.

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// ============================================================
// Tracks — config + accents
// ============================================================

const TRACKS = [
  {
    key: 'advocatuur',
    label: 'Advocatuur',
    accent: '#8b5cf6',
    tagline: 'Hoe Legal AI advocaten verandert — Harvey, Clio, Spellbook, Robin AI, …',
  },
  {
    key: 'bedrijfsleven',
    label: 'Bedrijfsleven (MKB)',
    accent: '#06b6d4',
    tagline: 'Legal Operations / Legal AI in de business — Ironclad, LinkSquares, Juro, …',
  },
]

const TRACK_BY_KEY = Object.fromEntries(TRACKS.map(t => [t.key, t]))

// ============================================================
// Helpers
// ============================================================

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

function fmtRelative(iso) {
  if (!iso) return 'nooit'
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 3600) return `${Math.floor(diff / 60)} min`
  if (diff < 86400) return `${Math.floor(diff / 3600)} u`
  if (diff < 604800) return `${Math.floor(diff / 86400)} d`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Markdown → HTML (lightweight; full library zou overkill zijn voor stub).
function mdToHtml(md) {
  if (!md) return ''
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^([^<].*)$/gm, '<p>$1</p>')
}

// ============================================================
// Data hook — alles wat de tab nodig heeft
// ============================================================

function useLegalAIData(activeTrack) {
  const [todayArticle, setTodayArticle] = useState(null)
  const [theses, setTheses] = useState([])
  const [topics, setTopics] = useState([])
  const [players, setPlayers] = useState([])
  const [archive, setArchive] = useState([])
  const [latestRunAt, setLatestRunAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const today = todayIso()
      const [aRes, tRes, topRes, playRes, archRes, runRes] = await Promise.all([
        supabase.from('legal_ai_articles')
          .select('*')
          .eq('track', activeTrack)
          .eq('article_date', today)
          .maybeSingle(),
        supabase.from('legal_ai_theses')
          .select('*')
          .eq('track', activeTrack)
          .eq('status', 'active')
          .order('confidence', { ascending: false })
          .limit(10),
        supabase.from('legal_ai_topics')
          .select('id, track, title, importance_score, depth_score, last_researched_at, active')
          .eq('track', activeTrack)
          .eq('active', true)
          .order('importance_score', { ascending: false })
          .limit(20),
        supabase.from('legal_ai_players')
          .select('id, track, name, website, importance_score, last_news_at, active')
          .in('track', [activeTrack, 'beide'])
          .eq('active', true)
          .order('importance_score', { ascending: false })
          .limit(15),
        supabase.from('legal_ai_articles')
          .select('id, article_date, track, title, reading_time_min')
          .eq('track', activeTrack)
          .lt('article_date', today)
          .order('article_date', { ascending: false })
          .limit(14),
        supabase.from('legal_ai_research_runs')
          .select('created_at, status, track')
          .eq('track', activeTrack)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (aRes.error)    throw aRes.error
      if (tRes.error)    throw tRes.error
      if (topRes.error)  throw topRes.error
      if (playRes.error) throw playRes.error
      if (archRes.error) throw archRes.error
      // runRes.error mag stil falen — kan zijn dat tabel leeg is

      setTodayArticle(aRes.data || null)
      setTheses(tRes.data || [])
      setTopics(topRes.data || [])
      setPlayers(playRes.data || [])
      setArchive(archRes.data || [])
      setLatestRunAt(runRes?.data?.created_at || null)
    } catch (e) {
      // Schema kan ontbreken (migration nog niet toegepast) — zet error maar
      // crash niet de hele app.
      setError(e.message || String(e))
      setTodayArticle(null)
      setTheses([])
      setTopics([])
      setPlayers([])
      setArchive([])
    } finally {
      setLoading(false)
    }
  }, [activeTrack])

  useEffect(() => { load() }, [load])

  return {
    todayArticle, theses, topics, players, archive, latestRunAt,
    loading, error, refresh: load,
  }
}

// ============================================================
// Sub-components
// ============================================================

function TrackToggle({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {TRACKS.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: '8px 16px',
            borderRadius: 999,
            border: active === t.key ? `2px solid ${t.accent}` : '1px solid var(--border, #d4d4d8)',
            background: active === t.key ? `${t.accent}15` : 'transparent',
            color: active === t.key ? t.accent : 'var(--text, #18181b)',
            fontWeight: active === t.key ? 600 : 400,
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function StatusPills({ latestRunAt, hasArticle }) {
  const runFresh = latestRunAt && (Date.now() - new Date(latestRunAt).getTime()) < 36 * 3600 * 1000
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
      <span style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: runFresh ? '#10b98115' : '#f59e0b15',
        color: runFresh ? '#059669' : '#d97706',
        border: `1px solid ${runFresh ? '#10b98140' : '#f59e0b40'}`,
      }}>
        Research: {latestRunAt ? fmtRelative(latestRunAt) : 'nog nooit'}
      </span>
      <span style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: hasArticle ? '#10b98115' : '#a1a1aa15',
        color: hasArticle ? '#059669' : '#71717a',
        border: `1px solid ${hasArticle ? '#10b98140' : '#a1a1aa40'}`,
      }}>
        {hasArticle ? 'Artikel klaar' : 'Geen artikel vandaag'}
      </span>
    </div>
  )
}

function ArticleHero({ article, accent }) {
  if (!article) {
    return (
      <div style={{
        padding: 24,
        borderRadius: 12,
        border: '1px dashed var(--border, #d4d4d8)',
        background: 'var(--bg-subtle, #fafafa)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 16, color: 'var(--text-muted, #71717a)' }}>
          Nog geen artikel voor vandaag.
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted, #71717a)', marginTop: 8 }}>
          <code>legal-ai-research</code> draait dagelijks 06:30, <code>legal-ai-compose</code> 07:30 NL.
          Beide schedules staan disabled tot Jelle de <code>perplexity_api_key</code> heeft gezet.
        </div>
      </div>
    )
  }

  const tldr = Array.isArray(article.tldr) ? article.tldr : []
  const sections = article.sections || {}
  const tegengeluidIds = sections.tegengeluid || []
  const visionUpdates = sections.vision_updates_proposed || []

  return (
    <article style={{
      padding: 28,
      borderRadius: 12,
      border: `1px solid ${accent}40`,
      background: `linear-gradient(180deg, ${accent}08 0%, transparent 60%)`,
    }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 12, color: accent, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {fmtDate(article.article_date)} · {article.reading_time_min ?? '–'} min lezen
        </div>
        <h1 style={{
          margin: '4px 0 0 0', fontSize: 24, lineHeight: 1.3,
          color: 'var(--text, #18181b)',
        }}>
          {article.title}
        </h1>
      </header>

      {tldr.length > 0 && (
        <div style={{
          padding: '12px 16px', marginBottom: 16,
          background: 'var(--bg-subtle, #fafafa)',
          borderRadius: 8,
          borderLeft: `3px solid ${accent}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: accent, marginBottom: 6 }}>
            TL;DR
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {tldr.map((b, i) => <li key={i} style={{ fontSize: 14, marginBottom: 4 }}>{b}</li>)}
          </ul>
        </div>
      )}

      <div
        style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text, #27272a)' }}
        dangerouslySetInnerHTML={{ __html: mdToHtml(article.body_md || '') }}
      />

      {tegengeluidIds.length === 0 && (
        <div style={{
          marginTop: 16, padding: 12,
          background: '#fef3c715',
          border: '1px solid #f59e0b40',
          borderRadius: 8,
          fontSize: 13,
          color: '#92400e',
        }}>
          ⚠️ <strong>Geen tegengeluid vandaag — verdacht?</strong>
          <br />
          Alle findings bevestigen Jelle's huidige stellingen. Mogelijk een blind spot.
        </div>
      )}

      {visionUpdates.length > 0 && (
        <div style={{
          marginTop: 20,
          padding: 16,
          background: 'var(--bg-subtle, #fafafa)',
          borderRadius: 8,
          border: '1px solid var(--border, #d4d4d8)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Voorgestelde visie-updates
          </div>
          {visionUpdates.map((v, i) => (
            <div key={i} style={{
              padding: 10, marginBottom: 8,
              background: 'var(--bg, white)',
              border: '1px solid var(--border, #e4e4e7)',
              borderRadius: 6,
              fontSize: 13,
            }}>
              <div>
                Stelling #{v.thesis_id}: confidence{' '}
                <strong>{v.current_confidence}</strong> → <strong>{v.proposed_confidence}</strong>
              </div>
              <div style={{ color: 'var(--text-muted, #71717a)', marginTop: 4, fontSize: 12 }}>
                {v.reason}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={btnSecondary}>Accept</button>
                <button style={btnSecondary}>Reject</button>
                <button style={btnSecondary}>Amend</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer style={{
        marginTop: 20, paddingTop: 16,
        borderTop: '1px solid var(--border, #e4e4e7)',
        display: 'flex', gap: 10,
      }}>
        <button style={{ ...btnPrimary, background: accent }}>
          🎤 Reageer met voice note
        </button>
        <button style={btnSecondary}>
          Maak LinkedIn-post
        </button>
      </footer>
    </article>
  )
}

function VisionTracker({ theses, accent }) {
  if (!theses || theses.length === 0) {
    return (
      <div style={{
        padding: 16, borderRadius: 8,
        border: '1px dashed var(--border, #d4d4d8)',
        textAlign: 'center', fontSize: 13,
        color: 'var(--text-muted, #71717a)',
      }}>
        Nog geen actieve stellingen. Voeg er handmatig toe via DB of laat ze
        groeien uit voice-notes (F.5).
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {theses.map(t => {
        const total = t.evidence_count + t.counter_evidence_count
        const supportPct = total === 0 ? 50 : (t.evidence_count / total) * 100
        const isWeakening = total >= 3 && t.counter_evidence_count * 2 > t.evidence_count
        return (
          <div key={t.id} style={{
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${isWeakening ? '#f59e0b80' : 'var(--border, #e4e4e7)'}`,
            background: isWeakening ? '#fef3c715' : 'transparent',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{t.statement}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #71717a)', marginLeft: 8 }}>
                conf. {t.confidence}
              </div>
            </div>
            <div style={{
              height: 6, borderRadius: 3, overflow: 'hidden',
              background: '#fee2e2', display: 'flex',
            }}>
              <div style={{
                width: `${supportPct}%`,
                background: accent, transition: 'width 0.3s',
              }} />
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: 'var(--text-muted, #71717a)', marginTop: 4,
            }}>
              <span>👍 {t.evidence_count} ondersteunend</span>
              {isWeakening && (
                <span style={{ color: '#d97706', fontWeight: 600 }}>
                  ⚠️ stelling verzwakt
                </span>
              )}
              <span>👎 {t.counter_evidence_count} tegen</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TopicsAndPlayers({ topics, players }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Topics ({topics.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          {topics.length === 0 && (
            <div style={{ color: 'var(--text-muted, #71717a)' }}>Geen topics actief.</div>
          )}
          {topics.map(t => (
            <div key={t.id} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '6px 8px', borderRadius: 4,
              background: 'var(--bg-subtle, #fafafa)',
            }}>
              <span>{t.title}</span>
              <span style={{ color: 'var(--text-muted, #71717a)', fontSize: 12 }}>
                {fmtRelative(t.last_researched_at)} · d{t.depth_score}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Spelers ({players.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          {players.length === 0 && (
            <div style={{ color: 'var(--text-muted, #71717a)' }}>Geen spelers actief.</div>
          )}
          {players.map(p => (
            <div key={p.id} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '6px 8px', borderRadius: 4,
              background: 'var(--bg-subtle, #fafafa)',
            }}>
              <a href={p.website} target="_blank" rel="noreferrer"
                 style={{ color: 'inherit', textDecoration: 'none' }}>
                {p.name}
              </a>
              <span style={{ color: 'var(--text-muted, #71717a)', fontSize: 12 }}>
                imp. {p.importance_score}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Archive({ archive, accent, onSelect }) {
  if (!archive || archive.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-muted, #71717a)', textAlign: 'center', padding: 12 }}>
        Nog geen archief.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {archive.map(a => (
        <button
          key={a.id}
          onClick={() => onSelect && onSelect(a.id)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', borderRadius: 6,
            border: '1px solid var(--border, #e4e4e7)',
            background: 'transparent', cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 13 }}>
            <strong>{fmtDate(a.article_date)}</strong> — {a.title}
          </span>
          <span style={{ fontSize: 11, color: accent }}>
            {a.reading_time_min ?? '–'} min
          </span>
        </button>
      ))}
    </div>
  )
}

// ============================================================
// Inline button styles (consistent met overige views)
// ============================================================

const btnPrimary = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: 6,
  color: 'white',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
}

const btnSecondary = {
  padding: '6px 12px',
  border: '1px solid var(--border, #d4d4d8)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text, #18181b)',
  fontSize: 12,
  cursor: 'pointer',
}

// ============================================================
// Main view
// ============================================================

export default function LegalAIView() {
  const [activeTrack, setActiveTrack] = useState('advocatuur')
  const data = useLegalAIData(activeTrack)
  const accent = useMemo(() => TRACK_BY_KEY[activeTrack].accent, [activeTrack])
  const tagline = useMemo(() => TRACK_BY_KEY[activeTrack].tagline, [activeTrack])

  return (
    <div style={{
      maxWidth: 1100, margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: 24,
      padding: '0 12px 40px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <TrackToggle active={activeTrack} onChange={setActiveTrack} />
          <div style={{
            fontSize: 13, color: 'var(--text-muted, #71717a)', marginTop: 6,
          }}>
            {tagline}
          </div>
        </div>
        <StatusPills
          latestRunAt={data.latestRunAt}
          hasArticle={!!data.todayArticle}
        />
      </div>

      {data.error && (
        <div style={{
          padding: 12, borderRadius: 6,
          background: '#fee2e2', color: '#991b1b',
          fontSize: 13, border: '1px solid #fca5a5',
        }}>
          <strong>Schema niet beschikbaar.</strong> Migration{' '}
          <code>legal_ai_thought_leadership_2026_05_02.sql</code> nog niet toegepast?
          <br />
          <span style={{ fontSize: 11, opacity: 0.8 }}>{data.error}</span>
        </div>
      )}

      {/* Hero — vandaag's artikel */}
      <ArticleHero article={data.todayArticle} accent={accent} />

      {/* Vision-tracker */}
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Visie-tracker — {TRACK_BY_KEY[activeTrack].label}</h2>
        <VisionTracker theses={data.theses} accent={accent} />
      </section>

      {/* Topics & players */}
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Wat we volgen</h2>
        <TopicsAndPlayers topics={data.topics} players={data.players} />
      </section>

      {/* Archive */}
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Archief — laatste 14 artikelen</h2>
        <Archive archive={data.archive} accent={accent} />
      </section>

      <div style={{
        fontSize: 11, color: 'var(--text-muted, #71717a)',
        textAlign: 'center', marginTop: 20,
      }}>
        Project — Legal AI Thought Leadership · F.4 stub.
        Voice/LinkedIn/bias-flag worden in F.5–F.7 toegevoegd.
      </div>
    </div>
  )
}

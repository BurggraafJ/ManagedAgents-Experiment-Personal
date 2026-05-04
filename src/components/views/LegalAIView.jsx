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
import DOMPurify from 'dompurify'
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
  // Escape eerst raw HTML zodat een `<script>` in de bron-markdown nooit
  // als HTML wordt geinterpreteerd vóór onze tag-replacements.
  const escaped = String(md)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const html = escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^([^<].*)$/gm, '<p>$1</p>')
  // Defense-in-depth: pipe door DOMPurify zodat een markdown-bron
  // die toch HTML smokkelde geen actieve content kan plaatsen.
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
  })
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
  const [proposals, setProposals] = useState([])
  const [linkedinDrafts, setLinkedinDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const today = todayIso()
      const [aRes, tRes, topRes, playRes, archRes, runRes, propRes, liRes] = await Promise.all([
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
        // Pending vision-update voorstellen (F.5)
        supabase.from('agent_proposals')
          .select('id, payload, status, created_at')
          .eq('agent_name', 'legal-ai-vision-update')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(20),
        // Recente LinkedIn drafts (F.6)
        supabase.from('legal_ai_linkedin_posts')
          .select('id, source_article_id, track, variant, body_md, status, created_at, posted_at')
          .in('track', [activeTrack, 'combined'])
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      if (aRes.error)    throw aRes.error
      if (tRes.error)    throw tRes.error
      if (topRes.error)  throw topRes.error
      if (playRes.error) throw playRes.error
      if (archRes.error) throw archRes.error
      // proposals + linkedin drafts mogen stil falen — table kan leeg zijn

      setTodayArticle(aRes.data || null)
      setTheses(tRes.data || [])
      setTopics(topRes.data || [])
      setPlayers(playRes.data || [])
      setArchive(archRes.data || [])
      setLatestRunAt(runRes?.data?.created_at || null)
      // Filter proposals op activeTrack via payload.track
      const trackProps = (propRes?.data || []).filter(p => p.payload?.track === activeTrack)
      setProposals(trackProps)
      setLinkedinDrafts(liRes?.data || [])
    } catch (e) {
      setError(e.message || String(e))
      setTodayArticle(null); setTheses([]); setTopics([]); setPlayers([]); setArchive([])
      setProposals([]); setLinkedinDrafts([])
    } finally {
      setLoading(false)
    }
  }, [activeTrack])

  useEffect(() => { load() }, [load])

  // ============================================================
  // F.5/F.6 — schrijf-acties (voice-note insert, LinkedIn request, proposal accept/reject)
  // ============================================================

  const submitFeedback = useCallback(async (transcript, articleId, thesisId) => {
    if (!transcript || transcript.trim().length < 5) return { ok: false, error: 'tekst te kort' }
    const { data, error } = await supabase.from('legal_ai_voice_notes').insert({
      article_id: articleId || null,
      thesis_id: thesisId || null,
      track: activeTrack,
      transcript: transcript.trim(),
      status: 'pending',
    }).select().single()
    if (error) return { ok: false, error: error.message }
    return { ok: true, id: data?.id }
  }, [activeTrack])

  const requestLinkedInDraft = useCallback(async (articleId) => {
    if (!articleId) return { ok: false, error: 'no article_id' }
    const { data, error } = await supabase.from('legal_ai_skill_requests').insert({
      request_type: 'linkedin_draft',
      article_id: articleId,
      payload: { track: activeTrack },
      status: 'pending',
    }).select().single()
    if (error) return { ok: false, error: error.message }
    return { ok: true, id: data?.id }
  }, [activeTrack])

  const decideProposal = useCallback(async (proposalId, decision, override) => {
    // decision: 'accept' | 'reject' | 'amend'
    const { data, error } = await supabase.rpc('apply_legal_ai_thesis_update', {
      p_proposal_id: proposalId,
      p_decision: decision,
      p_amended: override || null,
    })
    if (error) return { ok: false, error: error.message }
    await load()
    return { ok: true, data }
  }, [load])

  return {
    todayArticle, theses, topics, players, archive, latestRunAt,
    proposals, linkedinDrafts,
    loading, error, refresh: load,
    submitFeedback, requestLinkedInDraft, decideProposal,
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

function ArticleHero({ article, accent, onFeedback, onLinkedIn }) {
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

      <FeedbackPanel article={article} accent={accent} onFeedback={onFeedback} onLinkedIn={onLinkedIn} />
    </article>
  )
}

// F.5/F.6 — feedback-textarea + LinkedIn-request knop, in de hero zelf.
function FeedbackPanel({ article, accent, onFeedback, onLinkedIn }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState(null)

  const submit = async () => {
    if (!onFeedback || !text.trim()) return
    setPending(true); setStatus(null)
    const r = await onFeedback(text, article.id, null)
    setPending(false)
    if (r.ok) {
      setStatus({ type: 'ok', msg: 'Feedback opgeslagen — legal-ai-vision-update verwerkt hem zo.' })
      setText('')
    } else {
      setStatus({ type: 'err', msg: r.error || 'Insert mislukt.' })
    }
  }

  const requestLi = async () => {
    if (!onLinkedIn) return
    setPending(true); setStatus(null)
    const r = await onLinkedIn(article.id)
    setPending(false)
    if (r.ok) {
      setStatus({ type: 'ok', msg: 'LinkedIn-draft aangevraagd — legal-ai-linkedin-draft schrijft 2 varianten.' })
    } else {
      setStatus({ type: 'err', msg: r.error || 'Request mislukt.' })
    }
  }

  return (
    <footer style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border, #e4e4e7)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: accent, marginBottom: 6 }}>
        Reageer op dit artikel
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Schrijf je gedachten of zet een voice-note om naar tekst en plak hem hier..."
        rows={3}
        style={{
          width: '100%', padding: 10, fontSize: 13, lineHeight: 1.45,
          border: '1px solid var(--border, #d4d4d8)',
          borderRadius: 6, resize: 'vertical', fontFamily: 'inherit',
          background: 'var(--bg, white)', color: 'var(--text, #18181b)',
        }}
      />
      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={submit}
          disabled={pending || text.trim().length < 5}
          style={{ ...btnPrimary, background: accent, opacity: pending || text.trim().length < 5 ? 0.5 : 1 }}
        >
          📨 Stuur feedback
        </button>
        <button onClick={requestLi} disabled={pending} style={{ ...btnSecondary, opacity: pending ? 0.5 : 1 }}>
          🔗 Maak LinkedIn-post
        </button>
        {status && (
          <span style={{
            fontSize: 12,
            color: status.type === 'ok' ? '#059669' : '#dc2626',
          }}>
            {status.msg}
          </span>
        )}
      </div>
    </footer>
  )
}

function ProposalsPanel({ proposals, accent, onDecide }) {
  if (!proposals || proposals.length === 0) return null
  return (
    <section>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Visie-update voorstellen ({proposals.length})</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {proposals.map(p => {
          const pl = p.payload || {}
          return (
            <div key={p.id} style={{
              padding: 12, borderRadius: 8,
              border: `1px solid ${accent}40`, background: `${accent}08`,
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #71717a)', marginBottom: 4 }}>
                {pl.target} · {pl.action} · {fmtRelative(p.created_at)}
              </div>
              {pl.proposed_statement && (
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <strong>Voorstel:</strong> {pl.proposed_statement}
                </div>
              )}
              {(pl.proposed_confidence !== undefined && pl.current_thesis) && (
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  Confidence: <strong>{pl.current_thesis?.confidence}</strong> → <strong>{pl.proposed_confidence}</strong>
                </div>
              )}
              {pl.reason && (
                <div style={{ fontSize: 12, color: 'var(--text-muted, #71717a)', marginBottom: 8 }}>
                  Reden: {pl.reason}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => onDecide(p.id, 'accept')} style={{ ...btnSecondary, color: '#059669', borderColor: '#10b98140' }}>
                  Accept
                </button>
                <button onClick={() => onDecide(p.id, 'reject')} style={{ ...btnSecondary, color: '#dc2626', borderColor: '#fca5a540' }}>
                  Reject
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function LinkedInDraftsPanel({ drafts, accent }) {
  if (!drafts || drafts.length === 0) return null
  const copyToClipboard = (text) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text || '')
  }
  return (
    <section>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>LinkedIn drafts ({drafts.length})</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {drafts.map(d => (
          <details key={d.id} style={{
            padding: 12, borderRadius: 8,
            border: '1px solid var(--border, #e4e4e7)',
            background: 'var(--bg-subtle, #fafafa)',
          }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              <span style={{ color: accent, marginRight: 8 }}>
                [{d.variant}]
              </span>
              {(d.body_md || '').slice(0, 90).replace(/\n/g, ' ')}{(d.body_md || '').length > 90 ? '…' : ''}
              <span style={{ float: 'right', fontSize: 11, color: 'var(--text-muted, #71717a)' }}>
                {fmtRelative(d.created_at)} · {d.status}
              </span>
            </summary>
            <pre style={{
              fontSize: 13, lineHeight: 1.5, marginTop: 10,
              whiteSpace: 'pre-wrap', fontFamily: 'inherit',
              padding: 10, background: 'var(--bg, white)',
              border: '1px solid var(--border, #e4e4e7)', borderRadius: 4,
            }}>{d.body_md}</pre>
            <button onClick={() => copyToClipboard(d.body_md)} style={{ ...btnSecondary, marginTop: 8 }}>
              Kopieer
            </button>
          </details>
        ))}
      </div>
    </section>
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

      {/* Hero — vandaag's artikel met feedback + LinkedIn knop (F.5/F.6) */}
      <ArticleHero
        article={data.todayArticle}
        accent={accent}
        onFeedback={data.submitFeedback}
        onLinkedIn={data.requestLinkedInDraft}
      />

      {/* F.5 — Visie-update voorstellen (van legal-ai-vision-update skill) */}
      <ProposalsPanel
        proposals={data.proposals}
        accent={accent}
        onDecide={data.decideProposal}
      />

      {/* Vision-tracker */}
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Visie-tracker — {TRACK_BY_KEY[activeTrack].label}</h2>
        <VisionTracker theses={data.theses} accent={accent} />
      </section>

      {/* F.6 — LinkedIn drafts overview */}
      <LinkedInDraftsPanel drafts={data.linkedinDrafts} accent={accent} />

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

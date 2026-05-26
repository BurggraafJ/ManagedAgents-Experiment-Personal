import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChurnDetail } from '../../../hooks/useChurnDetail'
import { useChurnData } from '../../../hooks/useChurnData'
import './klantverlies-v2.css'
import './klantverlies-detail.css'

const MONTHS = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']
const MONTHS_SHORT = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

function shortDate(d) {
  if (!d) return '—'
  const date = new Date(d)
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`
}
function longDate(d) {
  if (!d) return null
  const date = new Date(d)
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}
function daysSince(d) {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
}
function relativeFromNow(date) {
  if (!date) return 'nog niet'
  const days = daysSince(date)
  if (days < 1) return 'vandaag'
  if (days === 1) return 'gisteren'
  if (days < 7) return `${days}d geleden`
  if (days < 60) return `${Math.floor(days / 7)}w geleden`
  return `${Math.floor(days / 30)}mnd geleden`
}

const AV_PALETTE = [
  { bg: '#fdecec', fg: '#7c1f1f' },
  { bg: '#fdf2eb', fg: '#a64d22' },
  { bg: '#eef0ec', fg: '#4a5147' },
  { bg: '#e6f5f8', fg: '#0c3a48' },
  { bg: '#e8f0fd', fg: '#1e3a73' },
  { bg: '#f1ebfe', fg: '#4a1d8a' },
]
function hashColor(seed) {
  let h = 0
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AV_PALETTE[h % AV_PALETTE.length]
}
function initials(name) {
  if (!name) return '—'
  const w = String(name).trim().split(/\s+/).filter(Boolean)
  if (!w.length) return '—'
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase()
  return (w[0][0] + w[w.length - 1][0]).toUpperCase()
}

const SOURCE_ICON = { mail: '✉', note: '📝', call: '☎', news: '📰', linkedin: 'in', usage: '📈', invoice: '€' }
const SOURCE_LABEL = { mail: 'E-mail', note: 'Notitie', call: 'Telefoongesprek', news: 'Nieuws', linkedin: 'LinkedIn', usage: 'Productgebruik', invoice: 'Factuur' }

/**
 * KlantverliesDetailView — detail-pagina voor één gechurnte klant.
 * Bereikbaar via /klantverlies-v2/:dealId.
 * Design: Klantverlies-detail.html (paper-look, hero summary, multi-notes, sources, related).
 */
export default function KlantverliesDetailView() {
  const { dealId } = useParams()
  const navigate = useNavigate()
  const { churn, notes, sources, loading, error, addNote, updateNote, deleteNote, refresh } = useChurnDetail(dealId)
  const { churns: allChurns, categories, updateCategory, triggerRun } = useChurnData()

  const [newNote, setNewNote] = useState('')
  const [noteFocused, setNoteFocused] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)
  const [catOpen, setCatOpen] = useState(false)

  // Prev/next via gesorteerde churns lijst
  const ordered = useMemo(
    () => [...allChurns].sort((a, b) => {
      const ad = a.closedate ? new Date(a.closedate).getTime() : 0
      const bd = b.closedate ? new Date(b.closedate).getTime() : 0
      return bd - ad
    }),
    [allChurns]
  )
  const idx = ordered.findIndex(c => c.deal_id === dealId)
  const prev = idx > 0 ? ordered[idx - 1] : null
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null

  // Categorie + related
  const cat = churn && churn.category_id ? categories.find(c => c.id === churn.category_id) : null
  const related = useMemo(() => {
    if (!churn || !churn.category_id) return []
    return allChurns
      .filter(c => c.category_id === churn.category_id && c.deal_id !== dealId)
      .slice(0, 4)
  }, [allChurns, churn, dealId])

  const lastSum = churn?.last_summarized_at ? new Date(churn.last_summarized_at) : null
  const fresh = lastSum ? (Date.now() - lastSum.getTime()) < 14 * 24 * 60 * 60 * 1000 : false

  const handleRefresh = async () => {
    setRefreshing(true); setRefreshMsg(null)
    try {
      await triggerRun()
      setRefreshMsg('Run aangevraagd — verschijnt na de volgende skill-cyclus.')
      setTimeout(() => setRefreshMsg(null), 6000)
    } catch (err) {
      setRefreshMsg('Mislukt: ' + (err.message || String(err)))
    } finally { setRefreshing(false) }
  }

  const handleAddNote = async () => {
    const v = newNote.trim()
    if (!v) return
    try {
      await addNote(v); setNewNote(''); setNoteFocused(false)
    } catch (err) { alert('Opslaan mislukt: ' + (err.message || String(err))) }
  }

  const handleSaveEdit = async (id) => {
    try {
      await updateNote(id, editText)
      setEditingId(null); setEditText('')
    } catch (err) { alert('Bijwerken mislukt: ' + (err.message || String(err))) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Notitie verwijderen?')) return
    try { await deleteNote(id) } catch (err) { alert('Verwijderen mislukt: ' + (err.message || String(err))) }
  }

  if (loading) {
    return (
      <div className="kl2-app kld-app">
        <div className="skeleton" style={{ height: 80 }} />
        <div className="skeleton" style={{ height: 220 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    )
  }

  if (error) {
    return <div className="kl2-app kld-app"><div className="kl2-banner">{error}</div></div>
  }

  if (!churn) {
    return (
      <div className="kl2-app kld-app">
        <button className="kld-back" onClick={() => navigate('/klantverlies-v2')}>← Terug naar overzicht</button>
        <div className="kl2-empty">
          <div className="kl2-empty__title">Klant niet gevonden</div>
          <div className="kl2-empty__desc">Deze deal staat (nog) niet in churn_customers.</div>
        </div>
      </div>
    )
  }

  const av = hashColor(churn.company_name || churn.dealname || '')
  const name = churn.company_name || churn.dealname || '—'
  const mrrLabel = churn.mrr != null
    ? `€${Number(churn.mrr).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`
    : '—'
  const sinds = churn.deal_created_at || churn.company_created_at
  const sindsLbl = sinds ? longDate(sinds) : 'onbekend'

  const hubspotUrl = `https://app.hubspot.com/contacts/0/deal/${dealId}`

  return (
    <div className="kl2-app kld-app">
      <div className="kld-topbar">
        <button className="kld-back" onClick={() => navigate('/klantverlies-v2')}>
          ← Terug naar overzicht
        </button>
        <div className="kld-nav">
          <button
            className="kl2-btn"
            disabled={!prev}
            onClick={() => prev && navigate(`/klantverlies-v2/${prev.deal_id}`)}
          >
            ← Vorige
          </button>
          <button
            className="kl2-btn"
            disabled={!next}
            onClick={() => next && navigate(`/klantverlies-v2/${next.deal_id}`)}
          >
            Volgende →
          </button>
        </div>
      </div>

      <div className="kld-head">
        <div className="kld-head__av" style={{ '--av-bg': av.bg, '--av-fg': av.fg }}>{initials(name)}</div>
        <div className="kld-head__main">
          <h1 className="kld-head__name">{name}</h1>
          <div className="kld-head__meta">
            {churn.domain && (
              <>
                <a href={`https://${churn.domain}`} target="_blank" rel="noopener noreferrer">{churn.domain}</a>
                <span className="kld-sep">·</span>
              </>
            )}
            <span>Klant sinds <b>{sindsLbl}</b></span>
            <span className="kld-sep">·</span>
            <span>
              Afgesloten <b>{shortDate(churn.closedate)}</b>
              {daysSince(churn.closedate) != null && (
                <span style={{ color: 'var(--kl2-neutral-400)' }}> ({daysSince(churn.closedate)}d geleden)</span>
              )}
            </span>
            <span className="kld-sep">·</span>
            <span>MRR <b>{mrrLabel}</b></span>
            <span className="kld-sep">·</span>
            <a href={hubspotUrl} target="_blank" rel="noopener noreferrer">Open in HubSpot ↗</a>
          </div>
        </div>
        <div className="kld-head__actions">
          {cat ? (
            <span className="kl2-cat-pill" style={{ '--cat-color': cat.color, '--cat-bg': cat.color + '14', '--cat-border': cat.color + '40' }}>
              <span className="kl2-cat-pill__dot" />
              {cat.label}
            </span>
          ) : (
            <span className="kl2-cat-pill kl2-cat-pill--unknown">Nog niet bepaald</span>
          )}
        </div>
      </div>

      <div className="kld-grid">
        {/* MAIN */}
        <div className="kld-col-main">
          {/* AI summary hero */}
          <div className="kld-sum">
            <div className="kld-sum__head">
              <div className="kld-sum__head-l">
                <span className="kld-ai-mark">
                  <span className="kld-ai-mark__pulse" />
                  AI
                </span>
                <h3 className="kld-sum__h3">Samenvatting van de afsluiting</h3>
              </div>
              <button className="kld-refresh" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? '⟳ Bezig…' : '⟳ Vernieuw samenvatting'}
              </button>
            </div>
            <div className="kld-sum__body">
              {churn.churn_summary
                ? churn.churn_summary
                : <em style={{ color: 'var(--kl2-neutral-400)' }}>Nog geen samenvatting — wacht op de volgende run.</em>}
            </div>
            <div className="kld-sum__foot">
              <div className={`kld-freshness ${fresh ? '' : 'is-stale'}`}>
                <span className="kld-freshness__dot" />
                {fresh
                  ? `Actueel — vernieuwd ${relativeFromNow(lastSum)}`
                  : (lastSum ? `Mogelijk verouderd — laatst ${relativeFromNow(lastSum)} bijgewerkt` : 'Nog niet samengevat')}
              </div>
              <div>
                {sources.length} {sources.length === 1 ? 'bron' : 'bronnen'} gebruikt
                {churn.new_provider && <> · overgestapt naar <b style={{ color: 'var(--kl2-ink)' }}>{churn.new_provider}</b></>}
              </div>
            </div>
            {refreshMsg && <div className="kl2-banner" style={{ marginTop: 12 }}>{refreshMsg}</div>}
          </div>

          {/* Notes */}
          <div className="kld-notes">
            <h3 className="kld-block-title">
              <span>Mijn notities <small>({notes.length})</small></span>
            </h3>
            {notes.length > 0 && (
              <div className="kld-notes-list">
                {notes.map(n => (
                  <div key={n.id} className="kld-note">
                    <div className="kld-note__head">
                      <span className="kld-note__head-l">
                        <span className="kld-note__av">JB</span>
                        <span>Jelle · {relativeFromNow(n.created_at)}</span>
                      </span>
                      <span className="kld-note__actions">
                        {editingId === n.id ? (
                          <>
                            <button onClick={() => { setEditingId(null); setEditText('') }}>Annuleer</button>
                            <button className="is-primary" onClick={() => handleSaveEdit(n.id)}>Opslaan</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingId(n.id); setEditText(n.body) }} title="Bewerken">✎</button>
                            <button className="is-danger" onClick={() => handleDelete(n.id)} title="Verwijderen">✕</button>
                          </>
                        )}
                      </span>
                    </div>
                    {editingId === n.id ? (
                      <textarea
                        className="kld-note__edit"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <div className="kld-note__txt">{n.body}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className={`kld-note-add ${noteFocused ? 'is-active' : ''}`} onClick={() => setNoteFocused(true)}>
              <textarea
                placeholder="Voeg een notitie toe — bv. waarom dit echt fout ging, of een suggestie voor win-back…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onFocus={() => setNoteFocused(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAddNote() }
                }}
              />
              <div className="kld-note-add__foot">
                <span className="kld-note-add__hint">⌘ Enter om op te slaan · alleen voor jou zichtbaar</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="kl2-btn"
                    onClick={(e) => { e.stopPropagation(); setNewNote(''); setNoteFocused(false) }}
                  >
                    Annuleer
                  </button>
                  <button
                    className="kl2-btn kl2-btn--primary"
                    disabled={!newNote.trim()}
                    onClick={(e) => { e.stopPropagation(); handleAddNote() }}
                  >
                    Notitie opslaan
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SIDE */}
        <div className="kld-col-side">
          {/* Categorie override */}
          <div className="kld-side-card">
            <h4>Categorie</h4>
            <button
              className="kld-cat-select"
              onClick={() => setCatOpen(o => !o)}
              type="button"
            >
              {cat ? (
                <span className="kl2-cat-pill" style={{ '--cat-color': cat.color, '--cat-bg': cat.color + '14', '--cat-border': cat.color + '40' }}>
                  <span className="kl2-cat-pill__dot" />
                  {cat.label}
                </span>
              ) : (
                <span className="kl2-cat-pill kl2-cat-pill--unknown">Nog niet bepaald</span>
              )}
              <span aria-hidden>▾</span>
            </button>
            {catOpen && (
              <div className="kld-cat-options">
                <button
                  className={!churn.category_id ? 'is-active' : ''}
                  onClick={() => { updateCategory(dealId, null); setCatOpen(false) }}
                >
                  <span style={{ color: 'var(--kl2-neutral-500)' }}>— Geen —</span>
                </button>
                {categories.map(c => {
                  const cnt = allChurns.filter(x => x.category_id === c.id).length
                  return (
                    <button
                      key={c.id}
                      className={churn.category_id === c.id ? 'is-active' : ''}
                      onClick={() => { updateCategory(dealId, c.id); setCatOpen(false) }}
                    >
                      <span className="kl2-cat-pill" style={{ '--cat-color': c.color, '--cat-bg': c.color + '14', '--cat-border': c.color + '40' }}>
                        <span className="kl2-cat-pill__dot" />
                        {c.label}
                      </span>
                      <small>{cnt}</small>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Sources */}
          <div className="kld-side-card">
            <h4>
              Bronnen gebruikt door agent
              <a href={hubspotUrl} target="_blank" rel="noopener noreferrer">alles ↗</a>
            </h4>
            {sources.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--kl2-neutral-500)' }}>
                Geen recente notes of mails gevonden.
              </div>
            ) : (
              <div className="kld-src-list">
                {sources.map(s => (
                  <div key={`${s.kind}-${s.id}`} className="kld-src">
                    <div className={`kld-src__ic kld-src__ic--${s.type}`}>{SOURCE_ICON[s.type] || '•'}</div>
                    <div className="kld-src__main">
                      <div className="kld-src__top">
                        <span className="kld-src__who">{s.who}</span>
                        <span>{shortDate(s.when)} · {SOURCE_LABEL[s.type] || 'Activiteit'}</span>
                      </div>
                      <div className="kld-src__label">{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Related */}
          {related.length > 0 && (
            <div className="kld-side-card">
              <h4>
                Andere "{cat?.label}" churns
                <a onClick={(e) => { e.preventDefault(); navigate('/klantverlies-v2') }} href="#">filter →</a>
              </h4>
              <div className="kld-related-list">
                {related.map(r => {
                  const ravc = hashColor(r.company_name || r.dealname || '')
                  return (
                    <button
                      key={r.deal_id}
                      type="button"
                      className="kld-related-item"
                      onClick={() => navigate(`/klantverlies-v2/${r.deal_id}`)}
                    >
                      <span className="kld-related-av" style={{ '--av-bg': ravc.bg, '--av-fg': ravc.fg }}>
                        {initials(r.company_name || r.dealname || '')}
                      </span>
                      <span className="kld-related-name">{r.company_name || r.dealname || '—'}</span>
                      <span className="kld-related-date">{r.closedate ? shortDate(r.closedate) : '—'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

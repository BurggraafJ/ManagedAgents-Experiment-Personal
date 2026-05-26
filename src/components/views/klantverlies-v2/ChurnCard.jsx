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

function shortDate(d) {
  const monthsShort = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']
  return `${String(d.getDate()).padStart(2, '0')} ${monthsShort[d.getMonth()]} ${d.getFullYear()}`
}

function relativeFromNow(date) {
  if (!date) return null
  const ms = Date.now() - date.getTime()
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days < 1) return 'vandaag'
  if (days === 1) return 'gisteren'
  if (days < 7) return `${days}d geleden`
  if (days < 60) return `${Math.floor(days / 7)}w geleden`
  return `${Math.floor(days / 30)}mnd geleden`
}

/**
 * ChurnCard — één gechurnte klant in de v2-tabel.
 * Klik = navigate naar de detail-pagina /klantverlies-v2/:dealId.
 */
export default function ChurnCard({ churn, onOpen }) {
  const name = churn.company_name || churn.dealname || '—'
  const av = hashColor(name)
  const cat = churn.category
  const hasNote = !!(churn.user_note && churn.user_note.trim())

  const closedate = churn.closedate ? new Date(churn.closedate) : null
  const lastSum = churn.last_summarized_at ? new Date(churn.last_summarized_at) : null
  const fresh = lastSum ? (Date.now() - lastSum.getTime()) < 14 * 24 * 60 * 60 * 1000 : false

  const noteUpdated = churn.user_note_updated_at ? new Date(churn.user_note_updated_at) : null

  const refreshedLbl = relativeFromNow(lastSum) || 'nog niet'
  const cite = `${churn.source_notes_count || 0} notes · ${churn.source_mails_count || 0} mails`

  const mrrLabel = churn.mrr != null
    ? `€${Number(churn.mrr).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`
    : '—'

  return (
    <div
      className={`kl2-klant ${hasNote ? '' : 'kl2-klant--no-note'}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      <div className="kl2-k-id">
        <div className="kl2-k-av" style={{ '--av-bg': av.bg, '--av-fg': av.fg }}>{initials(name)}</div>
        <div className="kl2-k-id-main">
          <div className="kl2-k-name" title={name}>{name}</div>
          {churn.domain && <div className="kl2-k-dom" title={churn.domain}>{churn.domain}</div>}
          <div className="kl2-k-meta">
            {closedate && (
              <>
                <span className="kl2-k-date"><b>{shortDate(closedate)}</b></span>
                <span className="kl2-k-sep">·</span>
              </>
            )}
            <span className="kl2-k-mrr"><b>{mrrLabel}</b>/mnd</span>
          </div>
        </div>
      </div>

      <div className="kl2-k-cat">
        {cat ? (
          <span
            className="kl2-cat-pill kl2-k-cat-pill"
            style={{ '--cat-color': cat.color, '--cat-bg': cat.color + '14', '--cat-border': cat.color + '40' }}
          >
            <span className="kl2-cat-pill__dot" />
            {cat.label}
          </span>
        ) : (
          <span className="kl2-cat-pill kl2-k-cat-pill kl2-cat-pill--unknown">Nog niet bepaald</span>
        )}
        {churn.new_provider ? (
          <div className="kl2-k-switch" title={`Overgestapt naar ${churn.new_provider}`}>
            <span className="kl2-k-switch-arrow" aria-hidden>→</span>
            <span className="kl2-k-switch-name"><small>naar</small>{churn.new_provider}</span>
          </div>
        ) : (
          <div className="kl2-k-switch-empty">— geen overstap bekend</div>
        )}
      </div>

      <div className="kl2-k-reason">
        <span className={`kl2-ai-mark ${fresh ? '' : 'kl2-ai-mark--stale'}`}>
          <span className="kl2-ai-mark__pulse" />
          {fresh ? 'AI · actueel' : (lastSum ? 'AI · verouderd' : 'AI · nog niet')}
        </span>
        <p className="kl2-k-sum">
          {churn.churn_summary
            ? churn.churn_summary
            : <em style={{ color: 'var(--kl2-neutral-400)' }}>Nog niet samengevat — wacht op volgende run.</em>}
        </p>
        <div className="kl2-k-bron">
          <span>🔗 {cite}</span>
          <span>·</span>
          <span>vernieuwd {refreshedLbl}</span>
          {churn.category_confidence != null && (
            <>
              <span>·</span>
              <span>conf. {Math.round(churn.category_confidence * 100)}%</span>
            </>
          )}
        </div>
      </div>

      <div className="kl2-k-note">
        <div className="kl2-k-note-lbl">
          <span>📝 Mijn notitie</span>
          {noteUpdated && <span className="kl2-k-note-when">{shortDate(noteUpdated)}</span>}
          {!noteUpdated && <span className="kl2-k-note-when">leeg</span>}
        </div>
        {hasNote ? (
          <div className="kl2-k-note-box">
            <div className="kl2-k-note-txt">{churn.user_note}</div>
          </div>
        ) : (
          <div className="kl2-k-note-box is-empty">+ Notitie toevoegen</div>
        )}
      </div>

      <div className="kl2-klant__go" aria-hidden>›</div>
    </div>
  )
}

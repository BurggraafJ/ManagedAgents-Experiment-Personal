import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import Ic from './pv2Icons'
import { kbScoreTone, msgTime } from './pv2lib'

/* Pv2KbModal — "Relevante kennisbank" (boek-knop rechtsboven in het detail).
 *
 * Data: RPC get_mail_kb_matches(p_mail_id) — leest de door de skill/eerder
 * berekende matches (cache op autodraft_mails.kb_matches) of berekent live
 * uit de mail-chunk-embedding × kb_articles. Score-kleuren:
 *   groen ≥ 0.52 (zeer relevant) · geel ≥ 0.45 (eventueel relevant) ·
 *   daaronder neutraal. Klik op een artikel → /kennisbank/artikel/:id. */

const TONE_LABEL = { green: 'zeer relevant', yellow: 'eventueel relevant', neutral: 'lage match' }

export default function Pv2KbModal({ mail, onClose }) {
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, matches: [], reason: null, source: null, computedAt: null })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (refresh) => {
    if (refresh) setBusy(true)
    else setState(s => ({ ...s, loading: true }))
    try {
      const { data, error } = await supabase.rpc('get_mail_kb_matches', {
        p_mail_id: mail.mail_id, p_refresh: !!refresh, p_top: 5,
      })
      if (error) throw error
      setState({
        loading: false,
        matches: Array.isArray(data?.matches) ? data.matches : [],
        reason: data?.ok === false ? (data?.reason || 'onbekend') : null,
        source: data?.source || null,
        computedAt: data?.computed_at || null,
      })
    } catch (e) {
      setState({ loading: false, matches: [], reason: e.message || String(e), source: null, computedAt: null })
    }
    setBusy(false)
  }, [mail.mail_id])

  useEffect(() => { load(false) }, [load])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-ico"><Ic n="book" s={18}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">Relevante kennisbank</div>
            <div className="modal-sub">Meest relevante artikelen op basis van deze mail{state.computedAt ? ` · berekend ${msgTime(state.computedAt)}` : ''}.</div>
          </div>
          <button className="btn btn-icon btn-ghost kb-refresh" title="Opnieuw berekenen" disabled={busy} onClick={() => load(true)}>
            <Ic n="refresh" s={15}/>
          </button>
          <button className="modal-close" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="modal-body">
          {state.loading ? (
            <div className="kb-empty">Relevantie berekenen…</div>
          ) : state.reason === 'not_chunked' && state.matches.length === 0 ? (
            <div className="kb-empty">
              Deze mail is nog niet geïndexeerd door de RAG-pijplijn (chunker draait elke paar minuten).
              <br/>Probeer het zo opnieuw via de verversknop rechtsboven.
            </div>
          ) : state.reason && state.matches.length === 0 ? (
            <div className="kb-empty">Relevantie ophalen mislukt: {state.reason}</div>
          ) : state.matches.length === 0 ? (
            <div className="kb-empty">
              Nog geen kennisbank-artikelen om tegen te matchen.
              <br/>De kennisbank vult zich via <b>/kennisbank/review</b> — elk goedgekeurd artikel doet direct mee.
            </div>
          ) : (
            <div className="kb-list">
              {state.matches.map(a => {
                const tone = kbScoreTone(a.score)
                return (
                  <a key={a.id} className="kb-item" href={`/kennisbank/artikel/${a.id}`}
                     onClick={e => { e.preventDefault(); onClose(); navigate(`/kennisbank/artikel/${a.id}`) }}>
                    <span className="kb-ic"><Ic n="book" s={15}/></span>
                    <div className="kb-main">
                      <div className="kb-t">{a.article_no ? `#${a.article_no} · ` : ''}{a.title}</div>
                      <div className="kb-s">{a.summary || ''}</div>
                      <div className="kb-meta">
                        <span className="kb-tag">{(a.kb_category || '').replace(/_/g, ' ') || a.article_type || 'artikel'}</span>
                        <span className={`kb-sim kb-sim--${tone}`} title={TONE_LABEL[tone]}>
                          <span className="kb-sim-dot"/>match {Number(a.score).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <Ic n="arrow-right" s={15}/>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

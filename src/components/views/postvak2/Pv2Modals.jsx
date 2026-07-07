import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Ic from './pv2Icons'
import { msgTime } from './pv2lib'

/* Pv2Modals — RAG-modal, actie-overzicht, spelcheck en leerregel-modal.
 * Alle in design-taal (.overlay/.modal/.rag-*), gevoed met echte data. */

export function Pv2RagModal({ mail, onClose }) {
  const [dir, setDir] = useState('in')
  const ctx = mail?.rag_context || null
  const matches = Array.isArray(ctx?.matches) ? ctx.matches : []
  const lessons = Array.isArray(ctx?.knowledge_lessons) ? ctx.knowledge_lessons : []
  const params = ctx?.retrieval_params || {}
  const topSim = matches.length ? Math.max(...matches.map(m => m.vector_score || m.similarity || 0)) : null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-ico"><Ic n="cube" s={18}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">RAG-zicht per record</div>
            <div className="modal-sub">{mail ? `${mail.from_name || mail.from_email} · ${mail.subject || ''}` : ''}</div>
          </div>
          <button className="modal-close" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="rag-tabs">
          <button className={`rag-tab ${dir === 'in' ? 'active' : ''}`} onClick={() => setDir('in')}>
            <span className="rag-tab-arrow">↓</span>Opgehaald<span className="rag-tab-meta">{matches.length} chunks</span>
          </button>
          <button className={`rag-tab ${dir === 'out' ? 'active' : ''}`} onClick={() => setDir('out')}>
            <span className="rag-tab-arrow">✦</span>Kennis &amp; instellingen<span className="rag-tab-meta">{lessons.length} lessen</span>
          </button>
        </div>
        <div className="modal-body">
          {!ctx ? (
            <div className="rag-empty">Nog geen RAG-context voor deze mail — de skill bouwt die bij de eerstvolgende scan.</div>
          ) : dir === 'in' ? (
            <>
              <div className="rag-stats">
                <div><div className="rag-stat-val">{matches.length}</div><div className="rag-stat-lbl">Chunks</div></div>
                <div><div className="rag-stat-val">{(ctx.source_function || '').replace('context-build-', '') || '—'}</div><div className="rag-stat-lbl">Build</div></div>
                <div><div className="rag-stat-val">{topSim != null ? topSim.toFixed(3) : '—'}</div><div className="rag-stat-lbl">Top sim</div></div>
                <div><div className="rag-stat-val dim">{ctx.retrieval_strategy ? 'entity' : 'semantic'}</div><div className="rag-stat-lbl">Strategie</div></div>
              </div>
              <div className="rag-chunks-head">Top {matches.length} chunks</div>
              {matches.map((m, i) => (
                <div key={m.chunk_id || i} className="rag-chunk">
                  <div className="rag-chunk-row">
                    <span className="rag-chunk-num">{i + 1}.</span>
                    <span className="rag-chunk-type">{m.source === 'mail' ? '✉' : '•'} {m.source}</span>
                    <span className="rag-chunk-sim">sim {(m.vector_score || m.similarity || 0).toFixed(3)}{m.occurred_at ? ` · ${msgTime(m.occurred_at)}` : ''}</span>
                  </div>
                  <div className="rag-chunk-ex">{(m.preview || '').slice(0, 320)}</div>
                </div>
              ))}
              {matches.length === 0 && <div className="rag-empty">Geen chunks gebruikt voor dit record.</div>}
            </>
          ) : (
            <>
              <div className="rag-chunks-head">JelleMind-lessen in de bundle</div>
              {lessons.map((l, i) => (
                <div key={l.id || i} className="rag-chunk">
                  <div className="rag-chunk-row">
                    <span className="rag-chunk-num">{i + 1}.</span>
                    <span className="rag-chunk-type">✦ {l.mind_scope}</span>
                    <span className="rag-chunk-sim">sim {(l.similarity || 0).toFixed(3)}</span>
                  </div>
                  <div className="rag-chunk-ex">{l.lesson_text}</div>
                </div>
              ))}
              {lessons.length === 0 && <div className="rag-empty">Geen lessen meegegeven aan deze draft.</div>}
              <div className="rag-notice">
                <div className="rag-notice-title"><Ic n="settings" s={14}/> Retrieval-instellingen</div>
                <div className="rag-notice-body">
                  top_k {params.top_k ?? '—'} · min_similarity {params.min_similarity ?? '—'} · recency_weight {params.recency_weight ?? '—'}
                  {ctx.entity_used ? ` · entity: ${ctx.entity_used.entity_type} (${ctx.entity_used.via})` : ' · geen entity-match'}
                  {ctx.computed_at ? ` · gebouwd ${msgTime(ctx.computed_at)}` : ''}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const AO_ICON = { reply: 'edit', forward: 'send', file: 'folder-in', schedule: 'calendar', delegate: 'arrow-right', defer: 'archive' }
const AO_COLOR = { reply: 'var(--brand)', forward: 'var(--c-klant)', file: 'var(--c-intern)', schedule: 'var(--c-plan)', delegate: 'var(--c-partner)', defer: 'var(--ink-3)' }

export function Pv2ActionsModal({ onClose }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let cancel = false
    supabase.from('autodraft_actions')
      .select('slug, category, display_name, description, target_value')
      .eq('enabled', true).order('category').order('slug')
      .then(({ data }) => { if (!cancel) setRows(data || []) })
    return () => { cancel = true }
  }, [])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-ico"><Ic n="sparkles" s={18}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">Wat Maestro kan voorstellen</div>
            <div className="modal-sub">Per mail kiest Maestro de meest waarschijnlijke actie. Je kunt altijd zelf wisselen via de knop rechtsonder.</div>
          </div>
          <button className="modal-close" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="modal-body">
          <div className="actions-grid">
            {(rows || []).map(r => (
              <div key={r.slug} className="ao-item ao-card">
                <span className="ao-ic" style={{ background: AO_COLOR[r.category] || 'var(--ink)' }}>
                  <Ic n={AO_ICON[r.category] || 'zap'} s={14}/>
                </span>
                <div>
                  <div className="ao-t">{r.display_name || r.slug}</div>
                  <div className="ao-s">{r.description || r.target_value || ''}</div>
                </div>
              </div>
            ))}
            {rows && rows.length === 0 && <div className="rag-empty">Geen acties in de catalogus.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

const SPELCHECK_DEFAULT =
  'Corrigeer alleen harde spel- en typefouten in de Nederlandse tekst. Behoud toon, structuur, opmaak en woordkeuze. Verander geen werkwoordstijden, alinea-indeling of stijl. Geef enkel de gecorrigeerde tekst terug, zonder commentaar.'

export function Pv2SpelcheckModal({ draftBody, onClose, onApply }) {
  const [extra, setExtra] = useState('')
  const [instr, setInstr] = useState(SPELCHECK_DEFAULT)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let cancel = false
    supabase.from('agent_config').select('config_value')
      .eq('agent_name', 'auto-draft').eq('config_key', 'spelcheck_default_instruction')
      .maybeSingle()
      .then(({ data }) => {
        const stored = data?.config_value?.text
        if (!cancel && stored && typeof stored === 'string' && stored.trim()) setInstr(stored)
      })
    return () => { cancel = true }
  }, [])
  async function apply() {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.functions.invoke('auto-draft-spelcheck', {
        body: { draft_body: draftBody, default_instruction: instr, extra_instruction: extra.trim() || null },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) throw new Error(data?.reason || 'spelcheck mislukt')
      onApply(data.corrected_body)
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-ico"><Ic n="spell" s={18}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">Spelcheck met AI</div>
            <div className="modal-sub">Loopt je concept door op spel- en typefouten; toon en structuur blijven intact.</div>
          </div>
          <button className="modal-close" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="modal-body">
          <label className="field-label">Default-instructie</label>
          <div className="rag-notice"><div className="rag-notice-body">{instr}</div></div>
          <div style={{ height: 12 }}/>
          <label className="field-label">Extra voorkeur voor deze keer (optioneel)</label>
          <textarea className="field-area" rows={2} value={extra} onChange={e => setExtra(e.target.value)}
                    placeholder='bv. "Britse spelling" of "contracties voluit"…'/>
          {err && <div className="rag-empty" style={{ color: 'oklch(0.55 0.2 25)' }}>⚠ {err}</div>}
        </div>
        <div className="modal-foot">
          <span className="modal-foot-meta">Resultaat vervangt de tekst in het schrijfvlak</span>
          <button className="btn" onClick={onClose} disabled={busy}>Annuleer</button>
          <button className="btn btn-primary" onClick={apply} disabled={busy}>
            {busy ? 'Spelcheck draait…' : 'Toepassen'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* Leerregel-modal voor awaiting ("🚫 Regel"): pattern + doelmap + reden. */
export function Pv2RuleModal({ folderOptions = [], onClose, onConfirm }) {
  const [pattern, setPattern] = useState('')
  const [folder, setFolder] = useState('Archief/Overig')
  const [reason, setReason] = useState('')
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-ico"><Ic n="shield-x" s={18}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">Leerregel toevoegen</div>
            <div className="modal-sub">Soortgelijke mails gaan voortaan automatisch naar de juiste map en verschijnen niet meer in In afwachting.</div>
          </div>
          <button className="modal-close" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="modal-body">
          <label className="field-label">Onderwerp bevat</label>
          <textarea className="field-area primary" rows={1} value={pattern} onChange={e => setPattern(e.target.value)}
                    placeholder="bv. 'Teams-vergadering' of 'nieuwsbrief'"/>
          <div style={{ height: 12 }}/>
          <label className="field-label">Doelmap</label>
          <select className="uc-select" style={{ width: '100%' }} value={folder} onChange={e => setFolder(e.target.value)}>
            {['Archief/Overig', ...folderOptions.filter(f => f !== 'Archief/Overig')].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <div style={{ height: 12 }}/>
          <label className="field-label">Reden (optioneel)</label>
          <textarea className="field-area" rows={2} value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Waarom hoort dit type mail hier niet?"/>
        </div>
        <div className="modal-foot">
          <span className="modal-foot-meta">Regel + afronden van deze thread</span>
          <button className="btn" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary" disabled={pattern.trim().length < 2}
                  onClick={() => onConfirm({ pattern: pattern.trim(), folder, reason: reason.trim() })}>
            <Ic n="check" s={14}/> Opslaan
          </button>
        </div>
      </div>
    </div>
  )
}

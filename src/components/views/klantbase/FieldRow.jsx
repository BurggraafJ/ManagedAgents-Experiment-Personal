/* FieldRow — één veld-rij in de detail-pane.
   4-koloms layout: Veld | Voorstel | Bron | Acties.
   Klik om uit te klappen → AI-redenering + bron-citaten + edit-control.
*/
import { SOURCES } from './klantbase-data'

const ICONS = {
  doc:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
  mail: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/></svg>,
  call: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>,
  hubspot: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/></svg>,
}
const INFO_ICO = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>

function statusPill(status) {
  if (status === 'approved') return <span className="kb-f-status-pill s-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>OK</span>
  if (status === 'edited')   return <span className="kb-f-status-pill s-edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>Gewijzigd</span>
  if (status === 'rejected') return <span className="kb-f-status-pill s-no"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>Afgewezen</span>
  return <span className="kb-f-status-pill s-pend"><span style={{ width: 5, height: 5, borderRadius: 9999, background: 'currentColor' }} />Check</span>
}

function deltaPill(f) {
  if (!f.current || f.current === '—' || f.current === 'n.v.t.') return <span className="kb-delta">nieuw</span>
  if (String(f.current) === String(f.proposed)) return <span className="kb-delta flat">gelijk</span>
  const a = parseFloat(String(f.current).replace(/[^0-9,.-]/g, '').replace(',', '.'))
  const b = parseFloat(String(f.proposed).replace(/[^0-9,.-]/g, '').replace(',', '.'))
  if (!isNaN(a) && !isNaN(b) && a !== 0) {
    if (b > a) return <span className="kb-delta">+{Math.round(Math.abs((b - a) / a) * 100)}%</span>
    if (b < a) return <span className="kb-delta down">−{Math.round(Math.abs((b - a) / a) * 100)}%</span>
  }
  return <span className="kb-delta">gewijzigd</span>
}

const isEmpty = (v) => !v || v === '—' || v === 'n.v.t.'

function sampleQuoteFor(f, srcKey) {
  const s = SOURCES[srcKey]
  if (!s) return null
  if (s.type === 'doc')     return <>Relevante passage: <em>"…{(f.label || '').toLowerCase()} zoals beschreven in artikel {s.page || ''}…"</em></>
  if (s.type === 'mail')    return <>Citaat: <em>"…ik bevestig hierbij dat {(f.label || '').toLowerCase()} = {f.proposed}…"</em></>
  if (s.type === 'call')    return <>Notitie: <em>"{(f.label || '').toLowerCase()} blijft {f.proposed}"</em></>
  if (s.type === 'hubspot') return <>Eigenschap <code>{f.key}</code> in {s.label} · waarde {f.proposed}</>
  return null
}

export default function FieldRow({ f, isOpen, isRen, onToggle, onApprove, onReject, onRerun, onSetValue }) {
  const stateCls = f.status === 'approved' ? 's-approved'
                 : f.status === 'edited'   ? 's-edited'
                 : f.status === 'rejected' ? 's-rejected'
                 : ''
  const isNum = (f.type === 'euro' || f.type === 'int' || f.type === 'percent')
  const srcMeta = SOURCES[f.srcKey] || {}
  const srcType = srcMeta.type || 'doc'

  return (
    <div className={`kb-f ${stateCls} ${isOpen ? 'is-open' : ''}`}>
      <div className="kb-f-head" onClick={onToggle}>
        {/* Label-cel */}
        <div className="kb-f-cell-lbl">
          <div className="kb-f-cell-lbl-row">
            <label>{f.label}</label>
            <button className="kb-f-info" onClick={(e) => { e.stopPropagation(); onToggle() }} title="Wat betekent dit veld?">
              {INFO_ICO}
            </button>
            {f.req && <span className="kb-req">vereist</span>}
            {f.xor && (
              <span className="kb-xor-pill" title={`XOR — niet samen met '${f.xor}' invullen`}>XOR</span>
            )}
            {f.computed && (
              <span className="kb-computed-pill" title={`Berekend uit: ${f.computed}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>
                auto
              </span>
            )}
          </div>
          <span className="kb-f-cell-lbl-key">{f.key}</span>
        </div>

        {/* Voorstel-cel */}
        <div className="kb-f-cell-val">
          {isRen ? (
            <div style={{ minWidth: 0 }}>
              <div className="kb-f-cell-val-diff">
                <span className="old-val">{isEmpty(f.current) ? '—' : f.current}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                <span className={`new-val ${isNum ? 'num' : ''}`}>{f.proposed}</span>
              </div>
              <div className="kb-f-cell-val-foot">
                {deltaPill(f)}
                {!isEmpty(f.proposed) && String(f.current) !== String(f.proposed) && (
                  <span className="kb-f-pred" title="AI-voorspelling — bevestig voordat je akkoord geeft">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3v4M19 17v4M3 5h4M17 19h4M14 4l-1 3M10 20l1-3M4 14l3-1M20 10l-3 1M9 9l6 6"/></svg>
                    voorspeld
                  </span>
                )}
                {statusPill(f.status)}
              </div>
            </div>
          ) : (
            <div style={{ minWidth: 0 }}>
              <div className={`kb-f-cell-value ${isNum ? 'num' : ''} ${isEmpty(f.proposed) ? 'empty' : ''}`}>
                {f.proposed}
              </div>
              <div className="kb-f-cell-val-foot">{statusPill(f.status)}</div>
            </div>
          )}
        </div>

        {/* Bron-cel */}
        <div className="kb-f-cell-src" onClick={(e) => e.stopPropagation()}>
          <div className={`kb-f-cell-src-ic t-${srcType}`}>
            {ICONS[srcType] || ICONS.doc}
          </div>
          <div className="kb-f-cell-src-main">
            <div className="kb-f-cell-src-name">{srcMeta.label || 'bron'}</div>
            <div className="kb-f-cell-src-meta">{srcMeta.page || ''}</div>
          </div>
        </div>

        {/* Acties */}
        <div className="kb-f-acts" onClick={(e) => e.stopPropagation()}>
          <button className="kb-f-act ok" title="Goedkeuren" onClick={onApprove}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </button>
          <button className="kb-f-act" title="Bewerken" onClick={onToggle}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button className="kb-f-act ai" title="AI opnieuw laten kijken" onClick={onRerun}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M3 21v-5h5"/></svg>
          </button>
          <button className="kb-f-act no" title="Afwijzen" onClick={onReject}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {isOpen && (
        <FieldBody f={f} onApprove={onApprove} onReject={onReject} onRerun={onRerun} onSetValue={onSetValue} />
      )}
    </div>
  )
}

function FieldBody({ f, onApprove, onReject, onRerun, onSetValue }) {
  const reasonNodes = renderReasonWithCites(f)
  const sources = (f.sources || [f.srcKey]).map(k => SOURCES[k] ? { k, ...SOURCES[k] } : null).filter(Boolean)

  return (
    <div className="kb-f-body">
      <div className="kb-f-uitleg">
        <div className="kb-f-uitleg-ic">{INFO_ICO}</div>
        <div className="kb-f-uitleg-body">
          <div className="kb-f-uitleg-lbl">Wat is dit veld?</div>
          <div className="kb-f-uitleg-txt">{f.uitleg || '—'}</div>
          <div className="kb-f-uitleg-foot">
            <span>Type: <b>{f.type}</b></span>
            {f.xor && <span>XOR met: <code>{f.xor}</code></span>}
            {f.computed && <span>Berekend uit: <code>{f.computed}</code></span>}
          </div>
        </div>
      </div>

      <p className="kb-f-reason"><b>AI-redenering — </b>{reasonNodes}</p>

      <div className="kb-f-sources">
        {sources.map(s => (
          <a key={s.k} className="kb-f-source" href="#" onClick={(e) => e.preventDefault()}>
            <div className={`kb-f-source-ic t-${s.type}`}>{ICONS[s.type] || ICONS.doc}</div>
            <div className="kb-f-source-m">
              <div className="kb-f-source-top">
                <span className="kb-f-source-who">{s.label}</span>
                <span>{s.page || ''}</span>
              </div>
              <div className="kb-f-source-q">{sampleQuoteFor(f, s.k)}</div>
            </div>
          </a>
        ))}
      </div>

      <EditControl f={f} onSetValue={onSetValue} />

      <div className="kb-f-foot">
        <div className="kb-f-foot-l">
          <button className="kb-btn kb-btn--primary" onClick={onApprove}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            Opslaan &amp; goedkeuren
          </button>
          <button className="kb-btn" onClick={onRerun}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M3 21v-5h5"/></svg>
            AI opnieuw
          </button>
          <button className="kb-btn kb-btn--ghost" onClick={onReject}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            Afwijzen
          </button>
        </div>
        <span className="kb-f-foot-meta">veld: <code>{f.key}</code></span>
      </div>
    </div>
  )
}

function EditControl({ f, onSetValue }) {
  if (f.type === 'select') {
    return (
      <div className="kb-f-edit">
        <span className="kb-f-edit-lbl">Voorgestelde waarde — pas aan indien nodig</span>
        <div className="kb-f-edit-ctl">
          <select value={f.proposed} onChange={(e) => onSetValue(e.target.value)}>
            {(f.options || []).map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
    )
  }
  const pref = f.type === 'euro' ? '€' : ''
  const suf  = f.type === 'percent' ? '%' : ''
  const raw = (f.proposed || '').replace(/^€\s*/, '').replace(/%$/, '').replace(/^—$/, '')
  const inputType = f.type === 'date' ? 'date' : (f.type === 'int' ? 'number' : 'text')
  return (
    <div className="kb-f-edit">
      <span className="kb-f-edit-lbl">Voorgestelde waarde — pas aan indien nodig</span>
      <div className="kb-f-edit-ctl">
        {pref && <span className="pref">{pref}</span>}
        <input
          type={inputType}
          defaultValue={raw}
          placeholder="—"
          onBlur={(e) => {
            const val = e.target.value
            const newVal = val ? `${pref ? pref + ' ' : ''}${val}${suf || ''}` : '—'
            onSetValue(newVal)
          }}
        />
        {suf && <span className="pref">{suf}</span>}
      </div>
    </div>
  )
}

/* Vervang {{cite}} markers in reason door bron-pill */
function renderReasonWithCites(f) {
  const reason = f.reason || ''
  const s = SOURCES[f.srcKey]
  const lbl = s ? `${s.label}${s.page ? ' · ' + s.page : ''}` : 'bron'
  const parts = reason.split(/\{\{cite\}\}/g)
  return parts.flatMap((p, i) => i === 0
    ? [p]
    : [<span key={i} className="kb-f-cite" title={lbl}>{lbl}</span>, p]
  )
}

/* FieldRow — één veld-rij in de detail-pane.
   4-koloms layout: Veld | Voorstel | Bron | Acties.
   - Klik op label-cel of bron-cel → uitklap met AI-redenering + bron-citaten.
   - Klik op voorstel-cel → inline edit (geen uitklap).
   - Hover op info-icon → tooltip met velduitleg (uit Klantbase-velden).
*/
import { useEffect, useRef, useState } from 'react'
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
  const [editingValue, setEditingValue] = useState(false)
  const [srcOpen, setSrcOpen] = useState(false)
  const stateCls = f.status === 'approved' ? 's-approved'
                 : f.status === 'edited'   ? 's-edited'
                 : f.status === 'rejected' ? 's-rejected'
                 : ''
  const isNum = (f.type === 'euro' || f.type === 'int' || f.type === 'percent')
  const srcMeta = SOURCES[f.srcKey] || {}
  const srcType = srcMeta.type || 'doc'
  // Echte bron: doc-label + letterlijke passage (sinds 2026-05-29). Fallback op dummy SOURCES.
  const srcDocLabel = f.sourceDoc || srcMeta.label || 'Bron'
  const hasQuote = !!f.sourceQuote

  function commitValue(val) {
    if (val !== f.proposed) onSetValue(val)
    setEditingValue(false)
  }

  return (
    <div className={`kb-f ${stateCls} ${isOpen ? 'is-open' : ''}`}>
      <div className="kb-f-head">
        {/* Label-cel: klik = uitklap. Pills onder de naam. */}
        <div className="kb-f-cell-lbl kb-clickable" onClick={onToggle}>
          <div className="kb-f-cell-lbl-row">
            <label>{f.label}</label>
            <InfoTooltip f={f} />
          </div>
          <span className="kb-f-cell-lbl-key">{f.key}</span>
          {(f.req || f.xor || f.computed) && (
            <div className="kb-f-cell-lbl-meta">
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
          )}
        </div>

        {/* Voorstel-cel: klik = inline edit (NIET uitklap). */}
        <div
          className={`kb-f-cell-val ${editingValue ? 'is-editing' : 'kb-clickable-val'}`}
          onClick={(e) => { e.stopPropagation(); if (!editingValue) setEditingValue(true) }}
        >
          {editingValue ? (
            <InlineEditor f={f} onCommit={commitValue} onCancel={() => setEditingValue(false)} />
          ) : (
            <ValueDisplay f={f} isRen={isRen} isNum={isNum} />
          )}
        </div>

        {/* Bron-cel: hover = passage-preview, klik = bron-popup. */}
        <div
          className={`kb-f-cell-src ${hasQuote ? 'kb-src-trigger' : 'kb-clickable'}`}
          onClick={(e) => { if (hasQuote) { e.stopPropagation(); setSrcOpen(true) } else { onToggle() } }}
        >
          <div className={`kb-f-cell-src-ic t-${srcType}`}>{ICONS[srcType] || ICONS.doc}</div>
          <div className="kb-f-cell-src-main">
            <div className="kb-f-cell-src-name">{srcDocLabel}</div>
            <div className="kb-f-cell-src-meta">{hasQuote ? 'klik voor bron' : (srcMeta.page || '')}</div>
          </div>
          {hasQuote && (
            <div className="kb-src-hovercard" role="tooltip">
              <div className="kb-src-hovercard-doc">
                {ICONS.doc}
                <span>{srcDocLabel}</span>
              </div>
              <div className="kb-src-hovercard-q">“{f.sourceQuote}”</div>
              <div className="kb-src-hovercard-hint">Klik om de volledige bron te openen</div>
            </div>
          )}
        </div>

        {/* Acties */}
        <div className="kb-f-acts" onClick={(e) => e.stopPropagation()}>
          <button className="kb-f-act ok" title="Goedkeuren" onClick={onApprove}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </button>
          <button className="kb-f-act" title="Bewerken" onClick={(e) => { e.stopPropagation(); setEditingValue(true) }}>
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

      {isOpen && <FieldBody f={f} onApprove={onApprove} onReject={onReject} onRerun={onRerun} />}
      {srcOpen && <SourceModal f={f} docLabel={srcDocLabel} onClose={() => setSrcOpen(false)} />}
    </div>
  )
}

/* SourceModal — popup met de volledige bron achter een veld.
   Toont het bron-document, de letterlijke passage, de afgeleide waarde
   en de AI-redenering. Read-only — puur ter controle. */
function SourceModal({ f, docLabel, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="kb-src-modal-overlay" onClick={onClose}>
      <div className="kb-src-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="kb-src-modal-head">
          <div className="kb-src-modal-doc">
            <div className="kb-f-cell-src-ic t-doc">{ICONS.doc}</div>
            <div>
              <div className="kb-src-modal-doc-name">{docLabel}</div>
              <div className="kb-src-modal-doc-sub">Bron voor: {f.label}</div>
            </div>
          </div>
          <button className="kb-src-modal-x" onClick={onClose} aria-label="Sluiten">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div className="kb-src-modal-body">
          <div className="kb-src-modal-label">Letterlijke passage</div>
          <blockquote className="kb-src-modal-quote">{f.sourceQuote || '—'}</blockquote>

          <div className="kb-src-modal-grid">
            <div>
              <div className="kb-src-modal-label">Afgeleide waarde</div>
              <div className="kb-src-modal-val">{f.proposed}</div>
            </div>
            {f.confidence != null && (
              <div>
                <div className="kb-src-modal-label">Zekerheid</div>
                <div className="kb-src-modal-val">{Math.round(f.confidence * 100)}%</div>
              </div>
            )}
          </div>

          {f.reason && (
            <>
              <div className="kb-src-modal-label">AI-redenering</div>
              <p className="kb-src-modal-reason">{renderReasonWithCites(f)}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ValueDisplay({ f, isRen, isNum }) {
  if (isRen) {
    return (
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
    )
  }
  return (
    <div style={{ minWidth: 0 }}>
      <div className={`kb-f-cell-value ${isNum ? 'num' : ''} ${isEmpty(f.proposed) ? 'empty' : ''}`}>
        {f.proposed}
      </div>
      <div className="kb-f-cell-val-foot">{statusPill(f.status)}</div>
    </div>
  )
}

/* InlineEditor — inplace bewerken van de voorgestelde waarde.
   - select: dropdown
   - euro/int/percent/date/text: input met optionele prefix/suffix
   Op blur of Enter slaat de waarde op. Esc annuleert.
*/
function InlineEditor({ f, onCommit, onCancel }) {
  const ref = useRef(null)
  const pref = f.type === 'euro' ? '€' : ''
  const suf  = f.type === 'percent' ? '%' : ''
  const initRaw = (f.proposed || '').replace(/^€\s*/, '').replace(/%$/, '').replace(/^—$/, '')

  useEffect(() => { ref.current?.focus(); ref.current?.select?.() }, [])

  if (f.type === 'select') {
    return (
      <select
        ref={ref}
        className="kb-f-inline-select"
        defaultValue={f.proposed}
        onBlur={(e) => onCommit(e.target.value)}
        onChange={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
      >
        {(f.options || []).map(o => <option key={o}>{o}</option>)}
      </select>
    )
  }
  const inputType = f.type === 'date' ? 'date' : (f.type === 'int' ? 'number' : 'text')
  return (
    <div className="kb-f-inline-input-wrap">
      {pref && <span className="kb-f-inline-pref">{pref}</span>}
      <input
        ref={ref}
        type={inputType}
        className="kb-f-inline-input"
        defaultValue={initRaw}
        placeholder="—"
        onBlur={(e) => {
          const raw = e.target.value
          const next = raw ? `${pref ? pref + ' ' : ''}${raw}${suf || ''}` : '—'
          onCommit(next)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') onCancel()
        }}
      />
      {suf && <span className="kb-f-inline-pref">{suf}</span>}
    </div>
  )
}

/* InfoTooltip — hover-popover op het info-icon.
   Toont label + type + uitleg + eventuele rules (xor/computed/req).
   Komt niet meer als blok in de uitklap-body (Jelle-feedback 2026-05-28).
*/
function InfoTooltip({ f }) {
  return (
    <span className="kb-info-tip-wrap" onClick={(e) => e.stopPropagation()}>
      <button className="kb-f-info" type="button" tabIndex={-1} aria-label="Wat betekent dit veld?">
        {INFO_ICO}
      </button>
      <div className="kb-info-tip" role="tooltip">
        <div className="kb-info-tip-head">
          <span className="kb-info-tip-lbl">{f.label}</span>
          <span className="kb-info-tip-type">{f.type}</span>
        </div>
        <p className="kb-info-tip-body">{f.uitleg || '—'}</p>
        {(f.req || f.xor || f.computed || f.options) && (
          <div className="kb-info-tip-rules">
            {f.req && <div className="rule"><b>Verplicht</b><span>— moet ingevuld voordat de overdracht kan.</span></div>}
            {f.xor && <div className="rule"><b>XOR</b><span>— vul deze of <code>{f.xor}</code> in, niet allebei.</span></div>}
            {f.computed && <div className="rule"><b>Berekend</b><span>— afgeleid uit: <code>{f.computed}</code></span></div>}
            {f.options && <div className="rule"><b>Opties</b><span>— {f.options.length}: {f.options.slice(0, 4).join(', ')}{f.options.length > 4 ? '…' : ''}</span></div>}
          </div>
        )}
      </div>
    </span>
  )
}

/* FieldBody — uitgeklapte body: alleen AI-redenering + bron-citaten + footer.
   Het "Wat is dit veld?"-blok is verwijderd (2026-05-28); uitleg leeft nu in
   de hover-tooltip op het info-icon én op de Klantbase-velden pagina.
*/
function FieldBody({ f, onApprove, onReject, onRerun }) {
  const reasonNodes = renderReasonWithCites(f)

  return (
    <div className="kb-f-body">
      <p className="kb-f-reason"><b>AI-redenering — </b>{reasonNodes}</p>

      <div className="kb-f-sources">
        {f.sourceQuote ? (
          /* Echte bron-passage uit het document */
          <div className="kb-f-source kb-f-source--real">
            <div className="kb-f-source-ic t-doc">{ICONS.doc}</div>
            <div className="kb-f-source-m">
              <div className="kb-f-source-top">
                <span className="kb-f-source-who">{f.sourceDoc || 'Bron'}</span>
              </div>
              <div className="kb-f-source-q">“{f.sourceQuote}”</div>
            </div>
          </div>
        ) : (
          /* Fallback: dummy-bron uit klantbase-data.js (oude UI-fase) */
          (f.sources || [f.srcKey]).map(k => SOURCES[k] ? { k, ...SOURCES[k] } : null).filter(Boolean).map(s => (
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
          ))
        )}
      </div>

      <div className="kb-f-foot">
        <div className="kb-f-foot-l">
          <button className="kb-btn kb-btn--primary" onClick={onApprove}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            Goedkeuren
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

/* Vervang {{cite}} markers in reason door bron-pill.
   Prefereer het echte bron-doc-label (f.sourceDoc); val terug op dummy SOURCES. */
function renderReasonWithCites(f) {
  const reason = f.reason || ''
  const s = SOURCES[f.srcKey]
  const lbl = f.sourceDoc || (s ? `${s.label}${s.page ? ' · ' + s.page : ''}` : 'bron')
  const parts = reason.split(/\{\{cite\}\}/g)
  return parts.flatMap((p, i) => i === 0
    ? [p]
    : [<span key={i} className="kb-f-cite" title={lbl}>{lbl}</span>, p]
  )
}

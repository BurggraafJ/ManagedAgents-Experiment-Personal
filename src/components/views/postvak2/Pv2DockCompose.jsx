import { useState } from 'react'
import Ic from './pv2Icons'
import { ComposeBody, RefineLoading, TrackChangesBar } from './Pv2Composer'

/* Pv2DockCompose — concept-gedeelte van het dock (design: .variants +
 * .composer): variant-kaarten met uitleg, Aan/Cc-chips met +ontvanger-
 * popover, onderwerp, schrijfvlak (incl. taalcheck-track-changes) en het
 * herschrijf-laadeffect. Pure presentatie — alle state leeft in Pv2Dock. */

const VARIANT_WHY_FALLBACK = 'Voorgesteld op basis van vergelijkbare eerdere reacties.'

export function VariantCards({ variants, variant, onPick, reasonShort }) {
  if (!variants || variants.length === 0) return null
  return (
    <div className="variants" style={variants.length !== 3 ? { gridTemplateColumns: `repeat(${Math.min(variants.length, 3)},1fr)` } : null}>
      {variants.map((v, i) => (
        <button key={v.id || v.label || i} className={`variant-card ${variant === i ? 'active' : ''}`} onClick={() => onPick(i)}>
          <div className="variant-top">
            <span className="variant-num">v{i + 1}</span>
            <span className="variant-title">{v.label || `Variant ${i + 1}`}</span>
            {variant === i && <span className="variant-badge"><Ic n="check" s={9}/>actief</span>}
          </div>
          <div className="variant-prev">{String(v.body || '').split('\n').filter(Boolean).slice(0, 2).join(' ')}</div>
          <div className="variant-why"><Ic n="sparkles" s={11}/><span>{v.why || reasonShort || VARIANT_WHY_FALLBACK}</span></div>
        </button>
      ))}
    </div>
  )
}

function RecipAddPop({ contacts, toList, ccList, onAddTo, onAddCc, onClose }) {
  const [custom, setCustom] = useState('')
  const taken = new Set([...toList, ...ccList].map(e => e.toLowerCase()))
  const options = contacts.filter(c => !taken.has(c.email.toLowerCase()))
  const customOk = /\S+@\S+\.\S+/.test(custom.trim())
  return (
    <div className="recip-add-pop" onClick={e => e.stopPropagation()} onMouseLeave={onClose}>
      <div className="dd-label">Voeg toe aan</div>
      {options.map(c => (
        <div key={c.email} className="recip-add-row">
          <div className="recip-add-info">
            <div className="recip-add-name">{c.name}</div>
            <div className="recip-add-mail">{c.email}</div>
          </div>
          <div className="recip-add-btns">
            <button onClick={() => onAddTo(c.email)}>Aan</button>
            <button onClick={() => onAddCc(c.email)}>Cc</button>
          </div>
        </div>
      ))}
      <div className="recip-add-row">
        <input className="comp-input" style={{ flex: 1, minWidth: 0, fontSize: 12.5 }} placeholder="ander e-mailadres…"
               value={custom} onChange={e => setCustom(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter' && customOk) { onAddTo(custom.trim()); setCustom('') } }}/>
        <div className="recip-add-btns">
          <button disabled={!customOk} onClick={() => { onAddTo(custom.trim()); setCustom('') }}>Aan</button>
          <button disabled={!customOk} onClick={() => { onAddCc(custom.trim()); setCustom('') }}>Cc</button>
        </div>
      </div>
    </div>
  )
}

export default function Pv2DockCompose({
  variants, variant, onPickVariant, reasonShort,
  toList, setToList, ccList, setCcList, contacts,
  subject, setSubject,
  body, setBody, tc, onAcceptTc, onRejectTc,
  refining, refineLabel,
}) {
  const [recipOpen, setRecipOpen] = useState(false)
  return (
    <div className="dock-compose">
      <VariantCards variants={variants} variant={variant} onPick={onPickVariant} reasonShort={reasonShort}/>
      <div className="composer">
        <div className="comp-row">
          <span className="comp-label">Aan</span>
          {toList.map(e => (
            <span key={e} className="comp-chip">{e}
              <button title="Verwijder" onClick={() => setToList(toList.filter(x => x !== e))}><Ic n="x" s={11}/></button>
            </span>
          ))}
          <div className="recip-add-wrap">
            <button className="comp-cc" onClick={() => setRecipOpen(v => !v)}>+ ontvanger</button>
            {recipOpen && (
              <RecipAddPop contacts={contacts} toList={toList} ccList={ccList}
                           onAddTo={e => setToList([...toList, e])}
                           onAddCc={e => setCcList([...ccList, e])}
                           onClose={() => setRecipOpen(false)}/>
            )}
          </div>
        </div>
        {ccList.length > 0 && (
          <div className="comp-row">
            <span className="comp-label">Cc</span>
            {ccList.map(e => (
              <span key={e} className="comp-chip">{e}
                <button title="Verwijder" onClick={() => setCcList(ccList.filter(x => x !== e))}><Ic n="x" s={11}/></button>
              </span>
            ))}
          </div>
        )}
        <div className="comp-row">
          <span className="comp-label">Onderwerp</span>
          <input className="comp-input comp-subject" value={subject} onChange={e => setSubject(e.target.value)}/>
          <span className="draft-tag"><span className="draft-tag-dot"/>Concept</span>
        </div>
        <TrackChangesBar tc={tc} onAccept={onAcceptTc} onReject={onRejectTc}/>
        <ComposeBody body={body} setBody={setBody} tc={tc}/>
        {refining && <RefineLoading verb="herschrijft" label={refineLabel}/>}
      </div>
    </div>
  )
}

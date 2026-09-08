import { useEffect } from 'react'
import MIcon from './MIcon'
import { srcWord, stepKind } from '../lib/answerLayers'

// =============================================================================
// MobileAnswerSheet — Bronnen en Onderzoek als bottom-sheet (spoor 08, 1h)
// =============================================================================
// Tot v1.151 stonden er op de telefoon acht bronkaarten inline onder ELK
// antwoord, met snippet en al. Je scrolde dus door de verantwoording heen om bij
// het volgende antwoord te komen, en de kaarten waren niet aan te klikken.
//
// Jelle gaf 2026-09-07 groen licht (1h): inline blijft alleen de
// verantwoordingsregel; dezelfde inhoud komt in een sheet. Mobiel krijgt daarmee
// dezelfde hiërarchie als desktop (H6), niet een eigen app.
//
// Hergebruikt de bestaande `.m-sheet` + `.m-scrim` uit mobile.css (nieuwe-taak
// sheet, v1.125) zodat de bewegingen en de safe-area-afhandeling identiek zijn.
// =============================================================================

const srcIcon = (s) => ({
  mail: 'mail', engagement: 'mail', note: 'mail', contact: 'contacts',
  company: 'admin', deal: 'admin', meeting: 'cal', agenda: 'cal', event: 'cal', chunk: 'mind',
}[s] || 'spark')

const fmtDate = (iso) => {
  if (!iso) return null
  try { return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return null }
}

export default function MobileAnswerSheet({ open, tab, onTab, onClose, citations, usedNs, steps, sentence, footer }) {
  // Escape en een terug-swipe zijn op iOS niet hetzelfde; de scrim is de
  // betrouwbare sluiter. Body-scroll blokkeren zolang de sheet open staat.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.classList.add('m-sheet-open')
    return () => root.classList.remove('m-sheet-open')
  }, [open])
  if (!open) return null

  const cites = Array.isArray(citations) ? citations : []
  const used = usedNs || new Set()
  const usedList = cites.filter(c => used.has(c.n))
  const restList = cites.filter(c => !used.has(c.n))
  const geenCitaties = usedList.length === 0

  return (
    <>
      <div className="m-scrim" onClick={onClose} aria-hidden />
      <div className="m-sheet m-ansheet" role="dialog" aria-label={tab === 'bronnen' ? 'Bronnen' : 'Onderzoek'}>
        <div className="m-ansheet__grab" aria-hidden />
        <div className="m-ansheet__head">
          <div className="m-ansheet__title">{tab === 'bronnen' ? 'Bronnen' : 'Onderzoek'}</div>
          {tab === 'bronnen' ? (
            <div className="m-ansheet__sub">
              {geenCitaties
                ? `${Math.min(3, restList.length)} meest relevant — niet in het antwoord genoemd`
                : `${usedList.length} gebruikt in het antwoord${restList.length ? ` · ${restList.length} wel bekeken, niet gebruikt` : ''}`}
            </div>
          ) : (
            sentence && <div className="m-ansheet__sub">{sentence}</div>
          )}
          <div className="m-ansheet__seg">
            <button type="button" className={tab === 'bronnen' ? 'is-active' : ''} onClick={() => onTab('bronnen')}>
              Bronnen {cites.length ? <em>{geenCitaties ? Math.min(3, restList.length) : usedList.length}</em> : null}
            </button>
            <button type="button" className={tab === 'onderzoek' ? 'is-active' : ''} onClick={() => onTab('onderzoek')}>
              Onderzoek {steps?.length ? <em>{steps.length}</em> : null}
            </button>
          </div>
        </div>

        <div className="m-ansheet__body">
          {tab === 'bronnen'
            ? <SourceList primary={geenCitaties ? restList.slice(0, 3) : usedList} rest={geenCitaties ? restList.slice(3) : restList} />
            : <Timeline steps={steps || []} />}
        </div>

        {footer && <div className="m-ansheet__foot">{footer}</div>}
      </div>
    </>
  )
}

function SourceList({ primary, rest }) {
  if (primary.length === 0 && rest.length === 0) {
    return <div className="m-ansheet__empty">Geen bronnen bij dit antwoord.</div>
  }
  return (
    <>
      {primary.map((c, i) => <SourceRow key={c.n ?? i} cite={c} />)}
      {rest.length > 0 && (
        <>
          <div className="m-ansheet__group">Ook bekeken, niet gebruikt · {rest.length}</div>
          {rest.map((c, i) => <SourceRow key={`r${c.n ?? i}`} cite={c} dim />)}
        </>
      )}
    </>
  )
}

function SourceRow({ cite, dim }) {
  const src = cite.source || 'mail'
  return (
    <div className={`m-ansrc ${dim ? 'is-dim' : ''}`}>
      <span className="m-ansrc__num">{cite.n ?? '·'}</span>
      <span className="m-ansrc__ico"><MIcon name={srcIcon(src)} size={12} /></span>
      <div className="m-ansrc__body">
        <div className="m-ansrc__title">{cite.subject || cite.title || srcWord(src, 1)}</div>
        <div className="m-ansrc__sub">
          {[fmtDate(cite.occurred_at || cite.ts), cite.from_name || srcWord(src, 1)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  )
}

// Dezelfde drie registers als desktop (vondst · leeg-met-reden · mislukt), maar
// zonder uitklapbare vondsten: op 390 px is de rij zelf de informatie.
function Timeline({ steps }) {
  if (steps.length === 0) return <div className="m-ansheet__empty">Geen stappen vastgelegd.</div>
  return (
    <div className="m-antl">
      {steps.map((st, i) => {
        const kind = stepKind(st)
        const detail = st.detail || ''
        const reason = (kind === 'empty' || kind === 'fail')
          ? (detail.split(/\s+—\s+/).slice(1).join(' — ') || detail.replace(/^mislukt:\s*/i, ''))
          : null
        if (kind === 'think') {
          return (
            <div key={i} className="m-antl__row m-antl__row--think">
              <span className="m-antl__ico" aria-hidden>💭</span>
              <div className="m-antl__main"><div className="m-antl__label">{st.label}</div></div>
            </div>
          )
        }
        return (
          <div key={i} className={`m-antl__row m-antl__row--${kind}`}>
            <span className="m-antl__ico" aria-hidden>{kind === 'fail' ? '✕' : kind === 'empty' ? '–' : '✓'}</span>
            <div className="m-antl__main">
              <div className="m-antl__label">{st.label}{kind === 'ok' && detail ? <em> — {detail}</em> : null}</div>
              {reason && <div className="m-antl__reason">{kind === 'fail' ? `mislukt: ${reason}` : reason}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

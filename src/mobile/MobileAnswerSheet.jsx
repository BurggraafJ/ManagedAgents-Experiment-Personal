import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import MIcon from './MIcon'
import { useSheetDrag } from '../hooks/useSheetDrag'
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
//
// ── v1.157: twee bugs die Jelle op zijn iPhone zag (2026-09-08) ─────────────
// 1) De sheet liep DOOR onder de composer en de tabbar: de laatste stappen en
//    de voetregel waren onzichtbaar. Oorzaak is niet de hoogte maar de PLEK in
//    de boom. De sheet werd gerenderd binnen `.m-zk--ask`, en dat is
//    `position: fixed` — een fixed element maakt een eigen stacking context.
//    Alles daarin (dus ook `.m-scrim` z-40 en `.m-sheet` z-41) wordt daarmee
//    geschilderd op het niveau van de dock zelf (z-index auto = 0), en de
//    `.m-tabbar` (z-10, kind van `.shell--m`) ligt daar per definitie bovenop.
//    Gemeten in het I2-harnas: `elementFromPoint` op de tabbar gaf de tabbar,
//    niet de sheet, terwijl de sheet wél tot de onderkant van de viewport liep.
//    Fix: de sheet gaat via een portal naar `.shell--m` — dezelfde plek waar de
//    "Meer"-drawer al hangt, en die werkt. Portalen naar `document.body` mag
//    NIET: alle `--m-*`-tokens staan op `.shell--m`, en één lege `var()` maakt
//    de hele declaratie ongeldig (geheugen: maestro-tokens-are-scoped).
//    Daarbij hoort `m-modal-open` in plaats van `m-sheet-open`: die eerste
//    verbergt de tabbar én lockt de scroll van `.m-main` (de sheet-variant
//    zette `overflow: hidden` op de body, en die scrolt in de mobiele shell
//    helemaal niet — het was dus een no-op).
// 2) Het greepje was decoratie. Nu sleept het (useSheetDrag), en er staat een
//    kruisje naast de kop zodat er ook zonder gebaar een weg terug is.
// =============================================================================

// De sheet hoort in de shell-root te hangen, niet in de chat-dock. Valt terug op
// <body> zodat een harnas of test zonder shell niet stilletjes niets rendert.
const sheetHost = () => (typeof document === 'undefined'
  ? null
  : document.querySelector('.shell--m') || document.body)

const srcIcon = (s) => ({
  mail: 'mail', engagement: 'mail', note: 'mail', contact: 'contacts',
  company: 'admin', deal: 'admin', meeting: 'cal', agenda: 'cal', event: 'cal', chunk: 'mind',
}[s] || 'spark')

const fmtDate = (iso) => {
  if (!iso) return null
  try { return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return null }
}

export default function MobileAnswerSheet({ open, tab, onTab, onClose, citations, usedNs, steps, sentence, footer }) {
  // m-modal-open verbergt de tabbar + FAB en lockt de scroll van .m-main —
  // dezelfde vergrendeling als de geschiedenis-sheet en de nieuwe-taak-sheet.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.classList.add('m-modal-open')
    return () => root.classList.remove('m-modal-open')
  }, [open])
  const drag = useSheetDrag({ onClose, enabled: open })
  const host = open ? sheetHost() : null
  if (!open || !host) return null

  const cites = Array.isArray(citations) ? citations : []
  const used = usedNs || new Set()
  const usedList = cites.filter(c => used.has(c.n))
  const restList = cites.filter(c => !used.has(c.n))
  const geenCitaties = usedList.length === 0
  const titel = tab === 'bronnen' ? 'Bronnen' : 'Onderzoek'

  return createPortal(
    <>
      <div className="m-scrim" onClick={onClose} aria-hidden />
      <div
        className={`m-sheet m-ansheet ${drag.dragging ? 'is-dragging' : ''}`}
        style={drag.dragStyle}
        role="dialog"
        aria-label={titel}
      >
        {/* Sleep-vlak = greepje + kop. De segment-knoppen vallen erbuiten, want
            een pointer-capture over een knop maakt die knop onbetrouwbaar. */}
        <div className="m-sheet__drag" {...drag.handleProps}>
          <div className="m-ansheet__grab" aria-hidden />
          <div className="m-ansheet__head m-ansheet__head--top">
            <div className="m-ansheet__titlerow">
              <div className="m-ansheet__title">{titel}</div>
              <button type="button" className="m-ansheet__close" onClick={onClose} aria-label="Sluiten">
                <MIcon name="close" size={15} />
              </button>
            </div>
            {tab === 'bronnen' ? (
              <div className="m-ansheet__sub">
                {geenCitaties
                  ? `${Math.min(3, restList.length)} meest relevant — niet in het antwoord genoemd`
                  : `${usedList.length} gebruikt in het antwoord${restList.length ? ` · ${restList.length} wel bekeken, niet gebruikt` : ''}`}
              </div>
            ) : (
              sentence && <div className="m-ansheet__sub">{sentence}</div>
            )}
          </div>
        </div>
        <div className="m-ansheet__head m-ansheet__head--seg">
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
    </>,
    host,
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

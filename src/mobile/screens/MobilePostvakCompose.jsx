import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from '../../components/Toast'
import { keyboardInset } from '../../lib/keyboardInset'
import { TC_LEVELS, TC_MAX_LEVEL, useTaalcheck } from '../../hooks/useTaalcheck'
import { CHIP_ORDER, refineMail } from '../../lib/composeAi'
import { usePv2Signature, withSignature } from '../../hooks/usePv2Outlook'
import { invokeOutlook } from '../../hooks/useOutlookMail'
import { SEND_DOMAIN, checkRecipients, externalCopy, splitAddresses } from '../../lib/mailPolicy'
import MIcon from '../MIcon'
import '../mobile-compose.css'

// =============================================================================
// MobilePostvakCompose — nieuwe mail opstellen op de telefoon (v1.203)
// =============================================================================
// Wat desktop in `Pv2NewMail` doet, maar dan met één duim: de FAB opent dit
// vel, je typt, Maestro schrijft of checkt mee, en je verstuurt.
//
// Dezelfde motor als desktop, bewust geen tweede:
//   • schrijven/herschrijven → `lib/composeAi` (Edge Function mail-verbeteraar)
//   • taalcheck              → `hooks/useTaalcheck` (Edge Function taalcheck-v2)
//   • handtekening           → `usePv2Signature` + `withSignature`
// De niveau-keuze van de taalcheck deelt zijn localStorage-sleutel met desktop,
// dus wat je daar koos geldt hier ook.
//
// ── Versturen ───────────────────────────────────────────────────────────────
// `outlook-live` → action `send_mail` verstuurt écht (zie de kop van
// _shared/outlook-send.ts). Zolang de Entra-grant `Mail.Send` mist kán dat niet,
// en dan is de enige eerlijke uitkomst: niet doen alsof, wél de tekst redden.
// De knop meldt dus de échte reden en zet je mail intussen als concept in
// Outlook — geen stille "verstuurd"-toast over een mail die nooit vertrok.
//
// ── Het beleid (Jelle 2026-09-15 00:44, HARD) ───────────────────────────────
// Alleen `@legal-mind.nl`. Dit scherm is de derde en zwakste laag daarvan: het
// is er om het te **zeggen** — zodra er een extern adres in Aan staat verdwijnt
// de Verstuur-knop en blijft Concept over, met de reden eronder. De laag die
// het **afdwingt** zit in `outlook-live` en in `_shared/outlook-send.ts`, want
// een knop die je verbergt is geen slot. Zie `src/lib/mailPolicy.js`.
// =============================================================================

// Reden van de server → wat een mens daaraan heeft. Wat hier niet in staat is
// geen bekende blokkade maar een storing, en die hoort een gewone foutmelding
// te blijven: "Mail.Send ontbreekt" tonen bij een 502 stuurt Jelle naar Jasper
// voor een probleem dat daar niet zit.
const SEND_BLOCKED = {
  mail_send_scope_missing:
    'De Outlook-koppeling heeft geen recht om te versturen (Mail.Send). Dat zet Jasper aan in Entra.',
  mail_send_tool_missing:
    'De verstuur-tool van de Outlook-koppeling bestaat niet meer onder deze naam.',
  mail_send_bad_request:
    'De verstuur-aanroep klopt niet met wat Outlook verwacht.',
  send_rate_unavailable:
    'De verstuur-teller is niet bereikbaar. Uit voorzorg verstuurt Maestro dan niet.',
  unknown_action:
    'De verstuur-route staat nog niet op de server — deze versie is nog niet uitgerold.',
}

/** De uurteller is geen blokkade van hetzelfde soort: hij gaat vanzelf voorbij. */
function rateLimitCopy(data) {
  const t = data?.retry_after ? new Date(data.retry_after) : null
  const when = t && !Number.isNaN(t.getTime())
    ? ` Om ${t.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} mag er weer één.`
    : ''
  return `Je hebt het uurmaximum van ${data?.limit ?? 7} verstuurde mails bereikt.${when}`
}

const sheetHost = () => (typeof document === 'undefined'
  ? null
  : document.querySelector('.shell--m') || document.body)

export default function MobilePostvakCompose({ open, mode = 'send', onClose, onSent }) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [aiInput, setAiInput] = useState('')
  const [refining, setRefining] = useState(false)
  const [refineLabel, setRefineLabel] = useState('')
  const [sending, setSending] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [blocked, setBlocked] = useState(null)   // { message, draftPlaced }

  const { signature } = usePv2Signature()
  const bodyRef = useRef(body)
  bodyRef.current = body
  const {
    tc, taalcheckBusy, runTaalcheck, acceptTaalcheck, rejectTaalcheck, tcLevel, setTcLevel,
  } = useTaalcheck({ getBody: () => bodyRef.current, setBody })

  // iOS-toetsenbord + tabbar/FAB verbergen — zelfde mechaniek als de andere
  // mobiele sheets (MobileNewTask, MobileMailSheet).
  useEffect(() => {
    if (!open) return undefined
    const root = document.documentElement
    root.classList.add('m-modal-open')
    const vv = window.visualViewport
    const apply = () => { if (vv) root.style.setProperty('--m-kb', `${keyboardInset(vv)}px`) }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      root.style.setProperty('--m-kb', '0px')
      root.classList.remove('m-modal-open')
    }
  }, [open])

  const host = open ? sheetHost() : null
  if (!open || !host) return null

  const busy = sending || savingDraft || refining || taalcheckBusy
  const finalText = () => withSignature(body, signature).trim()

  // Geen useMemo: dit is een split van één invoerveld, en een hook hier zou ná
  // de vroege return staan. Zie src/lib/mailPolicy.js voor de regel zelf.
  const rcpts = splitAddresses(to)
  const policy = checkRecipients(rcpts)
  // `mode` komt van de FAB-keuze (Concept of Mail). Een extern adres wint
  // daarvan: dan is Concept de enige knop die er nog staat.
  const maySend = mode === 'send' && policy.verdict !== 'external'

  // Alleen leegmaken als de mail écht weg is (verstuurd of als concept
  // weggezet). Gewoon sluiten laat je tekst staan — je tikt het vel net zo
  // makkelijk per ongeluk dicht als bewust.
  const reset = () => { setTo(''); setSubject(''); setBody(''); setAiInput(''); setBlocked(null) }

  async function runRefine(label) {
    if (busy || tc) return
    setRefineLabel(label)
    setRefining(true)
    try {
      const { text, examplesUsed } = await refineMail({ body, label })
      setBody(text)
      if (examplesUsed) {
        showToast({ message: 'Maestro schreef mee', detail: `${examplesUsed} vergelijkbare verzonden mails als stijlvoorbeeld.` })
      }
      setAiInput('')
    } catch (e) {
      showToast({ kind: 'error', message: 'Schrijven mislukt', detail: e.message })
    }
    setRefining(false)
  }

  /** Los concept in de Concepten-map. Ook het vangnet als versturen niet mag. */
  async function placeDraft({ silent = false } = {}) {
    const text = finalText()
    if (!text && !subject.trim()) {
      showToast({ kind: 'error', message: 'Nog geen inhoud voor een concept' })
      return false
    }
    setSavingDraft(true)
    try {
      const data = await invokeOutlook({ action: 'create_draft', subject, body_text: text, to: rcpts })
      if (!data.ok) throw new Error(data.reason || 'aanmaken mislukt')
      if (!silent) {
        showToast({ message: 'Concept staat in Outlook', detail: 'Te vinden in je Concepten-map.' })
        reset()
        onSent?.()
        onClose()
      }
      return true
    } catch (e) {
      if (!silent) showToast({ kind: 'error', message: 'Concept aanmaken mislukt', detail: e.message })
      return false
    } finally {
      setSavingDraft(false)
    }
  }

  async function send() {
    if (rcpts.length === 0) {
      showToast({ kind: 'error', message: 'Nog geen ontvanger', detail: 'Vul een e-mailadres in bij Aan.' })
      return
    }
    // Laag 3 van het domeinbeleid. De knop hoort hier al weg te zijn; dit is
    // het vangnet voor het geval een adres tussen render en tik is bijgetypt.
    if (policy.verdict === 'external') {
      setBlocked({ message: externalCopy(policy.external), draftPlaced: false, kind: 'policy' })
      return
    }
    const text = finalText()
    if (!text) {
      showToast({ kind: 'error', message: 'De mail is nog leeg' })
      return
    }
    setSending(true)
    setBlocked(null)
    try {
      const data = await invokeOutlook({ action: 'send_mail', subject, body_text: text, to: rcpts })
      if (data?.ok) {
        // De verstuur-tool kent één Aan-adres; de rest is naar Cc verhuisd en
        // dat hoort de afzender te weten, niet te ontdekken in Verzonden items.
        const moved = Array.isArray(data.cc_promoted_from_to) ? data.cc_promoted_from_to : []
        showToast({
          message: 'Mail verstuurd',
          detail: moved.length
            ? `Naar ${data.to?.[0] ?? rcpts[0]} · ${moved.length} ${moved.length === 1 ? 'adres' : 'adressen'} op Cc (de koppeling verstuurt naar één Aan-adres).`
            : `Naar ${rcpts.join(', ')}.`,
        })
        reset()
        onSent?.()
        onClose()
        return
      }
      // Drie soorten "nee", drie verschillende teksten. Alleen bij de eerste
      // soort zetten we een concept weg: bij een uurmaximum wil je het over een
      // paar minuten gewoon nog eens proberen, niet eerst je concepten opruimen.
      if (data?.reason === 'send_external_recipients') {
        setBlocked({ message: externalCopy(data.external || policy.external), draftPlaced: false, kind: 'policy' })
        return
      }
      if (data?.reason === 'send_rate_limited') {
        setBlocked({ message: rateLimitCopy(data), draftPlaced: false, kind: 'rate' })
        return
      }
      const message = SEND_BLOCKED[data?.reason]
      if (!message) throw new Error(data?.reason || 'versturen geweigerd')
      const draftPlaced = await placeDraft({ silent: true })
      setBlocked({ message, draftPlaced })
      showToast({ kind: 'error', message: 'Niet verstuurd', detail: message })
    } catch (e) {
      showToast({ kind: 'error', message: 'Versturen mislukt', detail: e.message })
    } finally {
      // In een `finally`, niet eronder: het vel blijft gemonteerd na sluiten, en
      // de geslaagde tak springt eruit met een `return`. Zonder dit stond
      // Verstuur bij de vólgende mail permanent op "Bezig…".
      setSending(false)
    }
  }

  const cycleLevel = () => setTcLevel(tcLevel >= TC_MAX_LEVEL ? 1 : tcLevel + 1)

  return createPortal(
    <>
      <div className="m-scrim" onClick={onClose} aria-hidden />
      <div className="m-compose" role="dialog" aria-modal="true" aria-label="Nieuwe mail">
        <div className="m-compose__head">
          <button type="button" className="m-iconbtn" onClick={onClose} aria-label="Sluiten">
            <MIcon name="close" size={18} />
          </button>
          <span className="m-compose__title">{mode === 'draft' ? 'Nieuw concept' : 'Nieuwe mail'}</span>
          <button type="button" className="m-compose__ghost" disabled={busy || !!tc}
                  onClick={() => placeDraft()}>
            {savingDraft ? '…' : 'Concept'}
          </button>
          {maySend && (
            <button type="button" className="m-compose__send" disabled={busy || !!tc}
                    onClick={send}
                    title={tc ? 'Neem de taalcheck eerst over of verwerp hem' : 'Versturen vanuit Outlook'}>
              <MIcon name="send" size={14} color="currentColor" stroke={2} />
              {sending ? 'Bezig…' : 'Verstuur'}
            </button>
          )}
        </div>

        <div className="m-compose__body">
          {blocked && (
            <div className="m-compose__blocked" role="status">
              <strong>{blocked.kind === 'rate' ? 'Even niet.' : 'Niet verstuurd.'}</strong> {blocked.message}
              <span>{blocked.draftPlaced
                ? 'Je tekst staat wél als concept in Outlook — daar kun je hem versturen.'
                : 'Je tekst staat nog hier; zet hem desnoods als concept weg.'}</span>
            </div>
          )}

          <div className="m-compose__row">
            <span className="m-compose__lbl">Aan</span>
            <input className="m-compose__in" value={to} onChange={e => setTo(e.target.value)}
                   type="email" inputMode="email" autoCapitalize="off" autoCorrect="off"
                   placeholder={`naam@${SEND_DOMAIN}`} aria-label="Aan" />
          </div>

          {/* Waarom de Verstuur-knop weg is. Zwijgen zou lezen als een bug. */}
          {policy.verdict === 'external' && (
            <div className="m-compose__policy" role="status">
              <MIcon name="lock" size={13} />
              <span>{externalCopy(policy.external)} Je kunt er wél een concept van maken en dat in Outlook versturen.</span>
            </div>
          )}
          <div className="m-compose__row">
            <span className="m-compose__lbl">Onderwerp</span>
            <input className="m-compose__in" value={subject} onChange={e => setSubject(e.target.value)}
                   placeholder="Onderwerp" aria-label="Onderwerp" />
          </div>

          {tc && (
            <div className="m-compose__tcbar">
              <span className="m-compose__tctxt">
                Taalcheck ({TC_LEVELS[tc.level]}): <b>{tc.stats.ins} erbij</b> · {tc.stats.del} weg
              </span>
              <button type="button" className="m-compose__tcno" onClick={rejectTaalcheck}>Verwerp</button>
              <button type="button" className="m-compose__tcok" onClick={acceptTaalcheck}>
                <MIcon name="check" size={13} color="currentColor" stroke={2.2} />Overnemen
              </button>
            </div>
          )}

          {tc ? (
            <div className="m-compose__tcview" aria-label="Taalcheck-resultaat met wijzigingen">
              {tc.segments.map((s, i) => (
                <span key={i} className={s.type === 'del' ? 'tc-del' : s.type === 'ins' ? 'tc-ins' : ''}>{s.text}</span>
              ))}
            </div>
          ) : (
            <textarea className="m-compose__ta" value={body} onChange={e => setBody(e.target.value)}
                      placeholder="Typ je bericht… of laat Maestro het schrijven."
                      aria-label="Bericht" rows={9} />
          )}

          {signature && <div className="m-compose__sign">{signature}</div>}

          {refining && (
            <div className="m-compose__aiload">
              <MIcon name="sparkles" size={15} />
              Maestro schrijft{refineLabel ? ` — ${refineLabel.toLowerCase()}` : ''}…
            </div>
          )}
        </div>

        <div className="m-compose__foot">
          <div className="m-compose__chips">
            {CHIP_ORDER.map(c => (
              <button key={c} type="button" className="m-compose__chip" disabled={busy || !!tc}
                      onClick={() => runRefine(c)}>
                <MIcon name="sparkles" size={12} />{c}
              </button>
            ))}
            <button type="button" className="m-compose__chip m-compose__chip--tc" disabled={busy || !!tc}
                    onClick={runTaalcheck}>
              <MIcon name="spell" size={12} />{taalcheckBusy ? 'Taalcheck…' : 'Taalcheck'}
            </button>
            <button type="button" className="m-compose__lvl" disabled={busy || !!tc} onClick={cycleLevel}
                    aria-label={`Taalcheck-intensiteit: ${TC_LEVELS[tcLevel]} — tik om te wisselen`}
                    title="Foutloos = alleen fouten · Vloeiend = ook kromme zinnen · Beter verwoord = sterkst verwoord">
              {TC_LEVELS[tcLevel]}
            </button>
          </div>
          <div className="m-compose__ask">
            <input className="m-compose__askin" value={aiInput} onChange={e => setAiInput(e.target.value)}
                   placeholder="Vertel Maestro wat je wil sturen…" disabled={busy || !!tc}
                   aria-label="Opdracht voor Maestro"
                   onKeyDown={e => { if (e.key === 'Enter' && aiInput.trim()) runRefine(aiInput) }} />
            <button type="button" className="m-compose__asksend" disabled={busy || !!tc || !aiInput.trim()}
                    onClick={() => aiInput.trim() && runRefine(aiInput)}>
              <MIcon name="sparkles" size={13} color="currentColor" />Schrijf
            </button>
          </div>
        </div>
      </div>
    </>,
    host,
  )
}

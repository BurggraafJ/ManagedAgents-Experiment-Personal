import { useEffect, useState } from 'react'
import Ic from './pv2Icons'

/* Pv2Loader — boot-overlay (design: Loader), alleen bij een KOUDE start.
 *
 * v1.223: tot en met v1.221 draaide hier een vaste timerketen (380→760→1120→
 * 1320→1620 ms) die de hele chrome ~1,6 s blokkeerde — óók als de SWR-cache
 * vol stond en de lijst er al was. Nu:
 *   • Postvak2View mount deze overlay niet als er al lijstdata is (warme cache).
 *   • Koud gaat hij weg zodra `ready` (= de eerste bruikbare data staat er),
 *     na een korte fade (STEP_FADE_MS). Geen cosmetische wachttijd ná data.
 *   • Vangnet: na MAX_MS weg, ook zonder data — de lijst heeft zijn eigen
 *     skeleton, een hangende fetch mag de chrome niet gijzelen.
 * De stappen lopen in het Outlook-vocabulaire van F0 (mappen, Postvak IN,
 * gesprekken) — niet in dat van de AI-lane. */
// Twee decoratieve stappen; de derde (Gesprekken koppelen) blijft draaien tot
// de data er is — een vinkje zonder data is een leugen.
const STEP_MS = [380, 760]
const STEP_FADE_MS = 300
const MAX_MS = 8000

export default function Pv2Loader({ onDone, counts, ready = false }) {
  const [step, setStep] = useState(0)
  const [fade, setFade] = useState(false)

  // Visuele voortgang terwijl we wachten — puur decoratie, blokkeert niets.
  useEffect(() => {
    const t = STEP_MS.map((ms, i) => setTimeout(() => setStep(s => Math.max(s, i + 1)), ms))
    return () => t.forEach(clearTimeout)
  }, [])

  // Afsluiten: op data (ready) of op het vangnet — wat het eerst komt.
  useEffect(() => {
    if (fade) return undefined
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setStep(3)
      setFade(true)
    }
    if (ready) { finish(); return undefined }
    const cap = setTimeout(finish, MAX_MS)
    return () => clearTimeout(cap)
  }, [ready, fade])

  useEffect(() => {
    if (!fade) return undefined
    const t = setTimeout(() => {
      try { sessionStorage.setItem('pvk2-loaded', '1') } catch { /* ignore */ }
      onDone && onDone()
    }, STEP_FADE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fade])

  const n = v => (v != null && v > 0 ? `${v}` : '…')
  const items = [
    { label: 'Outlook-mappen ophalen', c: n(counts?.folders) },
    { label: 'Postvak IN laden', c: n(counts?.inbox) },
    { label: 'Gesprekken koppelen', c: n(counts?.threads) },
  ]
  const Spin = <span className="loader-spin"/>
  const Done = <Ic n="check" s={13}/>
  const Wait = <span style={{ opacity: 0.35 }}><Ic n="clock" s={13}/></span>
  return (
    <div className={`loader ${fade ? 'fade-out' : ''}`} aria-busy={!fade} aria-live="polite">
      <div className="loader-mark"><Ic n="inbox" s={26}/></div>
      <div style={{ textAlign: 'center' }}>
        <div className="loader-title">Postvak openen…</div>
        <div className="loader-sub" style={{ marginTop: 4 }}>Outlook-mappen, Postvak IN en gesprekken ophalen</div>
      </div>
      <div className="loader-steps">
        {items.map((it, i) => (
          <div key={i} className={`loader-step ${step > i ? 'done' : step === i ? 'active' : ''}`}>
            <span className="loader-ico">{step > i ? Done : step === i ? Spin : Wait}</span>
            {it.label}
            <span className="loader-count">{step >= i ? it.c : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import Ic from './pv2Icons'

/* Pv2Loader — boot-overlay (design: Loader). Draait één keer per sessie
 * (sessionStorage) en toont de echte aantallen zodra de data binnen is. */
export default function Pv2Loader({ onDone, counts }) {
  const [step, setStep] = useState(0)
  const [fade, setFade] = useState(false)
  useEffect(() => {
    const t = [
      setTimeout(() => setStep(1), 380),
      setTimeout(() => setStep(2), 760),
      setTimeout(() => setStep(3), 1120),
      setTimeout(() => setFade(true), 1320),
      setTimeout(() => {
        try { sessionStorage.setItem('pvk2-loaded', '1') } catch { /* ignore */ }
        onDone && onDone()
      }, 1620),
    ]
    return () => t.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const items = [
    { label: 'Mails ophalen uit Outlook', c: counts?.mails != null ? `${counts.mails}` : '…' },
    { label: 'Categoriseren & RAG-chunks koppelen', c: counts?.categorized != null ? `${counts.categorized}` : '…' },
    { label: 'Concepten genereren voor jou', c: counts?.drafts != null ? `${counts.drafts}` : '…' },
  ]
  const Spin = <span className="loader-spin"/>
  const Done = <Ic n="check" s={13}/>
  const Wait = <span style={{ opacity: 0.35 }}><Ic n="clock" s={13}/></span>
  return (
    <div className={`loader ${fade ? 'fade-out' : ''}`}>
      <div className="loader-mark"><Ic n="inbox" s={26}/></div>
      <div style={{ textAlign: 'center' }}>
        <div className="loader-title">Maestro leest je inbox…</div>
        <div className="loader-sub" style={{ marginTop: 4 }}>RAG-scoring, categoriseren en concepten klaarzetten</div>
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

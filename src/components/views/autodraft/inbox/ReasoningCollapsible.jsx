import { useState } from 'react'
import styles from '../autodraft.module.css'

// Skill-insight banner als click-to-expand collapsible. Ingeklapt toont een
// preview tot ~80 chars; klik klapt uit naar de volledige reasoning. Default
// ingeklapt zodat de header-strook compact blijft — uitklap is opt-in.
export default function ReasoningCollapsible({ reasoning }) {
  const [open, setOpen] = useState(false)
  const preview = reasoning && reasoning.length > 80
    ? reasoning.slice(0, 80).trim() + '…'
    : reasoning
  return (
    <button
      type="button"
      className={`ad-reasoning ad-reasoning--collapsible ${open ? 'ad-reasoning--open' : ''} ${styles.detailReasoningTop}`}
      onClick={() => setOpen(v => !v)}
      aria-expanded={open}
      title={open ? 'Klik om in te klappen' : 'Klik om volledige reasoning te tonen'}
    >
      <span className="ad-reasoning__label">Skill denkt:</span>{' '}
      <span className="ad-reasoning__text">{open ? reasoning : preview}</span>
      <span className="ad-reasoning__chev" aria-hidden>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </span>
    </button>
  )
}

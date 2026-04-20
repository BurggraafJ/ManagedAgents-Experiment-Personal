import { useEffect, useRef, useState } from 'react'

const PIN_LENGTH = 4

export default function PinGate({ onSubmit, submitting, error }) {
  const [digits, setDigits] = useState(Array(PIN_LENGTH).fill(''))
  const inputRefs = useRef([])

  // Focus eerste vak op mount
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  // Reset bij fout
  useEffect(() => {
    if (error) {
      setDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
    }
  }, [error])

  const handleChange = (i, val) => {
    const clean = val.replace(/\D/g, '').slice(0, 1)
    const next = [...digits]
    next[i] = clean
    setDigits(next)
    if (clean && i < PIN_LENGTH - 1) {
      inputRefs.current[i + 1]?.focus()
    }
    // Auto-submit als alle 4 ingevuld
    if (clean && i === PIN_LENGTH - 1) {
      const full = [...next].join('')
      if (full.length === PIN_LENGTH) {
        onSubmit(full)
      }
    }
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputRefs.current[i - 1]?.focus()
    }
    if (e.key === 'Enter') {
      const full = digits.join('')
      if (full.length === PIN_LENGTH) onSubmit(full)
    }
  }

  const handlePaste = (e) => {
    const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, PIN_LENGTH)
    if (paste.length === PIN_LENGTH) {
      e.preventDefault()
      setDigits(paste.split(''))
      onSubmit(paste)
    }
  }

  return (
    <div className="pingate">
      <div className="pingate__card">
        <div className="pingate__logo">
          legal<span style={{ color: 'var(--accent)' }}>mind</span>
        </div>
        <div className="pingate__tagline">Agent Command Center</div>

        <div className="pingate__title">Voer je code in</div>
        <div className="pingate__hint">Toegang blijft 24 uur geldig op dit apparaat.</div>

        <div className="pingate__inputs" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => (inputRefs.current[i] = el)}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={1}
              value={d}
              disabled={submitting}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="pingate__box"
              aria-label={`Cijfer ${i + 1}`}
            />
          ))}
        </div>

        {error && <div className="pingate__error">{error}</div>}
        {submitting && <div className="pingate__pending">Controleren…</div>}
      </div>
    </div>
  )
}

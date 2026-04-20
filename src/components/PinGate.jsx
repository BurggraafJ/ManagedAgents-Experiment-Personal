import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const PIN_LENGTH = 4

export default function PinGate({ onSubmit, submitting, error, errorCode }) {
  const [profiles, setProfiles] = useState([])
  const [selected, setSelected] = useState(null)
  const [digits, setDigits] = useState(Array(PIN_LENGTH).fill(''))
  const inputRefs = useRef([])

  // Laad profielen
  useEffect(() => {
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_dashboard_profiles')
      if (!rpcError && Array.isArray(data)) {
        setProfiles(data)
      }
    })()
  }, [])

  // Focus eerste vak als profile gekozen
  useEffect(() => {
    if (selected) {
      setTimeout(() => inputRefs.current[0]?.focus(), 40)
    }
  }, [selected])

  // Reset bij fout — blijf bij hetzelfde profiel
  useEffect(() => {
    if (error) {
      setDigits(Array(PIN_LENGTH).fill(''))
      if (selected) setTimeout(() => inputRefs.current[0]?.focus(), 50)
    }
  }, [error, selected])

  const handleChange = (i, val) => {
    const clean = val.replace(/\D/g, '').slice(0, 1)
    const next = [...digits]
    next[i] = clean
    setDigits(next)
    if (clean && i < PIN_LENGTH - 1) {
      inputRefs.current[i + 1]?.focus()
    }
    if (clean && i === PIN_LENGTH - 1) {
      const full = next.join('')
      if (full.length === PIN_LENGTH && selected) onSubmit(selected.name, full)
    }
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputRefs.current[i - 1]?.focus()
    }
    if (e.key === 'Enter') {
      const full = digits.join('')
      if (full.length === PIN_LENGTH && selected) onSubmit(selected.name, full)
    }
  }

  const handlePaste = (e) => {
    const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, PIN_LENGTH)
    if (paste.length === PIN_LENGTH && selected) {
      e.preventDefault()
      setDigits(paste.split(''))
      onSubmit(selected.name, paste)
    }
  }

  const isRateLimited = errorCode === 'rate_limited'

  return (
    <div className="pingate">
      <div className="pingate__card">
        <div className="pingate__logo">
          legal<span style={{ color: 'var(--accent)' }}>mind</span>
        </div>
        <div className="pingate__tagline">Agent Command Center</div>

        {!selected ? (
          <>
            <div className="pingate__title">Wie ben je?</div>
            <div className="pingate__hint">Kies je profiel om verder te gaan.</div>
            <div className="pingate__profiles">
              {profiles.map(p => (
                <button
                  key={p.name}
                  onClick={() => setSelected(p)}
                  className={`pingate__profile ${!p.active ? 'pingate__profile--inactive' : ''}`}
                >
                  <div className="pingate__profile-name">{p.display_name}</div>
                  {!p.active && <div className="pingate__profile-tag">nog niet geactiveerd</div>}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="pingate__profile-back">
              <button className="btn btn--ghost" onClick={() => { setSelected(null); setDigits(Array(PIN_LENGTH).fill('')) }}>
                ← terug
              </button>
              <div className="pingate__profile-current">{selected.display_name}</div>
            </div>

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
                  disabled={submitting || isRateLimited}
                  onChange={e => handleChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  className="pingate__box"
                  aria-label={`Cijfer ${i + 1}`}
                />
              ))}
            </div>

            {error && (
              <div className={isRateLimited ? 'pingate__error pingate__error--strong' : 'pingate__error'}>
                {error}
              </div>
            )}
            {submitting && <div className="pingate__pending">Controleren…</div>}
          </>
        )}
      </div>
    </div>
  )
}

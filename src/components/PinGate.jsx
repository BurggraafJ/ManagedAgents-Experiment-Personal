import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSupabaseAuth } from '../hooks/useSupabaseAuth'

const PIN_LENGTH = 4

export default function PinGate({ onSubmit, submitting, error, errorCode }) {
  const [authMode, setAuthMode] = useState('pin') // 'pin' | 'supabase'
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

        {authMode === 'supabase' ? (
          <SupabaseLoginPanel onBack={() => setAuthMode('pin')} />
        ) : !selected ? (
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
            <div style={{ marginTop: 18, textAlign: 'center' }}>
              <button
                className="btn btn--ghost"
                style={{ fontSize: 12, color: 'var(--text-muted)' }}
                onClick={() => setAuthMode('supabase')}
              >
                of log in met e-mail →
              </button>
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

// ==================================================================
// Supabase login / signup / magic-link panel — naast PIN, Fase 1 van
// de PIN→Supabase-migratie. Zodra Jelle zich hier aanmeldt en de
// email bevestigt, is de volgende load via Supabase ontgrendeld.
// ==================================================================
function SupabaseLoginPanel({ onBack }) {
  const auth = useSupabaseAuth()
  const [mode, setMode] = useState('signin') // signin | signup | magic
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setNotice(null)
    if (mode === 'signin') {
      const ok = await auth.signIn(email, password)
      if (ok) setNotice('✓ Ingelogd — dashboard laadt…')
    } else if (mode === 'signup') {
      const ok = await auth.signUp(email, password)
      if (ok) setNotice('✓ Aangemeld — check je mail voor de bevestigingslink')
    } else if (mode === 'magic') {
      const ok = await auth.sendMagicLink(email)
      if (ok) setNotice('✓ Magic link verstuurd naar ' + email)
    }
  }

  return (
    <div>
      <div className="pingate__profile-back" style={{ marginBottom: 12 }}>
        <button className="btn btn--ghost" onClick={onBack}>← terug naar PIN</button>
      </div>

      <div className="pingate__title">
        {mode === 'signin' ? 'Log in' : mode === 'signup' ? 'Aanmelden' : 'Magic link'}
      </div>
      <div className="pingate__hint">
        {mode === 'signin' && 'Met je e-mail en wachtwoord.'}
        {mode === 'signup' && 'Eenmalig aanmaken — je krijgt een bevestigings-mail.'}
        {mode === 'magic' && 'Krijg een link in je mail om automatisch in te loggen.'}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="e-mail"
          required
          autoComplete="email"
          style={authInputStyle}
          disabled={auth.busy}
        />
        {mode !== 'magic' && (
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="wachtwoord"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            style={authInputStyle}
            disabled={auth.busy}
          />
        )}
        <button
          type="submit"
          className="btn btn--accent"
          disabled={auth.busy}
          style={{ padding: '11px 20px', borderRadius: 8, fontWeight: 600 }}
        >
          {auth.busy ? 'Bezig…' :
            mode === 'signin' ? 'Inloggen' :
            mode === 'signup' ? 'Account aanmaken' :
            'Stuur magic link'}
        </button>
      </form>

      {notice && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          background: 'var(--success-dim)', color: 'var(--success)',
          fontSize: 12,
        }}>{notice}</div>
      )}
      {auth.error && (
        <div className="pingate__error" style={{ marginTop: 12 }}>
          {auth.error}
        </div>
      )}

      <div style={{
        display: 'flex', gap: 12, justifyContent: 'center',
        marginTop: 16, fontSize: 12,
      }}>
        {mode !== 'signin' && (
          <button type="button" className="btn btn--ghost" onClick={() => setMode('signin')}
            style={{ fontSize: 11, padding: '4px 10px' }}>
            Inloggen
          </button>
        )}
        {mode !== 'signup' && (
          <button type="button" className="btn btn--ghost" onClick={() => setMode('signup')}
            style={{ fontSize: 11, padding: '4px 10px' }}>
            Nieuw account
          </button>
        )}
        {mode !== 'magic' && (
          <button type="button" className="btn btn--ghost" onClick={() => setMode('magic')}
            style={{ fontSize: 11, padding: '4px 10px' }}>
            Magic link
          </button>
        )}
      </div>
    </div>
  )
}

const authInputStyle = {
  width: '100%', padding: '11px 14px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text)', fontFamily: 'inherit', fontSize: 14,
}

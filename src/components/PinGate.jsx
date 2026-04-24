import { useEffect, useState } from 'react'
import { useSupabaseAuth } from '../hooks/useSupabaseAuth'

// Auth-gate (sinds v54) — Supabase Auth is de enige login-route. PIN en
// profile-selector zijn verwijderd. De filename blijft `PinGate.jsx`
// voor backwards-compat met imports; de inhoud is volledig vervangen.
//
// Twee modi, afhankelijk van context:
//   - default: inloggen (email+password, magic link, wachtwoord vergeten)
//   - recovery: wachtwoord resetten zodra de user via de reset-link uit
//     z'n mail op de app landt (#type=recovery in URL).
export default function PinGate() {
  // Detect password-reset flow via URL-hash (Supabase redirect na klik op
  // reset-link stuurt ?type=recovery óf #type=recovery). Als er recovery-
  // context is: toon UpdatePasswordPanel in plaats van login.
  const [isRecovery, setIsRecovery] = useState(() => detectRecovery())

  useEffect(() => {
    const onHashChange = () => setIsRecovery(detectRecovery())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div className="pingate">
      <div className="pingate__card">
        <div className="pingate__logo">
          legal<span style={{ color: 'var(--accent)' }}>mind</span>
        </div>
        <div className="pingate__tagline">Agent Command Center</div>

        {isRecovery ? (
          <UpdatePasswordPanel onDone={() => {
            // Na succesvol updaten: verwijder recovery-hash en ga naar dashboard.
            if (typeof window !== 'undefined') {
              history.replaceState(null, '', window.location.pathname)
            }
            setIsRecovery(false)
          }} />
        ) : (
          <LoginPanel />
        )}
      </div>
    </div>
  )
}

function detectRecovery() {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash || ''
  const query = window.location.search || ''
  return hash.includes('type=recovery') || query.includes('type=recovery')
}

// ==================================================================
// Login-paneel — email+password · magic link · wachtwoord vergeten
// ==================================================================
function LoginPanel() {
  const auth = useSupabaseAuth()
  const [mode, setMode] = useState('signin') // signin | magic | forgot
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setNotice(null)
    if (mode === 'signin') {
      const ok = await auth.signIn(email, password)
      if (ok) setNotice('✓ Ingelogd — dashboard laadt…')
    } else if (mode === 'magic') {
      const ok = await auth.sendMagicLink(email)
      if (ok) setNotice(`✓ Magic link verstuurd naar ${email}. Check je inbox (+ spam).`)
    } else if (mode === 'forgot') {
      const ok = await auth.resetPassword(email)
      if (ok) setNotice(`✓ Reset-link verstuurd naar ${email}. Klik in de mail en kies een nieuw wachtwoord.`)
    }
  }

  return (
    <>
      <div className="pingate__title">
        {mode === 'signin' ? 'Inloggen' : mode === 'magic' ? 'Magic link' : 'Wachtwoord vergeten'}
      </div>
      <div className="pingate__hint">
        {mode === 'signin' && 'Log in met je e-mail en wachtwoord.'}
        {mode === 'magic'  && 'Krijg een link in je mail om zonder wachtwoord in te loggen.'}
        {mode === 'forgot' && 'We sturen een link waarmee je een nieuw wachtwoord kunt kiezen.'}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="burggraaf@legal-mind.nl"
          required
          autoComplete="email"
          autoFocus
          style={inputStyle}
          disabled={auth.busy}
        />
        {mode === 'signin' && (
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="wachtwoord"
            required
            minLength={8}
            autoComplete="current-password"
            style={inputStyle}
            disabled={auth.busy}
          />
        )}
        <button
          type="submit"
          className="btn btn--accent"
          disabled={auth.busy}
          style={{ padding: '12px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14 }}
        >
          {auth.busy ? 'Bezig…' :
            mode === 'signin' ? 'Inloggen' :
            mode === 'magic'  ? 'Stuur magic link' :
            'Stuur reset-link'}
        </button>
      </form>

      {notice && (
        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 8,
          background: 'var(--success-dim)', color: 'var(--success)', fontSize: 12,
        }}>{notice}</div>
      )}
      {auth.error && (
        <div className="pingate__error" style={{ marginTop: 12 }}>
          {auth.error}
        </div>
      )}

      <div style={{
        display: 'flex', gap: 10, justifyContent: 'center',
        marginTop: 18, fontSize: 11, flexWrap: 'wrap',
      }}>
        {mode !== 'signin' && (
          <button type="button" className="btn btn--ghost"
            onClick={() => { setMode('signin'); setNotice(null) }}
            style={linkStyle}>
            ← inloggen
          </button>
        )}
        {mode !== 'magic' && (
          <button type="button" className="btn btn--ghost"
            onClick={() => { setMode('magic'); setNotice(null) }}
            style={linkStyle}>
            Magic link
          </button>
        )}
        {mode !== 'forgot' && (
          <button type="button" className="btn btn--ghost"
            onClick={() => { setMode('forgot'); setNotice(null) }}
            style={linkStyle}>
            Wachtwoord vergeten?
          </button>
        )}
      </div>
    </>
  )
}

// ==================================================================
// Update-password-paneel — zichtbaar nadat user op reset-link klikt
// ==================================================================
function UpdatePasswordPanel({ onDone }) {
  const auth = useSupabaseAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [notice, setNotice] = useState(null)
  const [localErr, setLocalErr] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLocalErr(null); setNotice(null)
    if (password.length < 8) {
      setLocalErr('Wachtwoord moet minimaal 8 tekens zijn.'); return
    }
    if (password !== confirm) {
      setLocalErr('Wachtwoorden komen niet overeen.'); return
    }
    const ok = await auth.updatePassword(password)
    if (ok) {
      setNotice('✓ Wachtwoord ingesteld — je bent automatisch ingelogd.')
      setTimeout(onDone, 900)
    }
  }

  return (
    <>
      <div className="pingate__title">Kies een nieuw wachtwoord</div>
      <div className="pingate__hint">Minimaal 8 tekens. Na opslaan ben je direct ingelogd.</div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="nieuw wachtwoord"
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus
          style={inputStyle}
          disabled={auth.busy}
        />
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="nogmaals"
          required
          minLength={8}
          autoComplete="new-password"
          style={inputStyle}
          disabled={auth.busy}
        />
        <button type="submit" className="btn btn--accent" disabled={auth.busy}
          style={{ padding: '12px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14 }}>
          {auth.busy ? 'Opslaan…' : 'Instellen en inloggen'}
        </button>
      </form>

      {notice && (
        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 8,
          background: 'var(--success-dim)', color: 'var(--success)', fontSize: 12,
        }}>{notice}</div>
      )}
      {(localErr || auth.error) && (
        <div className="pingate__error" style={{ marginTop: 12 }}>
          {localErr || auth.error}
        </div>
      )}
    </>
  )
}

const inputStyle = {
  width: '100%', padding: '11px 14px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text)', fontFamily: 'inherit', fontSize: 14,
}
const linkStyle = {
  fontSize: 11, padding: '4px 10px', color: 'var(--text-muted)',
}

import { useState, useEffect, useRef, useMemo } from 'react'
import { useSupabaseAuth } from '../hooks/useSupabaseAuth'
import styles from './Login.module.css'

// 5 panes: signin / forgot / sent / reset / twofa.
// Recovery-flow (?reset=1 in URL) forceert reset-pane via auth.isRecovery.
// 2FA-pane = visuele stub (Supabase MFA niet aan voor huidige accounts).
export default function Login() {
  const auth = useSupabaseAuth()
  const [pane, setPane] = useState(() => {
    if (auth.isRecovery) return 'reset'
    const h = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', '')
    return ['signin', 'forgot', 'sent', 'reset', 'twofa'].includes(h) ? h : 'signin'
  })

  useEffect(() => {
    if (auth.isRecovery) setPane('reset')
  }, [auth.isRecovery])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '#' + pane)
    }
  }, [pane])

  return (
    <div className={styles.shell}>
      <main className={styles.form}>
        <Brand />

        <div className={styles.formWrap}>
          {pane === 'signin' && <SignInPane auth={auth} go={setPane} />}
          {pane === 'forgot' && <ForgotPane auth={auth} go={setPane} />}
          {pane === 'sent'   && <SentPane go={setPane} />}
          {pane === 'reset'  && <ResetPane auth={auth} />}
          {pane === 'twofa'  && <TwoFAPane go={setPane} />}
        </div>

        <div className={styles.formFoot}>
          <span>© 2026 Legal Mind · <span className={styles.kbd}>v 1.0</span></span>
          <div style={{ display: 'flex', gap: 14 }}>
            <a href="#">Privacy</a>
            <a href="#">Voorwaarden</a>
            <a href="#">Status <span className={styles.dotLive} style={{ marginLeft: 3, verticalAlign: 'middle' }} /></a>
          </div>
        </div>
      </main>

      <ArtColumn />
    </div>
  )
}

function Brand() {
  return (
    <a className={styles.brand} href="/">
      <span className={styles.brandMark} aria-label="Legal Mind">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M5 19V6"/>
          <path d="M19 19V6"/>
          <path d="M5 6l7 8 7-8"/>
          <circle cx="12" cy="14" r="1.5" fill="#dc6f3f" stroke="none"/>
        </svg>
      </span>
      <span className={styles.brandText}>Legal<em>Mind</em></span>
    </a>
  )
}

function SignInPane({ auth, go }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [keep, setKeep] = useState(true)

  async function onSubmit(e) {
    e.preventDefault()
    if (!email || !pw) return
    await auth.signIn(email, pw)
    // App.jsx switcht zelf naar Dashboard zodra status='signed-in'.
  }

  return (
    <section className={styles.pane}>
      <p className={styles.paneEyebrow}>Welkom terug</p>
      <h1 className={styles.paneTitle}>Log in op je <em>werkplek</em></h1>
      <p className={styles.paneSub}>Toegang tot je inbox, agenda, administratie en agents — alles op één plek.</p>

      <form onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="lm-email">E-mailadres</label>
          <div className={styles.fieldInputWrap}>
            <span className={styles.fieldIcon}>
              <Icon><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></Icon>
            </span>
            <input
              className={`${styles.fieldInput} ${styles.hasIcon}`}
              id="lm-email" type="email" autoComplete="username"
              placeholder="jelle@legal-mind.nl"
              required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              disabled={auth.busy}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="lm-pw">Wachtwoord</label>
          <div className={styles.fieldInputWrap}>
            <span className={styles.fieldIcon}>
              <Icon><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></Icon>
            </span>
            <input
              className={`${styles.fieldInput} ${styles.hasIcon}`}
              id="lm-pw" type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••••"
              required
              value={pw} onChange={e => setPw(e.target.value)}
              disabled={auth.busy}
            />
            <button type="button" className={styles.fieldToggle}
              onClick={() => setShowPw(s => !s)}
              aria-label={showPw ? 'Verberg wachtwoord' : 'Toon wachtwoord'}>
              <Icon size={14}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></Icon>
              {showPw ? 'Verberg' : 'Toon'}
            </button>
          </div>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.check}>
            <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} />
            <span className={styles.checkBox}>
              <Icon size={11}><path d="M5 12l5 5L20 7"/></Icon>
            </span>
            <span className={styles.checkLbl}>30 dagen ingelogd blijven</span>
          </label>
          <button type="button" className={styles.linkMini} onClick={() => go('forgot')}>
            Wachtwoord vergeten?
          </button>
        </div>

        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={auth.busy}>
          {auth.busy ? 'Inloggen…' : 'Inloggen'}
          {!auth.busy && (
            <Icon size={14}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>
          )}
        </button>

        {auth.error && <div className={styles.errorBox}>{auth.error}</div>}

        <div className={styles.divider}>of ga door met</div>

        <div className={styles.ssoRow}>
          <button type="button" className={styles.sso} disabled title="Binnenkort beschikbaar">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <rect x="2" y="2" width="9" height="9" fill="#F25022"/>
              <rect x="13" y="2" width="9" height="9" fill="#7FBA00"/>
              <rect x="2" y="13" width="9" height="9" fill="#00A4EF"/>
              <rect x="13" y="13" width="9" height="9" fill="#FFB900"/>
            </svg>
            Microsoft 365
            <span className={styles.ssoSoon}>Soon</span>
          </button>
          <button type="button" className={styles.sso} disabled title="Binnenkort beschikbaar">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.15-4.53H2.17v2.84A11 11 0 0 0 12 23z"/>
              <path fill="#FBBC05" d="M5.85 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.45.35-2.11V7.05H2.17A11 11 0 0 0 1 12c0 1.78.43 3.46 1.17 4.95l3.68-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.17 7.05L5.85 9.9C6.71 7.31 9.14 5.38 12 5.38z"/>
            </svg>
            Google Workspace
            <span className={styles.ssoSoon}>Soon</span>
          </button>
        </div>
      </form>
    </section>
  )
}

function ForgotPane({ auth, go }) {
  const [email, setEmail] = useState('')
  const [localErr, setLocalErr] = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    setLocalErr(null)
    if (!email) return
    const ok = await auth.resetPassword(email)
    if (ok) {
      sessionStorage.setItem('lm_reset_email', email)
      go('sent')
    }
  }

  return (
    <section className={styles.pane}>
      <button type="button" className={styles.backLink} onClick={() => go('signin')}>
        <Icon size={13}><path d="M19 12H5M11 18l-6-6 6-6"/></Icon>
        Terug naar inloggen
      </button>
      <p className={styles.paneEyebrow}>Wachtwoord <em>herstellen</em></p>
      <h1 className={styles.paneTitle}>Geen probleem.</h1>
      <p className={styles.paneSub}>Vul je werk-mailadres in. We sturen je binnen één minuut een link waarmee je een nieuw wachtwoord kunt instellen.</p>

      <form onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="lm-fpw-email">E-mailadres</label>
          <div className={styles.fieldInputWrap}>
            <span className={styles.fieldIcon}>
              <Icon><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></Icon>
            </span>
            <input
              className={`${styles.fieldInput} ${styles.hasIcon}`}
              id="lm-fpw-email" type="email" autoComplete="username"
              placeholder="jelle@legal-mind.nl" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              disabled={auth.busy} />
          </div>
          <span className={styles.fieldHint}>Tip: bij Single Sign-On stuur je organisatie-admin een verzoek.</span>
        </div>

        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={auth.busy}>
          {auth.busy ? 'Versturen…' : 'Stuur reset-link'}
          {!auth.busy && (
            <Icon size={14}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></Icon>
          )}
        </button>

        {(localErr || auth.error) && <div className={styles.errorBox}>{localErr || auth.error}</div>}
      </form>
    </section>
  )
}

function SentPane({ go }) {
  const email = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('lm_reset_email') : null) || 'je werk-mailadres'

  return (
    <section className={styles.pane}>
      <p className={styles.paneEyebrow}>Onderweg</p>
      <h1 className={styles.paneTitle}>Check je <em>inbox</em>.</h1>

      <div className={styles.notice} style={{ marginTop: 24 }}>
        <div className={styles.noticeIc}>
          <Icon size={18}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></Icon>
        </div>
        <div>
          <h3 className={styles.noticeTitle}>Reset-link verstuurd</h3>
          <p className={styles.noticeText}>
            We hebben een mail gestuurd naar <span className={styles.noticeEmail}>{email}</span>. De link is <strong>30 minuten</strong> geldig.
          </p>
        </div>
      </div>

      <p className={styles.paneSub} style={{ marginBottom: 18 }}>
        Geen mail ontvangen? Kijk in je spam-map of <button type="button" className={styles.linkMini} onClick={() => go('forgot')}>probeer een ander adres</button>.
      </p>

      <button type="button" className={styles.btn} onClick={() => go('signin')}>
        <Icon size={14}><path d="M19 12H5M11 18l-6-6 6-6"/></Icon>
        Terug naar inloggen
      </button>
    </section>
  )
}

function ResetPane({ auth }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [localErr, setLocalErr] = useState(null)

  const strength = useMemo(() => calcStrength(pw), [pw])

  async function onSubmit(e) {
    e.preventDefault()
    setLocalErr(null)
    if (pw.length < 12) { setLocalErr('Wachtwoord moet minimaal 12 tekens zijn.'); return }
    if (pw !== pw2)     { setLocalErr('Wachtwoorden komen niet overeen.'); return }
    await auth.updatePassword(pw)
  }

  const barColor = (i) => {
    if (i >= strength.score) return 'var(--border)'
    if (strength.score >= 4) return 'var(--success)'
    if (strength.score >= 3) return '#c89a3a'
    return 'var(--orange)'
  }

  return (
    <section className={styles.pane}>
      <p className={styles.paneEyebrow}>Nieuw <em>wachtwoord</em></p>
      <h1 className={styles.paneTitle}>Stel een sterk wachtwoord in.</h1>
      <p className={styles.paneSub}>Minimaal 12 tekens. Gebruik hoofd- en kleine letters, een cijfer en een speciaal teken.</p>

      <form onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="lm-newpw">Nieuw wachtwoord</label>
          <div className={styles.fieldInputWrap}>
            <span className={styles.fieldIcon}>
              <Icon><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></Icon>
            </span>
            <input className={`${styles.fieldInput} ${styles.hasIcon}`}
              id="lm-newpw" type={showPw ? 'text' : 'password'}
              autoComplete="new-password" required minLength={12} autoFocus
              value={pw} onChange={e => setPw(e.target.value)}
              disabled={auth.busy} />
            <button type="button" className={styles.fieldToggle} onClick={() => setShowPw(s => !s)}>
              <Icon size={14}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></Icon>
              {showPw ? 'Verberg' : 'Toon'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className={styles.strength}>
              {[0, 1, 2, 3].map(i => (
                <span key={i} className={styles.strengthBar} style={{ background: barColor(i) }} />
              ))}
            </div>
            <span className={styles.strengthLbl}>{strength.label}</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="lm-newpw2">Bevestig wachtwoord</label>
          <div className={styles.fieldInputWrap}>
            <span className={styles.fieldIcon}>
              <Icon><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></Icon>
            </span>
            <input className={`${styles.fieldInput} ${styles.hasIcon}`}
              id="lm-newpw2" type={showPw ? 'text' : 'password'}
              autoComplete="new-password" required minLength={12}
              value={pw2} onChange={e => setPw2(e.target.value)}
              disabled={auth.busy} />
          </div>
        </div>

        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={auth.busy}>
          {auth.busy ? 'Opslaan…' : 'Wachtwoord opslaan'}
          {!auth.busy && (
            <Icon size={14}><path d="M5 12l5 5L20 7"/></Icon>
          )}
        </button>

        {(localErr || auth.error) && <div className={styles.errorBox}>{localErr || auth.error}</div>}
      </form>
    </section>
  )
}

function TwoFAPane({ go }) {
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const refs = useRef([])

  function setCell(i, v) {
    const digit = v.replace(/\D/g, '').slice(0, 1)
    const next = [...code]
    next[i] = digit
    setCode(next)
    if (digit && refs.current[i + 1]) refs.current[i + 1].focus()
  }

  function onKeyDown(e, i) {
    if (e.key === 'Backspace' && !code[i] && refs.current[i - 1]) {
      refs.current[i - 1].focus()
    }
  }

  function onPaste(e) {
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    const next = text.split('').concat(['', '', '', '', '', '']).slice(0, 6)
    setCode(next)
    refs.current[Math.min(text.length, 5)]?.focus()
  }

  function onSubmit(e) {
    e.preventDefault()
    alert('2FA is nog niet geactiveerd voor jouw account — log in zonder 2FA via de standaard signin-flow.')
  }

  return (
    <section className={styles.pane}>
      <button type="button" className={styles.backLink} onClick={() => go('signin')}>
        <Icon size={13}><path d="M19 12H5M11 18l-6-6 6-6"/></Icon>
        Terug
      </button>
      <p className={styles.paneEyebrow}>Verificatie</p>
      <h1 className={styles.paneTitle}>Voer de <em>6-cijferige code</em> in.</h1>
      <p className={styles.paneSub}>We hebben een code naar je authenticator-app gestuurd. De code is 30 seconden geldig.</p>

      <form onSubmit={onSubmit} noValidate>
        <div className={styles.codeRow}>
          {code.map((c, i) => (
            <input
              key={i}
              ref={el => refs.current[i] = el}
              className={`${styles.codeCell} ${c ? styles.codeCellHasVal : ''}`}
              maxLength={1} inputMode="numeric" pattern="[0-9]"
              value={c}
              onChange={e => setCell(i, e.target.value)}
              onKeyDown={e => onKeyDown(e, i)}
              onPaste={onPaste}
            />
          ))}
        </div>

        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
          Verifieer en log in
        </button>
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12.5, color: 'var(--neutral-500)' }}>
          Geen code ontvangen? <button type="button" className={styles.linkMini}>Stuur opnieuw</button>
        </div>
      </form>
    </section>
  )
}

function ArtColumn() {
  return (
    <aside className={styles.art}>
      <div className={styles.artBg} />
      <div className={styles.artGrid} />

      <div className={styles.artStack}>
        <div className={styles.artCard} style={{ marginLeft: 'auto', marginRight: 0, transform: 'rotate(-1.5deg)' }}>
          <div className={styles.artCardHead}>
            <div className={styles.artCardIc}>
              <Icon><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></Icon>
            </div>
            <span className={styles.artCardT}>Postvak</span>
            <span className={styles.artCardTime}>vandaag · 09:48</span>
          </div>
          <div className={styles.artCardBody}>
            <strong>Damsté Advocaten</strong> · concept klaar voor je.<br />
            Vraag van Bram beantwoord met 3 bron-citaten uit Customer Base.
          </div>
          <div className={styles.artCardMeta}>
            <span className={styles.artCardMetaOk}>✓ klaar</span>
            <span>·</span>
            <span>4 sources · 12s</span>
          </div>
        </div>

        <div className={styles.artCard} style={{ marginTop: -4, marginLeft: 18, transform: 'rotate(.8deg)' }}>
          <div className={styles.artCardHead}>
            <div className={styles.artCardIc} style={{ background: '#eef0ec', color: '#3a4137' }}>
              <Icon><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Icon>
            </div>
            <span className={styles.artCardT}>Agenda</span>
            <span className={styles.artCardTime}>10:00 · vandaag</span>
          </div>
          <div className={styles.artCardBody}>
            <strong>Kennismaking Banning Advocaten</strong> — voorbereid.<br />
            Note + opvolg-task aangemaakt op de deal.
          </div>
          <div className={styles.artCardMeta}>
            <span className={styles.artCardMetaOk}>✓ akkoord</span>
            <span>·</span>
            <span>2 records</span>
          </div>
        </div>
      </div>

      <div className={styles.artQuote}>
        <p className={styles.artQuotePre}>
          <span className={styles.dotLive} />&nbsp;&nbsp;134 voorstellen vandaag verwerkt
        </p>
        <p className={styles.artQuoteText}>
          "Ik heb mijn middagen <em>terug</em>. De agent doet het slimme werk; ik beslis."
        </p>
        <p className={styles.artQuoteCite}>
          <span className={styles.artQuoteAv}>JB</span>
          Jelle Burggraaf · Founder, Legal Mind
        </p>
      </div>
    </aside>
  )
}

// Inline icon-component — vermijdt herhaling van svg-attributen.
function Icon({ children, size = 16 }) {
  return (
    <svg
      className="lc"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      stroke="currentColor"
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

function calcStrength(v) {
  let s = 0
  if (v.length >= 8) s++
  if (v.length >= 12) s++
  if (/[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) s++
  if (/[^A-Za-z0-9]/.test(v) && v.length >= 14) s++
  const labels = ['Te kort', 'Zwak', 'Redelijk', 'Sterk', 'Uitstekend']
  return { score: s, label: labels[s] }
}

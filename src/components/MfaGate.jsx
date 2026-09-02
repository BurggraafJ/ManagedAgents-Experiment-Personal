import { useEffect, useRef, useState } from 'react'
import { APP_VERSION } from '../version'
import { Brand, Icon } from './Login'
import styles from './Login.module.css'

// MfaGate — de tweede factor, ná login (security review 2026-09-02, REPORT §3).
//
// Eén component voor desktop én mobiel: het login-shell schaalt al mee, dus er
// is geen aparte mobiele variant nodig. inputMode="numeric" +
// autocomplete="one-time-code" laat iOS de code uit Mail automatisch invullen.
//
// De grens zelf zit in de datalaag (is_admin_or_higher → session_mfa_ok), dus
// dit scherm is de bediening, niet de beveiliging: wie het omzeilt, krijgt een
// leeg dashboard en 42501 op elke schrijfactie.
export default function MfaGate({ email, gate, onSignOut }) {
  const [cells, setCells] = useState(['', '', '', '', '', ''])
  const [remember, setRemember] = useState(true)
  const [cooldown, setCooldown] = useState(gate.info?.cooldownSeconds ?? 60)
  const refs = useRef([])
  const submittingRef = useRef(false)

  useEffect(() => { refs.current[0]?.focus() }, [])

  // Resend-cooldown aftellen (GoTrue's smtp_max_frequency is 60s).
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const code = cells.join('')

  function fill(next, focusIndex) {
    setCells(next)
    if (typeof focusIndex === 'number') refs.current[Math.min(focusIndex, 5)]?.focus()
  }

  function setCell(i, raw) {
    const digits = String(raw).replace(/\D/g, '')
    if (digits.length > 1) {
      // iOS/Android autofill duwt de hele code in één veld.
      const next = ['', '', '', '', '', '']
      digits.slice(0, 6).split('').forEach((d, k) => { next[k] = d })
      fill(next, digits.length)
      return
    }
    const next = [...cells]
    next[i] = digits.slice(0, 1)
    fill(next, next[i] ? i + 1 : i)
  }

  function onKeyDown(e, i) {
    if (e.key === 'Backspace' && !cells[i] && refs.current[i - 1]) refs.current[i - 1].focus()
    if (e.key === 'ArrowLeft' && refs.current[i - 1]) refs.current[i - 1].focus()
    if (e.key === 'ArrowRight' && refs.current[i + 1]) refs.current[i + 1].focus()
  }

  function onPaste(e) {
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    const next = ['', '', '', '', '', '']
    text.split('').forEach((d, k) => { next[k] = d })
    fill(next, text.length)
  }

  async function submit(e) {
    e?.preventDefault?.()
    if (code.length !== 6 || gate.sending || submittingRef.current) return
    submittingRef.current = true
    const ok = await gate.verify(code, remember)
    submittingRef.current = false
    if (!ok) fill(['', '', '', '', '', ''], 0)
  }

  // Zodra alle zes cijfers staan: automatisch verifiëren. Scheelt een klik en
  // sluit aan op de autofill uit Mail.
  useEffect(() => {
    if (code.length === 6 && !gate.sending && !submittingRef.current) submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  async function resend() {
    const ok = await gate.resend()
    if (ok) {
      setCooldown(gate.info?.cooldownSeconds ?? 60)
      fill(['', '', '', '', '', ''], 0)
    }
  }

  return (
    <div className={styles.shell}>
      <main className={styles.form}>
        <Brand />

        <div className={styles.formWrap}>
          <section className={styles.pane}>
            <p className={styles.paneEyebrow}>Verificatie</p>
            <h1 className={styles.paneTitle}>Voer de <em>6-cijferige code</em> in.</h1>
            <p className={styles.paneSub}>
              We hebben een code naar <strong>{email || 'je e-mailadres'}</strong> gestuurd.
              De code is 10 minuten geldig.
            </p>

            {gate.error && (
              <div className={styles.errorBox} role="alert">{gate.error}</div>
            )}

            <form onSubmit={submit} noValidate>
              <div className={styles.codeRow}>
                {cells.map((c, i) => (
                  <input
                    key={i}
                    ref={el => { refs.current[i] = el }}
                    className={`${styles.codeCell} ${c ? styles.codeCellHasVal : ''}`}
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    pattern="[0-9]*"
                    aria-label={`Cijfer ${i + 1} van 6`}
                    value={c}
                    onChange={e => setCell(i, e.target.value)}
                    onKeyDown={e => onKeyDown(e, i)}
                    onPaste={onPaste}
                  />
                ))}
              </div>

              <label className={styles.check} style={{ marginBottom: 16 }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                />
                <span className={styles.checkBox} aria-hidden>
                  <Icon size={12}><path d="M20 6 9 17l-5-5" /></Icon>
                </span>
                <span className={styles.checkLbl}>Dit apparaat 14 dagen onthouden</span>
              </label>

              <button
                type="submit"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={code.length !== 6 || gate.sending}
              >
                {gate.sending ? 'Verifiëren…' : 'Verifiëren'}
              </button>

              <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12.5, color: 'var(--neutral-500)' }}>
                Geen code ontvangen?{' '}
                <button
                  type="button"
                  className={styles.linkMini}
                  onClick={resend}
                  disabled={cooldown > 0 || gate.sending}
                >
                  {cooldown > 0 ? `Opnieuw sturen (${cooldown}s)` : 'Code opnieuw sturen'}
                </button>
              </div>
              <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12.5, color: 'var(--neutral-500)' }}>
                <button type="button" className={styles.linkMini} onClick={onSignOut}>Uitloggen</button>
              </div>
            </form>
          </section>
        </div>

        <div className={styles.formFoot}>
          <span>© 2026 Legal Mind · <span className={styles.kbd}>v{APP_VERSION}</span></span>
        </div>
      </main>
    </div>
  )
}

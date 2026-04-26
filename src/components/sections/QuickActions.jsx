import { useState } from 'react'
import { supabase } from '../../lib/supabase'

// Snelacties-blok — visueel groter ding rechtsonderin het Dashboard.
// Bevat de meest-gebruikte acties: agents direct draaien, naar de juiste
// werk-pagina springen, autodraft-wachtrij verwerken.
//
// Niet-actie items (zoals 'Open Slack-channel') gebruiken een externe URL.
// Run-now items roepen `request_run_now` aan, navigatie items vragen een
// onNavigate-callback (gezet vanuit App via setView).

const RUN_NOW_AGENTS = [
  { id: 'hubspot-daily-sync',  label: 'Run Administratie',  hint: 'HubSpot mail + agenda scannen, voorstellen klaarzetten' },
  { id: 'auto-draft',          label: 'Scan inbox',         hint: 'Mailing-agent: nieuwe drafts genereren' },
  { id: 'sales-todos',         label: 'Daily Tasks',        hint: 'Sales-deals scannen op acties' },
  { id: 'linkedin-connect',    label: 'LinkedIn invites',   hint: 'Stuur vandaag\'s 15 connect-verzoeken' },
]

const NAV_SHORTCUTS = [
  { id: 'hubspot',   label: 'Open voorstellen',     hint: 'Naar Administratie-pagina' },
  { id: 'autodraft', label: 'Verwerk mail-wachtrij', hint: 'Naar Mailing-pagina' },
]

export default function QuickActions({ onNavigate }) {
  return (
    <section id="snelacties">
      <div className="section__head">
        <h2 className="section__title">
          <span aria-hidden style={{ marginRight: 6 }}>⚡</span>
          Snelacties
        </h2>
        <span className="section__hint">één klik om iets te starten</span>
      </div>

      <div
        className="card"
        style={{
          padding: 'var(--s-5)',
          background: 'linear-gradient(135deg, var(--bg-2) 0%, var(--bg) 100%)',
        }}
      >
        <div className="kpi__label" style={{ marginBottom: 'var(--s-3)' }}>Run nu</div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--s-3)',
            marginBottom: 'var(--s-5)',
          }}
        >
          {RUN_NOW_AGENTS.map(a => (
            <RunNowButton key={a.id} agent={a.id} icon={a.icon} label={a.label} hint={a.hint} />
          ))}
        </div>

        <div className="kpi__label" style={{ marginBottom: 'var(--s-3)' }}>Springen naar</div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--s-3)',
          }}
        >
          {NAV_SHORTCUTS.map(s => (
            <NavButton key={s.id} {...s} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    </section>
  )
}

function RunNowButton({ agent, label, hint }) {
  const [state, setState] = useState('idle') // idle | submitting | ok | err
  const [msg, setMsg]     = useState(null)

  async function trigger() {
    if (state === 'submitting' || state === 'ok') return
    setState('submitting'); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('request_run_now', { agent })
      if (error) {
        setState('err'); setMsg(error.message)
      } else if (data?.ok) {
        setState('ok')
        setMsg(data.status === 'already_requested'
          ? 'aanvraag stond al open'
          : 'aangevraagd')
        window.setTimeout(() => { setState('idle'); setMsg(null) }, 3500)
      } else {
        setState('err')
        setMsg(data?.reason || 'mislukt')
        window.setTimeout(() => { setState('idle'); setMsg(null) }, 5000)
      }
    } catch (e) {
      setState('err'); setMsg(e.message || 'fout')
      window.setTimeout(() => { setState('idle'); setMsg(null) }, 5000)
    }
  }

  // Status-prefix in plaats van icon-emoji — typografisch zuiverder.
  const statusPrefix =
    state === 'submitting' ? '…' :
    state === 'ok'         ? '✓' :
    state === 'err'        ? '!' :
    null

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={state === 'submitting' || state === 'ok'}
      className={`quick-action-btn quick-action-btn--state-${state}`}
      title={hint}
    >
      <span className="quick-action-btn__label">
        {statusPrefix && <span className="quick-action-btn__status">{statusPrefix}</span>}
        {label}
      </span>
      <span className="quick-action-btn__hint">
        {msg || hint}
      </span>
    </button>
  )
}

function NavButton({ id, label, hint, onNavigate }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate?.(id)}
      className="quick-action-btn quick-action-btn--nav"
      title={hint}
    >
      <span className="quick-action-btn__label">{label} <span className="quick-action-btn__arrow" aria-hidden>→</span></span>
      <span className="quick-action-btn__hint">{hint}</span>
    </button>
  )
}

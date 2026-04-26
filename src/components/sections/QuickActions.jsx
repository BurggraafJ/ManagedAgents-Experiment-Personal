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
  { id: 'hubspot-daily-sync',  icon: '📋', label: 'Run Administratie',  hint: 'HubSpot mail + agenda scannen, voorstellen klaarzetten' },
  { id: 'auto-draft',          icon: '✉',  label: 'Scan inbox',         hint: 'Mailing-agent: nieuwe drafts genereren' },
  { id: 'sales-todos',         icon: '🎯', label: 'Daily Tasks',        hint: 'Sales-deals scannen op acties' },
  { id: 'linkedin-connect',    icon: '🤝', label: 'LinkedIn invites',   hint: 'Stuur vandaag\'s 15 connect-verzoeken' },
]

const NAV_SHORTCUTS = [
  { id: 'hubspot',   icon: '👀', label: 'Open voorstellen',    hint: 'Naar Administratie-pagina' },
  { id: 'autodraft', icon: '📨', label: 'Verwerk mail-wachtrij', hint: 'Naar Mailing-pagina' },
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

function RunNowButton({ agent, icon, label, hint }) {
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

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={state === 'submitting' || state === 'ok'}
      className="quick-action-btn"
      title={hint}
    >
      <span className="quick-action-btn__icon">
        {state === 'submitting' ? '⏳' : state === 'ok' ? '✓' : state === 'err' ? '!' : icon}
      </span>
      <span className="quick-action-btn__label">{label}</span>
      <span className="quick-action-btn__hint">
        {msg || (state === 'idle' ? 'klik om te triggeren' : '')}
      </span>
    </button>
  )
}

function NavButton({ id, icon, label, hint, onNavigate }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate?.(id)}
      className="quick-action-btn quick-action-btn--nav"
      title={hint}
    >
      <span className="quick-action-btn__icon">{icon}</span>
      <span className="quick-action-btn__label">{label}</span>
      <span className="quick-action-btn__hint">→ {hint}</span>
    </button>
  )
}

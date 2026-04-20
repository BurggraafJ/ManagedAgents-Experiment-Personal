import { useEffect } from 'react'

export default function HelpDrawer({ open, onClose }) {
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [open])

  if (!open) return null

  return (
    <>
      <div className="drawer__backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Uitleg">
        <div className="drawer__head">
          <h2 className="drawer__title">Uitleg</h2>
          <button className="btn btn--ghost drawer__close" onClick={onClose} aria-label="Sluiten">×</button>
        </div>

        <div style={{ overflowY: 'auto' }}>

          <div className="drawer__section">
            <h3>Wat is dit?</h3>
            <p>
              Het Agent Command Center: live-overzicht van al Jelle's autonome agents
              (auto-draft, HubSpot Daily, Road Notes, Daily Tasks, LinkedIn Connect,
              Kilometerregistratie). Alles wat ze doen, openstaande vragen, gesprekken
              en drafts staan hier.
            </p>
          </div>

          <div className="drawer__section">
            <h3>Tabbladen</h3>
            <p><strong>Dashboard</strong> — samenvattend: wat draait er nu, week-overzicht en KPI's.</p>
            <p><strong>HubSpot Daily</strong> — dagelijkse CRM-sync: status + open vragen + week-metrics.</p>
            <p><strong>Road Notes</strong> — Slack-berichten na kennismakingen verwerkt tot HubSpot-updates + Outlook-drafts.</p>
            <p><strong>Daily Tasks</strong> — elke werkochtend 08:00 draait deze; scant HubSpot op offerte-reminders, trial-eindes en check-ins. Drafts staan klaar in Outlook-map <em>Sales Agent</em>.</p>
            <p><strong>Systeem</strong> — schedules, config, metadata.</p>
          </div>

          <div className="drawer__section">
            <h3>Orchestrator</h3>
            <p>
              Elke 30 min (06:00–22:30) pollt de orchestrator welke agents aan de beurt zijn.
              De groene/oranje/rode bol bij "bijgewerkt HH:MM" in de sidebar is de
              freshness-indicator van de data zelf. Het pulserende bolletje bij
              "orchestrator" geeft aan wanneer de laatste poll was.
            </p>
          </div>

          <div className="drawer__section">
            <h3>Meldingen (🔕 / 🔔)</h3>
            <p>
              Klik op 🔕 om meldingen aan te zetten. Je krijgt dan een push-notificatie bij
              elke agent-run (behalve orchestrator en auto-draft — die draaien te vaak).
            </p>
            <p>
              Klik op 🔔 (als aan) om het meldingen-paneel te openen: de laatste 20 runs
              met hun status en samenvatting.
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              Werkt alleen als de app open staat (of vanaf iOS home-screen). Voor
              notificaties terwijl de app dicht is: service worker + web push
              (toekomstige verbetering).
            </p>
          </div>

          <div className="drawer__section">
            <h3>Beveiliging</h3>
            <p>
              Toegang via 4-cijferige code. Na inloggen 24 uur geldig per apparaat.
              Bij 5 foute pogingen binnen 10 minuten wordt je apparaat 10 min geblokkeerd.
              Uitloggen: knop onderin de sidebar — invalidatiert de token direct.
            </p>
          </div>

          <div className="drawer__section">
            <h3>Snelkoppelingen</h3>
            <p>☀/☾ — thema wisselen (licht/donker)</p>
            <p>↻ — manueel verversen</p>
            <p>? — dit uitleg-paneel</p>
            <p>↩ — uitloggen</p>
          </div>

        </div>
      </aside>
    </>
  )
}

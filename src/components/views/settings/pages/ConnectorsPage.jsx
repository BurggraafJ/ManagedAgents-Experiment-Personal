import { SettingsPage } from '../SettingsLayout'
import { useOutlookConnector } from '../../../../hooks/useOutlookConnector'
import './connectors.css'

/**
 * ConnectorsPage — koppelingen met externe systemen, per gebruiker.
 *
 * v1.136: de in-opbouw-stub is vervangen door de echte Outlook-rij. Maestro is
 * de MCP-host: één Microsoft-login, waarna de agent namens jou in jouw Outlook
 * mag kijken. De tokens blijven server-side bij Composio — de browser ziet
 * alleen een status en de consent-URL.
 *
 * Dit staat los van de mail-sync: die blijft op de org-mailbox draaien en wordt
 * hier niet aan- of uitgezet.
 */

const STATUS_LABEL = {
  loading: 'controleren…',
  disconnected: 'niet gekoppeld',
  pending: 'wacht op toestemming',
  connected: 'gekoppeld',
  error: 'fout',
}

function StatusPill({ status }) {
  return (
    <span className={`conn-pill conn-pill--${status}`}>
      <span className="conn-pill__dot" />
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function OutlookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M3 7.5l9 6 9-6" />
    </svg>
  )
}

export default function ConnectorsPage() {
  const { status, accountEmail, error, busy, connect, disconnect } = useOutlookConnector()
  const isConnected = status === 'connected'

  return (
    <SettingsPage
      title="Connectors"
      intro="Koppelingen met externe systemen, per gebruiker. Je logt één keer in bij de dienst; Maestro bewaart de sleutels server-side en gebruikt de koppeling alleen als een agent er iets moet ophalen."
    >
      <div className="conn-list">
        <article className="conn-row">
          <span className="conn-row__ico" aria-hidden><OutlookIcon /></span>

          <div className="conn-row__body">
            <div className="conn-row__head">
              <h3 className="conn-row__title">Outlook</h3>
              <StatusPill status={status} />
            </div>
            <p className="conn-row__desc">
              {isConnected && accountEmail
                ? <>Gekoppeld aan <strong>{accountEmail}</strong>. De chat mag hiermee live in je eigen mailbox zoeken.</>
                : isConnected
                  ? <>Gekoppeld. De chat mag hiermee live in je eigen mailbox zoeken.</>
                  : status === 'pending'
                    ? <>Je bent doorgestuurd naar Microsoft. Zodra je toestemming hebt gegeven, springt deze rij op “gekoppeld”.</>
                    : <>Eén Microsoft-login. Daarna kan de chat je eigen mail raadplegen wanneer een vraag daarom vraagt.</>}
            </p>
            {error && <p className="conn-row__err">{error}</p>}
          </div>

          <div className="conn-row__actions">
            {isConnected ? (
              <button type="button" className="set-btn" onClick={disconnect} disabled={busy}>
                {busy ? 'Bezig…' : 'Loskoppelen'}
              </button>
            ) : (
              <button type="button" className="set-btn set-btn--primary" onClick={connect} disabled={busy || status === 'loading'}>
                {busy ? 'Bezig…' : status === 'pending' ? 'Opnieuw proberen' : 'Koppelen'}
              </button>
            )}
          </div>
        </article>
      </div>

      <p className="conn-note">
        Je persoonlijke koppeling staat los van de organisatie-mailbox waarop de mail-sync draait —
        die blijft gewoon lopen en verandert hier niet mee. Sleutels staan bij de koppelingsdienst,
        nooit in je browser.
      </p>
    </SettingsPage>
  )
}

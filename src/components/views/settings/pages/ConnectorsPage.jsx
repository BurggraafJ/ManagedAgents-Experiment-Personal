import { SettingsPage } from '../SettingsLayout'
import { useConnector } from '../../../../hooks/useConnector'
import './connectors.css'

/**
 * ConnectorsPage — koppelingen met externe systemen, per gebruiker.
 *
 * v1.136: de in-opbouw-stub is vervangen door de echte Outlook-rij. Maestro is
 * de MCP-host: één Microsoft-login, waarna de tokens server-side bij Composio
 * blijven — de browser ziet alleen een status en de consent-URL.
 *
 * v1.141, twee dingen:
 *
 *  1. Koppelen betekent iets anders. Tot v1.140 gaf het de chat het recht om
 *     LIVE in je mailbox te zoeken; die tool is eruit. Koppelen start nu je
 *     eigen mail-SPIEGEL: je mail wordt binnengehaald, verrijkt en geïndexeerd,
 *     en de chat leest uitsluitend uit die spiegel. Trager op de laatste
 *     minuten, maar verrijkt, herleidbaar en niet afhankelijk van het moment
 *     van vragen. De copy zegt dat ook zo.
 *
 *  2. Confluence erbij, met een eerlijke grens: de OAuth-koppeling is echt,
 *     maar er is nog geen Confluence-spiegel, dus de chat kan er niets mee. De
 *     kaart belooft dus ook niets — zie `connectors-confluence/index.ts` voor
 *     de volgende stap (tabel → ETL → chunker → pas dan een chat-tool).
 *
 * v1.142, Confluence: die spiegel bestaat nu (`confluence-sync-etl` →
 * `confluence_pages` → chunker → bestaande `semantic_search`). Hij draait op
 * één ORG-token, niet per gebruiker: de wiki is voor iedereen dezelfde inhoud,
 * dus een per-user ETL zou dezelfde pagina N keer indexeren. De copy zegt dat
 * daarom eerlijk — zoeken werkt al zónder te koppelen, en de koppeling legt
 * alleen vast welk Atlassian-account van jou is.
 *
 * v1.142: HubSpot erbij, en die kaart betekent iets anders dan de andere twee.
 * Outlook en Confluence koppelen om te kunnen LEZEN (spiegelen). HubSpot wordt
 * al gelezen — de org-spiegel `hubspot_*` draait op een eigen token en verandert
 * hier niet. Deze koppeling gaat over SCHRIJVEN: een notitie op een deal is een
 * handeling van een persoon, en met één org-token staat onder elke notitie
 * dezelfde naam. Daarom zegt de copy expliciet wat de knop wél doet.
 *
 * De organisatie-mailbox en de org-HubSpot-sync blijven apart draaien en worden
 * hier niet aan- of uitgezet.
 */

const STATUS_LABEL = {
  loading: 'controleren…',
  disconnected: 'niet gekoppeld',
  pending: 'wacht op toestemming',
  connected: 'gekoppeld',
  error: 'fout',
}

// Wat de spiegel-stap deed, in Jelle-taal. `existing` is de normale uitkomst
// voor de eigenaar: zijn mailbox werd al gespiegeld door de org-sync.
const MIRROR_NOTE = {
  created: 'Je mail-spiegel is aangezet. De eerste ronde loopt binnen vijf minuten; historie volgt daarna automatisch.',
  adopted: 'Deze koppeling is aan je bestaande mail-spiegel gehangen.',
  existing: 'Deze mailbox werd al gespiegeld — er verandert niets aan de sync.',
  paused: 'Je mail-spiegel staat gepauzeerd. Koppelen zet die niet vanzelf weer aan.',
  pending_mailbox: 'Nog even: het mailbox-adres is nog niet bekend bij de koppelingsdienst.',
}

// HubSpot heeft geen spiegel om aan te zetten; het veld draagt hier of we jouw
// HubSpot-owner kennen. Zo niet, dan valt HubSpot terug op het account dat de
// call doet — nog steeds jij, maar zonder expliciete eigenaar op de notitie.
const HUBSPOT_NOTE = {
  owner_known: 'Notities komen onder jouw HubSpot-naam te staan.',
  owner_unknown: 'Je HubSpot-owner is nog niet vastgelegd. Notities krijgen dan geen expliciete eigenaar mee — HubSpot hangt ze aan het account waarmee je koppelt. Vastleggen kan in Organisatie › Gebruikers.',
}

function StatusPill({ status }) {
  return (
    <span className={`conn-pill conn-pill--${status}`}>
      <span className="conn-pill__dot" />
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M3 7.5l9 6 9-6" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  )
}

// CRM: contacten met een pen erbij — deze koppeling gaat over schrijven.
function CrmIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="7" r="3.6" />
      <path d="M3 21v-1.6A4.4 4.4 0 0 1 7.4 15h3.2" />
      <path d="M20.5 12.5a1.6 1.6 0 0 1 2.3 2.3L16 21.6 13 22l.4-3z" />
    </svg>
  )
}

/**
 * Eén koppeling-rij. `describe(status, label)` levert de tekst, zodat elke
 * provider z'n eigen eerlijke belofte doet in plaats van één generieke.
 */
function ConnectorRow({ provider, title, icon, describe, note, connectLabel }) {
  const { status, accountEmail, mirror, error, busy, connect, disconnect } = useConnector(provider)
  const isConnected = status === 'connected'

  return (
    <article className="conn-row">
      <span className="conn-row__ico" aria-hidden>{icon}</span>

      <div className="conn-row__body">
        <div className="conn-row__head">
          <h3 className="conn-row__title">{title}</h3>
          <StatusPill status={status} />
        </div>
        <p className="conn-row__desc">{describe(status, accountEmail)}</p>
        {isConnected && note && note(mirror) && (
          <p className="conn-row__meta">{note(mirror)}</p>
        )}
        {error && <p className="conn-row__err">{error}</p>}
      </div>

      <div className="conn-row__actions">
        {isConnected ? (
          <button type="button" className="set-btn" onClick={disconnect} disabled={busy}>
            {busy ? 'Bezig…' : 'Loskoppelen'}
          </button>
        ) : (
          <button type="button" className="set-btn set-btn--primary" onClick={connect}
                  disabled={busy || status === 'loading'}>
            {busy ? 'Bezig…' : status === 'pending' ? 'Opnieuw proberen' : connectLabel}
          </button>
        )}
      </div>
    </article>
  )
}

export default function ConnectorsPage() {
  return (
    <SettingsPage
      title="Connectors"
      intro="Koppelingen met externe systemen, per gebruiker. Je logt één keer in bij de dienst; Maestro bewaart de sleutels server-side en gebruikt de koppeling alleen als een agent er iets moet ophalen."
    >
      <div className="conn-list">
        <ConnectorRow
          provider="outlook"
          title="Outlook"
          icon={<MailIcon />}
          connectLabel="Koppelen"
          note={(mirror) => MIRROR_NOTE[mirror]}
          describe={(status, label) => (
            status === 'connected' && label
              ? <>Gekoppeld aan <strong>{label}</strong>. Je mail wordt gespiegeld en verrijkt; de chat leest uit die spiegel.</>
              : status === 'connected'
                ? <>Gekoppeld. Je mail wordt gespiegeld en verrijkt; de chat leest uit die spiegel.</>
                : status === 'pending'
                  ? <>Je bent doorgestuurd naar Microsoft. Zodra je toestemming hebt gegeven, springt deze rij op “gekoppeld”.</>
                  : <>Eén Microsoft-login. Daarna wordt je mail gespiegeld en verrijkt, zodat de chat hem kan doorzoeken.</>
          )}
        />

        <ConnectorRow
          provider="confluence"
          title="Confluence"
          icon={<DocIcon />}
          connectLabel="Koppelen"
          describe={(status, label) => (
            status === 'connected' && label
              ? <>Gekoppeld aan <strong>{label}</strong>. De organisatie-pagina’s staan al in de kennisindex; deze koppeling haalt zelf niets extra op.</>
              : status === 'connected'
                ? <>Gekoppeld. De organisatie-pagina’s staan al in de kennisindex; deze koppeling haalt zelf niets extra op.</>
                : status === 'pending'
                  ? <>Je bent doorgestuurd naar Atlassian. Zodra je toestemming hebt gegeven, springt deze rij op “gekoppeld”.</>
                  : <>De organisatie-pagina’s worden centraal gespiegeld — daar hoef je niets voor te koppelen. Eén Atlassian-login legt alleen vast dat dit account van jou is.</>
          )}
        />

        <ConnectorRow
          provider="hubspot"
          title="HubSpot"
          icon={<CrmIcon />}
          connectLabel="Koppelen"
          note={(mirror) => HUBSPOT_NOTE[mirror]}
          describe={(status, label) => (
            status === 'connected' && label
              ? <>Gekoppeld als <strong>{label}</strong>. Lezen gaat via de Spiegel; deze koppeling is om namens jou te schrijven.</>
              : status === 'connected'
                ? <>Gekoppeld. Lezen gaat via de Spiegel; deze koppeling is om namens jou te schrijven.</>
                : status === 'pending'
                  ? <>Je bent doorgestuurd naar HubSpot. Zodra je toestemming hebt gegeven, springt deze rij op “gekoppeld”.</>
                  : <>Lezen gaat via de Spiegel. Koppelen is om namens jou te schrijven: één HubSpot-login, en een notitie op een deal komt onder jóuw naam te staan in plaats van onder één organisatie-token.</>
          )}
        />
      </div>

      <p className="conn-note">
        De chat zoekt nooit live in Outlook of HubSpot. Hij leest alleen wat al gespiegeld en verrijkt
        is — dat loopt bij tot de laatste sync-ronde, elke vijf minuten. Loskoppelen van Outlook
        pauzeert de mail-spiegel; de mail die er al staat blijft vindbaar. Confluence wordt centraal
        gespiegeld met één organisatie-token, twee keer per dag: één kopie van de wiki voor iedereen,
        dus je eigen koppeling haalt daar niets bovenop. HubSpot is het omgekeerde geval — dat
        wordt al gelezen uit de organisatie-spiegel, en de koppeling voegt alleen het recht toe om er
        namens jou in te schrijven; loskoppelen haalt niets weg wat er al staat. Je persoonlijke
        koppelingen staan los van de organisatie-mailbox en de organisatie-HubSpot-sync. Sleutels
        staan bij de koppelingsdienst, nooit in je browser.
      </p>
    </SettingsPage>
  )
}

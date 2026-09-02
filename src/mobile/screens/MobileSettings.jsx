import { useMemo } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { useAgents } from '../../hooks/useAgents'
import { useAgentInstructions } from '../../hooks/useAgentInstructions'
import { useTerminology } from '../../hooks/useTerminology'
import { useOutlookConnector } from '../../hooks/useOutlookConnector'
import { instructableAgents, instructionText } from '../../lib/agentInstructions'
import { APP_VERSION } from '../../version'
import MIcon from '../MIcon'
import { MSetHead, MSetGroup, MSetRow, MSwitch } from './MobileSettingsBits'
import { MobileAgentsList, MobileAgentEditor } from './MobileSettingsAgents'
import MobileSettingsTerminologie from './MobileSettingsTerminologie'
import { MobileSettingsChat, MobileSettingsUitleg } from './MobileSettingsChat'
import '../mobile-settings.css'

/**
 * MobileSettings (v1.126, design A "iOS drill-in") — eigen full-screen
 * Instellingen voor de telefoon. De desktop SettingsView (master-detail)
 * blijft ongewijzigd voor ≥769px; App.jsx kiest op isMobile.
 *
 * Route /instellingen/<slug> — dezelfde slugs als desktop, plus
 * agents/<agent_name> voor de editor (niveau 3):
 *   ''                     hub (Instructies / Algemeen / Uitleg / Account)
 *   agents                 lijst: Met eigen regels · Alleen SKILL.md
 *   agents/<agent_name>    editor met gedockte Opslaan-balk
 *   chat                   Chat-assistent (system prompt + schrijfstijlen)
 *   terminologie           fout → goed rijen
 *   connectors             koppelingen met externe systemen (v1.136: Outlook)
 *   uitleg/mail-verrijking, uitleg/autodraft   desktop-uitleg als drill-in
 *
 * Desktop-only (Agent-overzicht, Administratie-templates, Externe partijen,
 * Database, API Keys) tonen we hier niet — de voetnoot zegt dat je die op
 * desktop beheert. Oude deep-links daarnaar landen op de hub.
 */
const BASE = '/instellingen'

export default function MobileSettings({ isOwner = false, profile, onLogout, theme, onToggleTheme }) {
  const { schedules, loading: agentsLoading } = useAgents()
  const instr = useAgentInstructions()
  const term = useTerminology()
  const navigate = useNavigate()
  const slug = useParams()['*'] || ''

  const agents = useMemo(() => instructableAgents(schedules), [schedules])
  const withRules = useMemo(
    () => agents.filter(a => instructionText(instr.lookup[a.agent_name]).length > 0),
    [agents, instr.lookup],
  )
  const go = (p) => navigate(p ? `${BASE}/${p}` : BASE)

  if (slug === '') {
    return (
      <MobileSettingsHub
        agentsCount={agents.length} rulesCount={withRules.length} termCount={term.rows.length}
        profile={profile} onLogout={onLogout} theme={theme} onToggleTheme={onToggleTheme}
        isOwner={isOwner} go={go}
      />
    )
  }
  if (slug === 'agents') {
    return <MobileAgentsList agents={agents} lookup={instr.lookup} loading={agentsLoading} onBack={() => go('')} onOpen={(name) => go(`agents/${encodeURIComponent(name)}`)} />
  }
  if (slug.startsWith('agents/')) {
    const name = decodeURIComponent(slug.slice('agents/'.length))
    const schedule = agents.find(a => a.agent_name === name) || null
    if (!schedule) {
      if (agentsLoading) return <div className="m-dash m-set" />
      return <Navigate to={`${BASE}/agents`} replace />
    }
    return <MobileAgentEditor key={name} schedule={schedule} row={instr.lookup[name] || null} onBack={() => go('agents')} />
  }
  if (slug === 'chat') return <MobileSettingsChat onBack={() => go('')} />
  if (slug === 'terminologie') return <MobileSettingsTerminologie term={term} onBack={() => go('')} />
  if (slug === 'connectors') return <MobileSettingsConnectors onBack={() => go('')} />
  if (slug === 'uitleg/mail-verrijking') return <MobileSettingsUitleg page="mail-verrijking" onBack={() => go('')} />
  if (slug === 'uitleg/autodraft') return <MobileSettingsUitleg page="autodraft" onBack={() => go('')} />
  // Desktop-only of onbekende slug → hub.
  return <Navigate to={BASE} replace />
}

// Connectors (v1.136) — was een in-opbouw-stub, is nu de echte Outlook-rij.
// Zelfde hook en dezelfde Edge Function als de desktop-pagina; de tokens
// blijven server-side (Composio), de telefoon ziet alleen status + consent-URL.
const CONN_STATUS_LABEL = {
  loading: 'controleren…',
  disconnected: 'niet gekoppeld',
  pending: 'wacht op toestemming',
  connected: 'gekoppeld',
  error: 'fout',
}

function MobileSettingsConnectors({ onBack }) {
  const { status, accountEmail, error, busy, connect, disconnect } = useOutlookConnector()
  const isConnected = status === 'connected'

  return (
    <div className="m-dash m-set m-ap m-ap--hasdock">
      <MSetHead back={onBack} backLabel="Instellingen" title="Connectors" sub="Koppelingen met externe systemen." />
      <div className="m-set__body">
        <MSetGroup label="Mail">
          {/* De pill draagt de status; de subregel zegt wat de koppeling dóet
              (of, zodra gekoppeld, welke mailbox eraan hangt). */}
          <MSetRow
            icon="mail" tone="cool" title="Outlook" chevron={false}
            sub={isConnected ? (accountEmail || 'je eigen mailbox') : 'Zoeken in je eigen mailbox'}
            right={<span className={`m-conn-pill m-conn-pill--${status}`}>{CONN_STATUS_LABEL[status] || status}</span>}
          />
        </MSetGroup>

        <p className="m-set__note">
          <MIcon name="shield" size={18} />
          <span>
            {isConnected
              ? 'De chat mag hiermee live in je eigen mailbox zoeken. Sleutels staan bij de koppelingsdienst, nooit op je telefoon.'
              : 'Eén Microsoft-login. Daarna kan de chat je eigen mail raadplegen wanneer een vraag daarom vraagt. Sleutels staan bij de koppelingsdienst, nooit op je telefoon.'}
          </span>
        </p>
        {error && <div className="m-set__errline">⚠ {error}</div>}
      </div>

      <div className="m-ap-dock">
        {isConnected ? (
          <button type="button" className="m-ap-dock__btn m-ap-dock__btn--ghost" onClick={disconnect} disabled={busy}>
            {busy ? 'Bezig…' : 'Outlook loskoppelen'}
          </button>
        ) : (
          <button type="button" className="m-ap-dock__btn" onClick={connect} disabled={busy || status === 'loading'}>
            <MIcon name="plug" size={18} stroke={2} />
            {busy ? 'Bezig…' : status === 'pending' ? 'Opnieuw proberen' : 'Outlook koppelen'}
          </button>
        )}
      </div>
    </div>
  )
}

function MobileSettingsHub({ agentsCount, rulesCount, termCount, profile, onLogout, theme, onToggleTheme, isOwner, go }) {
  const dark = theme !== 'light'
  // Agent-overzicht, Database en API Keys zijn per v1.128 naar Admin verhuisd
  // (Meer › Admin); hier blijven alleen de echte desktop-only instellingen.
  const desktopOnly = ['Administratie-templates', 'Externe partijen']
  const noteList = desktopOnly.slice(0, -1).join(', ') + ' en ' + desktopOnly[desktopOnly.length - 1]

  return (
    <div className="m-dash m-set">
      <MSetHead eyebrow="Meer" title="Instellingen" sub="Wat de agents moeten weten en hoe Maestro zich gedraagt." />
      <div className="m-set__body">
        <MSetGroup label="Instructies">
          <MSetRow icon="user" tone="warm" title="Agents"
            sub={agentsCount ? `${agentsCount} agents · ${rulesCount} met eigen regels` : 'Vrije-tekst regels per agent'}
            meta={agentsCount || null} onClick={() => go('agents')} />
          <MSetRow icon="chat" tone="warm" title="Chat-assistent" sub="Toon en regels voor de Home-chat" onClick={() => go('chat')} />
        </MSetGroup>

        <MSetGroup label="Algemeen">
          <MSetRow icon="textA" tone="cool" title="Terminologie" sub="Spraak-naar-tekst correcties" meta={termCount || null} onClick={() => go('terminologie')} />
          <MSetRow icon="plug" tone="cool" title="Connectors" sub="Outlook koppelen aan Maestro" onClick={() => go('connectors')} />
        </MSetGroup>

        <MSetGroup label="Uitleg">
          <MSetRow icon="mail" tone="leaf" title="Mail-verrijking" onClick={() => go('uitleg/mail-verrijking')} />
          <MSetRow icon="pen" tone="leaf" title="AutoDraft" onClick={() => go('uitleg/autodraft')} />
        </MSetGroup>

        <p className="m-set__note"><MIcon name="laptop" size={18} /><span>{noteList} beheer je op desktop.</span></p>

        <MSetGroup label="Account">
          <MSetRow icon="moon" title="Donker thema" onClick={onToggleTheme} role="switch" aria-checked={dark} right={<MSwitch on={dark} />} />
          {onLogout && <MSetRow icon="logout" title="Uitloggen" onClick={onLogout} chevron={false} right={null} />}
        </MSetGroup>

        <div className="m-set__ver">
          {profile?.display_name || 'Gebruiker'} · {profile?.role || 'member'} · v{APP_VERSION}
        </div>
      </div>
    </div>
  )
}

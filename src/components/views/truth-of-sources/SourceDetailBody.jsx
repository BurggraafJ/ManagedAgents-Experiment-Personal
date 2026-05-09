import { fmtNum, relTime, pct, SOURCE_INTRO } from '../../../lib/truthOfSources'
import { StatRow, SectionLabel } from './Primitives'
import VectorBar from './VectorBar'
import ExternalSourceBody from './ExternalSourceBody'
import styles from './TruthOfSourcesView.module.css'

/**
 * SourceDetailBody — rendert per-source de linker-kolom van de detail-modal:
 * grote getal, sync-stats, vectorisatie. Refactor 27 (2026-05-09).
 *
 * Returnt `{ headerTitle, headerSubtitle, body }` zodat de modal-frame zelf
 * (SourceDetailModal) de header kan zetten en alleen het body-blok hier
 * gerenderd wordt.
 */
export function getSourceDetail(source, d) {
  if (source === 'mail') {
    return {
      headerTitle: 'Outlook',
      headerSubtitle: SOURCE_INTRO.mail,
      body: <MailBody d={d} />,
    }
  }
  if (source === 'hubspot') {
    return {
      headerTitle: 'HubSpot',
      headerSubtitle: SOURCE_INTRO.hubspot,
      body: <HubSpotBody d={d} />,
    }
  }
  if (source === 'fireflies') {
    return {
      headerTitle: 'Fireflies',
      headerSubtitle: SOURCE_INTRO.fireflies,
      body: <FirefliesBody d={d} />,
    }
  }
  if (source === 'jellemind') {
    return {
      headerTitle: 'JelleMind',
      headerSubtitle: SOURCE_INTRO.jellemind,
      body: (
        <ExternalSourceBody
          intro="Persoonlijke brein-context — gedachten, ideeën, patronen waar de agents uit kunnen lezen."
          access="Wordt nog gebouwd. Concrete invulling volgt later."
          usedBy="(toekomstig) auto-draft, daily-admin, task-organizer voor persoonlijke context"
          comingSoon
        />
      ),
    }
  }
  if (source === 'agenda') {
    return {
      headerTitle: 'Agenda',
      headerSubtitle: SOURCE_INTRO.agenda,
      body: <AgendaBody d={d} />,
    }
  }
  if (source === 'contacten') {
    return {
      headerTitle: 'Contactpersonen',
      headerSubtitle: SOURCE_INTRO.contacten,
      body: <ContactenBody d={d} />,
    }
  }
  if (source === 'jira') {
    return {
      headerTitle: 'Jira',
      headerSubtitle: SOURCE_INTRO.jira,
      body: <JiraBody d={d} />,
    }
  }
  return { headerTitle: '', headerSubtitle: '', body: null }
}

// ──────────────────────────────────────────────────────────────────────
// Per-source body components — pure UI, alleen lezend op `d`.
// ──────────────────────────────────────────────────────────────────────
function MailBody({ d }) {
  return (
    <>
      <div className={styles.metricRow}>
        <div className={styles.metricNum}>{fmtNum(d.mail.total)}</div>
        <div className={styles.metricLabel}>messages</div>
      </div>

      <SectionLabel>Sync</SectionLabel>
      <StatRow label="Laatste delta" value={relTime(d.mail.lastDelta)} />
      <StatRow label="Folders tracked" value={fmtNum(d.mail.foldersTracked)} />
      <StatRow
        label="Backfill voortgang"
        value={`${d.mail.backfill.percent}% (${fmtNum(d.mail.backfill.completedBuckets)}/${fmtNum(d.mail.backfill.totalBuckets)} buckets)`}
      />
      {d.mail.backfill.byStatus.in_progress > 0 && (
        <StatRow label="Backfill nu actief" value={fmtNum(d.mail.backfill.byStatus.in_progress)} />
      )}
      {d.mail.backfill.byStatus.error > 0 && (
        <StatRow label="Backfill errors" value={fmtNum(d.mail.backfill.byStatus.error)} />
      )}

      <SectionLabel>Vectorisatie</SectionLabel>
      <VectorBar embedded={d.mail.embedded} total={d.mail.total} />
      <StatRow label="Model" value={d.embed.model} />
      <StatRow label="Laatste embed-run" value={d.embed.lastRun ? relTime(d.embed.lastRun.started_at) : 'nooit'} />
      <StatRow label="Embed-runs (7d)" value={fmtNum(d.embed.runs7d)} />
      <StatRow
        label="Tokens (7d)"
        value={`${fmtNum(d.embed.tokens7d)} (≈ $${(d.embed.tokens7d / 1_000_000 * 0.02).toFixed(4)})`}
      />
    </>
  )
}

function HubSpotBody({ d }) {
  const total =
    (d.hubspot.deals || 0) +
    (d.hubspot.companies || 0) +
    (d.hubspot.contacts || 0) +
    (d.hubspot.engagements.total || 0)

  return (
    <>
      <div className={styles.metricRow}>
        <div className={styles.metricNum}>{fmtNum(total)}</div>
        <div className={styles.metricLabel}>records totaal</div>
      </div>

      <SectionLabel>CRM-objecten</SectionLabel>
      <StatRow label="Deals" value={fmtNum(d.hubspot.deals)} />
      <StatRow label="Companies" value={fmtNum(d.hubspot.companies)} />
      <StatRow label="Contacts" value={fmtNum(d.hubspot.contacts)} />
      <StatRow label="Owners" value={fmtNum(d.hubspot.state?.total_owners)} />
      <StatRow label="Pipelines" value={fmtNum(d.hubspot.state?.total_pipelines)} />
      <StatRow
        label="Laatste delta sync"
        value={d.hubspot.state?.last_delta_sync ? relTime(d.hubspot.state.last_delta_sync) : '–'}
      />
      <StatRow
        label="Laatste full sync"
        value={d.hubspot.state?.last_full_sync ? relTime(d.hubspot.state.last_full_sync) : '–'}
      />

      <SectionLabel>Engagements</SectionLabel>
      <StatRow label="Totaal"   value={fmtNum(d.hubspot.engagements.total)} />
      <StatRow label="Calls"    value={fmtNum(d.hubspot.engagements.byType.call    || 0)} />
      <StatRow label="Emails"   value={fmtNum(d.hubspot.engagements.byType.email   || 0)} />
      <StatRow label="Meetings" value={fmtNum(d.hubspot.engagements.byType.meeting || 0)} />
      <StatRow label="Notes"    value={fmtNum(d.hubspot.engagements.byType.note    || 0)} />
      <StatRow label="Tasks"    value={fmtNum(d.hubspot.engagements.byType.task    || 0)} />
      <StatRow label="Laatste eng-sync" value={relTime(d.hubspot.engagements.lastSync)} />

      <SectionLabel>Vectorisatie — engagements</SectionLabel>
      <VectorBar embedded={d.hubspot.engagements.embedded} total={d.hubspot.engagements.total} />
      <div className={styles.vectorNote}>
        Deals/companies/contacts nog niet geïndexeerd — wel op roadmap.
      </div>
    </>
  )
}

function FirefliesBody({ d }) {
  return (
    <>
      <div className={styles.metricRow}>
        <div className={styles.metricNum}>{fmtNum(d.fireflies.total)}</div>
        <div className={styles.metricLabel}>meetings (laatste 24u rolling)</div>
      </div>

      <SectionLabel>Sync</SectionLabel>
      <StatRow
        label="Laatste delta"
        value={d.fireflies.state?.last_delta_sync_at ? relTime(d.fireflies.state.last_delta_sync_at) : 'nog niet'}
      />
      <StatRow label="Window" value={`${d.fireflies.state?.last_window_hours || 24}u`} />
      {d.fireflies.state?.last_error && (
        <StatRow label="Laatste fout" value={d.fireflies.state.last_error.slice(0, 60)} />
      )}

      <SectionLabel>Action items</SectionLabel>
      <StatRow label="Totaal" value={fmtNum(d.fireflies.actionItems.total)} />
      <StatRow label="Voor Jelle (open)"   value={fmtNum(d.fireflies.actionItems.jelleOpen)} />
      <StatRow label="Voor Jelle (totaal)" value={fmtNum(d.fireflies.actionItems.jelleTotal)} />

      <SectionLabel>Vectorisatie</SectionLabel>
      <VectorBar embedded={d.fireflies.embedded} total={d.fireflies.total} />
      <div className={styles.vectorNote}>
        Geen historische backfill — pre-april 2026 transcripts zijn Engelstalig opgenomen en geschrapt.
      </div>
    </>
  )
}

function AgendaBody({ d }) {
  return (
    <>
      <div className={styles.metricRow}>
        <div className={styles.metricNum}>{fmtNum(d.agenda.total)}</div>
        <div className={styles.metricLabel}>events ({fmtNum(d.agenda.active)} actief)</div>
      </div>

      <SectionLabel>Sync</SectionLabel>
      <StatRow
        label="Laatste delta"
        value={d.agenda.state?.last_delta_sync_at ? relTime(d.agenda.state.last_delta_sync_at) : 'nog niet'}
      />
      <StatRow
        label="Laatste full sync"
        value={d.agenda.state?.last_full_sync_at ? relTime(d.agenda.state.last_full_sync_at) : '–'}
      />
      <StatRow label="Events laatste run" value={fmtNum(d.agenda.state?.last_events_count)} />
      {d.agenda.state?.last_error && (
        <StatRow label="Laatste fout" value={d.agenda.state.last_error.slice(0, 60)} />
      )}

      <SectionLabel>Inhoud</SectionLabel>
      <StatRow label="Attendees-rijen" value={fmtNum(d.agenda.attendees)} />
      <StatRow label="Cross-linked met Fireflies" value={fmtNum(d.agenda.linkedToFireflies)} />

      <SectionLabel>Vectorisatie</SectionLabel>
      <VectorBar embedded={d.agenda.embedded} total={d.agenda.total} />
      <div className={styles.vectorNote}>
        Window: 12 mnd terug + 6 mnd vooruit. Cross-link runt elke 30 min.
      </div>
    </>
  )
}

function ContactenBody({ d }) {
  return (
    <>
      <div className={styles.metricRow}>
        <div className={styles.metricNum}>{fmtNum(d.contacten.total)}</div>
        <div className={styles.metricLabel}>contactpersonen · {fmtNum(d.contacten.firms)} firms</div>
      </div>

      <SectionLabel>Sync</SectionLabel>
      <StatRow
        label="Laatste delta"
        value={d.contacten.lastSync ? relTime(d.contacten.lastSync) : 'nog niet'}
      />
      <StatRow label="Schedule" value="03:30 UTC nightly + handmatig via Tools → Contactpersonen" />
      {d.contacten.lastError && (
        <StatRow label="Laatste fout" value={d.contacten.lastError.slice(0, 80)} />
      )}

      <SectionLabel>Verdeling — contact_type</SectionLabel>
      {Object.entries(d.contacten.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => (
          <StatRow key={type} label={type.charAt(0).toUpperCase() + type.slice(1)} value={fmtNum(n)} />
        ))}

      <SectionLabel>Koppeling</SectionLabel>
      <StatRow
        label="Met firm gekoppeld"
        value={`${fmtNum(d.contacten.total - d.contacten.unlinked)} (${pct(d.contacten.total - d.contacten.unlinked, d.contacten.total)}%)`}
      />
      <StatRow label="Zonder firm (free-mail)" value={fmtNum(d.contacten.unlinked)} />

      <div className={styles.vectorNoteLines}>
        Bron: hubspot_contacts mirror + mail_messages senders/recipients. Verrijking via 3 idempotente RPC's:
        seed → improve_firm_matching → enrich_contact_categories. Manual override via dashboard-pagina.
      </div>
    </>
  )
}

function JiraBody({ d }) {
  return (
    <>
      <div className={styles.metricRow}>
        <div className={styles.metricNum}>{fmtNum(d.jira.issues)}</div>
        <div className={styles.metricLabel}>issues over {fmtNum(d.jira.projects)} projecten</div>
      </div>

      <SectionLabel>Sync</SectionLabel>
      <StatRow
        label="Laatste delta sync"
        value={d.jira.state?.last_delta_sync ? relTime(d.jira.state.last_delta_sync) : '–'}
      />
      <StatRow
        label="Laatste full sync"
        value={d.jira.state?.last_full_sync ? relTime(d.jira.state.last_full_sync) : '–'}
      />

      <SectionLabel>Vectorisatie</SectionLabel>
      <div className={styles.jiraVectorRow}>
        <span className={`status-pill s-idle ${styles.jiraVectorPill}`}>nog niet</span>
        <span className={styles.jiraVectorNote}>
          Issues/comments krijgen straks ook embeddings — staat op roadmap.
        </span>
      </div>
    </>
  )
}

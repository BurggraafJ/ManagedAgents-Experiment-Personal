import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { relativeTime } from '../../../lib/dateFormat'
import styles from './IntelligenceView.module.css'

/**
 * CrmDataQuality — HubSpot data-quality detector.
 *
 * Toegevoegd 2026-05-21 nadat BarentsKrans bleek 91 ongekoppelde mails te hebben.
 * Leest twee views uit de DB:
 *   - v_missing_hubspot_contacts: senders die >=3x mailen vanuit een bedrijfs-
 *     domein zonder als HubSpot-contact te bestaan. Self-healing detector.
 *   - v_company_data_quality:     companies met fout domain (eigen domein bij
 *     externe company) of duplicate-domain (zelfde domein bij meerdere records).
 *
 * Drie acties die de gebruiker zelf in HubSpot kan doen + link naar de
 * /zoeken/objects-pagina voor de company-context.
 */
export default function CrmDataQuality() {
  const { data: missing, loading: missingLoading } = useSupabaseQuery('v_missing_hubspot_contacts', {
    select: 'company_id, company_name, matched_domain, missing_email, sender_name, mail_count, first_mail, last_mail',
    orderBy: ['mail_count', { ascending: false }],
    limit: 100,
    initialData: null,
  })

  const { data: dqIssues, loading: dqLoading } = useSupabaseQuery('v_company_data_quality', {
    select: 'issue_type, company_id, name, domain, extra_info',
    limit: 200,
    initialData: null,
  })

  const grouped = useMemo(() => {
    if (!Array.isArray(missing)) return { byCompany: [], totalSenders: 0, totalMails: 0 }
    const byCompany = new Map()
    let totalMails = 0
    for (const row of missing) {
      const key = row.company_id
      if (!byCompany.has(key)) {
        byCompany.set(key, {
          company_id: key,
          company_name: row.company_name,
          matched_domain: row.matched_domain,
          senders: [],
          total_mails: 0,
        })
      }
      const entry = byCompany.get(key)
      entry.senders.push(row)
      entry.total_mails += row.mail_count
      totalMails += row.mail_count
    }
    return {
      byCompany: Array.from(byCompany.values()).sort((a, b) => b.total_mails - a.total_mails),
      totalSenders: missing.length,
      totalMails,
    }
  }, [missing])

  const issuesGrouped = useMemo(() => {
    if (!Array.isArray(dqIssues)) return { selfDomain: [], duplicates: new Map() }
    const selfDomain = dqIssues.filter(r => r.issue_type === 'self_domain_set_as_company')
    const dupRows = dqIssues.filter(r => r.issue_type === 'duplicate_domain')
    const byDomain = new Map()
    for (const r of dupRows) {
      if (!byDomain.has(r.domain)) byDomain.set(r.domain, [])
      byDomain.get(r.domain).push(r)
    }
    return { selfDomain, duplicates: byDomain }
  }, [dqIssues])

  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--s-4)' }}>
        <h2 className="section__title">CRM data-quality (HubSpot)</h2>
        <span className="muted text-md">Self-healing detector · {grouped.totalSenders} sender{grouped.totalSenders === 1 ? '' : 's'} · {(issuesGrouped.selfDomain.length + issuesGrouped.duplicates.size)} issue{(issuesGrouped.selfDomain.length + issuesGrouped.duplicates.size) === 1 ? '' : 's'}</span>
      </div>

      {/* === Self-domain bug === */}
      {issuesGrouped.selfDomain.length > 0 && (
        <div className={styles.dqAlert}>
          <div className={styles.dqAlertTitle}>⚠️ Eigen domein staat als domain bij {issuesGrouped.selfDomain.length} externe compan{issuesGrouped.selfDomain.length === 1 ? 'y' : 'ies'}</div>
          {issuesGrouped.selfDomain.map(r => (
            <div key={r.company_id} className={styles.dqAlertRow}>
              <strong>{r.name}</strong>
              <span className={styles.dqMono}>domain = {r.domain}</span>
              <Link to={`/zoeken?mode=objects&company_id=${r.company_id}`} className={styles.dqLink}>open in dashboard →</Link>
            </div>
          ))}
          <div className={styles.dqAlertFoot}>
            Fix in HubSpot: leeg het Domain-veld van deze companies. Anders matched al je interne mail per ongeluk als 'inkomend' bij dat record.
          </div>
        </div>
      )}

      {/* === Duplicate-domain === */}
      {issuesGrouped.duplicates.size > 0 && (
        <div className={styles.dqWarn}>
          <div className={styles.dqWarnTitle}>{issuesGrouped.duplicates.size} domeinen worden door meerdere companies gedeeld (duplicaten in HubSpot)</div>
          {Array.from(issuesGrouped.duplicates.entries()).slice(0, 15).map(([domain, rows]) => (
            <div key={domain} className={styles.dqDupRow}>
              <span className={styles.dqMono}>{domain}</span>
              <span className={styles.dqDupNames}>
                {rows.map(r => (
                  <Link key={r.company_id} to={`/zoeken?mode=objects&company_id=${r.company_id}`} className={styles.dqLink}>
                    {r.name}
                  </Link>
                ))}
              </span>
            </div>
          ))}
          <div className={styles.dqAlertFoot}>
            Fix in HubSpot: merge de duplicates (Settings → Records → Merge), of haal het domain weg bij één van de twee.
          </div>
        </div>
      )}

      {/* === Ontbrekende contacten === */}
      <div style={{ marginTop: 'var(--s-5)' }}>
        <h3 className={styles.dqSubtitle}>
          Ontbrekende contacten · {grouped.byCompany.length} bedrijven · {grouped.totalMails.toLocaleString('nl-NL')} mails zonder contact-koppeling
        </h3>
        <div className="muted text-md" style={{ marginBottom: 'var(--s-3)' }}>
          Senders die ≥3× mailden vanuit een bedrijfsdomein dat in HubSpot staat, maar zelf geen contact-record hebben.
          Tip: voeg ze als contact toe bij het bedrijf — dan vinden mails-koppelingen ze automatisch.
        </div>
        {missingLoading && !missing && <div className="muted">laden…</div>}
        {grouped.byCompany.slice(0, 20).map(co => (
          <div key={co.company_id} className={styles.dqCompanyBlock}>
            <div className={styles.dqCompanyHead}>
              <Link to={`/zoeken?mode=objects&company_id=${co.company_id}`} className={styles.dqCompanyName}>
                {co.company_name || '(geen naam)'}
              </Link>
              <span className={styles.dqMono}>@{co.matched_domain}</span>
              <span className="muted text-md">{co.total_mails.toLocaleString('nl-NL')} mails · {co.senders.length} sender{co.senders.length === 1 ? '' : 's'}</span>
            </div>
            <ul className={styles.dqSenderList}>
              {co.senders.slice(0, 6).map(s => (
                <li key={s.missing_email}>
                  <strong>{s.sender_name || s.missing_email.split('@')[0]}</strong>
                  <span className={styles.dqMono}>{s.missing_email}</span>
                  <span className="muted text-md">{s.mail_count} mails · laatst {relativeTime(s.last_mail) || '–'}</span>
                </li>
              ))}
              {co.senders.length > 6 && (
                <li className="muted text-md" style={{ paddingLeft: 8 }}>+ {co.senders.length - 6} meer…</li>
              )}
            </ul>
          </div>
        ))}
        {grouped.byCompany.length > 20 && (
          <div className="muted text-md" style={{ marginTop: 'var(--s-3)' }}>
            Eerste 20 van {grouped.byCompany.length} bedrijven getoond. Top-30+ ontbrekende contacten meestal van ONS-domain-bug — fix die eerst.
          </div>
        )}
        {!missingLoading && grouped.byCompany.length === 0 && (
          <div className="muted">Geen ontbrekende contacten gedetecteerd. 🎉</div>
        )}
      </div>
    </section>
  )
}

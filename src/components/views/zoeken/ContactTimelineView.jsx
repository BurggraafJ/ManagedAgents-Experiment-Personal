import { useState, useEffect } from 'react'
import ContactAutocomplete from '../../domain/ContactAutocomplete'
import SenderTimeline from '../autodraft/inbox/SenderTimeline'
import { CONTACT_TYPE_LABEL } from '../../../lib/contacten'
import { supabase } from '../../../lib/supabase'
import styles from './zoeken.module.css'

/**
 * ContactTimelineView — 3e mode op de Zoekpagina (naast Chat en Handmatig).
 *
 * Tikt een contactpersoon, krijgt diens complete tijdlijn (mails + meetings +
 * optioneel HubSpot-notes). Hergebruikt de Postvak-Tijdlijn-component zodat
 * de UX consistent is met wat in MailDetail beschikbaar is.
 *
 * Input:  ContactAutocomplete (search_contactpersonen RPC)
 * Output: SenderTimeline met from_email + hubspot_contact_id van het gekozen
 *         contact. conversation_id is null (geen huidige thread om uit te
 *         filteren — dit is een vrijstaande view, geen mail-detail-context).
 */
export default function ContactTimelineView({ onJumpToCompany }) {
  const [contact, setContact] = useState(null)
  const [companyInfo, setCompanyInfo] = useState(null)
  const [loadingCompany, setLoadingCompany] = useState(false)

  // V9.10: fetch gekoppelde company-info via get_contact_company RPC zodra
  // er een contact gekozen is. Resultaat verschijnt als banner met counts
  // + "Bekijk volledige company-tijdlijn"-knop die naar de company-mode
  // springt (callback naar RagSearchView).
  useEffect(() => {
    if (!contact?.hubspot_contact_id) { setCompanyInfo(null); return }
    let cancelled = false
    setLoadingCompany(true)
    supabase.rpc('get_contact_company', { p_hubspot_contact_id: contact.hubspot_contact_id })
      .then(({ data }) => {
        if (cancelled) return
        setCompanyInfo(data?.[0] || null)
        setLoadingCompany(false)
      })
    return () => { cancelled = true }
  }, [contact?.hubspot_contact_id])

  return (
    <div className={styles.contactTimelineWrap}>
      <div className={styles.contactTimelineSearch}>
        <label className={styles.contactTimelineLabel}>
          Contactpersoon zoeken
        </label>
        <ContactAutocomplete
          onSelect={c => setContact(c)}
          placeholder="Tik naam of e-mailadres — minstens 2 tekens…"
          limit={10}
          autoFocus
        />
        {contact && (
          <div className={styles.contactTimelineSelected}>
            <div className={styles.contactTimelineSelectedInfo}>
              <div className={styles.contactTimelineSelectedName}>
                {contact.display_naam || `${contact.voornaam || ''} ${contact.achternaam || ''}`.trim() || '—'}
              </div>
              <div className={styles.contactTimelineSelectedMeta}>
                <span>{contact.email}</span>
                {contact.firm_naam && <span> · {contact.firm_naam}</span>}
                {contact.contact_type && (
                  <span> · {CONTACT_TYPE_LABEL?.[contact.contact_type] || contact.contact_type}</span>
                )}
                {contact.email_count > 0 && (
                  <span> · {contact.email_count} mail{contact.email_count === 1 ? '' : 's'} in DB</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setContact(null)}
              className={styles.contactTimelineClear}
              title="Wissel naar andere contactpersoon"
            >
              × Andere kiezen
            </button>
          </div>
        )}
      </div>

      {!contact ? (
        <div className={styles.contactTimelineEmpty}>
          <div className={styles.contactTimelineEmptyIcon}>🔍</div>
          <div className={styles.contactTimelineEmptyTitle}>Tik een contactpersoon om de tijdlijn te zien</div>
          <div className={styles.contactTimelineEmptySub}>
            Volledige mail-historie + kalender-meetings van die persoon, gegroepeerd per maand.
            Geen contactpersoon gevonden? Type alleen het e-mailadres exact.
          </div>
        </div>
      ) : (
        <>
          {companyInfo && (
            <button
              type="button"
              className={styles.companyReferBanner}
              onClick={() => onJumpToCompany && onJumpToCompany(companyInfo)}
              title={onJumpToCompany ? 'Klik om naar de Company-tijdlijn te springen' : ''}
              disabled={!onJumpToCompany}
            >
              <div className={styles.companyReferBannerIcon}>🏢</div>
              <div className={styles.companyReferBannerBody}>
                <div className={styles.companyReferBannerTop}>
                  <span className={styles.companyReferBannerLabel}>Onderdeel van</span>
                  <strong className={styles.companyReferBannerName}>{companyInfo.name || '—'}</strong>
                  {companyInfo.lifecyclestage && (
                    <span className={styles.companyReferBannerStage}>{companyInfo.lifecyclestage}</span>
                  )}
                </div>
                <div className={styles.companyReferBannerMeta}>
                  {companyInfo.domain && <span>{companyInfo.domain}</span>}
                  {companyInfo.industry && <span> · {companyInfo.industry}</span>}
                  {companyInfo.city && <span> · {companyInfo.city}{companyInfo.country ? `, ${companyInfo.country}` : ''}</span>}
                  {companyInfo.num_employees && <span> · {companyInfo.num_employees} medewerkers</span>}
                </div>
                <div className={styles.companyReferBannerCounts}>
                  {companyInfo.other_contacts > 0 && (
                    <span>👥 {companyInfo.other_contacts} andere {companyInfo.other_contacts === 1 ? 'contactpersoon' : 'contactpersonen'}</span>
                  )}
                  {companyInfo.notes_on_company > 0 && (
                    <span>📝 {companyInfo.notes_on_company} {companyInfo.notes_on_company === 1 ? 'note' : 'notes'} op company-niveau</span>
                  )}
                </div>
              </div>
              {onJumpToCompany && (
                <div className={styles.companyReferBannerCta}>
                  Bekijk company-tijdlijn →
                </div>
              )}
            </button>
          )}
          {loadingCompany && !companyInfo && (
            <div className={styles.companyReferBannerLoading}>
              🏢 Company-link laden…
            </div>
          )}
          <div className={styles.contactTimelinePanel}>
            <SenderTimeline
              mail={{
                from_email: contact.email,
                from_name: contact.display_naam || `${contact.voornaam || ''} ${contact.achternaam || ''}`.trim(),
                conversation_id: null,
              }}
              hubspotContactId={contact.hubspot_contact_id || null}
            />
          </div>
        </>
      )}
    </div>
  )
}

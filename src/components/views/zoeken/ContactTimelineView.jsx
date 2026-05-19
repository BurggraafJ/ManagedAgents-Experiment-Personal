import { useState } from 'react'
import ContactAutocomplete from '../../domain/ContactAutocomplete'
import SenderTimeline from '../autodraft/inbox/SenderTimeline'
import { CONTACT_TYPE_LABEL } from '../../../lib/contacten'
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
export default function ContactTimelineView() {
  const [contact, setContact] = useState(null)

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
      )}
    </div>
  )
}

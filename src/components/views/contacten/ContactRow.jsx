import {
  CONTACT_TYPES, CONTACT_TYPE_LABEL, CONTACT_TYPE_TONE, contactInitials,
} from '../../../lib/contacten'
import { absDate } from '../../../lib/dateFormat'
import styles from './ContactenView.module.css'

/**
 * ContactRow — één contact-rij met avatar + naam + meta-cijfers + status-pill.
 * Klik op rij → uitvouwen voor full-detail + contact_type override-knoppen.
 */
export default function ContactRow({ contact: c, expanded, onToggle, onUpdateType, saving }) {
  const naam = c.display_naam || c.email
  const isManual = c.properties?.manual_override === true
  const tone = CONTACT_TYPE_TONE[c.contact_type] || ''

  return (
    <div className={styles.row} onClick={onToggle}>
      <div className={styles.rowGrid}>
        <div className={styles.avatar}>{contactInitials(c)}</div>

        <div className={styles.rowName}>
          <div className={styles.rowNameText}>
            {naam}
            {isManual && <span title="Handmatig overschreven" className={styles.manualMark}>✎</span>}
          </div>
          <div className={styles.rowEmailFirm}>
            {c.email}{c.firm_naam ? ` · ${c.firm_naam}` : ''}
          </div>
        </div>

        <div className={styles.rowMeta}>
          {c.email_count > 0 ? `${c.email_count} mails` : '—'}
        </div>

        <div className={styles.rowLast}>{absDate(c.last_seen_at)}</div>

        <span className={`pill ${tone ? `s-${tone}` : ''}`} style={{ fontSize: 11 }}>
          {CONTACT_TYPE_LABEL[c.contact_type] || c.contact_type}
        </span>
      </div>

      {expanded && (
        <div onClick={e => e.stopPropagation()} className={styles.expandPanel}>
          <Detail label="Email"           value={c.email} />
          <Detail label="Voornaam"        value={c.voornaam || '—'} />
          <Detail label="Achternaam"      value={c.achternaam || '—'} />
          <Detail label="Functietitel"    value={c.functietitel || '—'} />
          <Detail label="Telefoon"        value={c.telefoonnummer || '—'} />
          <Detail label="Firm"            value={c.firm_naam || '—'} />
          <Detail label="Email-domein"    value={c.email_domein || '—'} />
          <Detail label="Bronnen"         value={(c.sources || []).join(', ') || '—'} />
          <Detail label="Eerste contact"  value={absDate(c.first_seen_at)} />
          <Detail label="Laatste contact" value={absDate(c.last_seen_at)} />
          <Detail label="Aantal mails"    value={c.email_count ?? 0} />
          <Detail label="HubSpot ID"      value={c.hubspot_contact_id || '—'} />

          <div className={styles.typePicker}>
            <div className={styles.typePickerLabel}>Contact-type aanpassen</div>
            <div className={styles.typeButtons}>
              {CONTACT_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`btn btn--ghost ${styles.typeButton} ${c.contact_type === t ? 'is-active' : ''}`}
                  disabled={saving || c.contact_type === t}
                  onClick={() => onUpdateType(c.id, t)}
                >
                  {CONTACT_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div>
      <div className={styles.detailLabel}>{label}</div>
      <div className={styles.detailValue}>{value}</div>
    </div>
  )
}

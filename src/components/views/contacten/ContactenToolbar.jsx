import { CONTACT_TYPES, CONTACT_TYPE_LABEL, FIRM_TYPE_LABEL } from '../../../lib/contacten'
import { absDate } from '../../../lib/dateFormat'
import styles from './ContactenView.module.css'

/**
 * ContactenToolbar — zoek + type-filter + firm-filter + sync-knop.
 * Stateless; alle state leeft in de container.
 */
export default function ContactenToolbar({
  search, onSearch,
  filterType, onFilterType,
  filterFirm, onFilterFirm,
  lastSync, syncing, onSync,
}) {
  return (
    <div className={styles.toolbar}>
      <input
        type="search"
        placeholder="Zoek op naam, email of firm…"
        value={search}
        onChange={e => onSearch(e.target.value)}
        className={styles.toolbarSearch}
      />
      <select value={filterType} onChange={e => onFilterType(e.target.value)}>
        <option value="">Alle contact-types</option>
        {CONTACT_TYPES.map(t => (
          <option key={t} value={t}>{CONTACT_TYPE_LABEL[t]}</option>
        ))}
      </select>
      <select value={filterFirm} onChange={e => onFilterFirm(e.target.value)}>
        <option value="">Alle firm-types</option>
        {Object.entries(FIRM_TYPE_LABEL).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <div className={styles.toolbarSpacer} />
      <span className={styles.toolbarSyncInfo}>
        Laatste sync: {absDate(lastSync)}
      </span>
      <button type="button" className="btn btn--ghost" onClick={onSync} disabled={syncing}>
        {syncing ? '⏳ Sync draait…' : '🔄 Sync nu'}
      </button>
    </div>
  )
}

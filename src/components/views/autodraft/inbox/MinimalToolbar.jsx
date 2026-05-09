import { useState } from 'react'
import { formatRelative, FILTER_PRESETS } from '../../../../lib/autodraft'
import IconBtn from './IconBtn'
import SchoonButton from './SchoonButton'
import { MailImproverButton } from '../modals/MailImproverModal'
import styles from '../autodraft.module.css'

// MinimalToolbar — één compacte rij. Voor jou/Niet voor jou tabs links,
// search-icoon dat klapt uit, ⋯ menu voor advanced filters.
function MinimalToolbar({
  pending, awaitingCount, priorityCount, sentDraftsCount,
  audience, setAudience, filter, setFilter, query, setQuery,
  showHandled, setShowHandled, handledCount,
  onScan, scanBusy, scanMsg, skipCount, bulkSkipAll, bulkBusy, bulkMsg,
  latestScanRun, onNavigate,
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const forCount    = pending.filter(m => m.audience === 'for_you').length
  const notForCount = pending.filter(m => m.audience === 'not_for_you').length
  const filterActive = filter !== 'all'
  const scanAgo = latestScanRun ? formatRelative(latestScanRun.started_at) : null

  return (
    <div className={styles.toolbarRoot}>
      {/* Audience-tabs */}
      <div className={styles.audienceTabs}>
        {[
          { id: 'for_you',     label: 'Voor jou',     n: forCount },
          { id: 'priority',    label: '⭐ Pin',         n: priorityCount || 0 },
          { id: 'awaiting',    label: '⏳ In afwachting', n: awaitingCount || 0 },
          { id: 'not_for_you', label: 'Niet voor jou', n: notForCount },
          { id: 'sent_drafts', label: '📤 Drafts',     n: sentDraftsCount || 0 },
          { id: 'logs',        label: '📜 Logs',       n: null },
        ].map(t => {
          const on = audience === t.id
          return (
            <button key={t.id} type="button" onClick={() => setAudience(t.id)}
              style={{
                padding: '5px 12px',
                background: on ? 'var(--accent-soft)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--text)',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: on ? 600 : 400,
                borderLeft: t.id !== 'for_you' ? '1px solid var(--border)' : 'none',
              }}>
              {t.label} <span className={styles.audienceTabCount}>{t.n}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      {searchOpen ? (
        <input type="search" autoFocus
          value={query} onChange={e => setQuery(e.target.value)}
          onBlur={() => { if (!query) setSearchOpen(false) }}
          placeholder="zoeken…"
          className={styles.toolbarSearchInput} />
      ) : (
        <IconBtn onClick={() => setSearchOpen(true)} title="Zoek (afzender of onderwerp)">🔍</IconBtn>
      )}

      {/* ⋯ More — geeft toegang tot draft/skip/flag-filter en bulk-archive */}
      <div className={styles.relWrap}>
        <IconBtn onClick={() => setMoreOpen(v => !v)} title="Meer filters" active={moreOpen || filterActive}>
          ⋯ {filterActive && <span className={styles.toolbarFilterDot}>•</span>}
        </IconBtn>
        {moreOpen && (
          <div className={styles.toolbarMorePanel}>
            <div className={styles.dropdownSectionLabel}>Filter op voorstel</div>
            {FILTER_PRESETS.map(p => {
              const n = pending.filter(m => p.match(m)).length
              const on = filter === p.id
              return (
                <button key={p.id} type="button"
                  onClick={() => { setFilter(p.id); setMoreOpen(false) }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', width: '100%',
                    padding: '6px 8px', fontSize: 12, borderRadius: 4,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: on ? 'var(--accent-soft)' : 'transparent',
                    color: on ? 'var(--accent)' : 'var(--text)',
                    textAlign: 'left',
                  }}>
                  <span>{p.label}</span>
                  <span style={{ opacity: 0.65 }}>{n}</span>
                </button>
              )
            })}
            {handledCount > 0 && (
              <>
                <div className={styles.dropdownSectionDivider} />
                <div className={styles.dropdownSectionLabel}>Al afgehandeld in Outlook</div>
                <button type="button"
                  onClick={() => { setShowHandled(!showHandled); setMoreOpen(false) }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', width: '100%',
                    padding: '6px 8px', fontSize: 12, borderRadius: 4,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: showHandled ? 'var(--accent-soft)' : 'transparent',
                    color: showHandled ? 'var(--accent)' : 'var(--text)',
                    textAlign: 'left',
                  }}>
                  <span>{showHandled ? '✓ Verberg afgehandelde' : 'Toon afgehandelde'}</span>
                  <span style={{ opacity: 0.65 }}>{handledCount}</span>
                </button>
              </>
            )}
            {skipCount >= 2 && (
              <>
                <div className={styles.dropdownSectionDivider} />
                <button type="button" disabled={bulkBusy}
                  onClick={() => { bulkSkipAll(); setMoreOpen(false) }}
                  style={{
                    width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 4,
                    border: 'none', cursor: bulkBusy ? 'default' : 'pointer',
                    fontFamily: 'inherit', textAlign: 'left',
                    background: 'transparent', color: 'var(--warning, #f59e0b)',
                  }}>
                  🗂️ Archiveer alle {skipCount} negeer-voorstellen
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className={styles.toolbarSpacer} />

      {/* Status + scan rechts */}
      {scanAgo && (
        <span className={styles.toolbarScanStatus} title={`Laatste scan: ${scanAgo}`}>
          ↻ {scanAgo}
        </span>
      )}
      <IconBtn onClick={onScan} disabled={scanBusy} title="Ververs Outlook nu — mail-sync + scan binnen ~30s">
        {scanBusy ? '⏳' : '🔄'}
      </IconBtn>
      {scanMsg?.ok && <span className={styles.toolbarScanOk}>✓</span>}
      {scanMsg?.err && <span className={styles.toolbarScanErr} title={scanMsg.err}>⚠</span>}
      {bulkMsg?.ok && <span className={styles.toolbarScanOk}>✓ {bulkMsg.ok}</span>}
      {bulkMsg?.err && <span className={styles.toolbarScanErr}>⚠ {bulkMsg.err}</span>}

      {/* F.6.d — Schoon-indicator */}
      <SchoonButton onTrigger={onScan} busy={scanBusy} />

      <MailImproverButton />

      {onNavigate && (
        <button type="button"
          onClick={() => onNavigate('autodraft_settings')}
          title="Mailing-instellingen — voorstellen, categorieen, regels, logboek"
          className={styles.toolbarSettingsBtn}>
          <span aria-hidden className={styles.toolbarSettingsBtnIcon}>⚙</span>
          <span>Instellingen</span>
        </button>
      )}
    </div>
  )
}

export default MinimalToolbar

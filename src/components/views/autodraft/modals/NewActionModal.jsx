import { useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import Modal from '../../../ui/Modal'
import { showToast } from '../../../Toast'
import styles from '../autodraft.module.css'

/**
 * NewActionModal — wizard om een nieuwe action_slug toe te voegen aan
 * autodraft_actions catalog (AutoDraft v2 Fase 4B).
 *
 * Vereist: open + onClose + onCreated callbacks.
 *
 * Validatie:
 *  - slug matcht ^[a-z]+\.[a-z0-9-]+$
 *  - slug uniek (check vóór INSERT)
 *  - display_name niet leeg
 *  - voor forward/delegate/file: target_value verplicht
 */
const CATEGORY_OPTIONS = [
  { value: 'reply',    label: 'Reply (draft-reactie)',           hint: 'Voor varianten op de reply-draft' },
  { value: 'forward',  label: 'Forward (doorsturen)',            hint: 'Target = email-adres van ontvanger' },
  { value: 'file',     label: 'File (verplaatsen naar map)',     hint: 'Target = full_path uit mail_folders' },
  { value: 'schedule', label: 'Schedule (agenda-actie)',         hint: 'Toekomstig — werkt nog niet end-to-end' },
  { value: 'delegate', label: 'Delegate (Jira / HubSpot)',       hint: 'Target = project key (Jira) of object id' },
  { value: 'defer',    label: 'Defer (uitstellen / decline)',    hint: 'Target = doelmap of leeg' },
]

const SLUG_RE = /^[a-z]+\.[a-z0-9-]+$/

function fieldHint(category) {
  if (category === 'reply')    return 'Geen target nodig — reply genereert variants op basis van mail-body'
  if (category === 'forward')  return 'Email-adres dat altijd ontvanger wordt (bv. team@bedrijf.nl)'
  if (category === 'file')     return 'Outlook-map als full_path (bv. Inbox/Klanten/X)'
  if (category === 'delegate') return 'Jira project-key (bv. LEMIND) of HubSpot object-id'
  if (category === 'defer')    return 'Optioneel — doelmap waar de mail naartoe gaat (default Archive)'
  if (category === 'schedule') return 'Optioneel — type agenda-actie'
  return ''
}

export default function NewActionModal({ open, onClose, onCreated }) {
  const [category, setCategory]       = useState('forward')
  const [slugSuffix, setSlugSuffix]   = useState('')
  const [displayName, setDisplayName] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [promptHint, setPromptHint]   = useState('')
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState(null)

  const fullSlug = useMemo(() => {
    const s = (slugSuffix || '').trim().toLowerCase().replace(/\s+/g, '-')
    return s ? `${category}.${s}` : `${category}.`
  }, [category, slugSuffix])

  const targetRequired = category === 'forward' || category === 'file' || category === 'delegate'
  const isValid =
    SLUG_RE.test(fullSlug) &&
    displayName.trim().length > 0 &&
    (!targetRequired || targetValue.trim().length > 0)

  const reset = useCallback(() => {
    setCategory('forward')
    setSlugSuffix('')
    setDisplayName('')
    setTargetValue('')
    setPromptHint('')
    setError(null)
    setBusy(false)
  }, [])

  const handleSave = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { data: existing, error: lookupErr } = await supabase
        .from('autodraft_actions')
        .select('slug')
        .eq('slug', fullSlug)
        .maybeSingle()
      if (lookupErr) throw lookupErr
      if (existing) {
        setError(`Slug '${fullSlug}' bestaat al — kies een andere suffix`)
        setBusy(false)
        return
      }

      const targetType =
        category === 'forward'  ? 'email' :
        category === 'file'     ? 'folder' :
        category === 'delegate' ? 'jira_project' :
        null

      const { error: insertErr } = await supabase.from('autodraft_actions').insert({
        slug:                  fullSlug,
        category,
        display_name:          displayName.trim(),
        target_type:           targetType,
        target_value:          targetValue.trim() || null,
        prompt_hint:           promptHint.trim() || null,
        confidence_threshold:  0.4,
        enabled:               true,
        is_default:            false,
      })
      if (insertErr) throw insertErr

      showToast(`Nieuwe actie '${fullSlug}' toegevoegd`, 'success')
      onCreated?.()
      reset()
      onClose?.()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }, [category, fullSlug, displayName, targetValue, promptHint, onClose, onCreated, reset])

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose?.() }}
      title="Nieuwe actie toevoegen"
      size="md"
      className="theme-maestro"
    >
      <div className={styles.newActionForm}>
        <label className={styles.modalLabel}>Categorie</label>
        <select
          className={styles.modalInput}
          value={category}
          onChange={e => setCategory(e.target.value)}
          disabled={busy}
        >
          {CATEGORY_OPTIONS.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <div className={styles.modalIntro}>{CATEGORY_OPTIONS.find(c => c.value === category)?.hint}</div>

        <label className={styles.modalLabel}>Slug-suffix</label>
        <div className={styles.newActionSlugRow}>
          <span className={styles.newActionSlugPrefix}>{category}.</span>
          <input
            className={styles.modalInput}
            type="text"
            placeholder="bv. brigid-hvk"
            value={slugSuffix}
            onChange={e => setSlugSuffix(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        <div className={styles.modalIntro}>
          Volledig: <code>{fullSlug}</code> · alleen kleine letters, cijfers en streepjes
        </div>

        <label className={styles.modalLabel}>Naam (wat zie je in Postvak)</label>
        <input
          className={styles.modalInput}
          type="text"
          placeholder="bv. Doorsturen naar Brigid (HVK)"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          disabled={busy}
        />

        <label className={styles.modalLabel}>
          Target {targetRequired && <span className={styles.newActionRequired}>*</span>}
        </label>
        <input
          className={styles.modalInput}
          type="text"
          placeholder={
            category === 'forward'  ? 'brigid@hvk.nl' :
            category === 'file'     ? 'Inbox/Klanten/X' :
            category === 'delegate' ? 'LEMINDCS' :
            category === 'defer'    ? 'Archive (optioneel)' :
            'optioneel'
          }
          value={targetValue}
          onChange={e => setTargetValue(e.target.value)}
          disabled={busy}
        />
        <div className={styles.modalIntro}>{fieldHint(category)}</div>

        <label className={styles.modalLabel}>Prompt-hint (zin voor de classifier)</label>
        <textarea
          className={styles.modalTextarea}
          rows={2}
          placeholder="bv. 'Gebruik wanneer mail van Hoffman-VK partner komt, body bevat juridische stukken'"
          value={promptHint}
          onChange={e => setPromptHint(e.target.value)}
          disabled={busy}
        />

        {error && <div className={styles.actionProposalsError}>{error}</div>}

        <Modal.Footer>
          <button type="button" className="btn btn--ghost" onClick={() => { reset(); onClose?.() }} disabled={busy}>
            Annuleer
          </button>
          <button
            type="button"
            className="btn btn--accent"
            onClick={handleSave}
            disabled={!isValid || busy}
          >
            {busy ? 'Opslaan…' : 'Actie toevoegen'}
          </button>
        </Modal.Footer>
      </div>
    </Modal>
  )
}

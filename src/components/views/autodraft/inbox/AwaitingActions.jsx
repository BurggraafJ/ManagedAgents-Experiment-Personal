import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { recipientsToString } from '../../../../lib/autodraft'
import ToolbarBtn from './ToolbarBtn'
import ArrowBtn from './ArrowBtn'
import ReasonModal from '../modals/ReasonModal'
import styles from '../autodraft.module.css'

// AwaitingActions — actie-rij voor In Afwachting mails:
//  - ✓ Afgerond (optimistic, dismiss conversation_id)
//  - 🚫 Regel (opent ReasonModal: subject_keyword pattern + reden, dismiss + leerregel)
//  - ✎ Schrijf follow-up (uitklapbaar, generates template, mailto-link)
export default function AwaitingActions({ mail, cat, busy, err, dismissAwaiting, submitIgnoreWithRule, reminderStyle }) {
  const [reasonModal, setReasonModal] = useState(null)
  const [showFollowup, setShowFollowup] = useState(false)
  const [variantIdx, setVariantIdx] = useState(0)
  const [followupText, setFollowupText] = useState('')

  // 2 follow-up varianten: kort & direct vs warm & uitgebreid. Geen em-dashes
  // (komt te AI-achtig over). Variatie in begroeting per mail-id zodat het
  // niet altijd 'Hoi' is. Optionele reminderStyle-richtlijn uit Instellingen
  // toegevoegd als hint, maar template blijft hard-coded zodat Jelle weet
  // wat-ie krijgt.
  const variants = useMemo(() => {
    // 2026-05-07 — voor awaiting-mails is `mail.from_name` op 'aan <recipients>'
    // gezet (zie awaitingMails-builder), waardoor firstName 'aan' werd en de
    // opener "Hé aan," produceerde. Pak de echte recipient uit to_recipients.
    function firstRecipient(toRecip) {
      if (!toRecip) return ''
      const arr = Array.isArray(toRecip) ? toRecip : [toRecip]
      for (const x of arr) {
        if (typeof x === 'string') return x
        if (x?.name) return x.name
        if (x?.email) return x.email
        if (x?.address) return x.address
      }
      return ''
    }
    const stripAanPrefix = (s) => String(s || '').replace(/^aan\s+/i, '').trim()
    const recipientRaw = mail.__awaiting
      ? (firstRecipient(mail.to_recipients) || stripAanPrefix(mail.from_name) || (mail.from_email || '').split('@')[0] || '')
      : (mail.from_name || (mail.from_email || '').split('@')[0] || '')
    const recipientLabel = recipientRaw.includes('@')
      ? recipientRaw.split('@')[0].replace(/[._-]+/g, ' ')
      : recipientRaw
    const firstName = (recipientLabel.split(/[\s,]+/)[0] || recipientLabel || '').trim()
    const days = mail.days_waiting || 0
    const subj = (mail.subject || '').replace(/^(re|fw|fwd):\s*/i, '')
    const ago = days === 0 ? 'recent' : days === 1 ? 'gisteren' : `${days} dagen geleden`
    // Begroeting variatie op basis van mail_id zodat 'ie consistent maar niet
    // statisch is. 4 stijlen waar 'Hoi' niet altijd in zit.
    const greetings = ['Hi', 'Hé', 'Hallo', firstName ? `Beste ${firstName}` : 'Beste']
    const hashIdx = (mail.mail_id || '').split('').reduce((a, c) => (a + c.charCodeAt(0)) % greetings.length, 0)
    const greet = greetings[hashIdx]
    const opener = greet.startsWith('Beste') ? `${greet},` : `${greet}${firstName && !greet.includes(firstName) ? ' ' + firstName : ''},`
    return [
      {
        label: 'Kort en direct',
        body:
`${opener}

Even een korte reminder. Ik mailde je ${ago}${subj ? ` over "${subj}"` : ''} en heb nog geen reactie ontvangen. Lukt het om er deze week naar te kijken?

Groet,
Jelle`,
      },
      {
        label: 'Warm en uitgebreid',
        body:
`${opener}

Geen druk hoor, maar ik wilde even checken of mijn mail van ${ago}${subj ? ` over "${subj}"` : ''} bij je is binnengekomen. Soms verdwijnt zoiets in de drukte. Mocht je er nog naar willen kijken, dan hoor ik graag van je. Geen reactie nodig als het nog even duurt, dan stuur ik later opnieuw een reminder.

Vriendelijke groet,
Jelle`,
      },
    ]
  }, [mail])

  // Initial: variant 0
  useEffect(() => {
    if (showFollowup && !followupText) {
      setFollowupText(variants[variantIdx].body)
    }
  }, [showFollowup, followupText, variants, variantIdx])

  function switchVariant(newIdx) {
    if (newIdx < 0 || newIdx >= variants.length) return
    setVariantIdx(newIdx)
    setFollowupText(variants[newIdx].body)
  }

  const mailtoHref = useMemo(() => {
    const to = mail.to_recipients
      ? recipientsToString(mail.to_recipients).replace(/\s\+\d+\s\w+$/, '')
      : ''
    const subj = mail.subject ? `RE: ${mail.subject.replace(/^(re|fw|fwd):\s*/i, '')}` : ''
    const params = new URLSearchParams()
    if (subj) params.set('subject', subj)
    if (followupText) params.set('body', followupText)
    return `mailto:${encodeURIComponent(to)}?${params.toString()}`
  }, [mail, followupText])

  return (
    <>
      <div className={`ad-detail__actions ${styles.actionsRowCenter}`}>
        <ToolbarBtn
          icon="✓"
          label={busy === 'dismiss' ? 'Afronden…' : 'Afgerond'}
          primary
          disabled={!!busy}
          onClick={() => dismissAwaiting()}
          title="Markeer als afgerond — thread verdwijnt uit In Afwachting."
        />
        <ToolbarBtn
          icon="🚫"
          label="Regel"
          disabled={!!busy}
          onClick={() => setReasonModal({
            pattern_type: 'subject_keyword',
            pattern_value: '',
            reason_kind: 'unwanted',
            prompt: 'Waarom hoort deze mail hier niet? Maak een leerregel zodat soortgelijke mails voortaan automatisch naar de juiste map gaan en niet meer in In Afwachting verschijnen.',
            askPattern: true,
            askTargetFolder: true,   // v3: target_folder dropdown in modal
            forAwaiting: true,
          })}
          title="Voeg leerregel toe + markeer afgerond"
        />
        <ToolbarBtn
          icon="✎"
          label={showFollowup ? 'Verberg follow-up' : 'Schrijf follow-up'}
          active={showFollowup}
          disabled={!!busy}
          onClick={() => setShowFollowup(v => !v)}
          title="Genereer een korte herinneringsmail."
        />
        {err && <span className={styles.awaitingErrMsg}>⚠ {err}</span>}
        {cat && (
          <span className={styles.awaitingCatMeta}>
            <span className={styles.detailCatDot} style={{ background: cat.color || 'var(--text-muted)' }} />
            {cat.label}
          </span>
        )}
      </div>

      {showFollowup && (
        <div className={styles.followupPanel}>
          <div className={styles.followupHead}>
            <span className={styles.followupLabel}>Follow-up</span>
            <div className={styles.variantSelector}>
              <ArrowBtn dir="left" disabled={variantIdx <= 0} onClick={() => switchVariant(variantIdx - 1)} />
              <span className={styles.awaitingVariantPill}>
                {variants[variantIdx].label}
                {' '}<span className={styles.mutedInline}>· {variantIdx + 1}/{variants.length}</span>
              </span>
              <ArrowBtn dir="right" disabled={variantIdx >= variants.length - 1} onClick={() => switchVariant(variantIdx + 1)} />
            </div>
          </div>
          {reminderStyle && (
            <div className={styles.reminderHint}>
              💡 Jouw reminder-stijl: {reminderStyle}
            </div>
          )}
          <textarea value={followupText} onChange={e => setFollowupText(e.target.value)}
            rows={Math.max(8, followupText.split('\n').length + 1)}
            className={styles.followupTextarea} />
          <div className={styles.followupActions}>
            <a href={mailtoHref} className={styles.outlookLink}>
              📧 Open in Outlook
            </a>
            <button type="button"
              onClick={async () => {
                try { await navigator.clipboard.writeText(followupText) } catch {}
              }}
              className={styles.followupCopyBtn}>
              📋 Kopieer
            </button>
            <span className={styles.followupNote}>
              Mail blijft in In Afwachting tot er een reactie binnenkomt.
            </span>
          </div>
        </div>
      )}

      {reasonModal && (
        <ReasonModal
          opts={reasonModal}
          onCancel={() => setReasonModal(null)}
          onConfirm={async (extra) => {
            const payload = reasonModal
            setReasonModal(null)
            if (payload.forAwaiting) {
              if (extra.pattern && extra.pattern.length >= 2) {
                try {
                  // v3 (2026-05-26): autodraft_upsert_ignore_rule met target_folder.
                  // Vervangt add_ignore_rule (oude RPC zonder target_folder support).
                  // Toekomstige matches worden door auto-draft-execute pass A naar
                  // deze target_folder verplaatst.
                  await supabase.rpc('autodraft_upsert_ignore_rule', {
                    p_pattern_type: payload.pattern_type,
                    p_pattern_value: extra.pattern,
                    p_target_folder: extra.targetFolder || 'Archief/Overig',
                    p_reason: extra.text || null,
                    p_reason_kind: payload.reason_kind,
                    p_name: extra.pattern.slice(0, 60),
                    p_active: true,
                  })
                } catch {}
              }
              await dismissAwaiting(extra.text)
            } else {
              await submitIgnoreWithRule({
                pattern_type: payload.pattern_type,
                pattern_value: extra.pattern || payload.pattern_value,
                reason_kind: payload.reason_kind,
                reason: extra.text,
                target_folder: extra.targetFolder,
              })
            }
          }}
        />
      )}
    </>
  )
}

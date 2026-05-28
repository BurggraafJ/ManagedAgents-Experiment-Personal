import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'

// useMailActions — bundelt alle RPC-calls die MailDetail kan triggeren:
// submit (send/ignore/spam/amend), markProcessed, dismissAwaiting,
// submitIgnoreWithRule, toggleFlag, resetToPending en changeCategory.
//
// Houdt zelf `busy` (welke actie loopt) en `err` (laatste foutmelding) bij.
// Optimistic verbergen gaat via markActioned/unmarkActioned uit InboxPanel —
// alleen voor send/ignore/spam (amend blijft zichtbaar omdat de skill een
// nieuwe variant terugschrijft).
export function useMailActions({ mail, markActioned, unmarkActioned, draftStateRef }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  const submit = useCallback(async (action, opts = {}) => {
    if (busy) return
    setErr(null); setBusy(opts.busyTag || action)
    const optimisticHide = ['send','ignore','spam'].includes(action)
    if (optimisticHide && markActioned) markActioned(mail.mail_id)
    try {
      const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
      const trackVariant = ['send','amend'].includes(action) && variants.length > 0
      const { variantIndex, amendText, draftSubject, draftBody, targetFolder } = draftStateRef.current
      const chosenIdx = trackVariant ? Math.max(0, Math.min(variantIndex, variants.length - 1)) : null
      const chosenLabel = trackVariant ? (variants[chosenIdx]?.label ?? null) : null

      const { data: rpcRes, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: mail.mail_id,
        p_action: action,
        p_amend: action === 'amend' ? amendText : null,
        p_final_subject: action === 'send' ? (opts.subject ?? draftSubject) : null,
        p_final_body:    action === 'send' ? (opts.body    ?? draftBody)    : null,
        p_target_folder: opts.target_folder ?? (targetFolder || null),
        p_decision_kind: opts.decision_kind || 'reply',
        p_final_to:      opts.final_to || null,
        p_chosen_variant_index: chosenIdx,
        p_chosen_variant_label: chosenLabel,
      })
      if (error) {
        setErr(error.message)
        if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
        showToast({ kind: 'error', message: 'Actie mislukt', detail: error.message })
      } else if (rpcRes && rpcRes.ok === false) {
        setErr(rpcRes.reason || 'mislukt')
        if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
        showToast({ kind: 'error', message: 'Actie geweigerd', detail: rpcRes.reason || 'mislukt' })
      } else {
        if (action === 'send') {
          showToast({
            message: 'Concept onderweg naar Outlook',
            detail: 'Instant-trigger maakt de Outlook-draft binnen enkele seconden.',
          })
        } else if (action === 'ignore') {
          showToast({ kind: 'info', message: 'Mail genegeerd', detail: opts.target_folder ? `Verplaatst naar ${opts.target_folder}` : null })
        } else if (action === 'spam') {
          showToast({ kind: 'info', message: 'Gemarkeerd als spam' })
        } else if (action === 'amend') {
          showToast({ kind: 'info', message: 'Amend ingediend', detail: 'Skill schrijft nieuwe varianten.' })
        }
      }
    } catch (e) {
      setErr(e.message)
      if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
      showToast({ kind: 'error', message: 'Netwerkfout', detail: e.message })
    }
    setBusy(null)
  }, [busy, mail.mail_id, mail.draft_variants, markActioned, unmarkActioned, draftStateRef])

  // markProcessed — voor mails die je al handmatig in Outlook hebt afgehandeld.
  // Verbergt zonder Outlook-actie (Outlook-sync is anders soms traag waardoor
  // verplaatste mails toch nog in 'Voor jou' verschijnen).
  const markProcessed = useCallback(async () => {
    if (busy) return
    setBusy('processed'); setErr(null)
    if (markActioned) markActioned(mail.mail_id)
    try {
      const { data, error } = await supabase.rpc('mark_mail_processed', {
        p_mail_id: mail.mail_id,
        p_reason: 'Al verwerkt in Outlook',
      })
      if (error) {
        setErr(error.message)
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      } else if (data && data.ok === false) {
        setErr(data.reason || 'mislukt')
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      }
    } catch (e) {
      setErr(e.message)
      if (unmarkActioned) unmarkActioned(mail.mail_id)
    }
    setBusy(null)
  }, [busy, mail.mail_id, markActioned, unmarkActioned])

  // Awaiting-dismiss — markeer thread als afgerond. Verbergt deze + alle andere
  // mails in dezelfde conversation_id uit de awaiting-poel.
  const dismissAwaiting = useCallback(async (reason) => {
    if (busy) return
    if (!mail.conversation_id) { setErr('Geen conversation_id'); return }
    setBusy('dismiss'); setErr(null)
    if (markActioned) markActioned(mail.mail_id)
    try {
      const { data, error } = await supabase.rpc('dismiss_awaiting', {
        p_conversation_id: mail.conversation_id,
        p_reason: reason || null,
      })
      if (error) {
        setErr(error.message)
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      } else if (data && data.ok === false) {
        setErr(data.reason || 'mislukt')
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      }
    } catch (e) {
      setErr(e.message)
      if (unmarkActioned) unmarkActioned(mail.mail_id)
    }
    setBusy(null)
  }, [busy, mail.conversation_id, mail.mail_id, markActioned, unmarkActioned])

  // Negeer met reden + leerregel. Wanneer Jelle zegt "type mail wil ik niet
  // meer zien" schrijven we een autodraft_ignore_rules-row zodat de skill 'm
  // volgende keer auto-skipt.
  const submitIgnoreWithRule = useCallback(async (opts) => {
    if (busy) return
    setBusy('ignore'); setErr(null)
    if (markActioned) markActioned(mail.mail_id)
    try {
      const { targetFolder } = draftStateRef.current
      const { data, error } = await supabase.rpc('submit_ignore_with_rule', {
        p_mail_id: mail.mail_id,
        p_target_folder: targetFolder || null,
        p_pattern_type: opts.pattern_type,
        p_pattern_value: opts.pattern_value,
        p_reason: opts.reason || null,
        p_reason_kind: opts.reason_kind || 'unwanted',
      })
      if (error) {
        setErr(error.message)
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      } else if (data && data.ok === false) {
        setErr(data.reason || 'mislukt')
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      }
    } catch (e) {
      setErr(e.message)
      if (unmarkActioned) unmarkActioned(mail.mail_id)
    }
    setBusy(null)
  }, [busy, mail.mail_id, markActioned, unmarkActioned, draftStateRef])

  // Flag-toggle — direct via set_mail_flag RPC (geen autodraft_decision-roundtrip).
  const toggleFlag = useCallback(async (currentFlag) => {
    if (busy) return
    const newVal = !currentFlag
    setBusy(newVal ? 'flag' : 'unflag'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_mail_flag', {
        p_mail_id: mail.mail_id, p_flag: newVal,
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }, [busy, mail.mail_id])

  const changeCategory = useCallback(async (newKey) => {
    try {
      await supabase.rpc('set_autodraft_mail_category', { p_mail_id: mail.mail_id, p_category_key: newKey })
    } catch { /* silent */ }
  }, [mail.mail_id])

  const resetToPending = useCallback(async () => {
    setBusy('reset'); setErr(null)
    try {
      const { data: rpcRes, error } = await supabase.rpc('reset_autodraft_mail_to_pending', { p_mail_id: mail.mail_id })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }, [mail.mail_id])

  return {
    busy, err, setErr,
    submit, markProcessed, dismissAwaiting, submitIgnoreWithRule,
    toggleFlag, changeCategory, resetToPending,
  }
}

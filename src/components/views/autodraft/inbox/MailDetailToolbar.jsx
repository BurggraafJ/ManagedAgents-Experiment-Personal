import styles from '../autodraft.module.css'
import ToolbarBtn from './ToolbarBtn'
import IgnoreDropdownBtn from './IgnoreDropdownBtn'
import QuickActionsToolbarBtn from './QuickActionsToolbarBtn'
import MetaChips from './MetaChips'
import ActionBtn from './ActionBtn'

// Outlook-stijl ribbon onder de header — Plaats concept / Negeer / Aanpassen /
// Snel-acties / Reset + categorie-en-folder-chips. Voor awaiting/sent-drafts
// wordt 'ie verborgen (de AwaitingActions-component neemt het over).
//
// Bevat ook de amend-textarea die uitklapt zodra `mode === 'amend'`.
export default function MailDetailToolbar({
  mail, busy, err, collapsed,
  draftBody, mode, setMode,
  amendText, setAmendText,
  cat, categoryKey, changeCategory, categories,
  targetFolder, setTargetFolder, folderOptions, folderTree,
  onSend, onIgnore, onIgnoreWithRule, onMarkProcessed,
  onSubmitAmend, onReset,
  submit, onAddPreference,
}) {
  return (
    <>
      <div className="ad-detail__actions">
        <ToolbarBtn
          icon="📧"
          label={busy === 'send' ? 'Bezig…' : 'Plaats concept'}
          primary
          disabled={!!busy || collapsed || !draftBody.trim()}
          onClick={onSend}
          title="Maakt een concept-reply in Outlook. Jij klikt zelf send."
        />
        <IgnoreDropdownBtn
          mail={mail}
          busy={busy}
          onIgnore={onIgnore}
          onIgnoreWithRule={onIgnoreWithRule}
          onMarkProcessed={onMarkProcessed}
        />
        <ToolbarBtn
          icon="✎"
          label="Aanpassen"
          active={mode === 'amend'}
          disabled={!!busy}
          onClick={() => setMode(m => m === 'amend' ? null : 'amend')}
        />
        <span className="ot-sep" />
        <QuickActionsToolbarBtn
          mail={mail}
          submit={submit}
          busy={busy}
          disabled={!!busy}
          onAddPreference={onAddPreference}
        />
        {(mail.status !== 'pending') && (
          <ToolbarBtn icon="↺" label="Reset" disabled={!!busy} onClick={onReset} />
        )}
        {err && <span className={styles.detailErrSpan}>⚠ {err}</span>}

        <div className={styles.detailMetaChipsWrap}>
          <MetaChips
            cat={cat}
            categoryKey={categoryKey}
            changeCategory={changeCategory}
            categories={categories}
            targetFolder={targetFolder}
            setTargetFolder={setTargetFolder}
            folderOptions={folderOptions}
            folderTree={folderTree}
            busy={busy}
          />
        </div>
      </div>

      {mode === 'amend' && (
        <div className="ad-detail__amend">
          <label className={styles.detailAmendLabel}>
            Wat moet anders? De skill herschrijft op basis van je correctie.
          </label>
          <textarea value={amendText} onChange={e => setAmendText(e.target.value)} disabled={!!busy}
            rows={3}
            placeholder={'bv. "Korter en informeler", "Stel concrete datum voor", "Niet over prijs beginnen"…'}
            autoFocus
            className={styles.detailAmendTextarea} />
          <div className={styles.detailAmendBtnRow}>
            <ActionBtn label={busy === 'amend' ? 'Indienen…' : 'Stuur naar skill'}
              variant="primary" disabled={!!busy || !amendText.trim()} onClick={onSubmitAmend} />
            <ActionBtn label="Annuleer" variant="ghost"
              onClick={() => { setMode(null); setAmendText('') }} disabled={!!busy} />
          </div>
        </div>
      )}
    </>
  )
}

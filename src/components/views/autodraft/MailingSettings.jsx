import { useState } from 'react'
import EmptyHero from './inbox/EmptyHero'
import CategoryProposalsBlock from './settings/CategoryProposalsBlock'
import LessonProposalsBlock from './settings/LessonProposalsBlock'
import SystemInstructionsBlock from './settings/SystemInstructionsBlock'
import ReminderStyleBlock from './settings/ReminderStyleBlock'
import CategoriesBlock from './settings/CategoriesBlock'
import LessonsBlock from './settings/LessonsBlock'
import InboxLog from './settings/InboxLog'
import DebugBlock from './settings/DebugBlock'
import ActionsBlock from './settings/ActionsBlock'
import styles from './autodraft.module.css'

const SETTINGS_TABS = [
  { id: 'voorstellen', label: '✨ Voorstellen', hint: 'wachten op review' },
  { id: 'categories',  label: '🏷 Categorieën' },
  { id: 'acties',      label: '🎯 Acties' },
  { id: 'regels',      label: '🧠 Regels' },
  { id: 'logboek',     label: '📜 Logboek' },
]

// MAILING SETTINGS — sub-pagina met 4 intra-tabs
export default function MailingSettings({ mails, categories, categoryProps, lessonProps, decisions, folders, lessons, agentInstructions, recentRuns, onNavigate }) {
  const proposalsCount = categoryProps.length + lessonProps.length
  const [activeTab, setActiveTab] = useState(() => proposalsCount > 0 ? 'voorstellen' : 'categories')

  const tabCount = (id) => {
    if (id === 'voorstellen') return proposalsCount
    if (id === 'categories')  return categories.length
    if (id === 'acties')      return 0   // ActionsBlock haalt eigen count realtime
    if (id === 'regels')      return lessons.length
    if (id === 'logboek')     return mails.filter(m =>
      ['sent','ignored','failed','stale'].includes(m.status) || String(m.status).startsWith('queued_')
    ).length
    return 0
  }

  return (
    <div className="ad-settings">
      {onNavigate && (
        <button
          type="button"
          className={`btn btn--ghost ${styles.backBtn}`}
          onClick={() => onNavigate('autodraft')}
          title="Terug naar Postvak"
        >
          <span aria-hidden className={styles.backBtnArrow}>←</span>Postvak
        </button>
      )}
      <div className="ad-settings__tabs" role="tablist">
        {SETTINGS_TABS.map(t => {
          const active = activeTab === t.id
          const n = tabCount(t.id)
          return (
            <button key={t.id} type="button" role="tab" aria-selected={active}
              className={`ad-settings__tab ${active ? 'is-active' : ''}`}
              onClick={() => setActiveTab(t.id)}>
              <span>{t.label}</span>
              {n > 0 && <span className="ad-settings__tab-count">{n}</span>}
              {t.hint && active && <span className="ad-settings__tab-hint">· {t.hint}</span>}
            </button>
          )
        })}
      </div>

      <div className="ad-settings__panel">
        {activeTab === 'voorstellen' && (
          <div className="stack" style={{ gap: 'var(--s-5)' }}>
            {proposalsCount === 0 ? (
              <EmptyHero
                icon="✨"
                title="Geen openstaande voorstellen"
                hint="De skill stelt nieuwe categorieën en schrijfregels voor wanneer hij patronen herkent in jouw beslissingen. Verwerk eerst wat mails — dan komen hier vanzelf voorstellen binnen."
              />
            ) : (
              <div className="ad-proposals-row">
                {categoryProps.length > 0 && <CategoryProposalsBlock proposals={categoryProps} />}
                {lessonProps.length   > 0 && <LessonProposalsBlock   proposals={lessonProps} categories={categories} />}
              </div>
            )}
            <SystemInstructionsBlock agentInstructions={agentInstructions} />
            <ReminderStyleBlock agentInstructions={agentInstructions} />
          </div>
        )}

        {activeTab === 'categories' && (
          <CategoriesBlock categories={categories} folders={folders} alwaysOpen />
        )}

        {activeTab === 'acties' && (
          <ActionsBlock />
        )}

        {activeTab === 'regels' && (
          <LessonsBlock lessons={lessons} categories={categories} alwaysOpen />
        )}

        {activeTab === 'logboek' && (
          <div className="stack" style={{ gap: 'var(--s-5)' }}>
            <InboxLog mails={mails} decisions={decisions} alwaysOpen />
            <DebugBlock recentRuns={recentRuns} alwaysOpen />
          </div>
        )}
      </div>
    </div>
  )
}

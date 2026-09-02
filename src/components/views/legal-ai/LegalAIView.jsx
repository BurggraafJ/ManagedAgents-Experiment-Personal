import { useMemo, useState } from 'react'
import { TRACK_BY_KEY } from '../../../lib/legalAi'
import { useLegalAI } from '../../../hooks/useLegalAI'
import TrackToggle from './TrackToggle'
import StatusPills from './StatusPills'
import ArticleHero from './ArticleHero'
import ProposalsPanel from './ProposalsPanel'
import VisionTracker from './VisionTracker'
import TopicsAndPlayers from './TopicsAndPlayers'
import Archive from './Archive'
import styles from './LegalAIView.module.css'

/**
 * LegalAIView — Legal AI Thought Leadership dashboard-tab.
 *
 * Refactor 12 (Golf C): container <80 LOC. Hook in src/hooks/useLegalAI.js.
 * Sub-componenten in deze folder. Track-accent als CSS-var op de shell zodat
 * sub-componenten data-driven kleurpalet erven.
 */
export default function LegalAIView() {
  const [activeTrack, setActiveTrack] = useState('advocatuur')
  const data = useLegalAI(activeTrack)
  const accent = useMemo(() => TRACK_BY_KEY[activeTrack].accent, [activeTrack])
  const tagline = useMemo(() => TRACK_BY_KEY[activeTrack].tagline, [activeTrack])

  return (
    <div className={styles.shell} style={{ '--track-accent': accent }}>
      <div className={styles.header}>
        <div>
          <TrackToggle active={activeTrack} onChange={setActiveTrack} />
          <div className={styles.tagline}>{tagline}</div>
        </div>
        <StatusPills latestRunAt={data.latestRunAt} hasArticle={!!data.todayArticle} />
      </div>

      {data.error && (
        <div className={styles.errorBanner}>
          <strong>Schema niet beschikbaar.</strong> Migration{' '}
          <code>legal_ai_thought_leadership_2026_05_02.sql</code> nog niet toegepast?
          <br />
          <span style={{ fontSize: 11, opacity: 0.8 }}>{data.error}</span>
        </div>
      )}

      <ArticleHero
        article={data.todayArticle}
        onFeedback={data.submitFeedback}
      />

      <ProposalsPanel proposals={data.proposals} onDecide={data.decideProposal} />

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>
          Visie-tracker — {TRACK_BY_KEY[activeTrack].label}
        </h2>
        <VisionTracker theses={data.theses} />
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Wat we volgen</h2>
        <TopicsAndPlayers topics={data.topics} players={data.players} />
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Archief — laatste 14 artikelen</h2>
        <Archive archive={data.archive} />
      </section>

      <div className={styles.footer}>
        Project — Legal AI Thought Leadership · F.4 stub.
        Voice/bias-flag worden in F.5–F.7 toegevoegd.
      </div>
    </div>
  )
}

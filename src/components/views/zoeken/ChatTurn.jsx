import { useState, memo } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import Markdown from './Markdown'
import ReasoningTrace, { LiveElapsed } from './ReasoningTrace'
import AnswerLayers from './AnswerLayers'
import AnalyticsBlock from './AnalyticsBlock'
import CoverageNote from './CoverageNote'
import ArtifactBar from './ArtifactBar'
import { FollowupChips, splitFollowUps } from './Followups'
import { RunBudgetLine, RunCancelButton, RunInputPrompt, RunFailedActions, RunStateNote } from './RunControls'
import { expectedDuration } from '../../../lib/answerLayers'

// =============================================================================
// ChatTurn — één rij in de thread: de vraag, of het antwoord met zijn lagen
// =============================================================================
// Uit ChatMode.jsx gehaald in v1.152 (spoor 08). Dat bestand stond al ruim over
// de 400-regelcap uit CLAUDE.md, en dit spoor herschreef juist dit deel: de
// metaregel (ring, fase, verwachte duur, kosten), en de vier lagen onder het
// antwoord. De composer, de filters en de popovers blijven in ChatMode.
//
// Wat hier NIET meer staat en waar het heen ging (Jelle 2026-09-07, 1a–1i "ja"):
//   "24 chunks gelezen" / "87 % confidence"  → verantwoordingsregel + Technisch
//   "Onderzoek: 9 stappen · 2 gedachten"     → één zin + de tijdlijn eronder
//   "3 bronnen bekijken"                     → chip "Bronnen 3 +21"
//   RetrievalDebug (40 → 24 → 0)             → TechnicalPanel
// =============================================================================

// Memo: alleen re-render als message-shallow-changed. Tijdens streaming
// muteren we voornamelijk het LAATSTE bericht — eerdere TurnRows blijven
// dan in cache en re-renderen niet meer per delta.
const TurnRow = memo(TurnRowInner, (prev, next) => {
  return prev.m === next.m
      && prev.idx === next.idx
      && prev.onOpenSources === next.onOpenSources
      && prev.onFollowUp === next.onFollowUp
      && prev.onFeedback === next.onFeedback
      && prev.currentWebSearch === next.currentWebSearch
      && prev.run === next.run
      && prev.isOwner === next.isOwner
})

function TurnRowInner({ m, idx, onOpenSources, onFollowUp, onFeedback, currentWebSearch, run, isOwner }) {
  if (m.role === 'user') {
    return (
      <div className={s.user} data-msg-idx={idx}>
        <div className={s.userAv}>JB</div>
        <div className={s.userBubble}>{m.content}</div>
      </div>
    )
  }
  return <AssistantTurn m={m} idx={idx} onOpenSources={onOpenSources} onFollowUp={onFollowUp} onFeedback={onFeedback} currentWebSearch={currentWebSearch} run={run} isOwner={isOwner} />
}

function AssistantTurn({ m, idx, onOpenSources, onFollowUp, onFeedback, currentWebSearch, run, isOwner }) {
  // Tijdens streaming heeft het bericht al content; toon dat liever dan
  // de LoadingSteps-skelton. Alleen het ALLEREERSTE loading-state (geen
  // content nog) krijgt de step-indicator.
  if (m.loading && !m.content) {
    return (
      <div className={s.asst}>
        <div className={s.asstAv}>{Ico.sparkle}</div>
        <div className={s.asstMain}>
          {/* v1.152 (spoor 08, H4): ring + label + fase + verwachte duur +
              verstreken tijd + kosten + stop. De verwachting staat er vanaf de
              eerste frame — dat is wat "hangt hij?" wegneemt, niet de teller. */}
          <div className={s.asstMeta}>
            <span className={`${s.asstRing} ${s.asstRingLive}`} aria-hidden />
            <strong>Maestro</strong>
            <span className={s.asstMetaDot} />
            {/* v1.151: de rij weet in welke fase hij is (`phase_label`) — dat is
                specifieker dan "aan het werk" en overleeft een reload. */}
            <span className={s.asstPhase}>{m.phase_label || 'aan het werk'}<span className={s.thinkingDots}><span /><span /><span /></span></span>
            <span className={s.asstExpect}>{expectedDuration(m)}</span>
            <span className={s.asstMetaDot} />
            <LiveElapsed startedAt={m.run_started_at} />
            <RunBudgetLine m={m} />
            <RunCancelButton m={m} onCancel={run?.cancel} />
          </div>
          <ReasoningTrace steps={m.steps} live phaseLabel={m.phase_label} startedAt={m.run_started_at} webSearch={m.web_search_enabled ?? currentWebSearch} />
          <RunInputPrompt m={m} onAnswer={run?.answerInput} />
        </div>
      </div>
    )
  }
  if (m.error) {
    return (
      <div className={s.asst}>
        <div className={s.asstAv}>{Ico.sparkle}</div>
        <div className={s.asstMain}>
          <div className={s.errBubble}>Fout: {m.error}</div>
          {/* Het onderzoek staat op de server: hervatten herhaalt geen tool-calls. */}
          <RunFailedActions m={m} onResume={run?.resume} />
        </div>
      </div>
    )
  }
  const cites = m.citations || []
  const { main, followups } = splitFollowUps(m.content || '')

  return (
    <div className={s.asst}>
      <div className={s.asstAv}>{Ico.sparkle}</div>
      <div className={s.asstMain}>
        {/* v1.152 (1b, Jelle "ja"): "24 chunks gelezen" en "87 % confidence"
            stonden hier voor iedereen. Die twee zijn nu de verantwoordings-
            regel in AnswerLayers (gewone taal) en het getal zelf staat in
            TechnicalPanel. De duur staat ook in die regel. */}
        <div className={s.asstMeta}>
          <span className={s.asstRing} aria-hidden />
          <strong>Maestro</strong>
          {(m.knowledge_lessons?.length > 0) && (
            <span className={s.lessonBadge} title="JelleMind-lessons toegepast">
              {Ico.sparkle}
              {m.knowledge_lessons.length} {m.knowledge_lessons.length === 1 ? 'les' : 'lessen'}
            </span>
          )}
          {m.entity_used && (
            <span className={s.entityBadge} title={`Entity-aware retrieval — matched op "${m.entity_used.matched_term}"`}>
              {m.entity_used.entity_type === 'contact' ? Ico.user : m.entity_used.entity_type === 'deal' ? Ico.deal : Ico.building}
              <strong>{m.entity_used.name}</strong>
            </span>
          )}
          {/* v1.152 — de kosten staan nu in de verantwoordingsregel onder het
              antwoord (AnswerLayers), dus hier niet nog een keer. De stopknop
              blijft: een run kan ook na het eerste antwoord nog lopen. */}
          <RunCancelButton m={m} onCancel={run?.cancel} />
        </div>
        <RunInputPrompt m={m} onAnswer={run?.answerInput} />
        <RunStateNote m={m} />
        {/* v1.152 (1g, Jelle "ja"): de trace stond hier boven het antwoord als
            "Onderzoek: 9 stappen · 2 gedachten · 5 tool-calls". Die telling is
            geen mededeling; de trace zit nu onder het antwoord in AnswerLayers,
            met één zin als kop en de telling in TechnicalPanel. */}
        <div className={s.asstBody}>
          {/* Markdown ook tijdens streaming — useDeferredValue + 250ms
              throttle in hook + invalid-citation filter zorgt dat het
              snel blijft. Plain-text-modus was te lelijk volgens Jelle. */}
          <Markdown
            text={main}
            onCiteClick={(n) => onOpenSources(idx, n)}
            validCiteNs={cites.map(c => c.n)}
          />
        </div>
        {/* Geen lompe web-search banner meer onder het antwoord. Status komt
            terug in de bestaande asstMeta-rij (chunk-count etc) en de bronnen
            zitten in het SourcesPanel onder de "Web"-tab. */}
        {/* Vragenbak-analytics (structured/sweep): exacte tabel + dekking-
            banner. Zichtbaar zodra meta binnen is (ook tijdens streaming —
            de data is dan al definitief). */}
        {m.analytics && <AnalyticsBlock analytics={m.analytics} />}
        {/* WP2 — stond er niets, dan zegt dit blokje waaróm. Pas na het streamen:
            tijdens de delta-flow is de envelop nog niet binnen en zou hij
            kortstondig de verkeerde reden kunnen tonen. */}
        {!m.streaming && <CoverageNote coverage={m.envelope?.coverage} />}
        {/* v1.152 (spoor 08) — de vier lagen: verantwoordingsregel altijd,
            Bronnen en Onderzoek dicht achter een chip, Technisch alleen voor
            owner. Dit is pakket P2 "Normaal" (ASK-JELLE §2). De kosten staan
            in de regel: Jelle's uitzondering, bedrag per generatie blijft
            zichtbaar in de normale weergave. */}
        {!m.streaming && (
          <AnswerLayers
            m={m}
            isOwner={isOwner}
            onOpenCite={(n) => onOpenSources(idx, n)}
            onOpenPanel={() => onOpenSources(idx, null)}
          />
        )}
        {/* WP4 — Excel/CSV/afdrukken zodra er een tabel onder ligt. */}
        {!m.streaming && <ArtifactBar envelope={m.envelope} analytics={m.analytics} question={m.user_message} queryLogId={m.query_log_id} />}
        {/* Bronnen + Vervolgvragen pas zichtbaar NA streaming — schoner
            en voorkomt re-render-storm tijdens delta-flow. */}
        {!m.streaming && <FollowupChips items={followups} onPick={onFollowUp} />}
        {!m.streaming && (
          <div className={s.asstActionRow}>
            <ChatActions m={m} idx={idx} onFeedback={onFeedback} />
          </div>
        )}
      </div>
    </div>
  )
}

function ChatActions({ m, onFeedback }) {
  const [copied, setCopied] = useState(false)
  const [fb, setFb] = useState(null)   // 'thumbs_up' | 'thumbs_down'
  const onCopy = () => {
    try {
      navigator.clipboard.writeText(m.content || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* ignore */ }
  }
  const giveFeedback = async (rating) => {
    if (fb) return
    setFb(rating)
    const ok = await onFeedback?.(m, rating)
    if (!ok) setFb(null)   // revert bij fout
  }
  return (
    <div className={s.asstActions}>
      <button className={`${s.asstAct} ${copied ? s.asstActOn : ''}`}
              title={copied ? 'Gekopieerd' : 'Kopieer antwoord'}
              onClick={onCopy}>{Ico.copy}</button>
      <button className={`${s.asstAct} ${fb === 'thumbs_up' ? s.asstActOn : ''}`}
              title="Goed antwoord — voedt de RAG-kwaliteitsmeting"
              onClick={() => giveFeedback('thumbs_up')} disabled={!!fb}>👍</button>
      <button className={`${s.asstAct} ${fb === 'thumbs_down' ? s.asstActOn : ''}`}
              title="Niet goed — voedt de RAG-kwaliteitsmeting"
              onClick={() => giveFeedback('thumbs_down')} disabled={!!fb}>👎</button>
    </div>
  )
}

export default TurnRow

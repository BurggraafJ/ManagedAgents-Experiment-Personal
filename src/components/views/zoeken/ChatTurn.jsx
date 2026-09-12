import { useState, memo } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import Markdown from './Markdown'
import ReasoningTrace, { LiveElapsed } from './ReasoningTrace'
import AnswerLayers from './AnswerLayers'
import AnalyticsBlock from './AnalyticsBlock'
import CoverageNote from './CoverageNote'
import ArtifactBar from './ArtifactBar'
import { RunBudgetLine, RunCancelButton, RunInputPrompt, RunFailedActions, RunStateNote } from './RunControls'
import { expectedDuration } from '../../../lib/answerLayers'
import { stripFollowUpBlock } from '../../../lib/rag'

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
      && prev.onFeedback === next.onFeedback
      && prev.currentWebSearch === next.currentWebSearch
      && prev.run === next.run
      && prev.isOwner === next.isOwner
})

function TurnRowInner({ m, idx, onOpenSources, onFeedback, currentWebSearch, run, isOwner }) {
  if (m.role === 'user') {
    // v1.162 (vorm A "Gesprek", Jelle 2026-09-12) — één kolom. De vraag is geen
    // bubbel met avatar meer maar de aanhef van de beurt: een regel op de
    // oranje kantlijn, direct boven het antwoord waar hij bij hoort.
    return (
      <div className={s.user} data-msg-idx={idx}>
        <div className={s.userBubble}>{m.content}</div>
      </div>
    )
  }
  return <AssistantTurn m={m} idx={idx} onOpenSources={onOpenSources} onFeedback={onFeedback} currentWebSearch={currentWebSearch} run={run} isOwner={isOwner} />
}

function AssistantTurn({ m, idx, onOpenSources, onFeedback, currentWebSearch, run, isOwner }) {
  // v1.155 (spoor 08 I1) — welke citatie "aan" staat. De alinea met die marker
  // krijgt het oranje accent (Jelle 2026-09-08). Twee bronnen, één waarde:
  // hover is een vluchtige voorvertoning, een klik zet hem vast (en opent de
  // bron in het paneel). Hover wint zolang de muis er staat, anders geldt de
  // klik — zo blijft de gekozen passage gemarkeerd terwijl je hem naleest.
  const [pinnedCite, setPinnedCite] = useState(null)
  const [hoverCite, setHoverCite] = useState(null)
  const activeCiteN = hoverCite ?? pinnedCite

  // Tijdens streaming heeft het bericht al content; toon dat liever dan
  // de LoadingSteps-skelton. Alleen het ALLEREERSTE loading-state (geen
  // content nog) krijgt de step-indicator.
  if (m.loading && !m.content) {
    return (
      <div className={s.asst}>
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
        <div className={s.asstMain}>
          <div className={s.errBubble}>Fout: {m.error}</div>
          {/* Het onderzoek staat op de server: hervatten herhaalt geen tool-calls. */}
          <RunFailedActions m={m} onResume={run?.resume} />
        </div>
      </div>
    )
  }
  const cites = m.citations || []
  const main = stripFollowUpBlock(m.content || '')

  return (
    <div className={s.asst}>
      <div className={s.asstMain}>
        {/* v1.152 (1b, Jelle "ja"): "24 chunks gelezen" en "87 % confidence"
            stonden hier voor iedereen. Die twee zijn nu de verantwoordings-
            regel in AnswerLayers (gewone taal) en het getal zelf staat in
            TechnicalPanel. De duur staat ook in die regel. */}
        <div className={s.asstMeta}>
          <span className={s.asstRing} aria-hidden />
          <strong>Maestro</strong>
          {(m.knowledge_lessons?.length > 0) && (
            <span className={s.lessonBadge} title="Lessen toegepast">
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
            narrow
            onCiteClick={(n) => { setPinnedCite(n); onOpenSources(idx, n) }}
            onCiteHover={setHoverCite}
            activeCiteN={activeCiteN}
            validCiteNs={cites.map(c => c.n)}
          />
        </div>
        {/* Geen lompe web-search banner meer onder het antwoord. Status komt
            terug in de bestaande asstMeta-rij (chunk-count etc) en de bronnen
            zitten in het SourcesPanel onder de "Web"-tab. */}
        {/* Vragenbak-analytics (structured/sweep): exacte tabel + dekking-
            banner. Zichtbaar zodra meta binnen is (ook tijdens streaming —
            de data is dan al definitief). */}
        {m.analytics && <AnalyticsBlock analytics={m.analytics} isOwner={isOwner} />}
        {/* v1.161 — ArtifactBar direct onder de tabel (BUG Excel-knop / a20dcdc1).
            Stond onder AnswerLayers en viel weg achter bronnen/onderzoek. */}
        {!m.streaming && <ArtifactBar envelope={m.envelope} analytics={m.analytics} question={m.user_message} queryLogId={m.query_log_id} answerMd={main} />}
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
            onOpenCite={(n) => { setPinnedCite(n); onOpenSources(idx, n) }}
            onOpenPanel={() => onOpenSources(idx, null)}
          />
        )}
        {/* v1.165 — hier stonden de vervolgvraag-chips. Vervolgvragen zijn uit
            het hele product (Jelle 2026-09-12): hij gebruikt ze niet, en onder
            een antwoord met een verantwoordingsregel waren ze het tweede ding
            dat om een klik vroeg. Ook de prompt vraagt er niet meer om
            (rag-chat/compose.ts). De ArtifactBar stond hier tot v1.161 ook; die
            is bij de Excel-fix naar boven verhuisd, direct onder de tabel. */}
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

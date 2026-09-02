import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayIso } from '../lib/legalAi'

/**
 * useLegalAI — alle data + write-acties voor LegalAIView.
 *
 * Fetcht per actieve track (advocatuur/bedrijfsleven):
 *  - todayArticle      (legal_ai_articles voor today)
 *  - theses            (active stellingen)
 *  - topics            (actieve topics)
 *  - players           (actieve spelers — combined met 'beide')
 *  - archive           (laatste 14 articles vóór today)
 *  - latestRunAt       (legal_ai_research_runs)
 *  - proposals         (legal-ai-vision-update agent_proposals, pending)
 *
 * Plus twee write-acties: submitFeedback, decideProposal.
 *
 * @param {'advocatuur'|'bedrijfsleven'} activeTrack
 */
export function useLegalAI(activeTrack) {
  const [todayArticle, setTodayArticle] = useState(null)
  const [theses, setTheses] = useState([])
  const [topics, setTopics] = useState([])
  const [players, setPlayers] = useState([])
  const [archive, setArchive] = useState([])
  const [latestRunAt, setLatestRunAt] = useState(null)
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const today = todayIso()
      const [aRes, tRes, topRes, playRes, archRes, runRes, propRes] = await Promise.all([
        supabase.from('legal_ai_articles')
          .select('*').eq('track', activeTrack).eq('article_date', today).maybeSingle(),
        supabase.from('legal_ai_theses')
          .select('*').eq('track', activeTrack).eq('status', 'active')
          .order('confidence', { ascending: false }).limit(10),
        supabase.from('legal_ai_topics')
          .select('id, track, title, importance_score, depth_score, last_researched_at, active')
          .eq('track', activeTrack).eq('active', true)
          .order('importance_score', { ascending: false }).limit(20),
        supabase.from('legal_ai_players')
          .select('id, track, name, website, importance_score, last_news_at, active')
          .in('track', [activeTrack, 'beide']).eq('active', true)
          .order('importance_score', { ascending: false }).limit(15),
        supabase.from('legal_ai_articles')
          .select('id, article_date, track, title, reading_time_min')
          .eq('track', activeTrack).lt('article_date', today)
          .order('article_date', { ascending: false }).limit(14),
        supabase.from('legal_ai_research_runs')
          .select('created_at, status, track').eq('track', activeTrack)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('agent_proposals')
          .select('id, payload, status, created_at')
          .eq('agent_name', 'legal-ai-vision-update').eq('status', 'pending')
          .order('created_at', { ascending: false }).limit(20),
      ])

      if (aRes.error)    throw aRes.error
      if (tRes.error)    throw tRes.error
      if (topRes.error)  throw topRes.error
      if (playRes.error) throw playRes.error
      if (archRes.error) throw archRes.error

      setTodayArticle(aRes.data || null)
      setTheses(tRes.data || [])
      setTopics(topRes.data || [])
      setPlayers(playRes.data || [])
      setArchive(archRes.data || [])
      setLatestRunAt(runRes?.data?.created_at || null)
      setProposals((propRes?.data || []).filter(p => p.payload?.track === activeTrack))
    } catch (e) {
      setError(e.message || String(e))
      setTodayArticle(null); setTheses([]); setTopics([]); setPlayers([]); setArchive([])
      setProposals([])
    } finally {
      setLoading(false)
    }
  }, [activeTrack])

  useEffect(() => { load() }, [load])

  const submitFeedback = useCallback(async (transcript, articleId, thesisId) => {
    if (!transcript || transcript.trim().length < 5) return { ok: false, error: 'tekst te kort' }
    const { data, error: err } = await supabase.from('legal_ai_voice_notes').insert({
      article_id: articleId || null,
      thesis_id: thesisId || null,
      track: activeTrack,
      transcript: transcript.trim(),
      status: 'pending',
    }).select().single()
    if (err) return { ok: false, error: err.message }
    return { ok: true, id: data?.id }
  }, [activeTrack])

  const decideProposal = useCallback(async (proposalId, decision, override) => {
    const { data, error: err } = await supabase.rpc('apply_legal_ai_thesis_update', {
      p_proposal_id: proposalId,
      p_decision: decision,
      p_amended: override || null,
    })
    if (err) return { ok: false, error: err.message }
    await load()
    return { ok: true, data }
  }, [load])

  return {
    todayArticle, theses, topics, players, archive, latestRunAt,
    proposals,
    loading, error, refresh: load,
    submitFeedback, decideProposal,
  }
}

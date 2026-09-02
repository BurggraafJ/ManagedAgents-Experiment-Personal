import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// useOrgSkills — CRUD op public.org_skills: de org-brede pijplijn-/lead-kennis
// die de vragenbak (rag-chat) in z'n system-prompt injecteert. Owner-only
// schrijven via RLS (org_skills_admin_write → is_admin_or_higher(), dus ook
// MFA); lezen mag elke ingelogde gebruiker want de regels sturen hun
// chat-antwoorden.
//
// v1.134 (Organisatie): nieuw. Geen realtime-channel — dit is een
// beheerpagina die één gebruiker tegelijk bewerkt; refresh() na elke mutatie.

const SELECT = 'id, slug, title, category, body, tool_binding, applies_to, active, sort_order, created_at, updated_at'

export const SKILL_CATEGORIES = [
  { key: 'pijplijn', label: 'Pijplijn', hint: 'Fases, kansen, wat een stap betekent.' },
  { key: 'lead',     label: 'Lead',     hint: 'Wanneer is iets een lead, hoe kwalificeer je.' },
  { key: 'klant',    label: 'Klant',    hint: 'Licenties, verlenging, churn-regels.' },
  { key: 'algemeen', label: 'Algemeen', hint: 'Alles wat over meerdere onderwerpen gaat.' },
]

// De tools die de vragenbak aanbiedt. Moet gelijk lopen met
// supabase/functions/rag-chat/agentic.ts → toolSchemas() (Motor A-catalogus
// met een rpc + de vijf zoek-tools). Een lege binding = algemene kennis.
export const TOOL_BINDINGS = [
  { key: '',                     label: 'Geen — algemene kennis' },
  { key: 'count_by_stage',       label: 'count_by_stage · deals per fase' },
  { key: 'churned_in_window',    label: 'churned_in_window · churn in periode' },
  { key: 'started_in_window',    label: 'started_in_window · gestart in periode' },
  { key: 'active_pilots',        label: 'active_pilots · lopende pilots' },
  { key: 'uncontacted_since',    label: 'uncontacted_since · geen contact sinds' },
  { key: 'customers_by_price',   label: 'customers_by_price · klanten op prijs' },
  { key: 'deals_over_amount',    label: 'deals_over_amount · deals boven bedrag' },
  { key: 'license_value',        label: 'license_value · licentiewaarde' },
  { key: 'calendar_search',      label: 'calendar_search · agenda' },
  { key: 'notes_search',         label: 'notes_search · HubSpot-notities' },
  { key: 'semantic_search',      label: 'semantic_search · kennisindex' },
  { key: 'customer_timeline',    label: 'customer_timeline · klant-tijdlijn' },
  { key: 'mail_evidence_search', label: 'mail_evidence_search · mailarchief' },
]

export function categoryLabel(key) {
  return SKILL_CATEGORIES.find(c => c.key === key)?.label || key
}

// Titel → slug. De DB-CHECK eist ^[a-z0-9][a-z0-9-]{1,60}$.
export function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 61)
}

export function useOrgSkills() {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('org_skills').select(SELECT)
      .order('sort_order', { ascending: true }).order('title', { ascending: true })
    if (err) { setError(err.message); setSkills([]) }
    else { setError(null); setSkills(data || []) }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const save = useCallback(async (draft) => {
    const { data: { user } } = await supabase.auth.getUser()
    const row = {
      slug:         draft.slug || slugify(draft.title),
      title:        (draft.title || '').trim(),
      category:     draft.category || 'pijplijn',
      body:         (draft.body || '').trim(),
      tool_binding: draft.tool_binding ? draft.tool_binding : null,
      active:       draft.active !== false,
      sort_order:   Number.isFinite(+draft.sort_order) ? +draft.sort_order : 100,
      updated_by:   user?.id ?? null,
    }
    const res = draft.id
      ? await supabase.from('org_skills').update(row).eq('id', draft.id)
      : await supabase.from('org_skills').insert({ ...row, created_by: user?.id ?? null })
    if (res.error) return { ok: false, error: res.error.message }
    await refresh()
    return { ok: true }
  }, [refresh])

  const toggleActive = useCallback(async (skill) => {
    const { error: err } = await supabase.from('org_skills')
      .update({ active: !skill.active }).eq('id', skill.id)
    if (err) return { ok: false, error: err.message }
    await refresh()
    return { ok: true }
  }, [refresh])

  const remove = useCallback(async (id) => {
    const { error: err } = await supabase.from('org_skills').delete().eq('id', id)
    if (err) return { ok: false, error: err.message }
    await refresh()
    return { ok: true }
  }, [refresh])

  const stats = useMemo(() => ({
    total:  skills.length,
    active: skills.filter(s => s.active).length,
    bound:  skills.filter(s => s.active && s.tool_binding).length,
  }), [skills])

  return { skills, loading, error, refresh, save, toggleActive, remove, stats }
}

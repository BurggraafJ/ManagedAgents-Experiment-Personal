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
// supabase/functions/rag-chat/agentic.ts → toolSchemas(): de acht Motor A-RPC's
// uit TOOL_CATALOG (analytics.ts) plus de acht zoek-tools. Een lege binding =
// algemene kennis.
//
// 04 PR-A/H4 — hier stonden er dertien, en de comment sprak nog van "de vijf
// zoek-tools". Sinds v1.141/v1.145 bestaan `my_mail_search`,
// `confluence_search` en `confluence_get_page` ook; wat de dropdown niet noemt,
// kan Jelle niet binden, en dan is een regel over de wiki of over zijn eigen
// mailbox alleen als algemene kennis te schrijven. `my_mail_search` wordt
// alleen aangeboden aan een vrager mét gespiegelde mailbox — een regel eraan
// hangen mag, hij landt dan simpelweg niet bij wie die spiegel niet heeft.
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
  { key: 'confluence_search',    label: 'confluence_search · wiki zoeken' },
  { key: 'confluence_get_page',  label: 'confluence_get_page · wiki-pagina lezen' },
  { key: 'customer_timeline',    label: 'customer_timeline · klant-tijdlijn' },
  { key: 'mail_evidence_search', label: 'mail_evidence_search · mailarchief' },
  { key: 'my_mail_search',       label: 'my_mail_search · eigen mailbox' },
]

// Hoeveel van een body de vragenbak werkelijk meeneemt. rag-chat kapt elke
// body af op MAX_BODY_CHARS in supabase/functions/rag-chat/org-skills.ts; de
// DB-CHECK staat 8000 toe, dus alles daarboven wordt wél opgeslagen maar nooit
// aan het model getoond. Beide getallen moeten gelijk blijven lopen.
export const SKILL_BODY_INJECTION_CAP = 1200

// En hoeveel de hele set samen mag zijn. Naast de cap per regel geldt sinds
// 04a een budget over álle actieve regels heen (MAX_SET_CHARS in
// org-skills.ts): het blok gaat bij élke vraag volledig mee, dus zonder deze
// grens groeit elke prompt mee met de skill-lijst. Wat er buiten valt, valt op
// regelgrens weg en wordt geteld in `debug_pipeline.org_skills_truncated_n` —
// de cap mag stil zijn, het afkappen niet.
export const SKILL_SET_INJECTION_CAP = 6000

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

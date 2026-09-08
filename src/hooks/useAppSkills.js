import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// useAppSkills — CRUD op public.app_skills: de WERKWIJZEN die de vragenbak in
// drie trappen aanbiedt (titel altijd · beschrijving op de agent-route · body
// alleen na skill_open). Zusje van useOrgSkills, andere tabel, ander doel:
//
//   org_skills  — "dit is hoe wij het noemen": korte definities, org-breed, en
//                 elke actieve regel gaat integraal mee in élke vraag.
//   app_skills  — "dit is hoe wij het doen": een werkwijze van duizenden tekens
//                 die pas volledig meekomt als het model hem opvraagt.
//
// Schrijven mag alleen admin/owner (RLS app_skills_admin_write →
// is_admin_or_higher(), dus ook een geldige MFA-sessie). Lezen: een beheerder
// ziet alles, een gewone gebruiker precies wat er bij hém in de prompt komt —
// via hetzelfde predicaat als de chat (app_skills_visible), zodat editor en
// chat niet uit elkaar kunnen lopen.
//
// Geen realtime-channel: dit is een beheerpagina die één gebruiker tegelijk
// bewerkt; refresh() na elke mutatie. (En zie CLAUDE.md: een vaste channel-naam
// die twee keer mount crasht de pagina.)
//
// v1.156 (04 PR-B): nieuw.

const SELECT = 'id, slug, version, title, description, body, triggers, scope, scope_user_id, scope_role, tool_binding, active, sort_order, created_at, updated_at'

export const SKILL_SCOPES = [
  { key: 'org',  label: 'Iedereen',   hint: 'Elke gebruiker ziet de titel. Staat in het gedeelde deel van de prompt.' },
  { key: 'user', label: 'Eén persoon', hint: 'Alleen deze gebruiker ziet hem — en alleen in zijn eigen gesprekken.' },
  { key: 'role', label: 'Eén rol',    hint: 'Alleen wie deze rol heeft. Met twee rollen is dat vandaag een tweedeling.' },
]

export const SKILL_ROLES = [
  { key: 'owner',  label: 'Owner' },
  { key: 'member', label: 'Member' },
]

export function scopeLabel(skill) {
  if (skill?.scope === 'user') return 'Eén persoon'
  if (skill?.scope === 'role') return `Rol: ${skill.scope_role || '?'}`
  return 'Iedereen'
}

// Wat er van een titel, beschrijving en body werkelijk bij het model komt.
// Deze drie getallen zijn geen UI-smaak: ze staan één-op-één in
// supabase/functions/rag-chat/app-skills.ts en in de DB-CHECK's. Wijzigt daar
// iets, dan wijzigt het hier mee — anders belooft de editor iets anders dan de
// chat doet.
export const APP_SKILL_TITLE_CAP = 120
export const APP_SKILL_DESCRIPTION_CAP = 500
// De DB bewaart tot 20.000 tekens; het model leest de eerste 6.000. Dat is geen
// willekeurig getal: een toolresultaat in de agent-lus wordt op 7.000 tekens
// afgekapt (MAX_TOOL_RESULT_CHARS in agentic.ts), en dát afkappen gebeurt midden
// in de JSON. Daarom kapt de chat zelf af, op regelgrens, en meldt hoeveel er
// wegviel.
export const APP_SKILL_BODY_STORE_CAP = 20000
export const APP_SKILL_BODY_INJECTION_CAP = 6000
// Boven dit aantal zichtbare werkwijzen kapt de chat de titellijst af (op
// skill-grens, geteld in debug_pipeline.app_skills_truncated).
export const APP_SKILL_SET_CAP = 40

// Titel → slug. Zelfde DB-CHECK als org_skills: ^[a-z0-9][a-z0-9-]{1,60}$.
export function slugifySkill(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 61)
}

// `triggers` is een text[] in de DB en een komma-lijst in het formulier.
export function parseTriggers(text) {
  return String(text || '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length >= 3)
    .slice(0, 12)
}
export const triggersToText = (arr) => (Array.isArray(arr) ? arr.join(', ') : '')

export function useAppSkills() {
  const [skills, setSkills] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [{ data, error: err }, roles] = await Promise.all([
      supabase.from('app_skills').select(SELECT)
        .order('sort_order', { ascending: true }).order('title', { ascending: true }),
      // Wie kun je een persoonlijke werkwijze geven? user_roles is de enige
      // lijst die de browser mag lezen; auth.users mag hij niet.
      supabase.from('user_roles').select('user_id, app_role, display_name').order('created_at'),
    ])
    if (err) { setError(err.message); setSkills([]) }
    else { setError(null); setSkills(data || []) }
    setUsers(roles.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const save = useCallback(async (draft) => {
    const { data: { user } } = await supabase.auth.getUser()
    const scope = ['org', 'user', 'role'].includes(draft.scope) ? draft.scope : 'org'
    const row = {
      slug:          draft.slug || slugifySkill(draft.title),
      title:         (draft.title || '').trim(),
      description:   (draft.description || '').trim(),
      body:          (draft.body || '').trim(),
      triggers:      Array.isArray(draft.triggers) ? draft.triggers : parseTriggers(draft.triggers),
      scope,
      // De CHECK app_skills_scope_shape_chk eist dat precies één van de twee
      // gevuld is; hier één plek waar dat gebeurt in plaats van drie in de UI.
      scope_user_id: scope === 'user' ? (draft.scope_user_id || null) : null,
      scope_role:    scope === 'role' ? (draft.scope_role || 'member') : null,
      tool_binding:  draft.tool_binding ? draft.tool_binding : null,
      active:        draft.active !== false,
      sort_order:    Number.isFinite(+draft.sort_order) ? +draft.sort_order : 100,
      updated_by:    user?.id ?? null,
    }
    // `version` staat er bewust NIET bij: die is afgeleid (trigger
    // app_skills_bump) en een client-waarde wordt overschreven.
    const res = draft.id
      ? await supabase.from('app_skills').update(row).eq('id', draft.id)
      : await supabase.from('app_skills').insert({ ...row, created_by: user?.id ?? null })
    if (res.error) return { ok: false, error: res.error.message }
    await refresh()
    return { ok: true }
  }, [refresh])

  const toggleActive = useCallback(async (skill) => {
    const { error: err } = await supabase.from('app_skills')
      .update({ active: !skill.active }).eq('id', skill.id)
    if (err) return { ok: false, error: err.message }
    await refresh()
    return { ok: true }
  }, [refresh])

  const remove = useCallback(async (id) => {
    const { error: err } = await supabase.from('app_skills').delete().eq('id', id)
    if (err) return { ok: false, error: err.message }
    await refresh()
    return { ok: true }
  }, [refresh])

  const stats = useMemo(() => {
    const actief = skills.filter(s => s.active)
    // Wat er bij ELKE vraag meegaat is de titelregel van de org-brede skills.
    // Dat is het getal dat de pagina eerlijk moet noemen — niet de som van alle
    // bodies, want die komen alleen na een skill_open mee.
    const titelTekens = actief.filter(s => s.scope === 'org')
      .reduce((n, s) => n + (s.slug || '').length + (s.title || '').length + 4, 0)
    return {
      total: skills.length,
      active: actief.length,
      persoonlijk: actief.filter(s => s.scope !== 'org').length,
      titelTekens,
      overSetCap: Math.max(0, actief.length - APP_SKILL_SET_CAP),
    }
  }, [skills])

  return { skills, users, loading, error, refresh, save, toggleActive, remove, stats }
}

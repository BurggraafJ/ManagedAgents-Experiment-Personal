-- =============================================================================
-- agent_chat_run_state.app_skills — één set per RUN, niet per hop  (04 PR-B)
-- =============================================================================
-- D04-13. `run.ts` laadt de skills lazy per hop. Sinds spoor 02 kan een run over
-- meerdere hops liggen: de agent-lus in hop 1-2, het antwoord in hop 3. Bewerkt
-- Jelle in die minuut een werkwijze, dan onderzoekt de agent met de oude set en
-- schrijft het model met de nieuwe — een verschil dat niemand kan zien en dat
-- niet te reproduceren is.
--
-- Daarom: hop 1 laadt de zichtbare set (titels, beschrijvingen, triggers) plus
-- de etag en schrijft die hier weg; elke volgende hop leest hem hier. De etag
-- maakt een cache-miss uitlegbaar ("de set veranderde om 14:02") in plaats van
-- een raadsel.
--
-- Waarom een eigen kolom en niet in `dbg`: `dbg` landt integraal in
-- `agent_chat_runs.meta.debug_pipeline` en dus in de browser. Alleen de tellers
-- en de etag horen daar; de beschrijvingen (tot 6.000 tekens) zijn werkmateriaal
-- van de keten. `agent_chat_run_state` wordt na afloop opgeruimd, `meta` niet.
-- =============================================================================

alter table public.agent_chat_run_state
  add column if not exists app_skills jsonb;

comment on column public.agent_chat_run_state.app_skills is
  'De voor deze aanroeper zichtbare app_skills-set van hop 1 ({skills, etag, truncated}), zodat elke hop van dezelfde run met dezelfde set werkt (D04-13). Null = nog niet geladen of geen enkele zichtbare skill.';

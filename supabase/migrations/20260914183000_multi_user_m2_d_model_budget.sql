-- =============================================================================
-- Multi-user M2 · d — het plafond van €50 wordt een rem
-- =============================================================================
-- Hoort bij beslissing 5 (2026-09-14: "ja, default €50/maand per member"),
-- P0-IMPL-NOTES.md §Restrisico 2 ("het plafond wordt nergens afgedwongen") en
-- MATRIX-POLISH-NOTES.md §A3 ("het plafond blijft een afspraak, geen rem").
--
-- ── Het probleem was niet de rem, het was de meter ──────────────────────────
--
-- `user_model_budget` bestond al en stond op €50. Wat ontbrak was een getal om
-- hem tegenaan te houden. Vandaag is er precies één meetbare post per persoon:
-- de chat (`rag_chat_query_log` → `agent_chat_runs.caller_user_id`). De zes
-- Edge Functions die óók een betaald model aanroepen — taalcheck-v2,
-- mail-taalcheck, mail-verbeteraar, auto-draft-spelcheck, kb-compose,
-- transcribe — schrijven nergens op wie ze aanriep. Een rem op een meter die
-- twee derde van het verbruik niet ziet is geen rem.
--
-- Daarom twee dingen tegelijk: een grootboek waar die zes in schrijven
-- (`model_usage_log`) en een rem die chat én grootboek optelt.
--
-- ⚠ `claude_api_calls` blijft wat het is: de Anthropic-specifieke telemetrie
-- uit de hard-rule in CLAUDE.md (kostenattributie, loop-detectie, replay). Hij
-- heeft geen `user_id`, loopt sinds 2026-05-19 niet meer vol, en wordt hier
-- NIET meegeteld — twee grootboeken die dezelfde call tellen is erger dan één
-- dat een gat heeft, want dan weet je niet meer welke klopt.
--
-- ── De munt, en waarom er toch geen koers verzonnen wordt ───────────────────
--
-- Het plafond staat in euro, de meting in dollar, en
-- `dash_parameters.model_budget_usd_per_eur` staat bewust op NULL — "een zelf
-- gekozen wisselkoers is een verzonnen getal in een scherm dat over geld gaat".
-- Dat blijft staan. De rem rekent zolang die leeg is met **€1 = $1**, en dat is
-- geen koers maar een regel: hij maakt het plafond strénger dan de
-- werkelijkheid (een euro is meer dan een dollar), dus je gaat er nooit
-- ongemerkt overheen. Zodra Jelle een koers invult met bron en peildatum
-- rekent de rem daarmee. Het scherm zegt welke van de twee geldt.
--
-- ── Wie wordt geremd ────────────────────────────────────────────────────────
--
-- De owner niet. Beslissing 5 zegt "per member", en een plafond dat de eigenaar
-- buiten zijn eigen product sluit is een self-lockout — dezelfde reflex als de
-- demote-beveiliging in EditUserModal. De owner wordt wél gemeten en op de
-- Usage-pagina getoond; hij heeft alleen geen slot.
--
-- Maestro (geen ingelogde gebruiker, `caller_user_id is null`) wordt hier ook
-- niet geremd: zijn plafond staat als `model_budget_maestro_eur` in
-- dash_parameters en hoort bij de cron-kant, niet bij een gebruikerssessie.
--
-- ── Waarom een trigger en geen wijziging in rag-chat ────────────────────────
--
-- De rem op de chat zit op de INSERT van `agent_chat_runs`: dat is de rij die
-- geld gaat kosten, dus hem weigeren weigert de uitgave. Het alternatief was
-- een regel in `rag-chat/index.ts`, en dat opent de hele pre-flight-batterij
-- van punt 8 op een keten die deze PR verder niet raakt (plus een deploy van
-- een zevendelige bundel vanaf een tak die nog niet gemerged is). De trigger
-- doet hetzelfde werk op de plek waar de uitgave ontstaat.
--
-- Drie uitzonderingen in de trigger, elk met een reden:
--   • `caller_user_id is null`  → Maestro/cron/scripts, zie hierboven
--   • `eval_run_id is not null` → een evalronde is een meting, geen verbruik
--                                 van een persoon; hem afknijpen maakt de
--                                 poort onbetrouwbaar in plaats van zuinig
--   • rol = owner               → zie hierboven
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   drop trigger agent_chat_runs_budget_guard on public.agent_chat_runs;
--   drop function public.agent_chat_runs_budget_guard();
--   drop function public.model_budget_state(uuid);
--   drop view public.v_user_model_usage_edge_month;
--   drop table public.model_usage_log;
-- =============================================================================

begin;

-- ── 1. Het grootboek ────────────────────────────────────────────────────────

create table if not exists public.model_usage_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  edge_function  text not null,
  provider       text not null check (provider in ('openai', 'anthropic', 'grok', 'cohere')),
  model          text,
  input_tokens   int,
  output_tokens  int,
  est_cost_usd   numeric(12, 6) not null default 0,
  ok             boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table public.model_usage_log is
  'Grootboek van betaalde model-calls die aan een PERSOON toe te schrijven zijn: de zes user-callable Edge Functions die een model aanroepen. Geen prompt, geen antwoord, geen mailinhoud — alleen wie, waar, welk model en wat het kostte. Telt samen met de chat op tot het maandverbruik in model_budget_state(). Bewust géén overlap met claude_api_calls (Anthropic-telemetrie, geen user_id): twee grootboeken die dezelfde call tellen maken beide onbetrouwbaar. Multi-user M2.';
comment on column public.model_usage_log.est_cost_usd is
  'Geschat, niet gefactureerd — zelfde soort getal als rag_chat_query_log.est_cost_usd. Nul bij een mislukte call die niets kostte.';

create index if not exists model_usage_log_user_maand_idx
  on public.model_usage_log (user_id, created_at desc);

alter table public.model_usage_log enable row level security;

drop policy if exists model_usage_log_self_or_owner on public.model_usage_log;
create policy model_usage_log_self_or_owner on public.model_usage_log
  for select to authenticated
  using ((select public.session_mfa_ok())
         and (user_id = (select auth.uid()) or (select public.is_admin_or_higher())));

drop policy if exists model_usage_log_service on public.model_usage_log;
create policy model_usage_log_service on public.model_usage_log
  for all to service_role using (true) with check (true);

grant select on public.model_usage_log to authenticated;

-- De maandview naast v_user_model_usage_month, zodat de Usage-pagina de twee
-- posten náást elkaar kan zetten in plaats van één opgeteld getal te tonen
-- waarvan niemand meer weet waar het vandaan komt.
create or replace view public.v_user_model_usage_edge_month
with (security_invoker = on) as
  select l.user_id,
         date_trunc('month', l.created_at)::date as maand,
         count(*)                                as calls,
         round(sum(l.est_cost_usd), 4)           as cost_usd,
         count(*) filter (where not l.ok)        as fouten
    from public.model_usage_log l
   group by 1, 2;

comment on view public.v_user_model_usage_edge_month is
  'Maandtotaal per persoon van de Edge-Function-model-calls. security_invoker = on: de RLS van model_usage_log doet het werk (eigen rijen, owner alles). Multi-user M2.';

grant select on public.v_user_model_usage_edge_month to authenticated;

-- ── 2. De stand ─────────────────────────────────────────────────────────────

create or replace function public.model_budget_state(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_uid       uuid;
  v_rol       text;
  v_cap_eur   numeric;
  v_paused    boolean;
  v_koers     numeric;
  v_chat      numeric;
  v_edge      numeric;
  v_maand     date := date_trunc('month', now())::date;
begin
  -- Zelfde tak als has_capability(): een browsersessie mag NOOIT namens een
  -- ander vragen. Alleen interne callers en de service-role geven p_user mee.
  v_uid := case
             when coalesce(auth.role(), '') in ('authenticated', 'anon') then (select auth.uid())
             else coalesce(p_user, (select auth.uid()))
           end;
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reden', 'geen_gebruiker');
  end if;

  select app_role into v_rol from public.user_roles where user_id = v_uid;
  if v_rol is null then
    -- Geen rol = geen bekend account. Fail closed, net als has_capability().
    return jsonb_build_object('ok', false, 'reden', 'geen_rol', 'over', true);
  end if;

  select coalesce(b.monthly_cap_eur, 50), coalesce(b.paused, false)
    into v_cap_eur, v_paused
    from (select 1) q
    left join public.user_model_budget b on b.user_id = v_uid;

  select waarde into v_koers from public.dash_parameters
   where sleutel = 'model_budget_usd_per_eur';

  select coalesce(round(sum(q.est_cost_usd), 6), 0) into v_chat
    from public.rag_chat_query_log q
    join public.agent_chat_runs r on r.id = q.run_id
   where r.caller_user_id = v_uid
     and r.eval_run_id is null
     and q.asked_at >= v_maand;

  select coalesce(round(sum(l.est_cost_usd), 6), 0) into v_edge
    from public.model_usage_log l
   where l.user_id = v_uid
     and l.created_at >= v_maand;

  return jsonb_build_object(
    'ok',            true,
    'user_id',       v_uid,
    'rol',           v_rol,
    'maand',         v_maand,
    'plafond_eur',   v_cap_eur,
    -- Zonder koers rekenen we €1 = $1: strenger dan de werkelijkheid, dus nooit
    -- een stille overschrijding. Met koers rekenen we ermee.
    'plafond_usd',   round(v_cap_eur * coalesce(v_koers, 1), 4),
    'koers',         v_koers,
    'koers_bron',    case when v_koers is null then 'geen koers vastgelegd — de rem rekent €1 = $1'
                          else 'dash_parameters.model_budget_usd_per_eur' end,
    'chat_usd',      v_chat,
    'edge_usd',      v_edge,
    'verbruik_usd',  v_chat + v_edge,
    'gepauzeerd',    v_paused,
    -- De owner wordt gemeten maar niet geremd (beslissing 5: "per member").
    'geremd',        v_rol <> 'owner',
    'over',          v_rol <> 'owner'
                     and (v_paused or (v_chat + v_edge) >= v_cap_eur * coalesce(v_koers, 1))
  );
end;
$$;

comment on function public.model_budget_state(uuid) is
  'De stand van het maandplafond voor één persoon: plafond, verbruik (chat + Edge Functions), en of hij over is. Een browsersessie krijgt altijd zijn eigen stand — de p_user-parameter geldt alleen voor interne callers en de service-role, zelfde tak als has_capability(). De owner krijgt `geremd: false`: hij wordt gemeten, niet geblokkeerd. Multi-user M2.';

revoke execute on function public.model_budget_state(uuid) from public;
grant  execute on function public.model_budget_state(uuid) to authenticated, service_role;

-- ── 3. De rem op de chat ────────────────────────────────────────────────────

create or replace function public.agent_chat_runs_budget_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_state jsonb;
begin
  -- Maestro (geen ingelogde gebruiker) en evalrondes vallen erbuiten; zie de
  -- kop van deze migratie voor de reden per uitzondering.
  if new.caller_user_id is null or new.eval_run_id is not null then
    return new;
  end if;

  v_state := public.model_budget_state(new.caller_user_id);

  if not coalesce((v_state ->> 'over')::boolean, false) then
    return new;
  end if;

  -- Twee redenen, twee zinnen. "Gepauzeerd" met een bedrag erachter leest als
  -- een overschrijding die er niet is; dan zoekt iemand naar de verkeerde fout.
  if coalesce((v_state ->> 'gepauzeerd')::boolean, false) then
    raise exception 'budget_exceeded: de owner heeft dit account op pauze gezet'
      using errcode = 'insufficient_privilege',
            hint    = 'de owner heft de pauze op bij Organisatie › Usage',
            detail  = v_state::text;
  end if;

  raise exception
    'budget_exceeded: maandplafond bereikt (% van % USD deze maand)',
    round(coalesce((v_state ->> 'verbruik_usd')::numeric, 0), 2),
    round(coalesce((v_state ->> 'plafond_usd')::numeric, 0), 2)
    using errcode  = 'insufficient_privilege',
          hint     = 'de owner kan het plafond verhogen bij Organisatie › Usage',
          detail   = v_state::text;

  return new;
end;
$$;

comment on function public.agent_chat_runs_budget_guard() is
  'Weigert een nieuwe chatvraag zodra de vrager over zijn maandplafond is. Op de INSERT, want dat is de rij die geld gaat kosten. Slaat Maestro (caller_user_id null), evalrondes (eval_run_id) en de owner over. Multi-user M2.';

drop trigger if exists agent_chat_runs_budget_guard on public.agent_chat_runs;
create trigger agent_chat_runs_budget_guard
  before insert on public.agent_chat_runs
  for each row execute function public.agent_chat_runs_budget_guard();

-- ── 4. De toelichting bij de koers klopt weer ───────────────────────────────

update public.dash_parameters
   set toelichting = 'NOG NIET VASTGELEGD, en dat mag blijven. Het plafond uit beslissing 5 staat in euro (€50/maand), de gemeten kosten in dollar. Zolang deze koers NULL is toont de Usage-pagina dollars en een lege plek waar de euro hoort, en rekent de REM met €1 = $1 — strenger dan de werkelijkheid, dus nooit een stille overschrijding. Vul je hier een koers in mét bron en peildatum, dan rekent de rem daarmee. Zie model_budget_state().',
       updated_at  = now()
 where sleutel = 'model_budget_usd_per_eur';

update public.dash_parameters
   set toelichting = 'Maandplafond voor Maestro zelf: de chatvragen zonder ingelogde gebruiker (cron, agents, scripts). Zelfde standaard als een persoon (€50), instelbaar op de Usage-pagina. Wordt bewust NIET afgedwongen: de rem van M2 zit op een gebruikerssessie, en Maestro heeft er geen. Dit getal is een signaal voor de owner, geen slot. In september 2026 stond hier $3,59 van de $4,98 tegenover.',
       updated_at  = now()
 where sleutel = 'model_budget_maestro_eur';

commit;

-- =============================================================================
-- Vragenbak v2 W3 (2026-07-07): query-logging voor agent-verbetering.
-- Elke vraag aan rag-chat (óók semantic) wordt gelogd: route, tool(s), rijen,
-- kosten, latency — de basis om router/tool-keuze in echt gebruik te reviewen
-- (naast rag-eval-cron voor synthetische kwaliteit). Native in Supabase,
-- zelfde telemetrie-filosofie als claude_api_calls; bewust GEEN LangFuse
-- (extern platform + nieuwe key + klant-mailcontent naar derden; tracing-
-- waarde wordt hier gedekt door tools_used/meta jsonb).
-- Schrijven: alleen service_role (rag-chat edge function, bypasst RLS).
-- Lezen: app-owner (zelfde patroon als rag_chat_feedback).
-- =============================================================================

create table if not exists public.rag_chat_query_log (
  id uuid primary key default gen_random_uuid(),
  asked_at timestamptz not null default now(),
  question text not null,
  gate_hit boolean,
  route text not null default 'semantic',       -- structured | sweep | agentic | semantic
  tool text,                                    -- Motor A-tool (structured) of null
  tools_used jsonb,                             -- agentic trace: [{tool,args,rows,ms}]
  rows_returned int,
  scanned_n int,
  entity jsonb,                                 -- gebruikte entity (type/naam/via) of null
  answer_model text,
  est_cost_usd numeric(8,4),                    -- analytics/agentic LLM-kosten (indicatief); excl. grok-antwoord
  latency_ms int,
  router_ms int,
  stream boolean,
  error text,
  answer_chars int,
  route_fallback text,                          -- bv. motor_null_to_semantic
  meta jsonb                                    -- debug_pipeline-subset / vrije uitbreiding
);

create index if not exists rag_chat_query_log_asked_at_idx on public.rag_chat_query_log (asked_at desc);
create index if not exists rag_chat_query_log_route_idx on public.rag_chat_query_log (route, asked_at desc);

alter table public.rag_chat_query_log enable row level security;
drop policy if exists rag_chat_query_log_read on public.rag_chat_query_log;
create policy rag_chat_query_log_read on public.rag_chat_query_log
  for select to authenticated using (is_app_owner());

-- Weekrapportage: route-verdeling, kosten, latency, nul-resultaten.
create or replace view public.rag_chat_query_stats_weekly
with (security_invoker = on) as
select date_trunc('week', asked_at)::date as week,
       count(*) as vragen,
       count(*) filter (where route = 'structured') as structured,
       count(*) filter (where route = 'sweep') as sweep,
       count(*) filter (where route = 'agentic') as agentic,
       count(*) filter (where route = 'semantic') as semantic,
       round(avg(latency_ms))::int as avg_latency_ms,
       round(sum(coalesce(est_cost_usd, 0))::numeric, 4) as est_cost_usd,
       count(*) filter (where error is not null) as errors,
       count(*) filter (where route <> 'semantic' and coalesce(rows_returned, 0) = 0 and error is null) as nul_resultaat
from public.rag_chat_query_log
group by 1 order by 1 desc;

-- Review-lijst "hoe richten we de agent beter in": vragen zonder goed antwoord.
create or replace view public.rag_chat_unanswered
with (security_invoker = on) as
select asked_at, question, route, tool, rows_returned, error, route_fallback
from public.rag_chat_query_log
where error is not null
   or route_fallback is not null
   or (route in ('structured', 'sweep', 'agentic') and coalesce(rows_returned, 0) = 0)
order by asked_at desc
limit 200;

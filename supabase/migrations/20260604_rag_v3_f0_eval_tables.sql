-- RAG v3 F.0: meetbaarheid. Eval-store voor reference-free RAG-metrics (faithfulness,
-- answer-relevance, context-precision) per gold-vraag per run. Baseline + before/after voor latere fases.
-- Live toegepast 2026-06-04 via Supabase MCP apply_migration. Baseline-runner: scripts/rag_eval_baseline.cjs.
create table if not exists public.rag_eval_runs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  context_build_version text,
  judge_model text,
  answer_model text,
  n_questions int default 0,
  avg_faithfulness numeric,
  avg_answer_relevance numeric,
  avg_context_precision numeric,
  notes text,
  created_at timestamptz default now()
);
create table if not exists public.rag_eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.rag_eval_runs(id) on delete cascade,
  question_id text,
  question text,
  dimension text,
  intent text,
  retrieval_strategy text,
  bundle_id uuid,
  n_chunks int,
  answer text,
  faithfulness numeric,
  answer_relevance numeric,
  context_precision numeric,
  judge_notes text,
  created_at timestamptz default now()
);
create index if not exists idx_rag_eval_results_run on public.rag_eval_results(run_id);
alter table public.rag_eval_runs enable row level security;
alter table public.rag_eval_results enable row level security;
create policy rag_eval_runs_auth_read on public.rag_eval_runs for select to authenticated using (true);
create policy rag_eval_results_auth_read on public.rag_eval_results for select to authenticated using (true);
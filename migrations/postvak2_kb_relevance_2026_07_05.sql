-- Toegepast via Supabase MCP als migration 20260705100738 (postvak2_kb_relevance).
-- Postvak variant 2 — kennisbank-relevantie per mail.
-- Kolommen op autodraft_mails + één RPC die zowel dashboard (authenticated)
-- als de auto-draft skill (service_role) gebruikt.

alter table public.autodraft_mails
  add column if not exists kb_matches jsonb,
  add column if not exists kb_matches_at timestamptz;

create or replace function public.get_mail_kb_matches(
  p_mail_id text,
  p_refresh boolean default false,
  p_top int default 5
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_emb halfvec(3072);
  v_matches jsonb;
  v_stored jsonb;
  v_stored_at timestamptz;
begin
  perform require_dashboard_auth();

  select kb_matches, kb_matches_at into v_stored, v_stored_at
  from autodraft_mails where mail_id = p_mail_id
  order by scanned_at desc nulls last limit 1;

  if not p_refresh and v_stored is not null then
    return jsonb_build_object('ok', true, 'source', 'stored',
      'computed_at', v_stored_at, 'matches', v_stored);
  end if;

  select embedding into v_emb
  from chunks
  where source = 'mail' and source_id = p_mail_id and embedding is not null
  order by (chunk_type = 'message') desc, sequence nulls first
  limit 1;

  if v_emb is null then
    return jsonb_build_object('ok', false, 'reason', 'not_chunked',
      'matches', coalesce(v_stored, '[]'::jsonb));
  end if;

  select coalesce(jsonb_agg(m order by m.score desc), '[]'::jsonb)
  into v_matches
  from (
    select a.id, a.article_no, a.title, a.summary, a.kb_category,
           a.article_type, a.audience,
           round((1 - (a.embedding <=> v_emb))::numeric, 3) as score
    from kb_articles a
    where a.embedding is not null
      and a.status in ('gevalideerd', 'gepubliceerd')
    order by a.embedding <=> v_emb
    limit greatest(1, least(coalesce(p_top, 5), 10))
  ) m;

  update autodraft_mails
  set kb_matches = v_matches, kb_matches_at = now()
  where mail_id = p_mail_id;

  return jsonb_build_object('ok', true, 'source', 'live',
    'computed_at', now(), 'matches', v_matches);
end;
$$;

grant execute on function public.get_mail_kb_matches(text, boolean, int) to authenticated, service_role;

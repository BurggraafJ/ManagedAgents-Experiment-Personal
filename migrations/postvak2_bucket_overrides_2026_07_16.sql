-- Toegepast via Supabase MCP als migration postvak2_bucket_overrides.
-- Handmatig Prioriteit/Overige verplaatsen in Postvak variant 2; wint van de
-- AI-audience. Outlook's inferenceClassification syncen = latere mail-sync-
-- uitbreiding.
create table if not exists public.postvak_bucket_overrides (
  mail_id text primary key,
  user_id uuid not null default auth.uid(),
  bucket text not null check (bucket in ('prio', 'overig')),
  created_at timestamptz not null default now()
);
alter table public.postvak_bucket_overrides enable row level security;
drop policy if exists postvak_bucket_service on public.postvak_bucket_overrides;
create policy postvak_bucket_service on public.postvak_bucket_overrides
  for all to service_role using (true) with check (true);
drop policy if exists postvak_bucket_own on public.postvak_bucket_overrides;
create policy postvak_bucket_own on public.postvak_bucket_overrides
  for select to authenticated using (user_id = auth.uid());
create or replace function public.set_mail_bucket(p_mail_id text, p_bucket text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_catalog' as $$
begin
  perform require_dashboard_auth();
  if p_mail_id is null or length(p_mail_id) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing mail_id');
  end if;
  if p_bucket is null then
    delete from postvak_bucket_overrides where mail_id = p_mail_id and user_id = auth.uid();
    return jsonb_build_object('ok', true, 'bucket', null);
  end if;
  if p_bucket not in ('prio', 'overig') then
    return jsonb_build_object('ok', false, 'reason', 'bucket must be prio|overig');
  end if;
  insert into postvak_bucket_overrides (mail_id, user_id, bucket)
  values (p_mail_id, auth.uid(), p_bucket)
  on conflict (mail_id) do update
    set bucket = excluded.bucket, user_id = excluded.user_id;
  return jsonb_build_object('ok', true, 'bucket', p_bucket);
end; $$;
grant execute on function public.set_mail_bucket(text, text) to authenticated, service_role;

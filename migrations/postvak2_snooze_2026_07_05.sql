-- Toegepast via Supabase MCP als migration 20260705100741 (postvak2_snooze).
-- Postvak variant 2 — "Stel uit" (snooze).

create table if not exists public.postvak_snoozes (
  mail_id text primary key,
  user_id uuid not null default auth.uid(),
  snoozed_until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.postvak_snoozes enable row level security;

drop policy if exists postvak_snoozes_service on public.postvak_snoozes;
create policy postvak_snoozes_service on public.postvak_snoozes
  for all to service_role using (true) with check (true);

drop policy if exists postvak_snoozes_own on public.postvak_snoozes;
create policy postvak_snoozes_own on public.postvak_snoozes
  for select to authenticated using (user_id = auth.uid());

create or replace function public.set_mail_snooze(
  p_mail_id text,
  p_until timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  perform require_dashboard_auth();
  if p_mail_id is null or length(p_mail_id) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing mail_id');
  end if;
  if p_until is null then
    delete from postvak_snoozes where mail_id = p_mail_id and user_id = auth.uid();
    return jsonb_build_object('ok', true, 'snoozed', false);
  end if;
  insert into postvak_snoozes (mail_id, user_id, snoozed_until)
  values (p_mail_id, auth.uid(), p_until)
  on conflict (mail_id) do update
    set snoozed_until = excluded.snoozed_until, user_id = excluded.user_id;
  return jsonb_build_object('ok', true, 'snoozed', true, 'until', p_until);
end;
$$;

grant execute on function public.set_mail_snooze(text, timestamptz) to authenticated, service_role;

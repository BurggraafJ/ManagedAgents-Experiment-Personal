-- Outlook per-user MIRROR — chat leest de verrijkte spiegel, niet live Graph.
--
-- Twee onderdelen:
--
--   1. rag_search_my_mail() — de mirror-tool voor rag-chat. Vervangt de LIVE
--      Composio-tool `outlook_mail_search`: zelfde vraag ("zoek in mijn eigen
--      mailbox"), maar bediend uit `mail_messages` + `mail_enrichment`. Dus
--      alleen wat de ETL al gespiegeld en de enricher al verrijkt heeft.
--
--   2. cron `mail-backfill-seed-new-accounts` — sluit het gat waardoor een
--      nieuw gespiegeld account wél vooruit synct maar geen HISTORIE krijgt.
--      `mail-backfill` consumeert `mail_backfill_state`-buckets; niets zaaide
--      ze. `seed_mail_backfill_buckets()` bestond al en is idempotent, maar
--      werd door geen enkele job aangeroepen.
--
-- Zie /workspace/security/MIRROR-VERDICT.md voor de meting waarop dit rust.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. rag_search_my_mail — persoonlijke mailbox uit de spiegel
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `p_keywords_regex` is dezelfde vorm die `analytics_sweep_evidence` gebruikt,
-- zodat rag-chat z'n bestaande sanitizeKeywordsToRegex() kan hergebruiken en er
-- geen tweede manier ontstaat om keywords aan te leveren.
--
-- Ordening is puur op recentheid, niet op relevantie-score. Een mailbox-vraag
-- gaat vrijwel altijd over de laatste mail die matcht, en het maakt de uitkomst
-- voorspelbaar voor de agent (die zelf beoordeelt of een treffer bewijs is).
--
-- SECURITY DEFINER met een EXPLICIETE p_user_id, en execute ALLEEN voor
-- service_role: rag-chat draait op de service-role-client en leidt de eigenaar
-- af uit de door de gateway gevalideerde JWT (`sub`). Zou `authenticated`
-- execute krijgen, dan kon iedere ingelogde gebruiker een andere uuid
-- meegeven en zo een collega's mailbox lezen.
create or replace function public.rag_search_my_mail(
  p_user_id        uuid,
  p_keywords_regex text   default null,
  p_from_email     text   default null,
  p_since          date   default null,
  p_topics         text[] default null,
  p_limit          integer default 10
)
returns table (
  mail_id          text,
  received_at      timestamptz,
  direction        text,
  from_email       text,
  from_name        text,
  subject          text,
  folder_path      text,
  has_attachments  boolean,
  snippet          text,
  summary_one_line text,
  topics           text[],
  party_type       text,
  urgency          text,
  asks_response    boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    m.id,
    m.received_at,
    case when m.is_from_me then 'verzonden' else 'ontvangen' end,
    m.from_email,
    m.from_name,
    m.subject,
    m.folder_path,
    m.has_attachments,
    -- De verrijkte samenvatting eerst: die is al ontdaan van quote-staarten en
    -- disclaimers. Valt terug op de Graph-preview als de enricher nog niet
    -- langs is geweest (dan is de mail wél gespiegeld, maar nog niet verrijkt).
    left(regexp_replace(
           coalesce(nullif(e.summary_paragraph, ''), m.body_preview, ''),
           '\s+', ' ', 'g'), 400),
    e.summary_one_line,
    e.topics,
    e.party_type,
    e.urgency,
    e.asks_response
  from public.mail_messages m
  left join public.mail_enrichment e
         on e.mail_id = m.id
        and e.user_id = m.user_id
  where p_user_id is not null
    and m.user_id = p_user_id
    and m.is_deleted = false
    and coalesce(m.is_draft, false) = false
    and (p_since is null or m.received_at >= p_since::timestamptz)
    and (p_from_email is null or m.from_email ilike '%' || p_from_email || '%')
    and (p_topics is null or e.topics && p_topics)
    and (
      p_keywords_regex is null
      or m.subject           ~* p_keywords_regex
      or m.body_preview      ~* p_keywords_regex
      or m.from_name         ~* p_keywords_regex
      or m.from_email        ~* p_keywords_regex
      or e.summary_one_line  ~* p_keywords_regex
      or e.summary_paragraph ~* p_keywords_regex
    )
  order by m.received_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 40));
$function$;

comment on function public.rag_search_my_mail(uuid, text, text, date, text[], integer) is
  'Mirror-zoektool voor rag-chat: persoonlijke mailbox uit mail_messages + mail_enrichment, '
  'gescopeerd op één user_id. Vervangt de live Composio-tool outlook_mail_search. '
  'service_role only — p_user_id komt uit de gevalideerde JWT, niet uit de request-body.';

revoke all on function public.rag_search_my_mail(uuid, text, text, date, text[], integer) from public;
revoke all on function public.rag_search_my_mail(uuid, text, text, date, text[], integer) from anon;
revoke all on function public.rag_search_my_mail(uuid, text, text, date, text[], integer) from authenticated;
grant execute on function public.rag_search_my_mail(uuid, text, text, date, text[], integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Historie-zaai voor nieuw gespiegelde accounts
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Voorwaarde-voor-voorwaarde:
--   enabled/not paused        → een gepauzeerde mailbox hoort niets te starten
--   mail_folders bestaat      → mail-sync-etl-v2 is minstens één keer geweest,
--                               dus seed_mail_backfill_buckets() kán folders zien
--   geen mail_backfill_state  → dit is een VERS account. Zodra er één bucket
--                               staat vuurt deze job voor die user nooit meer,
--                               dus hij herstart geen afgeronde backfill.
do $$
begin
  perform cron.unschedule('mail-backfill-seed-new-accounts');
exception when others then null;   -- bestond nog niet
end $$;

select cron.schedule(
  'mail-backfill-seed-new-accounts',
  '9,39 * * * *',
  $cron$
  select public.seed_mail_backfill_buckets(a.user_id)
    from public.mail_accounts a
   where a.enabled
     and not a.paused
     and exists (select 1 from public.mail_folders f where f.user_id = a.user_id)
     and not exists (select 1 from public.mail_backfill_state b where b.user_id = a.user_id)
  $cron$
);

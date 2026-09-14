-- =============================================================================
-- Multi-user · de rechten-catalogus leaner + Maestro in Usage        (v1.192)
-- =============================================================================
-- Vervolg op 20260914143000 (de catalogus) en 20260914145000 (de Usage-views),
-- na Jelle's doorkijk op v1.191 — MATRIX-POLISH-PLAN.md, 2026-09-14.
--
-- ── Deel 1 · de catalogus herindelen ────────────────────────────────────────
-- De eerste indeling volgde de drie assen uit het onderzoek (module · data ·
-- handeling). Dat is een goede ontwerpindeling en een slechte leesindeling: je
-- zoekt "mag Julia bij de administratie" en moet dan in twee groepen kijken —
-- de module in Stuurinformatie, het data-bereik in Bereik. Vijf groepen die
-- volgen waar iets in het PRODUCT zit lezen sneller. De `soort`-kolom blijft
-- staan; die was de as en blijft de as.
--
--   Basisrechten        wat iedereen krijgt — modules én de handelingen die
--                       erbij horen (mailbesluit, betaalde model-calls)
--   Dashboards          per bord één recht (beslissing: per-dashboard blijft)
--   Eigen gegevens      het bereik dat over de persoon zelf gaat
--   Organisatie         het owner-portaal, Platform inbegrepen
--   API keys en secrets de sleutelzone, apart van de rest
--
-- ── Deel 2 · drie rijen eruit ───────────────────────────────────────────────
--   legalai            /organisatie/legalai staat niet eens in de nav (lock 20)
--                      en heeft geen member-verhaal. Een recht dat niemand ooit
--                      uitdeelt is ruis in een matrix die over uitdelen gaat.
--   gebruikers.beheren dubbel met `organisatie.gebruikers`, en de twee spraken
--                      elkaar tegen: de een grantable=false ("nooit"), de ander
--                      zit in de Organisatie-bundel ("mag met één vinkje").
--                      Beslissing 3 zet gebruikersbeheer niet in de harde
--                      owner-only lijst (dat zijn platform, API keys, secrets),
--                      dus de bundel-rij wint en deze verdwijnt.
--   data.mail.collega  "Niet ontworpen, niet gebouwd, niet uit te delen" — een
--                      rij over een functie die niet bestaat. Terugzetten is
--                      één insert; zie het blok onderaan.
--
-- Geen enkel UITDEELBAAR recht verdwijnt: de vier Handelingen-rijen die wel
-- iets betekenen (agents starten, agent-instructies, mailbesluit, model-calls)
-- verhuizen naar de groep waar ze thuishoren. De groep zelf is weg, de rechten
-- niet.
--
-- ── Deel 3 · Maestro in Usage ───────────────────────────────────────────────
-- `v_model_usage_dekking` gaf tot nu toe twee getallen: totaal en toegewezen.
-- Het verschil was één hoop "de rest". Gemeten op 2026-09-14 zit daar een
-- scherpe grens in, en rag-chat schrijft hem zelf op in `meta.caller_identified`:
--
--   september 2026, 311 vragen, $4,9835
--     37   $0,6573  aan een persoon toegewezen
--    233   $3,5934  caller_identified is niet true → geen ingelogde gebruiker:
--                   cron, agents, scripts. Dat is Maestro zelf. (220 zeggen
--                   expliciet false; 13 oude rijen schreven de vlag nog niet op
--                   en tellen hier mee — "niet opgeschreven" is ook "niet
--                   herkend".)
--     41   $0,7328  caller_identified = true maar geen agent_chat_runs-rij met
--                   caller — herkend en niet vastgelegd. Een MEETGAT, geen mens
--                   en geen Maestro.
--
-- Die derde regel is de reden dat de view hem apart telt in plaats van hem bij
-- Maestro op te tellen: een meetgat dat je als verbruik van iemand presenteert
-- is precies de nep-nul waar de Usage-pagina omheen is gebouwd.
--
-- ── Deel 4 · de doorkijk per persoon ────────────────────────────────────────
-- `v_user_model_usage_detail` — de vragen zelf, niet alleen het totaal. Zelfde
-- guard-patroon en dus dezelfde uitzonderingsregel in multi_user_acl_eval.cjs.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   drop view public.v_user_model_usage_detail;
--   de dekking-view terug naar de vier kolommen uit 20260914145000;
--   de drie geschrapte rijen terug met de insert uit 20260914143000;
--   groep/sort_order terug: die stonden in 20260914143000 regel 99-141.
-- =============================================================================

begin;

-- ── 1. Herindelen ───────────────────────────────────────────────────────────
-- Eén update, alle 33 blijvende rijen, zodat de nieuwe volgorde in één oogopslag
-- te lezen is en niet uit dertig losse statements moet worden gereconstrueerd.
update public.capabilities c
   set groep = n.groep, sort_order = n.sort_order
  from (values
    -- Basisrechten — de groep die OPEN staat in de matrix, omdat Kennisbank
    -- beheren en Administratie er onder constructie in zitten.
    ('home',                  'Basisrechten',        110),
    ('analyse',               'Basisrechten',        120),
    ('postvak',               'Basisrechten',        130),
    ('agenda',                'Basisrechten',        140),
    ('taken',                 'Basisrechten',        150),
    ('instellingen.eigen',    'Basisrechten',        160),
    ('mail.versturen',        'Basisrechten',        170),
    ('modellen.gebruiken',    'Basisrechten',        180),
    ('kennisbank.lezen',      'Basisrechten',        190),
    ('kennisbank.beheren',    'Basisrechten',        191),
    ('administratie',         'Basisrechten',        195),
    ('data.crm.lezen',        'Basisrechten',        196),
    ('data.crm.schrijven',    'Basisrechten',        197),
    -- Dashboards — per bord één recht; Legal AI hoort hier niet (zie deel 2).
    ('pipeline',              'Dashboards',          210),
    ('datakwaliteit',         'Dashboards',          220),
    ('klantverlies',          'Dashboards',          230),
    ('kwartaaldiagnose',      'Dashboards',          240),
    ('klantbase',             'Dashboards',          250),
    -- Eigen gegevens — het bereik dat over de persoon zelf gaat. Alle drie
    -- leveren vandaag écht iets; daarom staat de groep dicht.
    ('data.mail.eigen',       'Eigen gegevens',      310),
    ('data.agenda.eigen',     'Eigen gegevens',      320),
    ('data.confluence.spaces','Eigen gegevens',      330),
    -- Organisatie, Platform inbegrepen (Jelle 2026-09-14). De vijf bundelleden
    -- eerst, dan wat er per stuk bij hoort.
    ('organisatie.gebruikers','Organisatie',         410),
    ('organisatie.health',    'Organisatie',         420),
    ('organisatie.security',  'Organisatie',         430),
    ('organisatie.skills',    'Organisatie',         440),
    ('organisatie.pijplijn',  'Organisatie',         450),
    ('instellingen.beheer',   'Organisatie',         460),
    ('agent.uitvoeren',       'Organisatie',         470),
    ('agent.instructies',     'Organisatie',         480),
    ('data.telemetrie',       'Organisatie',         490),
    ('organisatie.platform',  'Organisatie',         495),
    -- De sleutelzone apart — niet uit te delen, en dat mag je zien.
    ('organisatie.apikeys',   'API keys en secrets', 510),
    ('secrets.beheren',       'API keys en secrets', 520)
  ) as n(key, groep, sort_order)
 where c.key = n.key;

-- Twee omschrijvingen die na de verhuizing niet meer klopten.
update public.capabilities
   set omschrijving = 'Agents, terminologie, templates, externe partijen — de beheerkant van Instellingen.'
 where key = 'instellingen.beheer';
update public.capabilities
   set omschrijving = 'Taalcheck, transcribe, kb-compose, chat. Het verbruik staat op de Usage-pagina.'
 where key = 'modellen.gebruiken';

-- ── 2. Drie rijen eruit ─────────────────────────────────────────────────────
-- role_capabilities en user_capabilities hangen met on delete cascade mee.
delete from public.capabilities
 where key in ('legalai', 'gebruikers.beheren', 'data.mail.collega');

-- ── 3. Dekking: Maestro en het meetgat apart ────────────────────────────────
drop view if exists public.v_model_usage_dekking;
create view public.v_model_usage_dekking as
  select date_trunc('month', q.asked_at)::date                            as maand,
         count(*)                                                         as vragen_totaal,
         count(*) filter (where r.caller_user_id is not null)             as vragen_toegewezen,
         round(sum(q.est_cost_usd)::numeric, 4)                           as usd_totaal,
         round(sum(q.est_cost_usd) filter (where r.caller_user_id is not null)::numeric, 4) as usd_toegewezen,
         -- Maestro zelf: rag-chat zag geen ingelogde gebruiker. Cron, agents,
         -- scripts. `caller_identified` ontbreekt op de oudste rijen; die
         -- tellen daar mee, want "niet opgeschreven" is ook "niet herkend".
         count(*) filter (where coalesce(q.meta->>'caller_identified', 'false') = 'false')  as vragen_systeem,
         round(sum(q.est_cost_usd) filter (where coalesce(q.meta->>'caller_identified', 'false') = 'false')::numeric, 4) as usd_systeem,
         -- Het meetgat: wél een mens herkend, geen chat-run met caller. Deze
         -- vragen horen bij iemand en staan bij niemand.
         count(*) filter (where q.meta->>'caller_identified' = 'true' and r.caller_user_id is null) as vragen_gat,
         round(sum(q.est_cost_usd) filter (where q.meta->>'caller_identified' = 'true' and r.caller_user_id is null)::numeric, 4) as usd_gat
    from public.rag_chat_query_log q
    left join public.agent_chat_runs r on r.id = q.run_id
   where not q.meta ? 'eval_run_id'
     and public.is_admin_or_higher()
   group by 1;

comment on view public.v_model_usage_dekking is
  'De noemer bij v_user_model_usage_month, in drie stukken in plaats van twee: toegewezen (een mens), systeem (caller_identified=false — cron, agents, scripts: Maestro zelf) en gat (caller_identified=true zonder agent_chat_runs.caller_user_id — herkend en niet vastgelegd). September 2026 gemeten: 37/233/41 vragen en $0,6573/$3,5934/$0,7328 van $4,9835. Het gat apart houden is de hele reden dat deze view bestaat: het bij Maestro optellen maakt er een sluitende rekening van die niet sluit. Owner-only, poort in het WHERE-predicaat.';

-- ── 4. De vragen achter het bedrag ──────────────────────────────────────────
-- Zelfde twee armen als v_user_model_usage_month: de owner ziet iedereen, een
-- member zichzelf. security_invoker bewust uit met de poort in het predicaat —
-- de policy op agent_chat_runs kent geen owner-tak (zie migratie f).
create or replace view public.v_user_model_usage_detail as
  select r.caller_user_id                       as user_id,
         q.id,
         q.asked_at,
         date_trunc('month', q.asked_at)::date  as maand,
         q.question,
         q.route,
         q.answer_model,
         q.est_cost_usd,
         q.latency_ms,
         q.answer_chars,
         (q.error is not null)                  as fout
    from public.rag_chat_query_log q
    join public.agent_chat_runs r on r.id = q.run_id
   where r.caller_user_id is not null
     and not q.meta ? 'eval_run_id'
     and (public.is_admin_or_higher() or r.caller_user_id = (select auth.uid()));

comment on view public.v_user_model_usage_detail is
  'De vragen achter het bedrag in v_user_model_usage_month: één rij per vraag, met de vraagtekst, de route, het model, de kosten en de latency. Voor de doorkijk op de Usage-pagina — een totaal per persoon zegt niet waar het geld heen ging. Owner ziet iedereen, een member zichzelf; poort in het WHERE-predicaat, zelfde reden als de maandview. Multi-user, v1.192.';

grant select on public.v_user_model_usage_detail to authenticated;

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
--   select count(*) from public.capabilities                        -> 33
--   select count(*) from public.role_capabilities where app_role='owner'  -> 33
--   select count(*) from public.role_capabilities where app_role='member' -> 14
--   select groep, count(*) from public.capabilities group by 1 order by min(sort_order)
--     -> Basisrechten 13 · Dashboards 5 · Eigen gegevens 3 · Organisatie 10
--        · API keys en secrets 2
--   select vragen_toegewezen, vragen_systeem, vragen_gat from v_model_usage_dekking
--    where maand = '2026-09-01'                                     -> 37 233 41
--   (de view zelf is owner-only; als postgres geeft hij nul rijen — meet de
--    splitsing dan rechtstreeks op rag_chat_query_log met hetzelfde predicaat)
--
-- ── Terugzetten van een geschrapte rij (voorbeeld) ──────────────────────────
-- insert into public.capabilities (key, soort, groep, label, omschrijving,
--        grantable, levert_vandaag, afdwingen_in, ui_bundle, toelichting, sort_order)
-- values ('data.mail.collega','data','Eigen gegevens','Mail van een collega',
--         'De mailbox van iemand anders inzien.', false, false, 'bestaat niet',
--         null, 'Fase 3 uit het meiplan. Niet ontworpen, niet gebouwd.', 340);

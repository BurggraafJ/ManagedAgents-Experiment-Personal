-- =============================================================================
-- Multi-user · de rechten-matrix naar ~8 rijen + de borden          (v1.193)
-- =============================================================================
-- Vervolg op 20260914160000. Jelle keek naar v1.192 en zei: "teveel rechten…
-- dashboard wel apart per bord… voor de rest max ~8… veel hoort samen."
-- (MATRIX-POLISH-V2.md, 2026-09-14 18:18).
--
-- De vorige ronde maakte de LIJST korter (36 → 33 rechten) en de GROEPEN
-- leesbaarder. Dat was het verkeerde eind: 29 rijen blijven 29 beslissingen,
-- ook als ze netjes gesorteerd staan. Deze ronde maakt de RIJ het product-recht
-- en laat de database zijn fijnmazigheid houden.
--
--   14 rijen = 8 uitdeelbare product-rechten + 5 borden + 1 sleutelrij
--   32 rechten in de database, precies zoals `has_capability()` ze straks leest
--
-- ── Waarom bundelen en niet schrappen ───────────────────────────────────────
-- `ui_bundle` bestaat sinds 20260914143000 en doet exact dit: de UI toont één
-- vinkje, de handhaving blijft per recht. Zeven vinkjes later is dan een
-- UI-wijziging en geen migratie. Alleen daar waar de SPLITSING zelf ruis is —
-- twee rijen over één module waarvan de tweede helft nog niet bestaat — wordt
-- er écht samengevoegd (Kennisbank, hieronder).
--
-- ── De acht + de borden ─────────────────────────────────────────────────────
--   Werk
--     1 Werkplek            home · taken · instellingen.eigen
--     2 Analyse             analyse · data.confluence.spaces · modellen.gebruiken
--     3 Postvak             postvak · data.mail.eigen · mail.versturen
--     4 Agenda              agenda · data.agenda.eigen
--     5 Administratie       administratie                      (levert nog niets)
--     6 Kennisbank          kennisbank            (samengevoegd uit twee rijen)
--   Dashboards
--     7-11 de vijf borden   pipeline · datakwaliteit · klantverlies ·
--                           kwartaaldiagnose · klantbase
--     12 Stuurdata lezen    data.crm.lezen — de spiegel achter Administratie
--                           én de borden; de reden dat ze vandaag leeg zijn
--   Organisatie
--     13 Organisatie        de vijf portaal-rechten · instellingen.beheer ·
--                           agent.uitvoeren · agent.instructies ·
--                           data.telemetrie · data.crm.schrijven · platform
--     14 API keys en secrets  organisatie.apikeys · secrets.beheren   (vast)
--
-- ── Drie inhoudelijke keuzes die geen opmaak zijn ───────────────────────────
--
-- 1. **Platform wordt uitdeelbaar.** Jelle's tabel zegt letterlijk
--    "Organisatie | gebruikers + platform + config (API keys **niet**)". Een
--    bundel waarvan één lid `grantable = false` is, is in de UI een bundel die
--    je niet kúnt aanvinken (buildRows: `leden.every(c => c.grantable)`) — dan
--    is "Organisatie met één vinkje" onmogelijk. De harde owner-only zone die
--    hij apart wilde is rij 14, en die blijft `grantable = false`.
--    Terugdraaien is één update; hij staat onderaan.
--
-- 2. **`data.crm.schrijven` gaat in de Organisatie-bundel, niet bij
--    Administratie.** Niet uit netheid maar omdat een bundel die de member-preset
--    doorsnijdt in elk memberhokje een streepje ("half aan") geeft. De preset
--    heeft `data.crm.lezen` wél en `data.crm.schrijven` niet; terugschrijven naar
--    HubSpot hoort bij het beheerdeel. Zo is elke bundel voor een member óf
--    helemaal aan óf helemaal uit, en betekent een streepje altijd "hier is met
--    de hand iets halfs gezet".
--
-- 3. **Kennisbank lezen + beheren worden één recht `kennisbank`.** Hier is de
--    splitsing zelf de ruis: `kennisbank_review` staat in de nav als `soon`, dus
--    het tweede recht gaat over een functie die nog gebouwd wordt. Eén vinkje
--    (Jelle: "Kennisbank — under construction — één vink"). Overrides en presets
--    verhuizen mee; een `revoke` wint van een `grant`, want de conservatieve kant
--    is hier de goede.
--
-- ── Plafond voor Maestro ────────────────────────────────────────────────────
-- Beslissing 5 gaf elke persoon €50/maand. Maestro zelf (cron, agents, scripts)
-- was in september de grootste post — $3,59 van $4,98 — en had geen plafond,
-- want `user_model_budget.user_id` wijst naar `auth.users` en Maestro is geen
-- gebruiker. Zijn plafond staat daarom als parameter, naast de koers die daar al
-- stond. Net als de persoonlijke plafonds remt hij vandaag niets (GAP-3).
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   update public.capabilities set ui_bundle = null;             -- alle bundels
--   update public.capabilities set grantable = false where key = 'organisatie.platform';
--   groep/sort_order terug: 20260914160000 regel 77-122;
--   Kennisbank terug: de twee inserts onderaan dit bestand.
-- =============================================================================

begin;

-- ── 1. Kennisbank: twee rijen worden één ────────────────────────────────────
insert into public.capabilities
  (key, soort, groep, label, omschrijving, grantable, levert_vandaag,
   afdwingen_in, ui_bundle, toelichting, sort_order)
values
  ('kennisbank', 'module', 'Werk', 'Kennisbank',
   'Artikelen lezen, de review-queue en artikelen vaststellen.',
   true, true, 'UI + RLS', null,
   'Lezen werkt vandaag. Het vaststellen niet: kennisbank_review staat in de nav als "soon" en de kb_*-tabellen staan op eigen rijen, dus een member ziet zijn eigen (nul) voorstellen.',
   160)
on conflict (key) do update
   set groep = excluded.groep, label = excluded.label,
       omschrijving = excluded.omschrijving, toelichting = excluded.toelichting,
       sort_order = excluded.sort_order;

-- De preset volgt: wie een van de twee oude rechten had, heeft het nieuwe.
insert into public.role_capabilities (app_role, capability)
  select distinct app_role, 'kennisbank'
    from public.role_capabilities
   where capability in ('kennisbank.lezen', 'kennisbank.beheren')
on conflict do nothing;

-- Handmatige afwijkingen verhuizen mee. Eén revoke op een van de twee helften
-- maakt het samengevoegde recht uit — je haalt geen toegang wég door rijen
-- samen te voegen. (Op prod gemeten 2026-09-14: 0 overrides, dus dit is hier
-- een no-op. Hij staat er omdat de volgende samenvoeging dat niet is.)
insert into public.user_capabilities (user_id, capability, effect, granted_by, granted_at, note)
  select user_id,
         'kennisbank',
         case when bool_or(effect = 'revoke') then 'revoke' else 'grant' end,
         (array_agg(granted_by order by granted_at desc))[1],
         max(granted_at),
         'Samengevoegd uit kennisbank.lezen/-beheren (v1.193).'
    from public.user_capabilities
   where capability in ('kennisbank.lezen', 'kennisbank.beheren')
   group by user_id
on conflict (user_id, capability) do nothing;

delete from public.capabilities where key in ('kennisbank.lezen', 'kennisbank.beheren');

-- ── 2. Platform wordt uitdeelbaar ───────────────────────────────────────────
update public.capabilities
   set grantable    = true,
       afdwingen_in = 'nog niet (UI)',
       toelichting  = 'Zit sinds v1.193 in de Organisatie-bundel: Jelle''s indeling is "gebruikers + platform + config", met API keys en secrets als de enige harde owner-only zone. Wie Organisatie krijgt, krijgt Platform erbij.'
 where key = 'organisatie.platform';

-- ── 3. Groep, volgorde en bundel voor alle 32 rijen ─────────────────────────
-- Eén update, zodat de nieuwe indeling in één oogopslag te lezen is. De
-- sort_order houdt elke groep én elke bundel aaneengesloten: groupRows() in de
-- UI groepeert OPEENVOLGENDE rijen, en buildRows() zet een bundel op de plek van
-- zijn eerste lid.
update public.capabilities c
   set groep = n.groep, sort_order = n.sort_order, ui_bundle = n.bundel
  from (values
    -- Werk — de groep die open staat: Administratie levert vandaag nog niets.
    ('home',                  'Werk',         110, 'werkplek'),
    ('taken',                 'Werk',         111, 'werkplek'),
    ('instellingen.eigen',    'Werk',         112, 'werkplek'),
    ('analyse',               'Werk',         120, 'analyse'),
    ('data.confluence.spaces','Werk',         121, 'analyse'),
    ('modellen.gebruiken',    'Werk',         122, 'analyse'),
    ('postvak',               'Werk',         130, 'postvak'),
    ('data.mail.eigen',       'Werk',         131, 'postvak'),
    ('mail.versturen',        'Werk',         132, 'postvak'),
    ('agenda',                'Werk',         140, 'agenda'),
    ('data.agenda.eigen',     'Werk',         141, 'agenda'),
    ('administratie',         'Werk',         150, null),
    ('kennisbank',            'Werk',         160, null),
    -- Dashboards — per bord één recht, plus de spiegel waar ze uit lezen.
    ('pipeline',              'Dashboards',   210, null),
    ('datakwaliteit',         'Dashboards',   220, null),
    ('klantverlies',          'Dashboards',   230, null),
    ('kwartaaldiagnose',      'Dashboards',   240, null),
    ('klantbase',             'Dashboards',   250, null),
    ('data.crm.lezen',        'Dashboards',   260, null),
    -- Organisatie — één vinkje voor het portaal, één slot voor de sleutels.
    ('organisatie.gebruikers','Organisatie',  310, 'organisatie'),
    ('organisatie.health',    'Organisatie',  311, 'organisatie'),
    ('organisatie.security',  'Organisatie',  312, 'organisatie'),
    ('organisatie.skills',    'Organisatie',  313, 'organisatie'),
    ('organisatie.pijplijn',  'Organisatie',  314, 'organisatie'),
    ('instellingen.beheer',   'Organisatie',  315, 'organisatie'),
    ('agent.uitvoeren',       'Organisatie',  316, 'organisatie'),
    ('agent.instructies',     'Organisatie',  317, 'organisatie'),
    ('data.telemetrie',       'Organisatie',  318, 'organisatie'),
    ('data.crm.schrijven',    'Organisatie',  319, 'organisatie'),
    ('organisatie.platform',  'Organisatie',  320, 'organisatie'),
    ('organisatie.apikeys',   'Organisatie',  330, 'sleutels'),
    ('secrets.beheren',       'Organisatie',  331, 'sleutels')
  ) as n(key, groep, sort_order, bundel)
 where c.key = n.key;

-- ── 4. Twee labels die de rij moeten dragen, niet het recht ─────────────────
-- `data.crm.lezen` staat nu tussen de borden. Zijn label moet zeggen waaróm hij
-- daar staat: hij is de reden dat die borden vandaag leeg zijn.
update public.capabilities
   set label        = 'Stuurdata lezen (CRM-spiegel)',
       omschrijving = 'De HubSpot-gegevens onder Administratie en de vijf borden hierboven.'
 where key = 'data.crm.lezen';

update public.capabilities
   set omschrijving = 'Terugschrijven naar HubSpot — hoort bij het beheerdeel, niet bij meekijken.'
 where key = 'data.crm.schrijven';

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
--   select count(*) from public.capabilities                              -> 32
--   select groep, count(*) from public.capabilities group by 1
--     -> Werk 13 · Dashboards 6 · Organisatie 13
--   select count(distinct coalesce(ui_bundle, key)) from public.capabilities -> 14
--   select count(*) from public.role_capabilities where app_role='member'  -> 14
--   select count(*) from public.role_capabilities where app_role='owner'   -> 32
--   Geen bundel mag de member-preset doorsnijden (anders: streepjes in de UI):
--     select ui_bundle from public.capabilities c where ui_bundle is not null
--      group by 1
--     having count(*) filter (where exists (select 1 from public.role_capabilities r
--              where r.app_role='member' and r.capability=c.key)) not in (0, count(*))
--     -> 0 rijen
--
-- ── Kennisbank terugsplitsen (voorbeeld) ────────────────────────────────────
-- insert into public.capabilities (key, soort, groep, label, omschrijving,
--        grantable, levert_vandaag, afdwingen_in, ui_bundle, toelichting, sort_order)
-- values ('kennisbank.lezen','module','Werk','Kennisbank lezen',
--         'Artikelen raadplegen.', true, true, 'UI + RLS', null, null, 160),
--        ('kennisbank.beheren','module','Werk','Kennisbank beheren',
--         'Review-queue en artikelen vaststellen.', true, false, 'RLS', null,
--         'De kb_*-tabellen staan op eigen rijen.', 161);
-- delete from public.capabilities where key = 'kennisbank';

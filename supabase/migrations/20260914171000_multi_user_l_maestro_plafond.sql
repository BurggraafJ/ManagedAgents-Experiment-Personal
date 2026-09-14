-- =============================================================================
-- Multi-user · een plafond voor Maestro zelf                        (v1.193)
-- =============================================================================
-- Beslissing 5 (2026-09-14) gaf elke persoon €50 per maand in
-- `user_model_budget`. Daar zat een gat in dat v1.192 zichtbaar maakte en niet
-- dichtte: **de grootste verbruiker is geen persoon.** September 2026, gemeten:
--
--     37 vragen  $0,6573   aan een mens toegewezen
--    233 vragen  $3,5934   Maestro zelf — cron, agents, scripts
--     41 vragen  $0,7328   meetgat (herkend, niet vastgelegd)
--
-- 72 % van de chatkosten stond dus onder een rij zonder plafond, terwijl zeven
-- mensen er wel een hadden. Jelle: "plafond €50 standaard, instelbaar per
-- gebruiker (incl. Maestro = ook €50 default)".
--
-- ── Waarom een parameter en geen rij in user_model_budget ───────────────────
-- `user_model_budget.user_id` is een FK naar `auth.users`. Maestro is geen
-- gebruiker en krijgt er ook geen: een nep-account in auth.users zou in elke
-- gebruikerslijst, elke telling en elke ACL-meting opduiken als mens. Zijn
-- plafond staat daarom naast de koers die er al stond — `dash_parameters` is in
-- dit project de plek voor één knop met een herkomst eronder.
--
-- ⚠ Net als de persoonlijke plafonds remt dit vandaag NIETS. Geen enkele Edge
-- Function leest het (GAP-3). De Usage-pagina zegt dat er met zoveel woorden bij;
-- een plafond dat stil doet alsof het begrenst is erger dan geen plafond.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   delete from public.dash_parameters where sleutel = 'model_budget_maestro_eur';
-- =============================================================================

begin;

insert into public.dash_parameters
  (sleutel, waarde, eenheid, geldig_vanaf, bron, peildatum, toelichting)
values
  ('model_budget_maestro_eur', 50, 'euro_per_maand', current_date,
   'Matrix/Usage polish v2 (Jelle, 2026-09-14)', current_date,
   'Maandplafond voor Maestro zelf: de chatvragen zonder ingelogde gebruiker (cron, agents, scripts — meta.caller_identified is niet true). Zelfde standaard als een persoon (€50) en op dezelfde plek instelbaar, op de Usage-pagina. Wordt NERGENS afgedwongen: geen enkele Edge Function leest dit getal (GAP-3). In september 2026 stond hier $3,59 van de $4,98 tegenover.')
on conflict (sleutel) do nothing;

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
--   select sleutel, waarde, eenheid from public.dash_parameters
--    where sleutel like 'model_budget%'
--     -> model_budget_maestro_eur  50    euro_per_maand
--        model_budget_usd_per_eur  NULL  usd_per_euro   (bewust leeg)

-- =============================================================================
-- Member-preset: administratie eruit tot PR-E (CRM-spiegel)               (v1.215)
-- =============================================================================
-- ASK 2 (SECURITY-READY 2026-09-15): Administratie stond in de member-preset
-- terwijl de HubSpot-spiegel nog is_admin_or_higher() is — menu-item zichtbaar,
-- pagina leeg. Jelle koos het gratis alternatief: haal `administratie` uit de
-- member-preset tot de CRM-spiegel omgezet wordt (PR-E). Owner blijft ongemoeid.
--
-- Bewust NIET aangeraakt:
--   • data.crm.lezen  — blijft in de member-preset (levert_vandaag=false) tot PR-E
--   • capabilities-rij, grantable, levert_vandaag — alleen de preset-rij weg
--   • owner role_capabilities
--
-- Effect: nav (viewRegistry cap='administratie') verbergt Administratie/Toekomst
-- voor members; in de Rechten-matrix wordt het een ○ (aanvinkbaar). MemberInfoModal
-- leest role_capabilities live, dus "Staat aan, maar levert vandaag niets" verliest
-- Administratie automatisch.
--
-- Terugdraaien:
--   insert into public.role_capabilities (app_role, capability)
--   values ('member', 'administratie') on conflict do nothing;

begin;

delete from public.role_capabilities
 where app_role = 'member'
   and capability = 'administratie';

-- Zelfde vorm als eerdere multi-user-migraties: asserts in de migratie zelf.
do $$
declare
  member_n int;
  owner_has boolean;
  member_has boolean;
begin
  select count(*) into member_n
    from public.role_capabilities where app_role = 'member';
  select exists (
    select 1 from public.role_capabilities
     where app_role = 'owner' and capability = 'administratie'
  ) into owner_has;
  select exists (
    select 1 from public.role_capabilities
     where app_role = 'member' and capability = 'administratie'
  ) into member_has;

  if member_has then
    raise exception 'member-preset bevat administratie nog — delete faalde';
  end if;
  if not owner_has then
    raise exception 'owner mist administratie — niet bedoeld';
  end if;
  -- Was 14; na deze delete 13. data.crm.lezen blijft.
  if member_n <> 13 then
    raise exception 'member-preset telt % i.p.v. 13', member_n;
  end if;
end $$;

commit;

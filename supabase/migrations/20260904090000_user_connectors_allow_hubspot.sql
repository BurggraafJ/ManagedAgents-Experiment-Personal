-- HubSpot als derde per-user connector.                     (v1.142, 2026-09-04)
--
-- Zelfde reden als bij Confluence (20260903223000): `provider` is een lijst en
-- geen vrije tekst, want de waarde bepaalt welke Edge Function de browser
-- aanroept (`connectors-<provider>`). Zonder deze regel faalt de INSERT uit
-- `connectors-hubspot` stil en ziet de UI alleen een 502.
--
-- WAT DEZE KOPPELING WEL EN NIET IS
--
-- NIET: een tweede HubSpot-sync. De org-spiegel (`hubspot_deals`,
-- `hubspot_companies`, `hubspot_contacts`, `hubspot_engagements`, …) blijft
-- ongewijzigd draaien op het HubSpot **Private App**-token uit Vault
-- (`skill:hubspot-sync-etl:access_token`). Die pijplijn raakt Composio niet aan
-- — zie de kop van `hubspot-sync-etl/index.ts` — dus een per-user OAuth-grant
-- deelt er geen credential, connectie of rate-limit mee. Lezen blijft de
-- spiegel; hier komt géén live-read-tool bij.
--
-- WEL: het recht om namens díe gebruiker te SCHRIJVEN. `hubspot-write` gebruikt
-- de connectie uit deze tabel als `connectedAccountId` op de Composio
-- v2-proxy, zodat HubSpot de notitie onder het account van de gebruiker
-- registreert in plaats van onder één org-token.
alter table public.user_connectors
  drop constraint if exists user_connectors_provider_chk;

alter table public.user_connectors
  add constraint user_connectors_provider_chk
  check (provider = any (array['outlook'::text, 'confluence'::text, 'hubspot'::text]));

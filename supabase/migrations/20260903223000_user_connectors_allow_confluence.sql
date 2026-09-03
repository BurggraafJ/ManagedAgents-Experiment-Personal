-- user_connectors accepteerde letterlijk alleen Outlook:
--   CHECK (provider = 'outlook')
--
-- Die constraint komt uit 20260903000000_user_connectors_outlook_mcp.sql, toen
-- Outlook de enige connector was. Met de Confluence-kaart erbij (v1.141) sloeg
-- hij toe op een plek waar niemand keek: `connectors-confluence` schrijft bij
-- een mislukte connect een 'error'-rij, en die INSERT faalde stil — de UI zag
-- alleen een 502 zonder spoor in de tabel.
--
-- Bewust een lijst en geen vrije tekst: `provider` bepaalt welke Edge Function
-- de browser aanroept (`connectors-<provider>`), dus een typfout hoort hier te
-- stranden en niet in een 404 op een niet-bestaande functie.
alter table public.user_connectors
  drop constraint if exists user_connectors_provider_chk;

alter table public.user_connectors
  add constraint user_connectors_provider_chk
  check (provider = any (array['outlook'::text, 'confluence'::text]));

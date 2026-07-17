-- 2026-07-16 — Outlook Prioriteit/Overige-vlag meesyncen (mail-sync-etl-v2 v3.4)
-- Graph's inferenceClassification ('focused' = Prioriteit, 'other' = Overige)
-- landt per mail in deze kolom. NULL = nog niet gesynct met v3.4+ of onbekende
-- waarde (EF laat alleen de twee bekende enum-waarden door).
alter table public.mail_messages
  add column if not exists inference_classification text
  constraint mail_messages_inference_classification_check
  check (inference_classification is null or inference_classification in ('focused','other'));

comment on column public.mail_messages.inference_classification is
  'Outlook Focused Inbox-vlag uit Graph (focused=Prioriteit, other=Overige); gevuld door mail-sync-etl-v2 >= v3.4';

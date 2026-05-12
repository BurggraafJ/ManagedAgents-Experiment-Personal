-- 2026-05-12 — calendar-reconcile soft-delete column.
--
-- Add is_deleted soft-delete flag to calendar_events. Used by the new
-- calendar-reconcile Edge Function (analoog mail-reconcile) to mark events
-- that have been hard-deleted or moved out of the active sync window in
-- Outlook. Frontend hooks (useAgenda, useAdmin, NowAgendaStrip, FocusGrid,
-- useTruthOfSources) filter is_deleted=false zodat ze direct verdwijnen.
--
-- Default false zodat bestaande rijen ongewijzigd blijven. Partial index op
-- de meest voorkomende predicate (is_deleted=false) houdt de frontend
-- gte/lte range-scans snel.
--
-- Toegepast in productie via mcp__supabase__apply_migration met dezelfde
-- naam — dit bestand is voor reproducibility bij fresh setup.

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS calendar_events_active_start_time_idx
  ON public.calendar_events (start_time)
  WHERE is_deleted = false;

COMMENT ON COLUMN public.calendar_events.is_deleted IS
  'Soft-delete flag set by calendar-reconcile when an event disappeared from Outlook (hard delete or moved out of window). Frontend queries should filter is_deleted=false.';
COMMENT ON COLUMN public.calendar_events.deleted_at IS
  'Wall-clock time when calendar-reconcile flipped is_deleted to true. Null for active events.';

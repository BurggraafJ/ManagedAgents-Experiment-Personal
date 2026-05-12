-- 2026-05-12 — jira-reconcile soft-delete column.
--
-- Add is_deleted soft-delete flag to jira_issues. Used by the new
-- jira-reconcile Edge Function (analoog mail-reconcile / calendar-reconcile /
-- hubspot-reconcile) om hard-deleted issues, moved-to-other-project en
-- out-of-jql-window-gevallen issues alsnog uit het Taken-tabblad weg te
-- toveren.
--
-- Default false zodat bestaande rijen ongewijzigd blijven. Partial index op
-- (status_category, jira_updated_at DESC) WHERE is_deleted=false versnelt de
-- Taken/Future-queries die op due_date / jira_updated_at ordenen.
--
-- Toegepast in productie via mcp__supabase__apply_migration met dezelfde
-- naam — dit bestand is voor reproducibility bij fresh setup.

ALTER TABLE public.jira_issues
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS jira_issues_active_status_idx
  ON public.jira_issues (status_category, jira_updated_at DESC)
  WHERE is_deleted = false;

COMMENT ON COLUMN public.jira_issues.is_deleted IS
  'Soft-delete flag set by jira-reconcile when an issue disappeared from Jira (hard-delete, moved to another project, or out of supported window). Frontend queries should filter is_deleted=false.';
COMMENT ON COLUMN public.jira_issues.deleted_at IS
  'Wall-clock time when jira-reconcile flipped is_deleted to true. Null for active issues.';

-- Directory import history (Phase 2). PREPARED, NOT APPLIED, NOT TESTED against
-- a real Postgres. Depends on carehub_20261120_business_directory.sql.
--
-- One row per completed or attempted import run: who ran it, which file
-- (fingerprint, not content), the planned row counts and the outcome including
-- per-row failures. Admin-only. The records themselves are deduplicated by the
-- unique (data_source, source_ref) index on directory_businesses, so re-running
-- the same file cannot create copies.
--
-- Rollback: DROP TABLE public.directory_imports;

CREATE TABLE IF NOT EXISTS public.directory_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text,
  file_fingerprint text NOT NULL,
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS directory_imports_created_idx ON public.directory_imports (created_at DESC);

ALTER TABLE public.directory_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS directory_imports_admin_read ON public.directory_imports;
CREATE POLICY directory_imports_admin_read ON public.directory_imports FOR SELECT TO authenticated
  USING (public.is_directory_admin());
DROP POLICY IF EXISTS directory_imports_admin_insert ON public.directory_imports;
CREATE POLICY directory_imports_admin_insert ON public.directory_imports FOR INSERT TO authenticated
  WITH CHECK (public.is_directory_admin() AND created_by = auth.uid());
-- No UPDATE or DELETE policy: history is append-only.

REVOKE ALL ON public.directory_imports FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.directory_imports TO authenticated;

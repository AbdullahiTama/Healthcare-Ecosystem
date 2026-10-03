-- ============================================================================
-- 20260821_contact_leads.sql
-- Issue #4 (CareFind → CareHub loop), part 1 of 2.
--
-- WHAT
--   1. `contact_leads` — a durable record every time a CareFind viewer taps
--      "WhatsApp" or "Call" on a business/product card. Today that intent
--      evaporates; with this table it becomes a lead the owner can be told
--      about and, later, count.
--
--   2. Trigger on public.reviews — when a customer leaves a review on a
--      business's CareFind profile, the owner gets a staff_notifications row
--      (kind 'review_created'). This mirrors what notify() writes from the
--      app side: is_owner = true, staff_id = NULL, scoped to business_id.
--      businesses.owner is a display name (text), not a user id, so "the
--      owner" in notification terms IS the is_owner row — same convention as
--      every other owner notification in the system.
--
-- SECURITY MODEL (house pattern from sql/20260802_roles_rls.sql)
--   - INSERT: anon + authenticated may record leads. The button is public;
--      requiring login would kill the lead. WITH CHECK (true) only.
--   - SELECT: tenant-scoped via current_business_ids() OR is_platform_admin().
--   - No UPDATE/DELETE policies: leads are append-only evidence.
--   - The trigger function is SECURITY DEFINER so an anonymous review insert
--      can still write the owner notification (staff_notifications RLS only
--      allows tenant members to write).
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.contact_leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id   uuid,
  product_name text,
  channel      text NOT NULL CHECK (channel IN ('whatsapp', 'call')),
  viewer_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can record a contact lead" ON public.contact_leads;
CREATE POLICY "anyone can record a contact lead"
  ON public.contact_leads FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "tenant can read own contact leads" ON public.contact_leads;
CREATE POLICY "tenant can read own contact leads"
  ON public.contact_leads FOR SELECT
  USING (
    business_id IN (SELECT public.current_business_ids())
    OR public.is_platform_admin()
  );

CREATE INDEX IF NOT EXISTS idx_contact_leads_business
  ON public.contact_leads (business_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Review → owner notification trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_owner_on_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.staff_notifications
    (business_id, staff_id, is_owner, kind, title, body, link)
  VALUES (
    NEW.business_id,
    NULL,
    true,
    'review_created',
    'New ' || NEW.rating || '-star review',
    COALESCE(NULLIF(LEFT(NEW.comment, 120), ''),
             'A customer reviewed your business on CareFind.'),
    '/dashboard/carefind'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_owner_on_review ON public.reviews;
CREATE TRIGGER trg_notify_owner_on_review
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.notify_owner_on_review();

-- Trigger-only function: nobody should call it over PostgREST. Triggers do
-- not check EXECUTE, so this only closes the RPC surface (advisor lint 0028).
REVOKE EXECUTE ON FUNCTION public.notify_owner_on_review()
  FROM anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Contact-lead → owner notification trigger
--
-- The whole point of recording a lead (issue #4 addendum): the moment a
-- viewer taps WhatsApp/Call, the owner hears about it in CareHub. Same
-- definer shape as the review trigger — an anonymous insert must still be
-- able to write the owner's staff_notifications row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_business_contact_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_name text;
  subject     text;
BEGIN
  SELECT COALESCE(
           NULLIF(au.raw_user_meta_data->>'full_name', ''),
           NULLIF(au.raw_user_meta_data->>'name', ''),
           NULLIF(au.email, ''),
           'Someone'
         )
    INTO viewer_name
    FROM auth.users au
   WHERE au.id = NEW.viewer_id;

  viewer_name := COALESCE(viewer_name, 'Someone');
  subject     := COALESCE(NULLIF(NEW.product_name, ''), 'your business');

  INSERT INTO public.staff_notifications
    (business_id, staff_id, is_owner, kind, title, body, link)
  VALUES (
    NEW.business_id,
    NULL,
    true,
    'contact_lead',
    'New ' || CASE NEW.channel WHEN 'whatsapp' THEN 'WhatsApp' ELSE 'Call' END || ' lead',
    viewer_name || ' found ' || subject || ' on your CareFind profile and contacted you via '
      || CASE NEW.channel WHEN 'whatsapp' THEN 'WhatsApp' ELSE 'Call' END
      || ' — please follow up.',
    '/dashboard/carefind'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_business_contact_lead ON public.contact_leads;
CREATE TRIGGER trg_notify_business_contact_lead
  AFTER INSERT ON public.contact_leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_business_contact_lead();

-- Trigger-only function: close the RPC surface (advisor lint 0028).
REVOKE EXECUTE ON FUNCTION public.notify_business_contact_lead()
  FROM anon, authenticated, public;

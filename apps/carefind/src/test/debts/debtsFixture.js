// Shared PGlite fixture for the debts migration tests: the live auth helpers, current_business_ids(),
// is_business_owner(), is_platform_admin(), pos_actor(), stamp_recorded_by() / keep_recorded_by() (read live
// 2026-11-10, unchanged 2026-11-14) and one business with an Owner, a Manager (may delete) and a Cashier, plus the
// owner of another business.
export const BIZ = 'a0000000-0000-4000-8000-000000000001'
export const OTHER = 'b0000000-0000-4000-8000-000000000001'
export const OWNER = 'owner@pharm.ng', MANAGER = 'manager@pharm.ng', CASHIER = 'cashier@pharm.ng', STRANGER = 'owner@other.ng'
export const UID = { [OWNER]: '10000000-0000-4000-8000-000000000001', [MANAGER]: '10000000-0000-4000-8000-000000000002', [CASHIER]: '10000000-0000-4000-8000-000000000003', [STRANGER]: '10000000-0000-4000-8000-000000000004' }
export const D = (n) => 'd0000000-0000-4000-8000-00000000000' + n
export const C = (n) => 'c0000000-0000-4000-8000-00000000000' + n

export const LIVE_HELPERS_SQL = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, name text, email text, owner text, owner_name text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active', auth_user_id uuid);
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb default '{}');
    insert into businesses (id, name, email, owner_name) values ('${BIZ}', 'Pharm', '${OWNER}', 'Tama'), ('${OTHER}', 'Other', '${STRANGER}', 'Zed');
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Musa', '${MANAGER}', 'Manager'), ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier');
    insert into roles (business_id, name, permissions) values ('${BIZ}', 'Manager', '{"canDelete": true}'), ('${BIZ}', 'Cashier', '{}');

    CREATE OR REPLACE FUNCTION public.current_business_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      WITH RECURSIVE visible AS (
        SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b WHERE lower(b.email) = lower(auth.email())
        UNION ALL
        SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1
        FROM businesses child INNER JOIN visible ON child.parent_business_id = visible.id WHERE visible.depth < visible.branch_depth_limit
      )
      SELECT id FROM visible
      UNION
      SELECT b.id FROM businesses b INNER JOIN staff s ON s.business_id = b.id WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
    $function$;
    CREATE OR REPLACE FUNCTION public.is_business_owner(bid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
      WITH RECURSIVE ancestry AS (
        SELECT b.id, b.parent_business_id, b.email, 0 AS depth FROM public.businesses b WHERE b.id = bid
        UNION ALL
        SELECT p.id, p.parent_business_id, p.email, a.depth + 1 FROM public.businesses p JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10
      )
      SELECT auth.uid() IS NOT NULL
         AND bid IN (SELECT public.current_business_ids())
         AND (
           EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
           OR EXISTS (SELECT 1 FROM public.staff s WHERE s.business_id = bid AND s.status = 'active' AND s.role = 'Owner' AND lower(s.email) = lower(auth.email()))
         )
    $function$;
    REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon, authenticated;
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;
    CREATE OR REPLACE FUNCTION public.pos_actor(p_business_id uuid) RETURNS TABLE(user_id uuid, staff_id uuid, staff_name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
    DECLARE
      v_uid uuid := auth.uid();
      v_email text := lower(auth.email());
    BEGIN
      IF v_uid IS NULL OR p_business_id IS NULL OR p_business_id NOT IN (SELECT public.current_business_ids()) THEN RETURN; END IF;
      RETURN QUERY
        WITH RECURSIVE up(id, parent_business_id, depth) AS (
          SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
          UNION
          SELECT p.id, p.parent_business_id, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
        )
        SELECT v_uid, s.id, COALESCE(NULLIF(trim(s.full_name), ''), s.email)
          FROM up JOIN public.staff s ON s.business_id = up.id
         WHERE s.status = 'active' AND (s.auth_user_id = v_uid OR lower(s.email) = v_email)
         ORDER BY up.depth, (s.auth_user_id = v_uid) DESC NULLS LAST LIMIT 1;
      IF FOUND THEN RETURN; END IF;
      RETURN QUERY
        WITH RECURSIVE up(id, parent_business_id, depth) AS (
          SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
          UNION
          SELECT p.id, p.parent_business_id, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
        )
        SELECT v_uid, NULL::uuid, COALESCE(NULLIF(trim(o.owner_name), ''), NULLIF(trim(o.owner), ''), 'Owner')
          FROM up JOIN public.businesses o ON o.id = up.id WHERE lower(o.email) = v_email ORDER BY up.depth LIMIT 1;
    END $function$;
    CREATE OR REPLACE FUNCTION public.stamp_recorded_by() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
    DECLARE
      v_actor record;
    BEGIN
      IF auth.uid() IS NULL THEN RETURN NEW; END IF;
      NEW.recorded_by := auth.uid();
      NEW.recorded_by_staff_id := NULL;
      NEW.recorded_by_name := NULL;
      SELECT a.staff_id, a.staff_name INTO v_actor FROM public.pos_actor(NEW.business_id) a LIMIT 1;
      IF FOUND THEN
        NEW.recorded_by_staff_id := v_actor.staff_id;
        NEW.recorded_by_name := v_actor.staff_name;
      END IF;
      RETURN NEW;
    END $function$;
    CREATE OR REPLACE FUNCTION public.keep_recorded_by() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
    BEGIN
      NEW.recorded_by := OLD.recorded_by;
      NEW.recorded_by_staff_id := OLD.recorded_by_staff_id;
      NEW.recorded_by_name := OLD.recorded_by_name;
      RETURN NEW;
    END $function$;
`

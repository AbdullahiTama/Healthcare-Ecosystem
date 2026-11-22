-- ─────────────────────────────────────────────────────────────────────────────
-- SEO: when a public listing last changed (businesses, products, profiles, news, posts).
-- 2026-11-22. Docs: docs/architecture/SEO-and-AI-Search-Visibility.md
-- Status: NOT APPLIED. Tested on PGlite (apps/carefind/src/test/seo/seoUpdatedAt.db.test.js).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- Search engines are told what changed through the sitemaps' <lastmod> (api/_handlers/sitemap.js) and, once a day,
-- through IndexNow (api/_lib/indexNow.js). None of these tables recorded when a row changed: businesses, products and
-- profiles had only created_at, news published_at, posts created_at. So an edited pharmacy, a repriced medicine or a
-- newly verified professional could not be told apart from an untouched one.
--
-- WHAT
-- * updated_at (timestamptz, default now()) on businesses, products, profiles, news and posts. Existing rows are left
--   NULL (no backfill UPDATE, so no trigger or guard runs on existing data); readers use coalesce(updated_at,
--   created_at).
-- * One BEFORE UPDATE trigger per table (seo_touch_updated_at) sets updated_at to now() only when something a search
--   engine shows changes (name, address, contact, description, price, visibility, verification…), and otherwise keeps
--   the previous value. Everyday writes (a sale changing stock, a payout code, a plan change) do not count, except a
--   product going in or out of stock. A client cannot set updated_at itself: the trigger always decides.
-- * carefind_products (the public products view) gains updated_at as its last column (CREATE OR REPLACE keeps its
--   grants; body otherwise identical to carehub_20270127_catalogue_health).
-- * anon / authenticated may read updated_at where the table grants columns one by one (businesses, profiles).
--
-- SECURITY
-- Exposes only the time of the last public change, on rows the public may already read. Trigger functions are
-- SECURITY INVOKER with a pinned search_path; EXECUTE revoked from API roles. No policy or other grant changes.
--
-- ROLLBACK
--   DROP TRIGGER seo_touch_updated_at ON public.businesses; (… products, profiles, news, posts)
--   DROP FUNCTION public.seo_touch_businesses(), public.seo_touch_products(), public.seo_touch_profiles(),
--                 public.seo_touch_news(), public.seo_touch_posts();
--   Re-run the carefind_products view from carehub_20270127_catalogue_health.sql (requires DROP VIEW first, since a
--   column is removed; re-grant select to anon, authenticated, service_role).
--   The updated_at columns can stay (nullable, unused by older code) or be dropped.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.products   ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.profiles   ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.news       ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.posts      ADD COLUMN IF NOT EXISTS updated_at timestamptz;
-- Default applies to new rows only (setting a default does not rewrite existing ones).
ALTER TABLE public.businesses ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.products   ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.profiles   ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.news       ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.posts      ALTER COLUMN updated_at SET DEFAULT now();

COMMENT ON COLUMN public.businesses.updated_at IS 'When something shown publicly last changed (SEO lastmod / IndexNow). Set by trigger seo_touch_updated_at; NULL: unchanged since before 2026-11.';
COMMENT ON COLUMN public.products.updated_at   IS 'When something shown publicly last changed, including going in or out of stock (SEO). Set by trigger seo_touch_updated_at.';
COMMENT ON COLUMN public.profiles.updated_at   IS 'When something shown publicly last changed (SEO). Set by trigger seo_touch_updated_at.';
COMMENT ON COLUMN public.news.updated_at       IS 'When the article last changed (SEO). Set by trigger seo_touch_updated_at.';
COMMENT ON COLUMN public.posts.updated_at      IS 'When the post last changed (SEO). Set by trigger seo_touch_updated_at.';

-- ── Triggers: updated_at moves only when public content changes ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seo_touch_businesses() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := CASE WHEN ROW(NEW.name, NEW.address, NEW.city, NEW.state, NEW.lga, NEW.area, NEW.phone, NEW.whatsapp, NEW.hours,
                                  NEW.website, NEW.description, NEW.logo_url, NEW.cover_url, NEW.maps_link, NEW.business_type,
                                  NEW.status, NEW.visible_on_carefind, NEW.show_prices, NEW.lat, NEW.lng, NEW.latitude, NEW.longitude, NEW.deleted_at)
                          IS DISTINCT FROM
                              ROW(OLD.name, OLD.address, OLD.city, OLD.state, OLD.lga, OLD.area, OLD.phone, OLD.whatsapp, OLD.hours,
                                  OLD.website, OLD.description, OLD.logo_url, OLD.cover_url, OLD.maps_link, OLD.business_type,
                                  OLD.status, OLD.visible_on_carefind, OLD.show_prices, OLD.lat, OLD.lng, OLD.latitude, OLD.longitude, OLD.deleted_at)
                         THEN now() ELSE OLD.updated_at END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.seo_touch_products() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := CASE WHEN ROW(NEW.name, NEW.generic_name, NEW.category, NEW.description, NEW.image_url, NEW.price, NEW.show_price,
                                  NEW.list_on_carefind, NEW.rx_status, NEW.business_id, coalesce(NEW.stock, 0) > 0)
                          IS DISTINCT FROM
                              ROW(OLD.name, OLD.generic_name, OLD.category, OLD.description, OLD.image_url, OLD.price, OLD.show_price,
                                  OLD.list_on_carefind, OLD.rx_status, OLD.business_id, coalesce(OLD.stock, 0) > 0)
                         THEN now() ELSE OLD.updated_at END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.seo_touch_profiles() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := CASE WHEN ROW(NEW.full_name, NEW.display_name, NEW.bio, NEW.specialty, NEW.verification_label, NEW.is_verified,
                                  NEW.avatar_url, NEW.location, NEW.website)
                          IS DISTINCT FROM
                              ROW(OLD.full_name, OLD.display_name, OLD.bio, OLD.specialty, OLD.verification_label, OLD.is_verified,
                                  OLD.avatar_url, OLD.location, OLD.website)
                         THEN now() ELSE OLD.updated_at END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.seo_touch_news() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := CASE WHEN ROW(NEW.headline, NEW.subtitle, NEW.body, NEW.hero_image_url, NEW.status)
                          IS DISTINCT FROM ROW(OLD.headline, OLD.subtitle, OLD.body, OLD.hero_image_url, OLD.status)
                         THEN now() ELSE OLD.updated_at END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.seo_touch_posts() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := CASE WHEN ROW(NEW.content, NEW.image_url, NEW.image_urls, NEW.post_type, NEW.subscriber_only, NEW.is_premium)
                          IS DISTINCT FROM ROW(OLD.content, OLD.image_url, OLD.image_urls, OLD.post_type, OLD.subscriber_only, OLD.is_premium)
                         THEN now() ELSE OLD.updated_at END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS seo_touch_updated_at ON public.businesses;
CREATE TRIGGER seo_touch_updated_at BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.seo_touch_businesses();
DROP TRIGGER IF EXISTS seo_touch_updated_at ON public.products;
CREATE TRIGGER seo_touch_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.seo_touch_products();
DROP TRIGGER IF EXISTS seo_touch_updated_at ON public.profiles;
CREATE TRIGGER seo_touch_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.seo_touch_profiles();
DROP TRIGGER IF EXISTS seo_touch_updated_at ON public.news;
CREATE TRIGGER seo_touch_updated_at BEFORE UPDATE ON public.news FOR EACH ROW EXECUTE FUNCTION public.seo_touch_news();
DROP TRIGGER IF EXISTS seo_touch_updated_at ON public.posts;
CREATE TRIGGER seo_touch_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.seo_touch_posts();

REVOKE ALL ON FUNCTION public.seo_touch_businesses(), public.seo_touch_products(), public.seo_touch_profiles(),
  public.seo_touch_news(), public.seo_touch_posts() FROM PUBLIC, anon, authenticated;

-- ── Readable where columns are granted one by one ────────────────────────────────────────────────────────────────
GRANT SELECT (updated_at) ON public.businesses TO anon, authenticated;
GRANT SELECT (updated_at) ON public.profiles TO anon, authenticated;

-- ── The public products view, with updated_at last (body as carehub_20270127_catalogue_health) ───────────────────
CREATE OR REPLACE VIEW public.carefind_products AS
SELECT p.id, p.business_id, p.owner_id, p.name, p.generic_name, p.category, p.emoji, p.image_url, p.description,
       p.whatsapp, p.sale_type, p.price_unit, p.min_purchase, p.seller_location, p.latitude, p.longitude, p.stock,
       p.list_on_carefind, p.created_at, p.rx_status,
       public.is_rx_restricted(p.rx_status) AS rx_restricted,
       CASE WHEN public.is_rx_restricted(p.rx_status) THEN NULL ELSE p.price END AS price,
       CASE WHEN public.is_rx_restricted(p.rx_status) THEN false ELSE p.show_price END AS show_price,
       p.updated_at
  FROM public.products p
 WHERE p.list_on_carefind = true
   AND NOT public.is_carefind_unpriced(p.rx_status, p.price);

REVOKE ALL ON public.carefind_products FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.carefind_products TO anon, authenticated, service_role;

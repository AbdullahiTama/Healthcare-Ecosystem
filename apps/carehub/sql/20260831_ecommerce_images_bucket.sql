-- ============================================================================
-- Ecommerce Images Storage Bucket
-- Status: READY — apply via Supabase SQL editor / psql
--
-- Creates the ecommerce-images bucket that the ecommerce module relies on
-- (apps/carehub/src/modules/ecommerce/repositories/index.js → sbUpload
--  'ecommerce-images'). The foundation migration 20260830_ecommerce_foundation.sql
-- only mentioned the bucket in a comment ("create via Supabase Storage API if
-- not exists") so the bucket was never created by SQL — every upload failed
-- with Bucket not found until an operator created it manually via Studio.
-- This migration makes the bucket creation declarative and repeatable.
--
-- Bucket spec from foundation comment:
--   Bucket: ecommerce-images, public true, file_size_limit 5MB, allowed_mime image/*
-- ============================================================================

-- Bucket: public read (CareFind Shop loads images via /object/public/ URL)
-- 5 MB limit enforced both in bucket config and in repository validation (addImage)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ecommerce-images',
  'ecommerce-images',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif','image/jpg']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/jpg'];

-- Policies: public read and authenticated insert
-- Mirrors business-assets and adr-evidence patterns (storage.objects RLS)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'ecommerce-images public read'
  ) then
    create policy "ecommerce-images public read" on storage.objects
      for select to public using (bucket_id = 'ecommerce-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'ecommerce-images authenticated upload'
  ) then
    create policy "ecommerce-images authenticated upload" on storage.objects
      for insert to authenticated with check (bucket_id = 'ecommerce-images');
  end if;

  -- Allow authenticated users to update/delete their own objects (reorder/delete)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'ecommerce-images authenticated update'
  ) then
    create policy "ecommerce-images authenticated update" on storage.objects
      for update to authenticated using (bucket_id = 'ecommerce-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'ecommerce-images authenticated delete'
  ) then
    create policy "ecommerce-images authenticated delete" on storage.objects
      for delete to authenticated using (bucket_id = 'ecommerce-images');
  end if;
end $$;

-- Verify after applying:
-- select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'ecommerce-images';
-- select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'ecommerce-images%';

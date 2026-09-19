-- 2026-08-05 — Settings module: public storage bucket for business images.
--
-- DRAFT — review and apply manually in the Supabase SQL editor.
--
-- Business Details in Settings now offers "Upload logo" / "Upload cover image"
-- buttons. They POST to the `business-assets` bucket via the shared sbUpload()
-- helper (services/supabase.js) using the custom bearer token — the same
-- shape as the existing order-files / activity-voice / message attachment
-- uploads, whose buckets were provisioned out-of-band.
--
-- Both inserts are idempotent so the file can be applied repeatedly.

insert into storage.buckets (id, name, public)
values ('business-assets', 'business-assets', true)
on conflict (id) do nothing;

-- Buckets are the only Supabase storage objects that ship with row-level
-- security attached (the RLS in new buckets owns the underlying objects), so
-- every consumer bucket above grants the same two policies — public reads for
-- the <bucket>/public/ URLs the frontend loads, and unrestricted inserts for
-- the bearer-token uploads.

create policy "business-assets public read" on storage.objects
  for select using (bucket_id = 'business-assets');

create policy "business-assets upload" on storage.objects
  for insert with check (bucket_id = 'business-assets');
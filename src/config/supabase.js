// Single source of truth for the Supabase project credentials. Previously
// redeclared identically in lib/supabase.js, lib/authClient.js and
// lib/realtime.js — consolidated here so credential rotation only needs to
// happen in one place.
//
// Credentials now come from env/config instead of being hardcoded, so staging
// and production can differ and the key can be rotated without a code deploy.
// Vite inlines VITE_* env vars at build time from ./.env.
export const SB_URL = import.meta.env.VITE_SUPABASE_URL
export const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

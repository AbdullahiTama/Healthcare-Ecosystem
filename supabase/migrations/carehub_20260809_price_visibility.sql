-- Price Visibility toggle (Issue 1): per-business flag that hides all product
-- prices from the public CareFind profile, showing "Ask for price" instead.
-- Defaults to true so existing businesses are unaffected.
alter table businesses
  add column if not exists show_prices boolean not null default true;

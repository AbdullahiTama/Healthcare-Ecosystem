-- Transfer headroom for the Paystack balance pre-check.
--
-- WHY: production showed 12 withdrawals refunded with `failure_reason = 'reconcile:not_found'`
-- and `payout_kobo` as low as 80000 (NGN 800). That is the fingerprint of a DEFINITIVE Paystack
-- refusal: the coins were debited, Paystack declined the transfer, the reconcile confirmed no
-- transfer exists, and the coins came back. The user was shown Paystack's own message verbatim -
--
--   "Your balance is not enough to fulfil this request. Your CareCoins have been returned to your wallet."
--
-- which reads as the CUSTOMER's CareCoin balance being short. It is not. It is Paystack reporting
-- the PLATFORM's own NGN settlement balance, and the pre-check at initiate-withdrawal.js did not
-- catch it because it compared `available < payoutKobo` with NO allowance for Paystack's own charge
-- on a balance-funded transfer, and there was no configuration key for one.
--
-- This adds the missing key. It is a THRESHOLD, not a commercial rate: it does not change any
-- price, fee, commission or amount a customer receives. Set to 0 it reproduces the old behaviour.
--
-- STATUS: written 2026-10-15. NOT APPLIED to production - needs the owner's explicit authorisation.

insert into public.financial_config (key, value, unit, description) values
  ('paystack_transfer_buffer_kobo', 20000, 'kobo',
   'NGN 200 held back from the Paystack balance pre-check on a withdrawal, covering Paystack''s own charge on a balance-funded transfer. A threshold, not a commercial rate. 0 restores the old exact-amount check.')
on conflict (key) do update
  set value = excluded.value,
      unit = excluded.unit,
      description = excluded.description,
      updated_at = now();
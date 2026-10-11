// The processing fee on a card top-up (owner decision 2026-10-10): the customer pays the listed price PLUS the fee and
// receives the full amount (a N200 coin costs N220 and credits one whole coin; a N10,000 business wallet top-up costs
// N11,000 and credits N10,000). Everything is integer kobo, nothing is rounded into coins, and the fee is recorded on
// the payment intent so the books show exactly what was charged and why.
//
// The rate is financial_config.topup_processing_fee_rate (a ratio, 0.10 = 10%), read on every top-up so an operator can
// change it without a deploy. If the row cannot be read the documented default is used and a warning is logged: a missing
// row must neither stop top-ups nor silently waive the fee.

export const TOPUP_FEE_RATE_KEY = 'topup_processing_fee_rate'
export const DEFAULT_TOPUP_FEE_RATE = 0.1

/**
 * @param {{ baseKobo: number, rate: number }} p  baseKobo = what the customer receives (positive integer kobo)
 * @returns {{ baseKobo: number, feeKobo: number, totalKobo: number, rate: number }}
 *   feeKobo = baseKobo x rate rounded to the nearest kobo (half up); totalKobo = what the card is charged.
 */
export function topupFee({ baseKobo, rate }) {
  if (!Number.isSafeInteger(baseKobo) || baseKobo <= 0) throw new RangeError('topupFee: baseKobo must be a positive integer number of kobo')
  if (typeof rate !== 'number' || !(rate >= 0 && rate <= 1)) throw new RangeError('topupFee: rate must be a ratio between 0 and 1')
  const feeKobo = Math.round(baseKobo * rate)
  return { baseKobo, feeKobo, totalKobo: baseKobo + feeKobo, rate }
}

/** The configured rate, or the default (with a warning) when the row is missing or invalid. Never throws. */
export async function getTopupFeeRate(supabase, { logger = console } = {}) {
  try {
    const { data, error } = await supabase.from('financial_config').select('value').eq('key', TOPUP_FEE_RATE_KEY).maybeSingle()
    if (error || data?.value == null) throw new Error(error?.message || 'row missing')
    const n = Number(data.value)
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('value out of range')
    return n
  } catch (err) {
    logger.warn?.(JSON.stringify({ event: 'topup.fee_rate_unavailable', key: TOPUP_FEE_RATE_KEY, reason: String(err.message).slice(0, 80), usingDefault: DEFAULT_TOPUP_FEE_RATE }))
    return DEFAULT_TOPUP_FEE_RATE
  }
}

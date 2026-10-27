// Which plan reminder email a CareHub business is due, for the daily cron (cron/check-subscription-expiry.js).
//
// Policy (carehub_20261214_plan_enforcement): 14, 7, 3 and 1 day before expiry; on expiry and during the 7-day grace
// period; then weekly while restricted (monthly after eight weeks, so an abandoned account is not mailed forever).
// Grace ends 7 days after max(expiry, enforcement start), so businesses already expired when restrictions were switched
// on get a full grace period. Before restrictions are switched on (no enforcement start), an expired plan gets the
// same rhythm as a plain "your plan has expired" reminder.
//
// Each stage is sent once per plan period: `key` goes into email_outbox.idempotency_key, whose unique index makes a
// repeat insert (a re-run, or two cron runs) fail instead of mailing twice.

const DAY = 86400000
const GRACE_DAYS = 7

function repeatKey(weeksSince) {
  return weeksSince < 8 ? `w${weeksSince}` : `m${Math.floor(weeksSince / 4)}`
}

// → { stage, templateStage, daysLeft, graceEndsAt } or null when nothing is due.
export function reminderStage({ expiresAt, enforcementStartedAt = null, now = new Date() }) {
  if (!expiresAt) return null
  const exp = new Date(expiresAt).getTime()
  const t = now.getTime()
  if (!Number.isFinite(exp)) return null

  if (exp > t) {
    const daysLeft = Math.ceil((exp - t) / DAY)
    if (daysLeft > 14) return null
    const stage = daysLeft >= 8 ? 'before_14' : daysLeft >= 4 ? 'before_7' : daysLeft >= 2 ? 'before_3' : 'before_1'
    return { stage, templateStage: stage, daysLeft, graceEndsAt: null }
  }

  if (!enforcementStartedAt) {
    const weeks = Math.floor((t - exp) / (7 * DAY))
    return { stage: `lapsed_${repeatKey(weeks)}`, templateStage: 'lapsed', daysLeft: 0, graceEndsAt: null }
  }

  const graceEnd = Math.max(exp, new Date(enforcementStartedAt).getTime()) + GRACE_DAYS * DAY
  const graceEndsAt = new Date(graceEnd).toISOString()
  if (t < graceEnd) {
    const left = Math.ceil((graceEnd - t) / DAY)
    const stage = left <= 1 ? 'grace_last' : left <= 4 ? 'grace_mid' : 'expired'
    return { stage, templateStage: stage, daysLeft: 0, graceEndsAt }
  }
  const weeks = Math.floor((t - graceEnd) / (7 * DAY))
  return { stage: `restricted_${repeatKey(weeks)}`, templateStage: 'restricted', daysLeft: 0, graceEndsAt }
}

export function reminderKey(businessId, expiresAt, stage) {
  return `plan_reminder:${businessId}:${String(expiresAt).slice(0, 10)}:${stage}`
}

// dailyCapCoins is the most CareCoins a user may withdraw in any rolling 24 hours (1 CareCoin = NGN 200).
// It is enforced atomically inside request_withdrawal, not here, so a stolen session plus PIN can only
// move a bounded amount per day and concurrent requests cannot both slip under it.
export const TRUST_LEVELS = {
  new: {
    minWithdrawals: 0,
    maxWithdrawals: 3,
    minConsecutiveSuccess: 0,
    instantThreshold: 0,
    dailyCapCoins: 50,
    requiredAuth: ['pin', 'email'],
    label: 'New',
  },
  trusted: {
    minWithdrawals: 4,
    maxWithdrawals: 15,
    minConsecutiveSuccess: 3,
    instantThreshold: 20,
    dailyCapCoins: 200,
    requiredAuth: ['pin'],
    label: 'Trusted',
  },
  veteran: {
    minWithdrawals: 16,
    maxWithdrawals: Infinity,
    minConsecutiveSuccess: 5,
    instantThreshold: 50,
    dailyCapCoins: 1000,
    requiredAuth: ['biometric', 'device'],
    label: 'Veteran',
  },
}

// Unknown levels get the strictest cap.
export function getDailyCap(trustLevel) {
  return (TRUST_LEVELS[trustLevel] || TRUST_LEVELS.new).dailyCapCoins
}

export function getRequiredAuth(trustLevel, amount) {
  const level = TRUST_LEVELS[trustLevel] || TRUST_LEVELS.new
  const auth = [...level.requiredAuth]

  if (trustLevel === 'new' && amount > 10) {
    auth.push('email')
  }

  return auth
}

export function isInstantEligible(trustLevel, amount) {
  const level = TRUST_LEVELS[trustLevel] || TRUST_LEVELS.new
  return level.instantThreshold > 0 && amount <= level.instantThreshold
}

export function getTrustDescription(trustLevel) {
  const level = TRUST_LEVELS[trustLevel] || TRUST_LEVELS.new

  if (trustLevel === 'new') {
    return 'Complete 4 successful withdrawals with 3 consecutive successes to reach Trusted level.'
  }
  if (trustLevel === 'trusted') {
    return `Instant withdrawals up to ${level.instantThreshold} CareCoins. Complete 16 successful withdrawals with 5 consecutive successes to reach Veteran level.`
  }
  return `Instant withdrawals up to ${level.instantThreshold} CareCoins with biometric authentication.`
}

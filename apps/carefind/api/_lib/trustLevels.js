export const TRUST_LEVELS = {
  new: {
    minWithdrawals: 0,
    maxWithdrawals: 3,
    minConsecutiveSuccess: 0,
    instantThreshold: 0,
    requiredAuth: ['pin', 'email'],
    label: 'New',
  },
  trusted: {
    minWithdrawals: 4,
    maxWithdrawals: 15,
    minConsecutiveSuccess: 3,
    instantThreshold: 20,
    requiredAuth: ['pin'],
    label: 'Trusted',
  },
  veteran: {
    minWithdrawals: 16,
    maxWithdrawals: Infinity,
    minConsecutiveSuccess: 5,
    instantThreshold: 50,
    requiredAuth: ['biometric', 'device'],
    label: 'Veteran',
  },
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

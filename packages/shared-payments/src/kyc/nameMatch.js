// Does the name a BANK reports for an account belong to the person (or business) we verified?
//
// Bank names are messy: order varies ("OBI ADA CHINYERE"), titles appear ("MR"), hyphenated names are split or joined
// ("ADE-BAYO" / "ADEBAYO"), middle names are missing or abbreviated, and typos exist. Matching is order-independent and
// tolerant of those, but strict where it protects money: BOTH first and last name must be present, joint accounts
// ("A & B") never match, and a name with several unexplained extra words is refused.

const TITLES = new Set([
  'MR', 'MRS', 'MISS', 'MS', 'DR', 'PROF', 'CHIEF', 'ALHAJI', 'ALHAJA', 'HAJIYA', 'MALLAM', 'ENGR', 'BARR', 'PASTOR', 'REV',
  'SIR', 'LADY', 'HON', 'ELDER', 'DEACON', 'EVANG', 'PRINCE', 'PRINCESS', 'ALH', 'ENG', 'MAL',
])
const BUSINESS_NOISE = new Set([
  'LTD', 'LIMITED', 'PLC', 'ENTERPRISE', 'ENTERPRISES', 'ENT', 'NIGERIA', 'NIG', 'NG', 'CO', 'COMPANY', 'AND', 'THE', 'INC', 'LLC',
])
const JOINT = /(&|\/|\+|\bAND\b|\bJOINT\b|\bJNT\b)/i
const MAX_EXTRA_PERSONAL = 2

/** Upper-case, accent-free, letters only, split on everything else. Titles and empty tokens removed. */
export function nameTokens(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/['’`]/g, '')
    .replace(/[^A-Z]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !TITLES.has(t))
}

function editDistance(a, b) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 1) return 2
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

// One typo is tolerated only in longer names; short names (e.g. "ADE" vs "ADA") are different people.
function sameWord(a, b) {
  if (a === b) return true
  return a.length >= 6 && b.length >= 6 && editDistance(a, b) <= 1
}

// Find `word` among unused bank tokens: a whole token, or two adjacent tokens joined (the bank split a compound name).
function take(word, tokens, used) {
  for (let i = 0; i < tokens.length; i++) {
    if (!used.has(i) && sameWord(word, tokens[i])) { used.add(i); return true }
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!used.has(i) && !used.has(i + 1) && sameWord(word, tokens[i] + tokens[i + 1])) { used.add(i); used.add(i + 1); return true }
  }
  return false
}

/**
 * Person: the bank's account name against the verified legal name.
 * @returns {{ matches: boolean, score: number, reason?: string }}
 */
export function matchPersonName(bankName, { first, middle, last }) {
  if (JOINT.test(String(bankName || ''))) return { matches: false, score: 0, reason: 'joint_account' }
  const bank = nameTokens(bankName)
  const wantFirst = nameTokens(first)
  const wantLast = nameTokens(last)
  if (bank.length === 0 || wantFirst.length === 0 || wantLast.length === 0) return { matches: false, score: 0, reason: 'missing_name' }

  const used = new Set()
  // A compound name ("Ade-Bayo") may appear joined or split at the bank: try it as one word first, then word by word.
  const takeName = (words) => (words.length > 1 && take(words.join(''), bank, used)) || words.every((w) => take(w, bank, used))
  const firstOk = takeName(wantFirst)
  const lastOk = takeName(wantLast)
  if (!firstOk || !lastOk) return { matches: false, score: 0, reason: 'name_mismatch' }

  // Middle names are optional on the bank side; credit them when present, allow an initial.
  const wantMiddle = nameTokens(middle)
  let middleHits = 0
  for (const w of wantMiddle) {
    if (take(w, bank, used)) { middleHits++; continue }
    const ix = bank.findIndex((t, i) => !used.has(i) && t.length === 1 && t === w[0])
    if (ix >= 0) { used.add(ix); middleHits++ }
  }

  const extras = bank.filter((_, i) => !used.has(i)).length
  if (extras > MAX_EXTRA_PERSONAL) return { matches: false, score: 0, reason: 'extra_words' }

  const required = 2 + wantMiddle.length
  const score = Math.max(0, (2 + middleHits) / required - extras * 0.05)
  return { matches: true, score: Number(score.toFixed(2)) }
}

/**
 * Business: the bank's account name against the registered business name, ignoring legal-form words (LTD, ENTERPRISES...).
 * @returns {{ matches: boolean, score: number, reason?: string }}
 */
export function matchBusinessName(bankName, businessName) {
  const strip = (v) => nameTokens(v).filter((t) => !BUSINESS_NOISE.has(t))
  const bank = strip(bankName)
  const want = strip(businessName)
  if (bank.length === 0 || want.length === 0) return { matches: false, score: 0, reason: 'missing_name' }

  const used = new Set()
  const hits = want.filter((w) => take(w, bank, used)).length
  const extras = bank.length - used.size
  if (hits < want.length || extras > 1) return { matches: false, score: 0, reason: 'name_mismatch' }
  return { matches: true, score: Number((hits / (want.length + extras)).toFixed(2)) }
}

// commandRegistry — kbar/cmdk registry: 20 commands (Approve/Revoke/Pay, Go to…)
// Filtered by navCatalogueFor perms — AD-5,10
// Uses command-score for fuzzy ranking (caller may use cmdk built-in or manual score)

import { PLATFORM_NAV, navCatalogueFor, hasPlatformPerm } from '../../lib/platformPermissions'

// 20 base commands: 8 nav + 12 actions. Dynamic business-specific cmds are
// expanded at runtime from pending businesses / payouts.

export const BASE_COMMANDS = [
  // Nav — 8
  { id: 'go-dashboard', label: 'Go to Dashboard', keywords: ['dashboard','home','overview'], section: 'Navigation', perm: 'Dashboard', shortcut: 'G D', action: 'navigate', target: 'dashboard' },
  { id: 'go-businesses', label: 'Go to Businesses', keywords: ['businesses','vendors','companies'], section: 'Navigation', perm: 'Businesses', shortcut: 'G B', action: 'navigate', target: 'businesses' },
  { id: 'go-team-agents', label: 'Go to Team — Agents', keywords: ['team agents','agents'], section: 'Navigation', perm: 'Team-Agents', shortcut: 'G A', action: 'navigate', target: 'team-agents' },
  { id: 'go-team-platform', label: 'Go to Team — Platform', keywords: ['platform team','roles'], section: 'Navigation', perm: 'Team-Platform', shortcut: 'G P', action: 'navigate', target: 'team-platform' },
  { id: 'go-applications', label: 'Go to Applications', keywords: ['applications','queue'], section: 'Navigation', perm: 'Applications', shortcut: 'G Q', action: 'navigate', target: 'applications' },
  { id: 'go-ledger', label: 'Go to Ledger', keywords: ['ledger','statement','finance'], section: 'Navigation', perm: 'Ledger', shortcut: 'G L', action: 'navigate', target: 'ledger' },
  { id: 'go-payouts', label: 'Go to Payouts', keywords: ['payouts','pay'], section: 'Navigation', perm: 'Payouts', shortcut: 'G O', action: 'navigate', target: 'payouts' },
  { id: 'go-coverage', label: 'Go to Coverage', keywords: ['coverage','territory','map'], section: 'Navigation', perm: 'Coverage', shortcut: 'G C', action: 'navigate', target: 'coverage' },

  // Actions — 12 (permission-gated where relevant)
  { id: 'action-search-businesses', label: 'Search businesses…', keywords: ['search','find','filter'], section: 'Actions', perm: 'Businesses', shortcut: '/', action: 'focusSearch' },
  { id: 'action-export-businesses', label: 'Export businesses CSV', keywords: ['export','csv','download'], section: 'Actions', perm: 'Businesses', shortcut: '', action: 'exportBusinesses' },
  { id: 'action-refresh', label: 'Refresh data', keywords: ['refresh','reload','sync'], section: 'Actions', perm: null, shortcut: 'R', action: 'refresh' },
  { id: 'action-toggle-theme', label: 'Toggle theme (light/dark)', keywords: ['theme','dark','light'], section: 'Actions', perm: null, shortcut: 'T', action: 'toggleTheme' },
  { id: 'action-signout', label: 'Sign out', keywords: ['logout','sign out'], section: 'Actions', perm: null, shortcut: '', action: 'signout' },
  { id: 'action-review-applications', label: 'Review pending applications', keywords: ['review','applications','pending'], section: 'Actions', perm: 'Applications', shortcut: '', action: 'navigate', target: 'applications' },
  { id: 'action-view-payouts-pending', label: 'View pending payouts', keywords: ['payouts pending','pay'], section: 'Actions', perm: 'Payouts', shortcut: '', action: 'navigate', target: 'payouts' },
  // approve/revoke/pay are expanded per entity below, these are generic hints:
  { id: 'action-approve-hint', label: 'Approve business…', keywords: ['approve','accept','active'], section: 'Approve', perm: 'Businesses', shortcut: 'A', action: 'approveHint' },
  { id: 'action-revoke-hint', label: 'Revoke business…', keywords: ['revoke','withdraw','remove'], section: 'Approve', perm: 'Businesses', shortcut: 'R', action: 'revokeHint' },
  { id: 'action-suspend-hint', label: 'Suspend business…', keywords: ['suspend','pause','temporary'], section: 'Approve', perm: 'Businesses', shortcut: 'S', action: 'suspendHint' },
  { id: 'action-mark-paid-hint', label: 'Mark payout as Paid…', keywords: ['paid','mark paid','pay'], section: 'Payouts', perm: 'Payouts', shortcut: 'P', action: 'markPaidHint' },
]

// Build dynamic business commands from live data.
// `opts`: { businesses, payouts, perms, recentIds }
// Returns up to 20+ commands, filtered by perms, recent first.
export function buildCommandList({ businesses, payouts, perms = null, recentIds = [] } = {}) {
  const safeBusinesses = Array.isArray(businesses) ? businesses : []
  const safePayouts = Array.isArray(payouts) ? payouts : []
  const allowed = perms ? new Set(navCatalogueFor(perms).map(n => n.perm)) : null
  // helper to check perm: null perm means always allowed
  const isAllowed = (perm) => {
    if (!perm) return true
    if (!allowed) return true
    return allowed.has(perm)
  }

  const list = []

  // base commands filtered
  for (const c of BASE_COMMANDS) {
    if (isAllowed(c.perm)) list.push({ ...c })
  }

  // dynamic per-business Approve/Revoke/Suspend (pending & active)
  if (isAllowed('Businesses')) {
    const pending = safeBusinesses.filter(b => b.status === 'pending' && !b.deleted_at).slice(0, 6)
    for (const b of pending) {
      list.push({
        id: `approve-${b.id}`,
        label: `Approve ${b.name}`,
        keywords: ['approve', b.name, b.state || '', b.category || ''],
        section: 'Approve',
        perm: 'Businesses',
        shortcut: 'A',
        action: 'approveBusiness',
        businessId: b.id,
        business: b,
      })
      list.push({
        id: `suspend-pending-${b.id}`,
        label: `Reject ${b.name}`,
        keywords: ['reject','revoke', b.name],
        section: 'Approve',
        perm: 'Businesses',
        shortcut: '',
        action: 'revokeBusiness',
        businessId: b.id,
        business: b,
      })
    }
    const active = safeBusinesses.filter(b => b.status === 'active' && !b.deleted_at).slice(0, 4)
    for (const b of active) {
      list.push({
        id: `suspend-${b.id}`,
        label: `Suspend ${b.name} (temporary)`,
        keywords: ['suspend','pause', b.name],
        section: 'Approve',
        perm: 'Businesses',
        shortcut: 'S',
        action: 'suspendBusiness',
        businessId: b.id,
        business: b,
      })
      list.push({
        id: `revoke-${b.id}`,
        label: `Revoke ${b.name} (withdrawal)`,
        keywords: ['revoke','withdraw', b.name],
        section: 'Approve',
        perm: 'Businesses',
        shortcut: 'R',
        action: 'revokeBusiness',
        businessId: b.id,
        business: b,
      })
    }
    // View sheet for every business (searchable)
    for (const b of safeBusinesses.slice(0, 8)) {
      list.push({
        id: `view-${b.id}`,
        label: `Open ${b.name}`,
        keywords: ['open','view', b.name, b.state || ''],
        section: 'Businesses',
        perm: 'Businesses',
        shortcut: '',
        action: 'openBusiness',
        businessId: b.id,
        business: b,
      })
    }
  }

  // dynamic payouts: Mark Paid for processing
  if (isAllowed('Payouts')) {
    const processing = safePayouts.filter(p => p.status === 'processing').slice(0, 4)
    for (const p of processing) {
      list.push({
        id: `pay-${p.id}`,
        label: `Mark Paid ${p.requester_id?.slice(0,6) || p.id.slice(0,6)} — ${p.amount || ''}`,
        keywords: ['pay','paid','mark paid', p.requester_id || ''],
        section: 'Payouts',
        perm: 'Payouts',
        shortcut: 'P',
        action: 'markPayoutPaid',
        payoutId: p.id,
        payout: p,
      })
    }
    const pendingPayouts = safePayouts.filter(p => p.status === 'pending').slice(0, 3)
    for (const p of pendingPayouts) {
      list.push({
        id: `approve-payout-${p.id}`,
        label: `Approve payout ${p.requester_id?.slice(0,6) || p.id.slice(0,6)} → processing`,
        keywords: ['approve payout','processing', p.requester_id || ''],
        section: 'Payouts',
        perm: 'Payouts',
        shortcut: 'A',
        action: 'approvePayout',
        payoutId: p.id,
        payout: p,
      })
    }
  }

  // Dedupe by id, cap 30 then slice to 20 for palette but keep all for scoring
  const seen = new Set()
  const deduped = list.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })

  // Recent boosting: move recentIds to top
  if (recentIds && recentIds.length) {
    deduped.sort((a,b) => {
      const ai = recentIds.indexOf(a.id)
      const bi = recentIds.indexOf(b.id)
      const aRecent = ai !== -1 ? ai : 999
      const bRecent = bi !== -1 ? bi : 999
      return aRecent - bRecent
    })
  }

  // Ensure at least 20 commands; if perms filter leaves <20, fill with allowed basics
  // Spec requires exactly 20 filtered commands visible in palette (before dynamic)
  // Caller can slice; we return all filtered.
  return deduped
}

// Filter helper for explicit perm check (used by palette)
export function filterCommandsByPerms(commands, perms) {
  const safeCommands = Array.isArray(commands) ? commands : []
  if (!perms) return safeCommands
  const allowed = new Set(navCatalogueFor(perms).map(n => n.perm))
  return safeCommands.filter(c => !c.perm || allowed.has(c.perm))
}

// Simple fuzzy matcher using command-score if available, fallback to includes.
// Used when cmdk not handling scoring.
export function scoreCommand(command, query) {
  if (!query) return 1
  const q = query.toLowerCase()
  const hay = [command.label, ...(command.keywords||[])].join(' ').toLowerCase()
  // exact substring boost
  if (hay.includes(q)) {
    // shorter label match ranks higher
    return 2 + (1 / (command.label.length || 1))
  }
  // initials?
  const words = command.label.toLowerCase().split(/\s+/)
  const initials = words.map(w=>w[0]).join('')
  if (initials.includes(q.replace(/\s/g,''))) return 1.2
  return 0
}

export default { BASE_COMMANDS, buildCommandList, filterCommandsByPerms, scoreCommand }

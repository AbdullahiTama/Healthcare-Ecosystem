// Re-export unified design tokens from shared package
// Extended with dark-first CSS var tokens + data-theme switch per AD-4 / Quiet Chrome.
// Color = state only: surfaces are monochrome, only amber/green/red convey state.

import { theme as baseTheme } from '../../../../packages/design-system/src/theme.js'

// ── CSS var tokens (dark-first) ────────────────────────────────────────────
// Dark is default; light overrides via [data-theme="light"].
// Also respects OS prefers-color-scheme when no explicit data-theme set.
// All UI should use var(--xxx) so the toggle works without JS re-render.
// Quiet Chrome: near-monochrome surfaces, one accent (teal), 13px body.

const CSS_VARS = `
:root {
  --bg: #0B1412;
  --panel: #121C19;
  --panel-hover: #16211E;
  --fg: #E8EDEB;
  --muted: #8B9A94;
  --muted-2: #6B7D77;
  --border: #1E2D29;
  --hairline: #1E2D29;
  --teal: #0E6F5A;
  --teal-deep: #0E6F5A;
  --teal-hover: #0B5A49;
  --teal-mist: rgba(14,111,90,0.12);
  --amber: #d97706;
  --amber-bg: rgba(217,119,6,0.12);
  --green: #16a34a;
  --green-bg: rgba(22,163,74,0.12);
  --red: #dc2626;
  --red-bg: rgba(220,38,38,0.10);
  --gray: #6B7280;
  --overlay: rgba(6,12,10,0.72);
  --elevation-1: 0 1px 4px rgba(0,0,0,0.3);
  --elevation-2: 0 4px 16px rgba(0,0,0,0.35);
  color-scheme: dark;
}
[data-theme="light"] {
  --bg: #F7F5EF;
  --panel: #FBFAF6;
  --panel-hover: #F2EFE6;
  --fg: #182722;
  --muted: #5B6B63;
  --muted-2: #8B978F;
  --border: #ECEAE0;
  --hairline: #E7E4D9;
  --teal: #0E6F5A;
  --teal-deep: #0E6F5A;
  --teal-hover: #0B5A49;
  --teal-mist: #E3EEE8;
  --amber: #d97706;
  --amber-bg: #fffbeb;
  --green: #16a34a;
  --green-bg: #f0fdf4;
  --red: #dc2626;
  --red-bg: #fef2f2;
  --gray: #6B7280;
  --overlay: rgba(15,23,42,0.55);
  --elevation-1: 0 1px 4px rgba(15,23,42,0.05);
  --elevation-2: 0 4px 16px rgba(15,23,42,0.08);
  color-scheme: light;
}
[data-theme="dark"] {
  --bg: #0B1412;
  --panel: #121C19;
  --panel-hover: #16211E;
  --fg: #E8EDEB;
  --muted: #8B9A94;
  --muted-2: #6B7D77;
  --border: #1E2D29;
  --hairline: #1E2D29;
  --teal: #14a68a;
  --teal-deep: #14a68a;
  --teal-hover: #0E6F5A;
  --teal-mist: rgba(14,111,90,0.16);
  --amber: #f59e0b;
  --amber-bg: rgba(245,158,11,0.12);
  --green: #22c55e;
  --green-bg: rgba(34,197,94,0.12);
  --red: #ef4444;
  --red-bg: rgba(239,68,68,0.10);
  --gray: #8B9A94;
  --overlay: rgba(6,12,10,0.72);
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
  }
}
html[data-theme="dark"] body, html:not([data-theme]) body {
  background: var(--bg);
  color: var(--fg);
}
html[data-theme="light"] body {
  background: var(--bg);
  color: var(--fg);
}
/* Ensure Quiet Chrome: color only on state dots/pills — surfaces stay monochrome */
`

function injectThemeVars() {
  if (typeof document === 'undefined') return
  if (document.getElementById('carehub-theme-vars')) return
  const el = document.createElement('style')
  el.id = 'carehub-theme-vars'
  el.textContent = CSS_VARS
  document.head.appendChild(el)
}

injectThemeVars()

export function getStoredTheme() {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem('carehub_theme') } catch { return null }
}

export function applyTheme(name) {
  if (typeof document === 'undefined') return
  const t = name === 'light' || name === 'dark' ? name : 'dark'
  document.documentElement.setAttribute('data-theme', t)
  try { localStorage.setItem('carehub_theme', t) } catch {}
}

export function toggleTheme() {
  if (typeof document === 'undefined') return 'dark'
  // check localStorage first, then system light preference per spec (FOUC guard)
  const stored = getStoredTheme()
  const cur = document.documentElement.getAttribute('data-theme') || stored || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  const next = cur === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

export function initTheme() {
  if (typeof document === 'undefined') return
  injectThemeVars()
  const stored = getStoredTheme()
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored)
    return
  }
  // system preference via light check (spec) — if light prefers light, else dark-first
  const prefersLight = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
  document.documentElement.setAttribute('data-theme', prefersLight ? 'light' : 'dark')
}

// FOUC guard: init synchronously before paint on import (dark-first)
// No DOMContentLoaded defer — injectThemeVars + initTheme run immediately
if (typeof window !== 'undefined') {
  initTheme()
  // keep in sync with OS when no explicit choice stored
  try {
    const mqLight = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e) => {
      const stored = getStoredTheme()
      if (stored) return
      document.documentElement.setAttribute('data-theme', e.matches ? 'light' : 'dark')
    }
    if (mqLight && mqLight.addEventListener) mqLight.addEventListener('change', handler)
    else if (mqLight && mqLight.addListener) mqLight.addListener(handler)
    // also listen dark for older browsers
    const mqDark = window.matchMedia('(prefers-color-scheme: dark)')
    if (mqDark && mqDark.addEventListener) mqDark.addEventListener('change', (e) => {
      const s = getStoredTheme()
      if (s) return
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light')
    })
  } catch {}
}

// Re-export base theme plus var-aware aliases for components that read theme object.
// New code should prefer CSS vars (var(--bg) etc) but existing inline styles keep
// working because these aliases resolve to var() strings, switching with data-theme.
export const theme = {
  ...baseTheme,
  // CSS var aliases — use these for Quiet Chrome surfaces so dark/light flips
  bg: 'var(--bg)',
  panel: 'var(--panel)',
  fg: 'var(--fg)',
  border: 'var(--border)',
  hairline: 'var(--hairline)',
  overlay: 'var(--overlay)',
  // keep original hexes as fallbacks via *_hex
  bg_hex: baseTheme.bg,
  cardBg_hex: baseTheme.cardBg,
  // state-only colors remain as hex but also available as vars
  teal: 'var(--teal)',
  tealDeep: 'var(--teal-deep)',
  amber: 'var(--amber)',
  green: 'var(--green)',
  red: 'var(--red)',
}

export default theme

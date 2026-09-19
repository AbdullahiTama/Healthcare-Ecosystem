// Re-export unified design tokens from shared package
// Light-only mode: dark mode removed to fix white-on-white text visibility
// (hardcoded white surfaces + var(--fg) light in dark mode caused invisible text).
// All tokens now map to light warm scale; toggle is no-op for backward compat.

import { theme as baseTheme } from '../../../../packages/design-system/src/theme.js'

// ── CSS var tokens (light-only) ────────────────────────────────────────────
// Single source: light warm palette. No data-theme variants, no OS preference.
// Fixes invisible white text: var(--fg) is always dark (#182722) on light bg.

const CSS_VARS = `
:root {
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
html body {
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
  return 'light'
}

export function applyTheme() {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', 'light')
  try { localStorage.removeItem('carehub_theme') } catch {}
}

export function toggleTheme() {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', 'light')
    try { localStorage.removeItem('carehub_theme') } catch {}
  }
  return 'light'
}

export function initTheme() {
  if (typeof document === 'undefined') return
  injectThemeVars()
  document.documentElement.setAttribute('data-theme', 'light')
  try { localStorage.removeItem('carehub_theme') } catch {}
}

// FOUC guard: init synchronously before paint — force light
if (typeof window !== 'undefined') {
  initTheme()
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

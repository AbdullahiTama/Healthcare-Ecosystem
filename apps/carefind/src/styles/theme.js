// Re-export unified design tokens from shared package
// Light mode only for CareFind — no dark mode toggle.
// Color = state only: surfaces are monochrome, only amber/green/red convey state.

import { theme as baseTheme } from '../../../../packages/design-system/src/theme.js'

// ── CSS var tokens (light mode only) ────────────────────────────────────────
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
`

function injectThemeVars() {
  if (typeof document === 'undefined') return
  if (document.getElementById('carefind-theme-vars')) return
  const el = document.createElement('style')
  el.id = 'carefind-theme-vars'
  el.textContent = CSS_VARS
  document.head.appendChild(el)
}

injectThemeVars()

export function initTheme() {
  if (typeof document === 'undefined') return
  injectThemeVars()
  document.documentElement.setAttribute('data-theme', 'light')
}

if (typeof window !== 'undefined') {
  initTheme()
}

export const theme = {
  ...baseTheme,
  bg: 'var(--bg)',
  panel: 'var(--panel)',
  fg: 'var(--fg)',
  border: 'var(--border)',
  hairline: 'var(--hairline)',
  overlay: 'var(--overlay)',
  bg_hex: baseTheme.bg,
  cardBg_hex: baseTheme.cardBg,
  teal: 'var(--teal)',
  tealDeep: 'var(--teal-deep)',
  amber: 'var(--amber)',
  green: 'var(--green)',
  red: 'var(--red)',
}

export default theme

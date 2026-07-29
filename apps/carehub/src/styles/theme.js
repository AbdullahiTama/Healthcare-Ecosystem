// Design tokens for CareHub, matching docs/design/DESIGN_SYSTEM.md and its
// linked documents (COLORS.md, TYPOGRAPHY.md, SPACING.md, GRID_SYSTEM.md,
// ELEVATION.md, MOTION.md, ICONS.md). Mirrors the shape of CareFind's
// ../../../carefind/src/styles/theme.js so both apps share one system
// (DESIGN_PRINCIPLES.md's consistency principle) while each keeps its own
// product-specific application (TYPOGRAPHY.md's CareHub vs CareFind section).
// `lib/utils.js`'s TEAL/DARK/TEALC constants now re-export from here, so
// every existing call site keeps working unchanged.

export const theme = {
  // ── Brand — custom teal palette ─────────────────────────────────────────
  tealDeep: '#0E6F5A',
  tealBright: '#0E6F5A',
  tealHover: '#0B5A49',
  deepTeal: '#0B4A3E',
  navy: '#182722',
  navySoft: '#3C4B44',
  bg: '#F7F5EF',
  canvasBg: '#E7E5DC',
  cardBg: '#FBFAF6',
  border: '#ECEAE0',
  hairline: '#E7E4D9',
  textDark: '#182722',
  textMid: '#3C4B44',
  textLight: '#8B978F',
  textMuted: '#9AA69F',
  success: '#0E6F5A',
  warning: '#d97706',
  alert: '#dc2626',
  heroGradient: 'linear-gradient(135deg, #0E6F5A 0%, #0B4A3E 100%)',
  tealGradient: 'linear-gradient(135deg, #0E6F5A, #0B5A49)',
  darkGradient: 'linear-gradient(135deg, #0B4A3E, #0E6F5A)',

  // ── Full neutral scale (COLORS.md) ──────────────────────────────────────────
  gray50: '#FBFAF6',
  gray100: '#F7F5EF',
  gray200: '#ECEAE0',
  gray300: '#E7E4D9',
  gray400: '#9AA69F',
  gray500: '#8B978F',
  gray600: '#5B6B63',
  gray900: '#182722',

  // ── Semantic colors (COLORS.md) ─────────────────────────────────────────────
  danger: '#dc2626',
  info: '#2563eb',
  purple: '#7c3aed',
  successBg: '#E3EEE8',
  warningBg: '#fffbeb',
  dangerBg: '#fef2f2',
  infoBg: '#eff6ff',
  tealMist: '#E3EEE8',

  // ── Typography scale (TYPOGRAPHY.md) ────────────────────────────────────────
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontMono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  // Marketing/public pages only (e.g. Landing.jsx) — never dashboard/POS/
  // form/table screens. See TYPOGRAPHY.md's "Display serif" section.
  fontDisplay: '"Lora", Georgia, "Times New Roman", serif',
  type: {
    display: { size: 24, weight: 900, lineHeight: 1.2 },
    h1: { size: 21, weight: 900, lineHeight: 1.25 },
    h2: { size: 18, weight: 800, lineHeight: 1.3 },
    h3: { size: 15, weight: 800, lineHeight: 1.35 },
    bodyLg: { size: 14, weight: 500, lineHeight: 1.5 },
    body: { size: 13, weight: 500, lineHeight: 1.5 },
    bodySm: { size: 12, weight: 600, lineHeight: 1.4 },
    caption: { size: 11, weight: 700, lineHeight: 1.4 },
    micro: { size: 10.5, weight: 700, lineHeight: 1.3 },
  },

  // ── Spacing scale (SPACING.md, 4px-based) ───────────────────────────────────
  space: {
    1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20, 11: 24, 12: 32,
  },

  // ── Corner radius scale (DESIGN_SYSTEM.md) ──────────────────────────────────
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
    full: 9999,
  },

  // ── Elevation / shadow scale (ELEVATION.md — navy-based, never pure black) ──
  elevation: {
    0: 'none',
    1: '0 1px 4px rgba(15,23,42,0.05)',
    2: '0 4px 16px rgba(15,23,42,0.08)',
    3: '0 8px 24px rgba(15,23,42,0.12)',
    4: '0 20px 48px rgba(15,23,42,0.18)',
  },

  // ── Motion (MOTION.md) ───────────────────────────────────────────────────────
  motion: {
    instant: '0ms',
    fast: '140ms',
    base: '200ms',
    slow: '300ms',
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeIn: 'cubic-bezier(0.7, 0, 0.84, 0)',
  },

  // ── Icon sizing (ICONS.md) ───────────────────────────────────────────────────
  icon: {
    xs: 14, sm: 16, md: 20, lg: 24, xl: 40,
  },

  // ── Breakpoints (GRID_SYSTEM.md) ────────────────────────────────────────────
  breakpoints: {
    mobile: 320,
    tablet: 768,
    laptop: 1024,
    desktop: 1440,
    largeDesktop: 1920,
  },
}

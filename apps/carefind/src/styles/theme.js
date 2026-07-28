// Design tokens for CareFind.
// Brand palette: warm natural teal — primary #0E6F5A, deep #0B4A3E.

export const theme = {
  // ── Brand ───────────────────────────────────────────────────────────────────
  tealDeep: '#0E6F5A',
  tealBright: '#1A8A72',
  tealHover: '#0B5A49',
  navy: '#0B4A3E',
  navySoft: '#155A4B',
  bg: '#F7F5EF',
  cardBg: '#FBFAF6',
  border: '#ECEAE0',
  textDark: '#182722',
  textMid: '#3C4B44',
  textLight: '#8B978F',
  success: '#16a34a',
  warning: '#d97706',
  alert: '#dc2626',
  heroGradient: 'linear-gradient(135deg, #0B4A3E 0%, #155A4B 55%, #0E6F5A 130%)',
  tealGradient: 'linear-gradient(135deg, #0E6F5A, #0B4A3E)',

  // ── Full neutral scale ──────────────────────────────────────────────────────
  gray50: '#F7F5EF',
  gray100: '#F0EEE5',
  gray200: '#E7E4D9',
  gray300: '#D4D0C5',
  gray400: '#9AA69F',
  gray500: '#8B978F',
  gray600: '#3C4B44',
  gray900: '#182722',

  // ── Semantic colors (COLORS.md) ─────────────────────────────────────────────
  // `danger` is the canonical name going forward; `alert` above is kept as an
  // alias so existing call sites are untouched.
  danger: '#dc2626',
  info: '#2563eb',
  purple: '#7c3aed',
  successBg: '#f0fdf4',
  warningBg: '#fffbeb',
  dangerBg: '#fef2f2',
  infoBg: '#eff6ff',
  tealMist: '#e8f3ee',

  // ── Typography scale ────────────────────────────────────────────────────────
  fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontMono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontDisplay: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  type: {
    display: { size: 28, weight: 900, lineHeight: 1.15, letterSpacing: '-0.03em' },
    h1: { size: 24, weight: 900, lineHeight: 1.2, letterSpacing: '-0.02em' },
    h2: { size: 19, weight: 800, lineHeight: 1.25, letterSpacing: '-0.01em' },
    h3: { size: 16, weight: 800, lineHeight: 1.3 },
    bodyLg: { size: 15, weight: 500, lineHeight: 1.55 },
    body: { size: 14, weight: 500, lineHeight: 1.55 },
    bodySm: { size: 13, weight: 600, lineHeight: 1.45 },
    caption: { size: 11.5, weight: 600, lineHeight: 1.4, letterSpacing: '0.02em' },
    micro: { size: 10.5, weight: 600, lineHeight: 1.3, letterSpacing: '0.04em' },
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

  // ── Elevation / shadow scale (deep-teal-based, never pure black) ────────────
  elevation: {
    0: 'none',
    1: '0 1px 4px rgba(11,74,62,0.05)',
    2: '0 4px 16px rgba(11,74,62,0.08)',
    3: '0 8px 24px rgba(11,74,62,0.12)',
    4: '0 20px 48px rgba(11,74,62,0.18)',
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

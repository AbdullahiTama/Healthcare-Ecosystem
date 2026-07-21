// Design tokens for CareFind, matching docs/design/DESIGN_SYSTEM.md and its
// linked documents (COLORS.md, TYPOGRAPHY.md, SPACING.md, GRID_SYSTEM.md,
// ELEVATION.md, MOTION.md, ICONS.md). This is a superset of the original
// theme.js — every pre-existing key keeps its exact original value, so all
// existing call sites (`theme.tealDeep`, etc.) keep working unchanged.

export const theme = {
  // ── Original keys (unchanged values — backward compatible) ─────────────────
  tealDeep: '#0f766e',
  tealBright: '#14b8a6',
  navy: '#0f172a',
  navySoft: '#1e293b',
  bg: '#f9f9f6',
  cardBg: '#ffffff',
  border: '#f0f0f0',
  textDark: '#0f172a',
  textMid: '#475569',
  textLight: '#94a3b8',
  success: '#16a34a',
  warning: '#d97706',
  alert: '#dc2626',
  heroGradient: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #0f766e 130%)',
  tealGradient: 'linear-gradient(135deg, #14b8a6, #0f766e)',

  // ── Full neutral scale (COLORS.md) ──────────────────────────────────────────
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#cbd5e1',
  gray400: '#94a3b8',
  gray500: '#64748b',
  gray600: '#475569',
  gray900: '#0f172a',

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

  // ── Typography scale (TYPOGRAPHY.md) ────────────────────────────────────────
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontMono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  // Marketing/public pages only — never product screens. See TYPOGRAPHY.md's
  // "Display serif" section.
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

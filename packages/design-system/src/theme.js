// Unified Design Tokens — HealthCare Ecosystem
// Single source of truth for CareHub + CareFind
// See docs/design/DESIGN-SYSTEM.md, docs/design/COLORS.md, docs/design/TYPOGRAPHY.md,
// docs/design/SPACING.md, docs/design/GRID_SYSTEM.md, docs/design/ELEVATION.md,
// docs/design/MOTION.md, docs/design/ICONS.md, docs/design/ACCESSIBILITY.md

export const theme = {
  // ──────────────────────────────────────────────────────────────────────────────
  // BRAND PALETTE (Preserved — do not change without design review)
  // ──────────────────────────────────────────────────────────────────────────────
  tealDeep: '#0E6F5A',       // Primary actions, active nav, primary buttons, key emphasis
  tealBright: '#1A8A72',     // CareFind: brighter accent for consumer surfaces
  tealHover: '#0B5A49',      // Button hover, interactive emphasis
  navy: '#0B4A3E',           // Primary text, headings, deep surfaces
  navySoft: '#3C4B44',       // Secondary text, muted headings

  // ──────────────────────────────────────────────────────────────────────────────
  // NEUTRAL SCALE (Unified — CareHub's warmer scale as canonical)
  // ──────────────────────────────────────────────────────────────────────────────
  gray50: '#FBFAF6',         // Card backgrounds, elevated surfaces
  gray100: '#F7F5EF',        // Page background (bg)
  gray200: '#ECEAE0',        // Borders, dividers, input borders
  gray300: '#E7E4D9',        // Hairlines, subtle separators
  gray400: '#9AA69F',        // Disabled text, placeholder, secondary icons
  gray500: '#8B978F',        // Muted text, tertiary information
  gray600: '#5B6B63',        // Helper text, labels, inactive states
  gray900: '#182722',        // Primary text (alias: textDark, navy)

  // Semantic surface aliases
  bg: '#F7F5EF',             // Page background (=== gray100)
  cardBg: '#FBFAF6',         // Card, modal, drawer backgrounds (=== gray50)
  border: '#ECEAE0',         // Default borders, dividers (=== gray200)
  hairline: '#E7E4D9',       // Subtle separators (=== gray300)
  overlay: 'rgba(15,23,42,0.55)', // Modal/drawer/sheet backdrop (neutral slate — Slice 4)
  textDark: '#182722',       // Primary text (=== gray900, navy)
  textMid: '#3C4B44',        // Secondary text (=== gray600)
  textLight: '#8B978F',      // Muted text (=== gray500)
  textMuted: '#9AA69F',      // Disabled/placeholder (=== gray400)

  // ──────────────────────────────────────────────────────────────────────────────
  // SEMANTIC COLORS (Unified — success is green, not brand teal)
  // ──────────────────────────────────────────────────────────────────────────────
  success: '#16a34a',        // Confirmed, paid, completed, active
  warning: '#d97706',        // Pending, low stock, credit due
  danger: '#dc2626',         // Cancelled, out of stock, errors, destructive
  info: '#2563eb',           // Information, online, in-progress
  purple: '#7c3aed',         // Online consultations, special actions

  // Semantic backgrounds (for badges, alerts, state surfaces)
  successBg: '#f0fdf4',
  warningBg: '#fffbeb',
  dangerBg: '#fef2f2',
  infoBg: '#eff6ff',
  purpleBg: '#f5f3ff',
  tealMist: '#E3EEE8',       // Teal-tinted surfaces (selected rows, hover)

  // ──────────────────────────────────────────────────────────────────────────────
  // HEALTHCARE-SPECIFIC SEMANTIC STATES
  // Always pair with icon + text — never color alone
  // ──────────────────────────────────────────────────────────────────────────────
  // Critical Stock: danger + dangerBg + ⚠️
  // Low Stock: warning + warningBg + 📦
  // Available: success + successBg + ✅
  // Unavailable: gray500 + gray100 + ❌
  // Pending: warning + warningBg + ⏳
  // Approved: success + successBg + ✅
  // Rejected: danger + dangerBg + ❌
  // Urgent: danger + dangerBg + 🚨

  // ──────────────────────────────────────────────────────────────────────────────
  // GRADIENTS (Marketing/hero only — never operational surfaces)
  // ──────────────────────────────────────────────────────────────────────────────
  heroGradient: 'linear-gradient(135deg, #0E6F5A 0%, #0B4A3E 100%)',
  tealGradient: 'linear-gradient(135deg, #0E6F5A, #0B5A49)',
  darkGradient: 'linear-gradient(135deg, #0B4A3E, #0E6F5A)',

  // ──────────────────────────────────────────────────────────────────────────────
  // TYPOGRAPHY
  // ──────────────────────────────────────────────────────────────────────────────
  fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontMono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontDisplay: '"Lora", Georgia, "Times New Roman", serif', // Marketing pages only

  type: {
    display: { size: 24, weight: 900, lineHeight: 1.2, letterSpacing: '-0.02em' },   // Marketing hero
    h1: { size: 21, weight: 900, lineHeight: 1.25, letterSpacing: '-0.02em' },       // Page titles
    h2: { size: 18, weight: 800, lineHeight: 1.3, letterSpacing: '-0.015em' },       // Section titles
    h3: { size: 15, weight: 800, lineHeight: 1.35, letterSpacing: '-0.01em' },       // Card titles
    bodyLg: { size: 14, weight: 500, lineHeight: 1.5, letterSpacing: '0' },          // Important body, KPI labels
    body: { size: 13, weight: 500, lineHeight: 1.5, letterSpacing: '0' },             // Default body text
    bodySm: { size: 12, weight: 600, lineHeight: 1.4, letterSpacing: '0' },           // Secondary info, metadata
    caption: { size: 11, weight: 700, lineHeight: 1.4, letterSpacing: '0.02em' },     // Labels, pill text, timestamps
    micro: { size: 10.5, weight: 700, lineHeight: 1.3, letterSpacing: '0.04em' },     // Dense tables, footnotes
  },

  // ──────────────────────────────────────────────────────────────────────────────
  // SPACING (4px base scale)
  // ──────────────────────────────────────────────────────────────────────────────
  space: {
    1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20, 11: 24, 12: 32,
  },

  // ──────────────────────────────────────────────────────────────────────────────
  // BORDER RADIUS
  // ──────────────────────────────────────────────────────────────────────────────
  radius: {
    sm: 6,       // Buttons, inputs, badges, pills
    md: 10,      // Cards (default), modals, dropdowns
    lg: 14,      // Large cards, stat cards, sheets
    xl: 20,      // Sheets, hero cards, marketing
    full: 9999,  // Avatars, pills, toggle switches
  },

  // ──────────────────────────────────────────────────────────────────────────────
  // ELEVATION / SHADOWS (Navy-based, never pure black)
  // ──────────────────────────────────────────────────────────────────────────────
  elevation: {
    0: 'none',
    1: '0 1px 4px rgba(15,23,42,0.05)',   // Default card
    2: '0 4px 16px rgba(15,23,42,0.08)',  // Hovered card, raised dropdown
    3: '0 8px 24px rgba(15,23,42,0.12)',  // Modal, sheet, popover
    4: '0 20px 48px rgba(15,23,42,0.18)', // Full-screen modal, critical overlay
  },

  // ──────────────────────────────────────────────────────────────────────────────
  // MOTION
  // ──────────────────────────────────────────────────────────────────────────────
  motion: {
    instant: '0ms',
    fast: '140ms',      // Hover, focus, button press
    base: '200ms',      // Standard transitions (modal, drawer, toast)
    slow: '300ms',      // Page transitions, complex drawer
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',  // Enter animations
    easeIn: 'cubic-bezier(0.7, 0, 0.84, 0)',   // Exit animations
  },

  // ──────────────────────────────────────────────────────────────────────────────
  // ICON SIZING
  // ──────────────────────────────────────────────────────────────────────────────
  icon: {
    xs: 14,   // Inline with caption text
    sm: 16,   // Inline with body text, button icons
    md: 20,   // Default UI icons, nav items
    lg: 24,   // Large buttons, empty states
    xl: 40,   // Hero illustrations, onboarding
  },

  // ──────────────────────────────────────────────────────────────────────────────
  // BREAKPOINTS
  // ──────────────────────────────────────────────────────────────────────────────
  breakpoints: {
    mobile: 320,
    tablet: 768,
    laptop: 1024,
    desktop: 1440,
    largeDesktop: 1920,
  },

  // ──────────────────────────────────────────────────────────────────────────────
  // COMPONENT DEFAULTS (for reference — not used directly in inline styles)
  // ──────────────────────────────────────────────────────────────────────────────
  button: {
    height: { sm: 40, md: 44, lg: 48 },
    padding: { sm: '8px 16px', md: '10px 20px', lg: '12px 24px' },
  },
  input: {
    height: 44,
    padding: '9px 12px',
  },
  card: {
    padding: { dense: 8, default: 12, comfortable: 16 },
  },
};
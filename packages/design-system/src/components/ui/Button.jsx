import { forwardRef, useRef } from 'react'
import { theme } from '../../theme'

// Self-contained spinner keyframe — the design-system package must not depend
// on either app's app-specific keyframes (CareHub: ch-spin, CareFind: cf-spin).
// Injected once into <head> at module load (guarded for SSR/envs without
// document) rather than rendered per-instance — a <style> inside <button> both
// pollutes button.textContent (breaking text-based lookups) and duplicates the
// rule once per button on the page.
const SPIN_KEYFRAMES = `
@keyframes ds-spin {
  to { transform: rotate(360deg); }
}
/* Focus ring. Buttons render inline styles, so the one thing inline styles
   cannot express — a ring drawn OUTSIDE the box so it is not clipped, and only
   for keyboard users — lives here. Injected once, never per instance. */
.ds-btn:focus { outline: none; }
.ds-btn:focus-visible {
  outline: 2px solid ${theme.tealDeep};
  outline-offset: 2px;
}
.ds-btn[disabled] { cursor: not-allowed; }
.ds-btn:not([disabled]):hover {
  background: var(--ds-btn-bg-hover);
  color: var(--ds-btn-color-hover);
  border-color: var(--ds-btn-border-hover);
}
.ds-btn:not([disabled]):active { transform: scale(0.985); }
@media (prefers-reduced-motion: reduce) {
  .ds-btn { transition: none !important; }
  .ds-btn:not([disabled]):active { transform: none !important; }
}`
if (typeof document !== 'undefined' && !document.getElementById('ds-button-keyframes')) {
  const style = document.createElement('style')
  style.id = 'ds-button-keyframes'
  style.textContent = SPIN_KEYFRAMES
  document.head.appendChild(style)
}

const VARIANT_STYLES = {
  primary: {
    background: theme.tealDeep,
    color: '#fff',
    border: 'none',
    hoverBackground: theme.tealHover,
    hoverColor: '#fff',
  },
  secondary: {
    background: theme.navy,
    color: '#fff',
    border: 'none',
    hoverBackground: '#092D25',
    hoverColor: '#fff',
  },
  ghost: {
    background: 'white',
    color: theme.gray600,
    border: `1px solid ${theme.gray200}`,
    hoverBackground: theme.gray50,
    hoverColor: theme.gray600,
    hoverBorder: theme.gray300,
  },
  danger: {
    background: theme.dangerBg,
    color: theme.danger,
    border: 'none',
    hoverBackground: theme.dangerBg,
    hoverColor: '#b91c1c',
  },
  outline: {
    background: 'transparent',
    color: theme.tealDeep,
    border: `1px solid ${theme.tealDeep}`,
    hoverBackground: theme.tealMist,
    hoverColor: theme.tealDeep,
    hoverBorder: theme.tealDeep,
  },
}

const SIZE_STYLES = {
  sm: { minHeight: 40, padding: '8px 16px', fontSize: 12, radius: theme.radius.sm },
  md: { minHeight: 44, padding: '10px 20px', fontSize: 13, radius: theme.radius.sm },
  lg: { minHeight: 48, padding: '12px 24px', fontSize: 14, radius: theme.radius.md },
}

/**
 * Unified Button component — one button for the whole ecosystem.
 * Variants: primary, secondary, ghost, danger, outline.
 * Sizes: sm (40px), md (44px), lg (48px). Heights stay at the documented
 * minimum touch target so a control never shrinks below it on a phone or
 * tablet at the counter. Density comes from the tighter radius: sm and md now
 * sit at 6px rather than 10px, which is what made a 44px control read padded.
 * Keyboard focus gets a ring drawn outside the box; hover and press feedback
 * come from the injected rule at the top of this file, not inline handlers.
 * Supports left/right icons, loading state, full width.
 */
export const Button = forwardRef(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    onClick,
    style = {},
    disabled,
    type = 'button',
    leftIcon,
    rightIcon,
    loading = false,
    loadingText = 'Loading…',
    fullWidth = false,
    className = '',
    ...rest
  },
  ref
) {
  const innerRef = useRef(null)
  const v = VARIANT_STYLES[variant] || VARIANT_STYLES.primary
  const s = SIZE_STYLES[size] || SIZE_STYLES.md

  const baseStyle = {
    minHeight: s.minHeight,
    padding: s.padding,
    borderRadius: s.radius,
    border: v.border,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    fontWeight: 700,
    fontSize: s.fontSize,
    fontFamily: theme.fontFamily,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: fullWidth ? '100%' : 'auto',
    boxSizing: 'border-box',
    transition: `background ${theme.motion.fast} ${theme.motion.easeOut}, border-color ${theme.motion.fast} ${theme.motion.easeOut}, color ${theme.motion.fast} ${theme.motion.easeOut}, transform ${theme.motion.instant}`,
  }

  const inert = disabled || loading

  // The base colours stay as resolved literals so the component's contract is
  // readable from its style object (and assertable). Only the interaction
  // states live in CSS, because the old onMouseEnter/onMouseLeave handlers
  // wrote inline styles: a hover colour survived a re-render, and nothing
  // happened at all for keyboard or touch activation. Passing the hover values
  // in as custom properties lets one injected rule serve every variant.
  const variantStyle = {
    '--ds-btn-bg-hover': disabled ? theme.gray200 : v.hoverBackground,
    '--ds-btn-color-hover': disabled ? theme.gray400 : v.hoverColor,
    '--ds-btn-border-hover': v.hoverBorder || 'transparent',
    background: disabled ? theme.gray200 : v.background,
    color: disabled ? theme.gray400 : v.color,
  }

  return (
    <button
      ref={ref || innerRef}
      type={type}
      onClick={onClick}
      disabled={inert}
      className={`ds-btn${className ? ` ${className}` : ''}`}
      style={{ ...baseStyle, ...variantStyle, ...style }}
      data-loading={loading ? 'true' : undefined}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: `2px solid ${disabled ? theme.gray300 : 'rgba(255,255,255,0.4)'}`,
            borderTopColor: disabled ? theme.gray400 : '#fff',
            animation: 'ds-spin 0.7s linear infinite',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      )}
      {leftIcon && !loading && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{leftIcon}</span>}
      {loading ? loadingText : children}
      {rightIcon && !loading && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{rightIcon}</span>}
    </button>
  )
})

Button.displayName = 'Button'

export default Button
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
  sm: { minHeight: 40, padding: '8px 16px', fontSize: 12 },
  md: { minHeight: 44, padding: '10px 20px', fontSize: 13 },
  lg: { minHeight: 48, padding: '12px 24px', fontSize: 14 },
}

/**
 * Unified Button component — one button for the whole ecosystem.
 * Variants: primary, secondary, ghost, danger, outline.
 * Sizes: sm (40px), md (44px), lg (48px).
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
    borderRadius: theme.radius.md,
    border: v.border,
    background: disabled ? theme.gray200 : v.background,
    color: disabled ? theme.gray400 : v.color,
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
    transition: `background ${theme.motion.fast} ${theme.motion.easeOut}, border-color ${theme.motion.fast} ${theme.motion.easeOut}, color ${theme.motion.fast} ${theme.motion.easeOut}, transform ${theme.motion.fast} ${theme.motion.easeOut}`,
    ...style,
  }

  return (
    <button
      ref={ref || innerRef}
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={className}
      style={baseStyle}
      onMouseEnter={disabled || loading ? undefined : (e) => {
        e.currentTarget.style.background = v.hoverBackground
        e.currentTarget.style.color = v.hoverColor
        if (v.hoverBorder) e.currentTarget.style.borderColor = v.hoverBorder
      }}
      onMouseLeave={disabled || loading ? undefined : (e) => {
        e.currentTarget.style.background = v.background
        e.currentTarget.style.color = v.color
        if (v.border) e.currentTarget.style.borderColor = v.border
      }}
      onMouseDown={disabled || loading ? undefined : (e) => { e.currentTarget.style.transform = 'scale(0.97)' }}
      onMouseUp={disabled || loading ? undefined : (e) => { e.currentTarget.style.transform = 'scale(1)' }}
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
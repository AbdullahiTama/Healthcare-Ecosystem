import { Inbox, WifiOff, AlertTriangle } from 'lucide-react'
import { theme } from '../../theme'
import { Card } from './Card'
import { Button } from './Button'

// Self-contained keyframes — the design-system package must not depend on
// either app's app-specific keyframes (CareHub: ch-*, CareFind: cf-*).
// Injected once into <head> at module load (guarded for SSR/test envs where
// document is undefined) so frequently-rendered components like Skeleton do
// not emit a duplicate <style> tag per instance.
const KEYFRAMES = `@keyframes ds-spin {
  to { transform: rotate(360deg); }
}
@keyframes ds-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}`
if (typeof document !== 'undefined' && !document.getElementById('ds-ui-keyframes')) {
  const style = document.createElement('style')
  style.id = 'ds-ui-keyframes'
  style.textContent = KEYFRAMES
  document.head.appendChild(style)
}

// ── LOADING (spinner — short indeterminate waits only) ──────────────────────
export function Loading({ text = 'Loading...', fullScreen = false }) {
  return (
    <div role="status" aria-live="polite" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: fullScreen ? 0 : 60, minHeight: fullScreen ? '100vh' : undefined, color: theme.gray400,
    }}>
      <div style={{ width: fullScreen ? 36 : 28, height: fullScreen ? 36 : 28, borderRadius: theme.radius.full, border: `3px solid ${theme.gray200}`, borderTopColor: theme.tealDeep, marginBottom: 14, animation: 'ds-spin 0.8s linear infinite' }} />
      <div style={{ fontSize: fullScreen ? 15 : 14, fontWeight: 600, color: theme.textLight }}>{text}</div>
    </div>
  )
}

// ── SKELETON (structured content loading — MOTION.md) ───────────────────────
export function Skeleton({ width = '100%', height = 14, radius, style = {} }) {
  return <div style={{ width, height, borderRadius: radius ?? theme.radius.sm, background: theme.gray200, animation: 'ds-pulse 1.6s ease-in-out infinite', ...style }} />
}

export function CardSkeleton() {
  return (
    <Card style={{ padding: theme.space[10] }}>
      <Skeleton width={40} height={40} radius={theme.radius.full} style={{ marginBottom: 12 }} />
      <Skeleton width="70%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="45%" height={12} />
    </Card>
  )
}

// ── EMPTY STATE ──────────────────────────────────────────────────────────────
// `cause` distinguishes the three real empty-state situations
// (SCREEN_PATTERNS.md pattern 30) so the message and action are appropriate:
// 'none' = nothing exists yet, 'filtered' = filters/search excluded everything,
// 'positive' = a genuinely good empty state (e.g. "no pending approvals").
export function Empty({ icon, message, action, onAction, cause = 'none' }) {
  // Backward compatible: a string icon (legacy emoji) still renders as text,
  // a passed lucide element renders as-is, and the default is a lucide Inbox.
  const node = icon == null ? <Inbox size={40} strokeWidth={1.5} color={theme.gray300} />
    : typeof icon === 'string' ? <span style={{ fontSize: 44, lineHeight: 1 }}>{icon}</span>
    : icon
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: theme.gray300, textAlign: 'center' }}>
      <div style={{ marginBottom: 16, display: 'flex' }} aria-hidden="true">{node}</div>
      <div style={{ fontSize: 15, color: theme.gray500, marginBottom: action ? 20 : 0, maxWidth: 320 }}>{message}</div>
      {action && (
        <Button variant={cause === 'filtered' ? 'ghost' : 'primary'} onClick={onAction}>{action}</Button>
      )}
    </div>
  )
}

// ── ERROR STATE ───────────────────────────────────────────────────────────────
// SCREEN_PATTERNS.md pattern 32. `variant`: 'network' gets reassuring,
// auto-retry framing; 'app' is a generic-but-human failure message. Always
// offers a next step — never a dead end.
export function ErrorState({ variant = 'app', message, onRetry }) {
  const copy = variant === 'network'
    ? { Icon: WifiOff, heading: "You're offline", body: message || "We'll keep trying to reconnect automatically." }
    : { Icon: AlertTriangle, heading: 'Something went wrong', body: message || "We couldn't load this. Please try again." }
  return (
    <div role="alert" aria-live="assertive" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' }}>
      <div style={{ marginBottom: 12, display: 'flex', color: theme.gray400 }} aria-hidden="true"><copy.Icon size={36} strokeWidth={1.75} /></div>
      <div style={{ fontSize: 15, fontWeight: 700, color: theme.textDark, marginBottom: 4 }}>{copy.heading}</div>
      <div style={{ fontSize: 13, color: theme.gray500, marginBottom: onRetry ? 20 : 0, maxWidth: 320 }}>{copy.body}</div>
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  )
}

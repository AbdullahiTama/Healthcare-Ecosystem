import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { captureError } from '../lib/sentry'
import { logger } from '../lib/logger'
import { theme } from '../styles/theme'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    logger.error('Component error boundary triggered', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      componentName: this.props.name || 'Unknown',
    })

    captureError(error, {
      componentStack: errorInfo.componentStack,
      componentName: this.props.name,
    })

    this.setState({ errorInfo })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, () => this.reset())
      }

      return (
        <div style={{
          maxWidth: 560, margin: '48px auto', padding: 32,
          background: theme.cardBg, border: `1px solid ${theme.border}`,
          borderRadius: theme.radius.xl, textAlign: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', margin: '0 auto 16px',
            background: theme.dangerBg, color: theme.danger,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertTriangle size={28} aria-hidden="true" />
          </div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: 20, fontWeight: 800, color: theme.navy, fontFamily: theme.fontDisplay }}>
            Something went wrong
          </h2>
          <p style={{ margin: '0 0 6px 0', fontSize: 14, color: theme.textMid, lineHeight: 1.6 }}>
            We hit an unexpected error. Your data is safe — try again or head back to the feed.
          </p>
          <p style={{ margin: '0 0 20px 0', fontSize: 12, color: theme.textLight }}>
            {this.state.error?.message ? `“${this.state.error.message}”` : 'An unexpected error occurred.'}
          </p>
          {import.meta.env.DEV && this.state.error?.stack && (
            <details style={{ textAlign: 'left', marginBottom: 20 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: theme.textMid }}>
                Error details (dev only)
              </summary>
              <pre style={{
                marginTop: 8, padding: 12, background: theme.gray50,
                border: `1px solid ${theme.border}`, borderRadius: theme.radius.md,
                fontSize: 11, overflow: 'auto', maxHeight: 280, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => this.reset()}
              className="cf-press"
              style={{
                minHeight: 44, padding: '10px 20px', background: theme.tealDeep, color: '#fff',
                border: 'none', borderRadius: theme.radius.full, cursor: 'pointer',
                fontSize: 14, fontWeight: 800,
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = '/feed' }}
              className="cf-press"
              style={{
                minHeight: 44, padding: '10px 20px', background: '#fff', color: theme.navy,
                border: `1px solid ${theme.border}`, borderRadius: theme.radius.full, cursor: 'pointer',
                fontSize: 14, fontWeight: 700,
              }}
            >
              Go to feed
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }

  reset() {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }
}

export default ErrorBoundary

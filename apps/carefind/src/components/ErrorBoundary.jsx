import { Component } from 'react'
import { theme } from '../styles/theme'

// Route-level error boundary. A single malformed piece of content (a broken
// article body, a bad embed) must never unmount the whole React tree into a
// blank page. Falling back to a friendly message keeps the app usable and,
// via the retry button, lets the user recover without a full reload.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Route crashed:', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, fontFamily: theme.fontFamily, textAlign: 'center', boxSizing: 'border-box',
        }}>
          <div style={{ maxWidth: 380 }}>
            <p style={{ margin: '0 0 8px 0', fontSize: 34, lineHeight: 1 }} aria-hidden="true">⚠️</p>
            <h1 style={{ fontSize: 16, fontWeight: 800, color: theme.navy, margin: '0 0 6px 0' }}>
              Something went wrong here
            </h1>
            <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 16px 0', lineHeight: 1.5 }}>
              This section couldn&apos;t be displayed. The rest of the app is unaffected — try
              reloading, or head back to the feed.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                onClick={this.handleReset}
                style={{ padding: '10px 18px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                Try again
              </button>
              <button
                onClick={() => { window.location.href = '/feed' }}
                style={{ padding: '10px 18px', background: '#fff', color: theme.tealDeep, border: `1px solid ${theme.border}`, borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                Go to feed
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
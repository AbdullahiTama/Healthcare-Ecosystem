import React from 'react'
import { captureError } from '../lib/sentry'
import { logger } from '../lib/logger'

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
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, () => this.reset())
      }

      // Default fallback UI
      return (
        <div style={{
          padding: '20px',
          margin: '20px',
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '8px',
          color: '#c33',
        }}>
          <h2 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>
            Something went wrong
          </h2>
          <p style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          {import.meta.env.DEV && this.state.error?.stack && (
            <details style={{ marginTop: '10px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '12px' }}>
                Error Details (dev only)
              </summary>
              <pre style={{
                marginTop: '10px',
                padding: '10px',
                backgroundColor: '#fff',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '11px',
                overflow: 'auto',
                maxHeight: '300px',
              }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <button
            onClick={() => this.reset()}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              backgroundColor: '#c33',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Try Again
          </button>
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

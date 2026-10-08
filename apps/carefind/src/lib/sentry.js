import * as Sentry from '@sentry/react'

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) {
    if (import.meta.env.DEV) console.log('[Sentry] No DSN configured - error tracking disabled')
    return
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || 'development',
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ 
        maskAllText: false, 
        blockAllMedia: false 
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    allowUrls: [/carefind\.ng/i, /vercel\.app/i],
    beforeSend(event) {
      // Sanitize sensitive data before sending
      if (event.request?.headers) {
        delete event.request.headers['Authorization']
      }
      return event
    },
  })

  if (import.meta.env.DEV) console.log('[Sentry] Initialized successfully')
}

export function captureError(error, context = {}) {
  if (import.meta.env.DEV) {
    console.error('[Error]', error, context)
  }
  Sentry.captureException(error, { extra: context })
}

export function captureMessage(message, level = 'info', context = {}) {
  if (import.meta.env.DEV) {
    console.log(`[${level}]`, message, context)
  }
  Sentry.captureMessage(message, { level, extra: context })
}

export function setUser(user) {
  if (user) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username || user.display_name,
    })
  } else {
    Sentry.setUser(null)
  }
}

export function addBreadcrumb(category, message, data = {}, level = 'info') {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level,
  })
}

export { Sentry }

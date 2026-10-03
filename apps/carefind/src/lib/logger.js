// Structured logging system
// Provides consistent logging with levels, context, and Sentry integration

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

const LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR']

class Logger {
  constructor(context = {}) {
    this.context = context
    this.level = LOG_LEVELS.INFO
  }

  setLevel(level) {
    if (typeof level === 'string') {
      this.level = LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO
    } else {
      this.level = level
    }
  }

  setContext(context) {
    this.context = { ...this.context, ...context }
  }

  _log(level, message, data = {}) {
    if (level < this.level) return

    const timestamp = new Date().toISOString()
    const levelName = LEVEL_NAMES[level]
    const logEntry = {
      timestamp,
      level: levelName,
      message,
      ...this.context,
      ...data,
    }

    // Console output
    const consoleMethod = level === LOG_LEVELS.ERROR ? 'error' : 
                         level === LOG_LEVELS.WARN ? 'warn' : 
                         level === LOG_LEVELS.DEBUG ? 'debug' : 'log'
    
    const logData = { ...this.context, ...data }
    console[consoleMethod](
      `[${timestamp}] [${levelName}]`,
      message,
      Object.keys(logData).length > 0 ? logData : ''
    )

    // Send to Sentry for errors and warnings
    if (level >= LOG_LEVELS.WARN && typeof window !== 'undefined') {
      import('./sentry.js').then(({ captureError, captureMessage }) => {
        if (level === LOG_LEVELS.ERROR) {
          captureError(new Error(message), data)
        } else {
          captureMessage(message, 'warning', data)
        }
      }).catch(() => {
        // Silently fail if Sentry import fails
      })
    }

    return logEntry
  }

  debug(message, data = {}) {
    return this._log(LOG_LEVELS.DEBUG, message, data)
  }

  info(message, data = {}) {
    return this._log(LOG_LEVELS.INFO, message, data)
  }

  warn(message, data = {}) {
    return this._log(LOG_LEVELS.WARN, message, data)
  }

  error(message, data = {}) {
    return this._log(LOG_LEVELS.ERROR, message, data)
  }

  // Performance tracking
  startTimer(label) {
    const start = performance.now()
    return {
      stop: (data = {}) => {
        const duration = performance.now() - start
        this.info(`[PERF] ${label}`, { duration: `${duration.toFixed(2)}ms`, ...data })
        return duration
      }
    }
  }

  // Create child logger with additional context
  child(context) {
    return new Logger({ ...this.context, ...context })
  }
}

// Default logger instance
export const logger = new Logger()

// Factory function for creating loggers with context
export function createLogger(context) {
  return new Logger(context)
}

// Performance monitoring
export function measurePerformance(label, fn) {
  const timer = logger.startTimer(label)
  try {
    const result = fn()
    if (result instanceof Promise) {
      return result.finally(() => timer.stop())
    }
    timer.stop()
    return result
  } catch (error) {
    timer.stop({ error: error.message })
    throw error
  }
}

export { LOG_LEVELS }

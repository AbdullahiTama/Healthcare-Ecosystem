import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logger, createLogger, LOG_LEVELS, measurePerformance } from './logger'

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log')
    vi.spyOn(console, 'warn')
    vi.spyOn(console, 'error')
    vi.spyOn(console, 'debug')
  })

  it('should log info messages', () => {
    logger.info('test message')
    expect(console.log).toHaveBeenCalled()
  })

  it('should log warning messages', () => {
    logger.warn('warning message')
    expect(console.warn).toHaveBeenCalled()
  })

  it('should log error messages', () => {
    logger.error('error message')
    expect(console.error).toHaveBeenCalled()
  })

  it('should log debug messages when level is DEBUG', () => {
    logger.setLevel('DEBUG')
    logger.debug('debug message')
    expect(console.debug).toHaveBeenCalled()
  })

  it('should not log debug messages when level is INFO', () => {
    logger.setLevel('INFO')
    console.debug.mockClear()
    logger.debug('debug message')
    expect(console.debug).not.toHaveBeenCalled()
  })

  it('should include context in log messages', () => {
    logger.setContext({ userId: '123' })
    logger.info('test with context')
    expect(console.log).toHaveBeenCalledWith(
      expect.any(String),
      'test with context',
      expect.objectContaining({ userId: '123' })
    )
  })

  it('should create child logger with additional context', () => {
    const childLogger = logger.child({ component: 'TestComponent' })
    childLogger.info('child logger message')
    expect(console.log).toHaveBeenCalledWith(
      expect.any(String),
      'child logger message',
      expect.objectContaining({ component: 'TestComponent' })
    )
  })

  it('should measure performance', () => {
    const result = measurePerformance('test-operation', () => {
      return 'test result'
    })
    expect(result).toBe('test result')
    expect(console.log).toHaveBeenCalled()
  })

  it('should measure async performance', async () => {
    const result = await measurePerformance('async-operation', async () => {
      return 'async result'
    })
    expect(result).toBe('async result')
  })

  it('should handle errors in performance measurement', () => {
    expect(() => {
      measurePerformance('error-operation', () => {
        throw new Error('test error')
      })
    }).toThrow('test error')
  })
})

describe('createLogger', () => {
  it('should create logger with initial context', () => {
    const customLogger = createLogger({ service: 'test-service' })
    customLogger.info('test message')
    expect(console.log).toHaveBeenCalledWith(
      expect.any(String),
      'test message',
      expect.objectContaining({ service: 'test-service' })
    )
  })
})

describe('LOG_LEVELS', () => {
  it('should have correct level values', () => {
    expect(LOG_LEVELS.DEBUG).toBe(0)
    expect(LOG_LEVELS.INFO).toBe(1)
    expect(LOG_LEVELS.WARN).toBe(2)
    expect(LOG_LEVELS.ERROR).toBe(3)
  })
})

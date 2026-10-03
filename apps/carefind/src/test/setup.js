import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

// One global async timeout for every findBy*/waitFor in the suite, instead of
// a `{ timeout: n }` argument on the handful of assertions that happened to go
// red first.
//
// Why it was needed: React Testing Library defaults to 1000ms, which is
// generous in isolation and not generous at all in a full run. The route-
// mounting suites (BackgroundRoutes, PostModalRoute, PostPage) assert on
// content that only appears after two sequential round trips — the post
// resolves, and a second fetch (comments, or the post-edit refetch) is issued
// from an effect that the first one triggers. Under jsdom contention a whole
// run has been observed at 320s against a nominal ~110-190s, and a single
// worker can be starved for several hundred ms at a stretch, so those
// assertions were losing the race intermittently — a different file each time,
// every one of them passing in isolation.
//
// 5000ms is 5x the default and the value the two inline overrides that used to
// live in PostPage.test.jsx had already proven sufficient; it is still short
// enough that a genuinely hung assertion fails in five seconds rather than
// stalling the run. `testTimeout` in vitest.config.js is deliberately set
// above this so RTL's own "unable to find an element" error — which names the
// element — always wins the race against vitest's generic test timeout.
configure({ asyncUtilTimeout: 5000 })

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock URL.createObjectURL
URL.createObjectURL = vi.fn(() => 'blob:mock-url')
URL.revokeObjectURL = vi.fn()

// Suppress console.error in tests
const originalError = console.error
beforeAll(() => {
  console.error = (...args) => {
    if (
      args[0]?.includes?.('act(...)') ||
      args[0]?.includes?.('Warning:') ||
      args[0]?.includes?.('ReactDOM.render')
    ) return
    originalError.call(console, ...args)
  }
})

afterAll(() => {
  console.error = originalError
})
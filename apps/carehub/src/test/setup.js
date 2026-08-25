import '@testing-library/jest-dom'

// jsdom has no matchMedia. Default is reduced-motion OFF so production motion
// paths actually run under test; a suite that needs the reduced-motion branch
// overrides window.matchMedia itself (see the marketing page tests).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
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

global.IntersectionObserver = class IntersectionObserver {
  constructor(callback) { this.callback = callback }

  observe() {}

  unobserve() {}

  disconnect() {}
}

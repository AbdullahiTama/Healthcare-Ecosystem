import { render, screen } from '@testing-library/react'

// Named .test.jsx, not the .test.js the plan drafted: this file contains JSX,
// and esbuild does not parse JSX out of a .js file. The vitest `include`
// pattern already covers both extensions.
describe('carehub test setup', () => {
  it('provides jest-dom matchers', () => {
    render(<div data-testid="probe">hello</div>)
    expect(screen.getByTestId('probe')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('mocks matchMedia reporting motion allowed by default', () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useUrlFilters } from './useUrlFilters'

const DEFAULTS = { status: 'pending', q: '', id: '' }

function Probe() {
  const [f, set] = useUrlFilters(DEFAULTS)
  const location = useLocation()
  return (
    <div>
      <span data-testid="values">{JSON.stringify(f)}</span>
      <span data-testid="url">{location.pathname}{location.search}</span>
      <button onClick={() => set({ status: 'approved' })}>approved</button>
      <button onClick={() => set({ status: 'pending' })}>pending</button>
      <button onClick={() => set({ q: 'a b&c' })}>search</button>
      <button onClick={() => set({ q: '' })}>clear</button>
      <button onClick={() => set({ id: 'r1' }, { replace: false })}>open</button>
      <button onClick={() => set({ id: null })}>close</button>
    </div>
  )
}
const renderAt = (route) => render(<MemoryRouter initialEntries={[route]}><Probe /></MemoryRouter>)
const values = () => JSON.parse(screen.getByTestId('values').textContent)
const url = () => screen.getByTestId('url').textContent

describe('useUrlFilters', () => {
  it('returns defaults when the URL has no parameters', () => {
    renderAt('/admin/x')
    expect(values()).toEqual({ status: 'pending', q: '', id: '' })
  })

  it('reads values from the URL', () => {
    renderAt('/admin/x?status=approved&q=ada&id=v9')
    expect(values()).toEqual({ status: 'approved', q: 'ada', id: 'v9' })
  })

  it('writes a value and removes it again when set back to the default', () => {
    renderAt('/admin/x')
    fireEvent.click(screen.getByText('approved'))
    expect(url()).toBe('/admin/x?status=approved')
    fireEvent.click(screen.getByText('pending'))
    expect(url()).toBe('/admin/x')
  })

  it('encodes search text and removes the key when cleared', () => {
    renderAt('/admin/x')
    fireEvent.click(screen.getByText('search'))
    expect(values().q).toBe('a b&c')
    fireEvent.click(screen.getByText('clear'))
    expect(url()).toBe('/admin/x')
  })

  it('keeps parameters it does not own', () => {
    renderAt('/admin/x?utm=1')
    fireEvent.click(screen.getByText('open'))
    expect(url()).toBe('/admin/x?utm=1&id=r1')
    fireEvent.click(screen.getByText('close'))
    expect(url()).toBe('/admin/x?utm=1')
  })
})

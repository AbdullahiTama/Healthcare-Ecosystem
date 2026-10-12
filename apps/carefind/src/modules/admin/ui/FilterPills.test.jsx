import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FilterPills } from './FilterPills.jsx'

const options = [{ value: 'all', label: 'All' }, { value: 'verified', label: 'Verified' }]

describe('FilterPills', () => {
  it('marks the active pill pressed and the others not pressed', () => {
    render(<FilterPills options={options} value="verified" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Verified' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('wraps the pills in a group named by `label`', () => {
    const onChange = vi.fn()
    render(<FilterPills label="Verification" options={options} value="all" onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Verification' })
    fireEvent.click(within(group).getByRole('button', { name: 'Verified' }))
    expect(onChange).toHaveBeenCalledWith('verified')
  })

  it('renders no group without a label, as the legacy tabs use it', () => {
    render(<FilterPills options={['all', 'post']} value="all" onChange={() => {}} />)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'post' })).toHaveAttribute('aria-pressed', 'false')
  })
})

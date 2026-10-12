import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FilterPills, DateRange } from './FilterPills.jsx'

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

describe('DateRange', () => {
  it('names each date input by its label and reports changes', () => {
    const onFrom = vi.fn()
    const onTo = vi.fn()
    render(<DateRange from="2026-09-01" to="" onFrom={onFrom} onTo={onTo} />)
    const from = screen.getByLabelText('From')
    const to = screen.getByLabelText('To')
    expect(from).toHaveAttribute('type', 'date')
    expect(from).toHaveValue('2026-09-01')
    expect(to).toHaveValue('')
    fireEvent.change(from, { target: { value: '2026-09-02' } })
    fireEvent.change(to, { target: { value: '2026-09-30' } })
    expect(onFrom).toHaveBeenCalledWith('2026-09-02')
    expect(onTo).toHaveBeenCalledWith('2026-09-30')
  })

  it('two ranges on one screen keep their labels apart', () => {
    render(<><DateRange onFrom={() => {}} onTo={() => {}} /><DateRange onFrom={() => {}} onTo={() => {}} /></>)
    const froms = screen.getAllByLabelText('From')
    expect(froms).toHaveLength(2)
    expect(froms[0]).not.toBe(froms[1])
  })
})

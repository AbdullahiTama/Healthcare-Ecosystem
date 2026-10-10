import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BankPicker from './BankPicker.jsx'

const banks = [
  { code: '057', name: 'Zenith Bank', popular: true },
  { code: '999992', name: 'OPay Digital Services Limited (OPay)', popular: true },
  { code: '50515', name: 'Moniepoint Microfinance Bank', popular: true },
  { code: '999', name: 'Zebra Bank', popular: false },
]

function Harness({ onSelect = () => {}, status = 'ready' }) {
  const [code, setCode] = useState('')
  return <BankPicker banks={banks} status={status} selectedCode={code} onRetry={vi.fn()} onSelect={(b) => { setCode(b ? b.code : ''); onSelect(b) }} />
}

describe('BankPicker', () => {
  it('filters as you type and selects with the mouse', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    expect(screen.getAllByRole('option')).toHaveLength(4)
    fireEvent.change(box, { target: { value: 'monie' } })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    fireEvent.mouseDown(options[0])
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ code: '50515' }))
    expect(box.value).toBe('Moniepoint Microfinance Bank')
  })

  it('supports the keyboard: arrows move, Enter selects, Escape closes', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'ze' } }) // Zenith, Zebra
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ code: '999' }))
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })

  it('clears the selection when the text is edited after choosing', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'zenith' } })
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    fireEvent.change(box, { target: { value: 'Zenith Ban' } })
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('shows an empty state for no matches', () => {
    render(<Harness />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'qqq' } })
    expect(screen.getByText(/No bank matches/)).toBeInTheDocument()
  })

  it('shows loading and a retry on error', () => {
    const { rerender } = render(<BankPicker banks={[]} status="loading" selectedCode="" onSelect={() => {}} onRetry={() => {}} />)
    expect(screen.getByRole('combobox')).toBeDisabled()
    const onRetry = vi.fn()
    rerender(<BankPicker banks={[]} status="error" selectedCode="" onSelect={() => {}} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
  })
})

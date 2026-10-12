import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MetricStrip from './MetricStrip.jsx'
import SplitBar from './SplitBar.jsx'

describe('MetricStrip', () => {
  it('shows each value and hint', () => {
    render(<MetricStrip items={[{ key: 'a', label: 'Users', value: '4,218', hint: 'Total registered', status: 'ok' }]} />)
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.getByText('4,218')).toBeInTheDocument()
    expect(screen.getByText('Total registered')).toBeInTheDocument()
  })

  it('shows an error with Retry instead of a number, and Retry calls back', () => {
    const onRetry = vi.fn()
    render(<MetricStrip items={[{ key: 'a', label: 'Transactions', value: 0, status: 'error', onRetry, hint: 'hidden hint' }]} />)
    expect(screen.getByText(/Couldn't load/)).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('hidden hint')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows a labelled loading placeholder while loading', () => {
    render(<MetricStrip items={[{ key: 'a', label: 'Users', value: 1, status: 'loading' }]} />)
    expect(screen.getByRole('status', { name: 'Loading Users' })).toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('makes the label a button only when the cell opens something', () => {
    const onOpen = vi.fn()
    render(<MetricStrip items={[{ key: 'a', label: 'Open reports', value: 5, status: 'ok', onOpen }, { key: 'b', label: 'Users', value: 9, status: 'ok' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open reports' }))
    expect(onOpen).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Users' })).not.toBeInTheDocument()
  })
})

describe('SplitBar', () => {
  it('describes the split in text, not just colour', () => {
    render(<SplitBar title="Reports" segments={[{ label: 'Open', value: 5, tone: 'urgent' }, { label: 'Resolved', value: 33, tone: 'ok' }]} />)
    expect(screen.getByRole('img', { name: 'Reports: 5 open, 33 resolved' })).toBeInTheDocument()
    expect(screen.getByText('38 total')).toBeInTheDocument()
    expect(screen.getByText('Open 5')).toBeInTheDocument()
  })

  it('says "None yet" for an empty set instead of drawing a bar', () => {
    render(<SplitBar title="Claims" segments={[{ label: 'Pending', value: 0 }]} />)
    expect(screen.getByText('None yet')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

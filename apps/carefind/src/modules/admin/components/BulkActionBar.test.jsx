import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActionBar } from './BulkActionBar'

describe('BulkActionBar', () => {
  it('renders nothing with no selection', () => {
    const { container } = render(<BulkActionBar selectedCount={0} onApprove={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uses the labels it is given and calls the matching handler', () => {
    const onDismiss = vi.fn()
    render(<BulkActionBar selectedCount={2} onApprove={() => {}} approveLabel="Approve verifications" onReject={() => {}} rejectLabel="Reject verifications" onDismiss={onDismiss} dismissLabel="Dismiss reports" onDelete={() => {}} deleteLabel="Delete posts" />)
    expect(screen.getByRole('button', { name: 'Approve verifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject verifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete posts' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reports' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('lets the button row wrap so four labelled actions fit a phone', () => {
    render(<BulkActionBar selectedCount={2} onApprove={() => {}} onReject={() => {}} onDismiss={() => {}} onDelete={() => {}} onClear={() => {}} />)
    expect(screen.getByRole('button', { name: 'Clear' }).parentElement).toHaveStyle({ flexWrap: 'wrap' })
  })

  it('keeps the old labels by default', () => {
    render(<BulkActionBar selectedCount={1} onApprove={() => {}} />)
    expect(screen.getByRole('button', { name: 'Approve selected' })).toBeInTheDocument()
  })
})

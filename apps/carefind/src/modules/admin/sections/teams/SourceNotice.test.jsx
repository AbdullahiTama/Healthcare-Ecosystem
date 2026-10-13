import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SourceNotice from './SourceNotice.jsx'

describe('SourceNotice restricted', () => {
  it('names staff accounts for the staff source', () => {
    render(<SourceNotice source={{ status: 'restricted' }} noun="staff" onRetry={() => {}} />)
    expect(screen.getByText('Only a super admin can see staff accounts')).toBeInTheDocument()
  })

  it('is generic for any other noun and never says staff accounts', () => {
    render(<SourceNotice source={{ status: 'restricted' }} noun="roles" onRetry={() => {}} />)
    expect(screen.getByText("You don't have access to roles")).toBeInTheDocument()
    expect(screen.queryByText(/staff accounts/)).not.toBeInTheDocument()
  })
})

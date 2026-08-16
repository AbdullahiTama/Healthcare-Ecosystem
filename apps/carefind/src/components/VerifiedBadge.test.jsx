import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VerifiedBadge from './VerifiedBadge.jsx'

describe('VerifiedBadge', () => {
  it('renders nothing for an unverified profile', () => {
    const { container } = render(<VerifiedBadge profile={{ is_verified: false }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no profile is passed', () => {
    const { container } = render(<VerifiedBadge />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the professional role next to the check for a verified profile', () => {
    render(<VerifiedBadge profile={{ is_verified: true, specialty: 'Pharmacist', verification_label: 'Pharmacist' }} />)
    expect(screen.getByText('Pharmacist')).toBeInTheDocument()
    expect(screen.getByLabelText('Verified')).toBeInTheDocument()
  })

  it('falls back to verification_label when specialty is missing', () => {
    render(<VerifiedBadge profile={{ is_verified: true, verification_label: 'Nurse' }} />)
    expect(screen.getByText('Nurse')).toBeInTheDocument()
  })

  it('prefers verification_label over specialty when both are set', () => {
    render(<VerifiedBadge profile={{ is_verified: true, specialty: 'General Practice', verification_label: 'Verified Doctor' }} />)
    expect(screen.getByText('Verified Doctor')).toBeInTheDocument()
    expect(screen.queryByText('General Practice')).not.toBeInTheDocument()
  })

  it('uses specialty when verification_label is missing', () => {
    render(<VerifiedBadge profile={{ is_verified: true, specialty: 'Nurse' }} />)
    expect(screen.getByText('Nurse')).toBeInTheDocument()
  })

  it('does not double the "Verified" prefix when the label already contains it', () => {
    render(<VerifiedBadge profile={{ is_verified: true, verification_label: 'Verified Nurse' }} />)
    expect(screen.getByText('Verified Nurse')).toBeInTheDocument()
    expect(screen.queryByText('Verified Verified Nurse')).not.toBeInTheDocument()
  })

  it('falls back to "Verified" when no role columns are set', () => {
    render(<VerifiedBadge profile={{ is_verified: true }} />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })
})
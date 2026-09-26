import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProfileHeader from './ProfileHeader.jsx'

const verifiedDoctor = {
  is_verified: true,
  full_name: 'Dr Ada',
  display_name: 'ada',
  verification_label: 'Verified Doctor',
  specialty: 'Doctor',
}

describe('ProfileHeader', () => {
  it('renders the name with exactly one verification badge (no second icon)', () => {
    render(<ProfileHeader profile={verifiedDoctor} name="Dr Ada" context="profile" />)
    expect(screen.getByText('Dr Ada')).toBeInTheDocument()
    // Only the name checkmark carries the "Verified" label — the role tag is text only.
    expect(screen.getAllByLabelText('Verified')).toHaveLength(1)
  })

  it('shows the verified role dynamically, not hardcoded to a single profession', () => {
    const pharmacist = { ...verifiedDoctor, verification_label: 'Verified Pharmacist', specialty: 'Pharmacist' }
    render(<ProfileHeader profile={pharmacist} name="Dr Ben" context="post" />)
    expect(screen.getByText('Verified Pharmacist')).toBeInTheDocument()
    expect(screen.queryByText('Verified Doctor')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Verified')).toHaveLength(1)
  })

  it('falls back to the specialty when no verification label is provided', () => {
    const pharmacist = { ...verifiedDoctor, verification_label: undefined, specialty: 'Pharmacist' }
    render(<ProfileHeader profile={pharmacist} name="Dr Ben" context="post" />)
    expect(screen.getByText('Pharmacist')).toBeInTheDocument()
  })

  it('hides the @username handle on posts but shows it on the profile', () => {
    const { unmount } = render(<ProfileHeader profile={verifiedDoctor} name="Dr Ada" context="post" />)
    expect(screen.queryByText('@ada')).not.toBeInTheDocument()
    unmount()
    render(<ProfileHeader profile={verifiedDoctor} name="Dr Ada" context="profile" />)
    expect(screen.getByText('@ada')).toBeInTheDocument()
  })

  it('renders no verification badge for an unverified user', () => {
    const unverified = { is_verified: false, full_name: 'Sam', display_name: 'sam' }
    render(<ProfileHeader profile={unverified} name="Sam" context="profile" />)
    expect(screen.queryByLabelText('Verified')).not.toBeInTheDocument()
    expect(screen.getByText('@sam')).toBeInTheDocument()
  })

  it('renders safely when the profile is missing', () => {
    const { container } = render(<ProfileHeader name="Unknown" context="post" />)
    expect(container.textContent).toContain('Unknown')
    expect(screen.queryByLabelText('Verified')).not.toBeInTheDocument()
  })
})

// The Users tab's Export button renders an icon in its filter bar on every visit, so a missing import there takes the
// whole tab down ("Download is not defined") rather than one rare branch.
import { render, screen } from '@testing-library/react'
import UsersTab from './UsersTab'

const noop = () => {}
const props = {
  users: [{ id: 'u1', full_name: 'Ada Obi', display_name: 'ada', is_verified: true, verification_label: 'Pharmacist' }],
  selectedUser: null, setSelectedUser: noop, userSearch: '', setUserSearch: noop,
  userVerifiedFilter: 'all', setUserVerifiedFilter: noop, userSpecialtyFilter: '', setUserSpecialtyFilter: noop,
  phoneMap: {}, viewUserDetails: noop, suspendDays: 7, setSuspendDays: noop, suspendUser: noop,
  deleteUser: noop, deletingUser: null, userPosts: [], verifyingUser: null, setVerifyingUser: noop,
  verifySpecialty: '', setVerifySpecialty: noop, manualVerify: noop, adminUser: { id: 'a1', role: 'super_admin' },
}

describe('UsersTab', () => {
  it('renders the user list and the export action', () => {
    render(<UsersTab {...props} />)
    expect(screen.getByText('Ada Obi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export filtered csv/i })).toBeInTheDocument()
  })
})

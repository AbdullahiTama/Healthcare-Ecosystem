import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { renderWithQueryClient } from '../../../test/renderWithQueryClient.jsx'
import { AdminContext } from '../AdminGate.jsx'
import { AdminFeedbackProvider } from '../AdminFeedback.jsx'

export const SUPER_ADMIN = { id: 'admin-1', full_name: 'Admin', role: 'super_admin' }

// Renders admin UI the way AdminApp does, minus the gate's network call.
export function renderAdmin(ui, { route = '/admin', admin = SUPER_ADMIN, permissions = {} } = {}) {
  const value = { adminUser: admin, permissions, signOut: vi.fn() }
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[route]}>
      <AdminContext.Provider value={value}>
        <AdminFeedbackProvider>{ui}</AdminFeedbackProvider>
      </AdminContext.Provider>
    </MemoryRouter>,
  )
}

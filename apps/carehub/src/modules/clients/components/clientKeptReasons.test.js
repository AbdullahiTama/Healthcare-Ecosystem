import { describe, it, expect } from 'vitest'
import { clientKeptText } from './ClientDeleteModal'

// delete_clients keeps a client with history and says why; every reason it can return has words for staff.
describe('clientKeptText', () => {
  it('describes every reason delete_clients returns, including hospital visits', () => {
    expect(clientKeptText(['sales', 'appointments', 'consultations', 'debts', 'requests', 'linked_records', 'hospital'])).toBe(
      'has sales, has appointments, has consultations, has debts, has customer requests, is linked to other client records, has hospital visits')
  })

  it('shows an unknown reason as it came rather than hiding it', () => {
    expect(clientKeptText(['something_new'])).toBe('something_new')
    expect(clientKeptText(undefined)).toBe('')
  })
})

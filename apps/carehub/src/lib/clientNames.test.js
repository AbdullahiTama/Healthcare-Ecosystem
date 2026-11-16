import { describe, it, expect } from 'vitest'
import { clientsById, currentClientName, withCurrentClientNames } from './clientNames'

const byId = clientsById([{ id: 7, full_name: 'Ada Okafor-Bello' }, { id: 'c2', full_name: 'Musa Bello' }])

describe('client names on linked records', () => {
  it('shows the current name of a linked client and what the record was saved as', () => {
    expect(currentClientName({ client_id: '7', client_name: 'Ada Okafor' }, byId, 'client_name')).toEqual({ name: 'Ada Okafor-Bello', recordedAs: 'Ada Okafor' })
    expect(currentClientName({ client_id: 'c2', party_name: 'Musa Bello' }, byId, 'party_name')).toEqual({ name: 'Musa Bello', recordedAs: '' })
  })

  it('keeps the saved name when the record is not linked or its client is not loaded', () => {
    expect(currentClientName({ client_name: 'Walk-in' }, byId, 'client_name')).toEqual({ name: 'Walk-in', recordedAs: '' })
    expect(currentClientName({ client_id: 'gone', client_name: 'Old' }, byId, 'client_name')).toEqual({ name: 'Old', recordedAs: '' })
    expect(currentClientName({ client_id: 'gone' }, byId, 'client_name', 'Walk-in').name).toBe('Walk-in')
  })

  it('returns view copies and leaves the records themselves untouched', () => {
    const rows = [{ id: 1, client_id: 7, client_name: 'Ada Okafor' }, { id: 2, client_name: 'Walk-in' }, { id: 3, client_id: 'c2', client_name: 'Musa Bello' }]
    const shown = withCurrentClientNames(rows, byId, 'client_name')
    expect(shown[0]).toEqual({ id: 1, client_id: 7, client_name: 'Ada Okafor-Bello', recorded_name: 'Ada Okafor' })
    expect(shown[1]).toBe(rows[1])
    expect(shown[2]).toBe(rows[2])
    expect(rows[0].client_name).toBe('Ada Okafor')
  })

  it('returns the rows as they are when no clients are loaded', () => {
    const rows = [{ client_id: 7, client_name: 'Ada' }]
    expect(withCurrentClientNames(rows, clientsById([]), 'client_name')).toBe(rows)
    expect(withCurrentClientNames(undefined, byId, 'client_name')).toEqual([])
  })
})

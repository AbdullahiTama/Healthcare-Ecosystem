import { describe, it, expect } from 'vitest'
import { translateBulkDeleteError, groupDeletions } from './bulkDelete'

describe('translateBulkDeleteError', () => {
  it('turns refusal codes into sentences for the right noun, keeping the code', () => {
    expect(translateBulkDeleteError(new Error('Supabase error (400): DELETE_NONE: x'), 'client')).toMatchObject({ code: 'DELETE_NONE', message: 'Choose at least one client.' })
    expect(translateBulkDeleteError(new Error('DELETE_TOO_MANY'), 'product').message).toBe('Delete at most 5,000 products at a time.')
  })
  it('a missing function or table means the update is not installed; anything else passes through', () => {
    expect(translateBulkDeleteError(new Error('Supabase error (404): Could not find the function public.delete_clients'), 'client').code).toBe('DELETE_UNAVAILABLE')
    expect(translateBulkDeleteError(new Error('Could not find the table public.deleted_clients in the schema cache')).code).toBe('DELETE_UNAVAILABLE')
    const net = new Error('Failed to fetch')
    expect(translateBulkDeleteError(net, 'client')).toBe(net)
  })
})

describe('groupDeletions', () => {
  it('one entry per deletion, newest first as given, with counts and the first names', () => {
    expect(groupDeletions([
      { deletion_id: 'd2', client_name: 'A', deleted_at: 't2', deleted_by_name: 'Ada', restored_at: null },
      { deletion_id: 'd2', client_name: 'B', deleted_at: 't2', deleted_by_name: 'Ada', restored_at: 'x' },
      { deletion_id: 'd1', client_name: 'C', deleted_at: 't1', deleted_by_name: null, restored_at: null },
    ], 'client_name')).toEqual([
      { deletion_id: 'd2', deleted_at: 't2', by: 'Ada', all: false, count: 2, restored: 1, names: ['A', 'B'] },
      { deletion_id: 'd1', deleted_at: 't1', by: null, all: false, count: 1, restored: 0, names: ['C'] },
    ])
  })
})

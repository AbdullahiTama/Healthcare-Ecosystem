import { describe, it, expect } from 'vitest'
import { classifyFailure } from './failureClass'

// A queued report is retried only when retrying can help. A refusal or a malformed request will fail the
// same way every time, so it must stop and be shown to the person instead of looping.
describe('classifyFailure', () => {
  it.each([
    ['a dropped connection', new TypeError('Failed to fetch')],
    ['a timeout', new Error('The request timed out')],
    ['a server error', new Error('Supabase error (500): internal')],
    ['a gateway error', new Error('Supabase error (502): bad gateway')],
    ['rate limiting', new Error('Supabase error (429): too many requests')],
    ['an unknown thing', 'boom'],
    ['nothing at all', undefined],
  ])('%s is worth retrying', (_n, e) => {
    expect(classifyFailure(e)).toBe('retry')
  })

  it.each([
    ['a policy refusal (403)', new Error('Supabase error (403): new row violates row-level security policy')],
    ['an expired login (401)', new Error('Supabase error (401): JWT expired')],
    ['permission denied (42501)', new Error('permission denied for function log_field_activity 42501')],
    ['invalid input syntax (22P02)', new Error('Supabase error (400): invalid input syntax for type uuid 22P02')],
    ['a not-null violation (23502)', new Error('null value in column 23502')],
    ['a foreign-key violation (23503)', new Error('violates foreign key constraint 23503')],
    ['a check violation (23514)', new Error('violates check constraint 23514')],
    ['an invalid parameter from the function (22023)', new Error('p_activity must be a JSON object 22023')],
    ['a bad request (400)', new Error('Supabase error (400): bad request')],
    ['an unprocessable request (422)', new Error('Supabase error (422): unprocessable')],
    ['a file that is too large (413)', new Error('Voice upload failed (413): too large')],
    ['a file type the bucket does not accept (415)', new Error('Voice upload failed (415): unsupported media type')],
  ])('%s will fail again, so it is permanent', (_n, e) => {
    expect(classifyFailure(e)).toBe('permanent')
  })

  it('reads the message off an object that is not an Error', () => {
    expect(classifyFailure({ message: 'Supabase error (403): denied' })).toBe('permanent')
  })
})

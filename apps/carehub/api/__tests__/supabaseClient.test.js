import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getSupabase, supabase } from '../_lib/supabase.js'

const URL_VAR = 'SUPABASE_URL'
const KEY_VAR = 'SUPABASE_SERVICE_ROLE_KEY'
const saved = { url: process.env[URL_VAR], key: process.env[KEY_VAR] }

describe('lazy service-role client', () => {
  beforeEach(() => {
    delete process.env[URL_VAR]
    delete process.env[KEY_VAR]
  })

  afterEach(() => {
    if (saved.url === undefined) delete process.env[URL_VAR]
    else process.env[URL_VAR] = saved.url
    if (saved.key === undefined) delete process.env[KEY_VAR]
    else process.env[KEY_VAR] = saved.key
  })

  it('does not touch env or throw when the module is imported', () => {
    // The whole point: importing a handler must be safe. The proxy is created
    // eagerly; the client is not.
    expect(supabase).toBeDefined()
  })

  it('throws a named error listing the missing vars on first use', () => {
    expect(() => getSupabase()).toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('reuses one client across calls', () => {
    process.env[URL_VAR] = 'http://127.0.0.1:54321'
    process.env[KEY_VAR] = 'test-service-role-key'
    expect(getSupabase()).toBe(getSupabase())
  })

  it('binds proxied methods to the real client', () => {
    process.env[URL_VAR] = 'http://127.0.0.1:54321'
    process.env[KEY_VAR] = 'test-service-role-key'
    // An unbound method would receive the proxy as `this` and supabase-js
    // would read its internal state off the wrong object. Building a query is
    // pure and does no network I/O, so this asserts binding without a server.
    const builder = supabase.from('profiles').select('id').limit(1)
    expect(typeof builder.then).toBe('function')
  })
})

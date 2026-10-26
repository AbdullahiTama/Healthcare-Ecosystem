import { describe, it, expect, vi, beforeEach } from 'vitest'

// The upload ceiling on the business-directory import.
//
// This handler feeds raw request bytes to the spreadsheet parser (api/_lib/spreadsheet.js, exceljs, which replaced
// xlsx@0.18.5 and its unfixed advisories). The original code buffered the entire request with no bound, which made a
// memory exhaustion trivially reachable from a public endpoint. The cap closes that; the parser's own zip-size guard
// is tested in api/_lib/__tests__/spreadsheet.test.js.

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'a@b.c' } }, error: null }) } }),
}))

const parser = vi.hoisted(() => ({ readFirstSheetRows: vi.fn(), SpreadsheetError: class extends Error {} }))
vi.mock('../_lib/spreadsheet.js', () => parser)

// The handler refuses to do anything without these, and it checks them at call time - without them it returns 500
// before it ever subscribes to the request body, which would make every test below pass for the wrong reason.
process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import handler from './excel-import.js'

/** A request whose body arrives in `size`-byte chunks, the way a real socket delivers it. */
function makeReq(size, chunkSize = 64 * 1024) {
  const handlers = {}
  let sent = 0
  let destroyed = false
  return {
    method: 'POST',
    url: '/api/excel-import',
    headers: { authorization: 'Bearer token' },
    on: (ev, fn) => { handlers[ev] = fn; return this },
    destroy: () => { destroyed = true },
    get destroyed() { return destroyed },
    // Drive the stream the way node does, emitting until the body is exhausted.
    pump: () => {
      while (sent < size) {
        const n = Math.min(chunkSize, size - sent)
        sent += n
        handlers.data(Buffer.alloc(n, 0x41))
      }
      handlers.end()
    },
    listeners: handlers,
  }
}

/**
 * The handler authenticates before it subscribes to the body, so the stream cannot be pumped the instant it is called.
 * Wait for the listeners to exist, then deliver the body.
 */
async function run(handler, req, r) {
  const pending = handler(req, r)
  for (let i = 0; i < 100 && typeof req.listeners.data !== 'function'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  req.pump()
  return pending
}

const res = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.setHeader = (k, v) => { r.headers[k] = v; return r }
  return r
}

const MAX = 5 * 1024 * 1024

beforeEach(() => {
  parser.readFirstSheetRows.mockReset()
  parser.readFirstSheetRows.mockResolvedValue([['name'], ['Acme']])
})

describe('the import upload ceiling', () => {
  it('refuses an oversized body with 413 and never parses it', async () => {
    const req = makeReq(MAX + 1024)
    const r = res()
    await run(handler, req, r)

    expect(r.statusCode).toBe(413)
    expect(r.body.error).toBe('File too large')
    expect(parser.readFirstSheetRows).not.toHaveBeenCalled()
  })

  it('stops buffering once the ceiling is passed, rather than reading the whole thing first', async () => {
    const req = makeReq(MAX * 4)
    const r = res()
    await run(handler, req, r)

    expect(r.statusCode).toBe(413)
    // Destroying the socket is what actually stops the client streaming; without it we would keep buffering a body
    // nobody is going to read.
    expect(req.destroyed).toBe(true)
  })

  it('accepts a normal spreadsheet and parses it', async () => {
    const req = makeReq(1024)
    const r = res()
    await run(handler, req, r)

    expect(r.statusCode).not.toBe(413)
    expect(parser.readFirstSheetRows).toHaveBeenCalledTimes(1)
  })

  it('a body exactly on the ceiling is still accepted - the limit is not off by one', async () => {
    const req = makeReq(MAX)
    const r = res()
    await run(handler, req, r)

    expect(r.statusCode).not.toBe(413)
    expect(parser.readFirstSheetRows).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty body rather than handing an empty buffer to the parser', async () => {
    const req = makeReq(0)
    const r = res()
    await run(handler, req, r)

    expect(r.statusCode).toBe(400)
    expect(parser.readFirstSheetRows).not.toHaveBeenCalled()
  })
})
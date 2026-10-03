import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// (xvii) Strengthened main.jsx source-order pin: the verify-email params module
// MUST be the FIRST import statement in the app entry, before supabaseClient
// AND before providers/AuthContext (which constructs the supabase client). ESM
// evaluates imports in source order, so this guarantees the capture snapshot
// precedes supabase-js' boot-time consumption of the callback URL.
// Resolved relative to this file via __dirname (not process.cwd()), so the pin
// is working-directory independent; comments are stripped before matching so
// comment text can never masquerade as an import statement.
const mainSource = readFileSync(path.resolve(__dirname, 'main.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

const importStatements = [...mainSource.matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1])

describe('main.jsx import source order', () => {
  it('pins the verify-email params side-effect import as the FIRST import statement', () => {
    expect(importStatements.length).toBeGreaterThan(0)
    expect(importStatements[0]).toBe('./modules/account/verifyEmailParams')
  })

  it('the params import precedes the supabase client and the AuthProvider imports', () => {
    const paramsIdx = importStatements.indexOf('./modules/account/verifyEmailParams')
    const authProviderIdx = importStatements.findIndex((s) => s.includes('AuthContext.jsx'))
    const supabaseIdx = importStatements.findIndex((s) => s.includes('supabaseClient'))
    expect(paramsIdx).toBe(0)
    expect(paramsIdx).toBeLessThan(authProviderIdx)
    expect(authProviderIdx).toBeGreaterThan(-1)
    // main.jsx itself does not import the client directly; the pin above (index
    // 0) already guarantees capture precedes whatever AuthContext transitively
    // constructs -- assert the guard for the direct case too.
    expect(supabaseIdx).toBe(-1)
  })
})
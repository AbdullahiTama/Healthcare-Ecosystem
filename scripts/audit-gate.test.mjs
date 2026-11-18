// node --test scripts/audit-gate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockingAdvisories, decide } from './audit-gate.mjs'

const adv = (id, severity, title = 't') => ({ source: 1, url: `https://github.com/advisories/${id}`, severity, title })
const report = (vulns) => ({ vulnerabilities: vulns })
const PICO = report({
  picomatch: { severity: 'high', via: [adv('GHSA-pico', 'high')] },
  vite: { severity: 'high', via: ['picomatch', 'fdir'] },
  glob: { severity: 'moderate', via: [adv('GHSA-glob', 'moderate')] },
})
const CLEAN = report({})
const EX = [{ advisory: 'GHSA-pico', package: 'picomatch', reason: 'no fix', expires: '2026-12-18' }]

test('counts each high/critical advisory once, on the package it is filed against, and ignores moderates', () => {
  assert.deepEqual(blockingAdvisories(PICO).map((a) => [a.advisory, a.package]), [['GHSA-pico', 'picomatch']])
  assert.deepEqual(blockingAdvisories(undefined), [])
})

test('a dev-only advisory with a valid exception passes and is reported as excused', () => {
  const r = decide({ full: PICO, prod: CLEAN, exceptions: EX, today: '2026-11-18' })
  assert.deepEqual(r.failures, [])
  assert.deepEqual(r.excused, [{ advisory: 'GHSA-pico', package: 'picomatch', expires: '2026-12-18' }])
})

test('a dev-only advisory without an exception fails', () => {
  const r = decide({ full: PICO, prod: CLEAN, exceptions: [], today: '2026-11-18' })
  assert.equal(r.failures.length, 1)
  assert.match(r.failures[0].why, /no exception/)
})

test('an expired exception fails; the expiry day itself still passes', () => {
  assert.equal(decide({ full: PICO, prod: CLEAN, exceptions: EX, today: '2026-12-18' }).failures.length, 0)
  const r = decide({ full: PICO, prod: CLEAN, exceptions: EX, today: '2026-12-19' })
  assert.match(r.failures[0].why, /expired on 2026-12-18/)
})

test('an exception without a reason or a valid date does not count', () => {
  for (const bad of [{ ...EX[0], reason: '' }, { ...EX[0], expires: 'soon' }, { ...EX[0], expires: undefined }]) {
    assert.match(decide({ full: PICO, prod: CLEAN, exceptions: [bad], today: '2026-11-18' }).failures[0].why, /no reason or expiry/)
  }
})

test('a production advisory always fails, even when listed as an exception, and is reported once', () => {
  const r = decide({ full: PICO, prod: PICO, exceptions: EX, today: '2026-11-18' })
  assert.equal(r.failures.length, 1)
  assert.match(r.failures[0].why, /production dependency/)
  assert.deepEqual(r.excused, [])
})

test('critical counts like high; a clean report passes', () => {
  const crit = report({ x: { severity: 'critical', via: [adv('GHSA-x', 'critical')] } })
  assert.equal(decide({ full: crit, prod: CLEAN, exceptions: [], today: '2026-11-18' }).failures.length, 1)
  assert.deepEqual(decide({ full: CLEAN, prod: CLEAN, exceptions: [], today: '2026-11-18' }), { failures: [], excused: [] })
})

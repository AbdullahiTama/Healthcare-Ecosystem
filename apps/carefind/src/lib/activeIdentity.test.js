import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getActiveBusiness,
  setActiveBusiness,
  clearActiveBusiness,
  getActiveStaffIdentity,
  setActiveStaffIdentity,
  clearActiveStaffIdentity,
  getActiveIdentity,
} from './activeIdentity.js'

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('active business identity', () => {
  it('starts with no active business', () => {
    expect(getActiveBusiness()).toBeNull()
  })

  it('round-trips an active business through localStorage', () => {
    setActiveBusiness({ id: 'b1', name: 'Glow Clinic' })
    expect(getActiveBusiness()).toEqual({ id: 'b1', name: 'Glow Clinic' })
  })

  it('stores only id and name, discarding the rest of the record', () => {
    setActiveBusiness({ id: 'b1', name: 'Glow', email: 'hi@x.com', other: true })
    expect(getActiveBusiness()).toEqual({ id: 'b1', name: 'Glow' })
  })

  it('clearActiveBusiness clears the stored business', () => {
    setActiveBusiness({ id: 'b1', name: 'Glow' })
    clearActiveBusiness()
    expect(getActiveBusiness()).toBeNull()
  })

  it('announces the change with an identity-changed event', () => {
    setActiveBusiness({ id: 'b1', name: 'Glow' })
    expect(window.dispatchEvent).toHaveBeenCalled()
    expect(window.dispatchEvent.mock.calls[0][0].type).toBe('identity-changed')
  })
})

describe('active staff identity', () => {
  it('set/get round-trips a staff claim', () => {
    setActiveStaffIdentity({ staffId: 's9', fullName: 'Ayo', publicTitle: 'Pharmacist', businessId: 'b1', businessName: 'Midtown' })
    expect(getActiveStaffIdentity()).toEqual({ staffId: 's9', fullName: 'Ayo', publicTitle: 'Pharmacist', businessId: 'b1', businessName: 'Midtown' })
  })

  it('dropping a staff identity clears it', () => {
    setActiveStaffIdentity({ staffId: 's9', fullName: 'Ayo', publicTitle: 'P', businessId: 'b1', businessName: 'M' })
    clearActiveStaffIdentity()
    expect(getActiveStaffIdentity()).toBeNull()
  })
})

describe('single active identity', () => {
  it('activating a business clears any staff identity', () => {
    setActiveStaffIdentity({ staffId: 's9', fullName: 'Ayo', publicTitle: 'P', businessId: 'b1', businessName: 'M' })
    setActiveBusiness({ id: 'b1', name: 'Glow' })
    expect(getActiveStaffIdentity()).toBeNull()
    expect(getActiveBusiness()).toEqual({ id: 'b1', name: 'Glow' })
  })

  it('activating a staff identity clears any active business', () => {
    setActiveBusiness({ id: 'b1', name: 'Glow' })
    setActiveStaffIdentity({ staffId: 's9', fullName: 'Ayo', publicTitle: 'P', businessId: 'b1', businessName: 'M' })
    expect(getActiveBusiness()).toBeNull()
    expect(getActiveStaffIdentity().staffId).toBe('s9')
  })

  it('getActiveIdentity returns null when posting as yourself', () => {
    expect(getActiveIdentity()).toBeNull()
  })

  it('getActiveIdentity tags a business identity', () => {
    setActiveBusiness({ id: 'b1', name: 'Glow' })
    expect(getActiveIdentity()).toEqual({ type: 'business', id: 'b1', name: 'Glow' })
  })

  it('getActiveIdentity tags a staff identity with the staff keys', () => {
    setActiveStaffIdentity({ staffId: 's9', fullName: 'Ayo', publicTitle: 'Pharmacist', businessId: 'b1', businessName: 'Midtown' })
    expect(getActiveIdentity().type).toBe('staff')
    expect(getActiveIdentity().staffId).toBe('s9')
    expect(getActiveIdentity().fullName).toBe('Ayo')
  })
})

describe('storage failure tolerance', () => {
  it('returns null when localStorage holds corrupt JSON', () => {
    localStorage.setItem('carefind_active_business', '{not json')
    expect(getActiveBusiness()).toBeNull()
    localStorage.setItem('carefind_active_staff', '{also broken')
    expect(getActiveStaffIdentity()).toBeNull()
  })
})
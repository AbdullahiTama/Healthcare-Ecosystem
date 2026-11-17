import { describe, it, expect } from 'vitest'
import { createHospitalRepository } from './index.js'

// A recording transport: every request the repository makes, with its body parsed.
function recording(response = []) {
  const calls = []
  const request = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined })
    return response
  }
  return { calls, repo: createHospitalRepository(request) }
}

describe('hospitalRepository', () => {
  it('searches the business\'s clients by name or phone, with the identity fields only', async () => {
    const { calls, repo } = recording()
    await repo.searchClients('biz-1', 'Ada')
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toMatch(/^clients\?business_id=eq\.biz-1&or=\(full_name\.ilike\.\*Ada\*,phone\.ilike\.\*Ada\*\)/)
    expect(calls[0].path).toContain('&select=id,full_name,phone,email,date_of_birth,gender,address,next_of_kin_name,next_of_kin_phone,insurance')
    expect(calls[0].path).not.toContain('total_spend')
  })

  it('does not search on fewer than two characters, and the search text cannot change the filter', async () => {
    const { calls, repo } = recording()
    expect(await repo.searchClients('biz-1', ' a ')).toEqual([])
    expect(calls).toEqual([])
    await repo.searchClients('biz-1', 'x),business_id.neq.(y*%')
    const or = decodeURIComponent(calls[0].path.match(/or=\((.*?)\)&select/)[1])
    expect(or).toBe('full_name.ilike.*x business_id.neq. y*,phone.ilike.*x business_id.neq. y*')
  })

  it('registers a visit through register_hospital_visit', async () => {
    const { calls, repo } = recording({ patient_id: 'p1' })
    const out = await repo.registerVisit({ businessId: 'biz-1', clientId: 'c1', client: { insurance: 'NHIS' }, visit: { department: 'ENT' } })
    expect(out).toEqual({ patient_id: 'p1' })
    expect(calls).toEqual([{ path: 'rpc/register_hospital_visit', method: 'POST',
      body: { p_business_id: 'biz-1', p_client_id: 'c1', p_client: { insurance: 'NHIS' }, p_visit: { department: 'ENT' } } }])
  })

  it('completes a consultation in one request (all or nothing in the database)', async () => {
    const { calls, repo } = recording()
    await repo.completeConsultation({ patientId: 'p1', consultation: { primary_diagnosis: 'Malaria' }, medicines: [], lab: { tests: ['FBC'] }, imaging: [] })
    expect(calls).toEqual([{ path: 'rpc/complete_hospital_consultation', method: 'POST',
      body: { p_patient_id: 'p1', p_consultation: { primary_diagnosis: 'Malaria' }, p_medicines: [], p_lab: { tests: ['FBC'] }, p_imaging: [] } }])
  })

  it('dispenses through dispense_prescription', async () => {
    const { calls, repo } = recording()
    await repo.dispensePrescription('rx1')
    expect(calls).toEqual([{ path: 'rpc/dispense_prescription', method: 'POST', body: { p_prescription_id: 'rx1' } }])
  })

  it('reads lab and imaging requests with the patient embedded (the tables have no patient name)', async () => {
    const { calls, repo } = recording()
    await repo.labRequests('biz-1')
    await repo.imagingRequests('biz-1')
    expect(calls.map((c) => c.path)).toEqual([
      'lab_requests?business_id=eq.biz-1&order=created_at.desc&select=*,patient:patients(full_name,reg_no,status)',
      'imaging_requests?business_id=eq.biz-1&order=created_at.desc&select=*,patient:patients(full_name,reg_no,status)',
    ])
  })
})

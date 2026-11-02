import { describe, it, expect } from 'vitest'
import { normalizeApplications, filterApplications, applicationSections, applicationRecordFields, splitAreas, maskAccount, APPLICATION_EXPORT_COLUMNS } from '../applicationRecords'
import { toCsv } from '../../../../lib/carefindhubExports'

const agent = { id: 'a1', applicant_name: 'Musa Bello', contact_email: 'musa@x.com', contact_phone: '0803', requested_city: 'Kano', requested_area: 'Nassarawa, Fagge; Gwale', applicant_details: { experience: '3 years in pharma sales', motivation: 'Serve my community', languages: ['Hausa', 'English'] }, status: 'submitted', submitted_at: '2026-10-30T09:00:00Z' }
const unified = { id: 'u1', type: 'agent', applicant_name: 'Ngozi Eze', applicant_email: 'ngozi@x.com', details: { phone: '0805', city: 'Enugu', selected_areas: ['Independence Layout', 'Ogui'], vehicle: true }, status: 'pending', submitted_at: '2026-10-31T09:00:00Z' }
const ecom = { id: 'e1', business_id: 'b1', status: 'pending', segment: 'pharmacy', terms_accepted: true, account_number: '0123456789', seller_info: { email: 'shop@x.com', bvn: '22222222222', store_name: 'Ada Online' }, created_at: '2026-10-29T09:00:00Z' }

describe('application records', () => {
  const list = normalizeApplications({ unified: [unified], agentLegacy: [agent], ecommerce: [ecom], businessNames: new Map([['b1', 'Ada Pharmacy']]) })

  it('merges the three sources newest first', () => {
    expect(list.map(a => a.key)).toEqual(['applications:u1', 'agent_applications:a1', 'ecommerce_applications:e1'])
  })

  it('maps an ambassador application in full: contact, location, selected areas and every answer', () => {
    const a = list[1]
    expect(a).toMatchObject({ type: 'agent', name: 'Musa Bello', phone: '0803', city: 'Kano', status: 'pending', areas: ['Nassarawa', 'Fagge', 'Gwale'], reviewable: true })
    const fields = Object.fromEntries(applicationRecordFields(a))
    expect(fields['Location: Selected areas']).toBe('Nassarawa, Fagge, Gwale')
    expect(fields['Application responses: Experience']).toBe('3 years in pharma sales')
    expect(fields['Application responses: Motivation']).toBe('Serve my community')
    expect(fields['Application responses: Languages']).toBe('Hausa, English')
  })

  it('reads unified applications from their details without repeating known fields as answers', () => {
    const a = list[0]
    expect(a).toMatchObject({ phone: '0805', city: 'Enugu', areas: ['Independence Layout', 'Ogui'] })
    expect(a.answers).toEqual([['Vehicle', true]])
  })

  it('shows online-store applications read-only, with the account masked and identity numbers left out', () => {
    const e = list[2]
    expect(e).toMatchObject({ name: 'Ada Pharmacy', reviewable: false, email: 'shop@x.com' })
    const text = JSON.stringify(applicationSections(e))
    expect(text).toContain('•••• 6789')
    expect(text).not.toContain('0123456789')
    expect(text).not.toContain('22222222222')
    expect(text).toContain('Ada Online')
  })

  it('filters by type, status and text including areas', () => {
    expect(filterApplications(list, { type: 'agent' })).toHaveLength(2)
    expect(filterApplications(list, { search: 'fagge' }).map(a => a.id)).toEqual(['a1'])
    expect(filterApplications(list, { status: 'approved' })).toHaveLength(0)
  })

  it('exports one row per application with areas and responses', () => {
    const csv = toCsv(APPLICATION_EXPORT_COLUMNS, [list[1]])
    expect(csv).toContain('Nassarawa; Fagge; Gwale')
    expect(csv).toContain('Experience: 3 years in pharma sales | Motivation: Serve my community')
  })

  it('splits areas and masks accounts', () => {
    expect(splitAreas('A | B\nC')).toEqual(['A', 'B', 'C'])
    expect(splitAreas(null)).toEqual([])
    expect(maskAccount('1234')).toBe('1234')
    expect(maskAccount('')).toBeNull()
  })
})

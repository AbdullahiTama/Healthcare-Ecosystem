import { describe, it, expect } from 'vitest'
import { exportToCSV, buildPdfHtml, buildExportRows, createExportJob } from './export.js'

describe('facility discovery export (matrix row: Export)', () => {
  const sample = [
    { name: 'LUTH', category: 'Hospital', address: 'Idi-Araba', lga: 'Mushin', state: 'Lagos', phone: '0801', distanceM: 320, source: 'carefind', verification: 'verified', confidence: 88, lat: 6.5, lng: 3.3 },
    { name: 'HealthPlus', category: 'Pharmacy', address: 'Ikeja', lga: 'Ikeja', state: 'Lagos', phone: '0802', distanceM: 540, source: 'osm', verification: 'external_unverified', confidence: 62, lat: 6.6, lng: 3.35 },
  ]
  const filters = { mode: 'state', state: 'Lagos', category: 'all', source: 'all', keyword: '', sort: 'distance' }

  it('buildExportRows preserves name/category/address/LGA/State/phone/distance/source', () => {
    const rows = buildExportRows(sample)
    expect(rows[0].name).toBe('LUTH')
    expect(rows[0].lga).toBe('Mushin')
    expect(rows[0].state).toBe('Lagos')
    expect(rows[0].distance).toBe('320 m')
    expect(rows[0].source).toBe('carefind')
  })

  it('exportToCSV includes criteria/date/count/header + data rows', () => {
    const csv = exportToCSV(sample, filters)
    expect(csv).toContain('Criteria')
    expect(csv).toContain('Lagos')
    expect(csv).toContain('Date')
    expect(csv).toContain('Count')
    expect(csv).toContain('Name')
    expect(csv).toContain('LUTH')
    expect(csv).toContain('HealthPlus')
    expect(csv).toContain('Category')
  })

  it('buildPdfHtml includes criteria/date/count/table', () => {
    const html = buildPdfHtml(sample, filters)
    expect(html).toContain('Criteria')
    expect(html).toContain('Lagos')
    expect(html).toContain('Count: 2')
    expect(html).toContain('<table>')
    expect(html).toContain('LUTH')
    expect(html).toContain('HealthPlus')
  })

  it('createExportJob simulates background progress for large sets', async () => {
    const large = Array.from({ length: 1200 }, (_, i) => ({ ...sample[0], name: 'F' + i, lat: 6.5, lng: 3.3 }))
    let lastProgress = null
    const job = await createExportJob(large, filters, (p) => { lastProgress = p })
    expect(job.total).toBe(1200)
    expect(job.status).toBe('complete')
    expect(lastProgress.percent).toBe(100)
  })

  it('respects provider restriction note via source column', () => {
    const withGoogle = [{ ...sample[0], source: 'google' }]
    const csv = exportToCSV(withGoogle, filters)
    expect(csv).toContain('google')
  })
})

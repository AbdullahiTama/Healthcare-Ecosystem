import { describe, it, expect } from 'vitest'
import { ROLE_TEMPLATES, getTemplatesForBusinessType, applyTemplate } from './roleTemplates'

describe('roleTemplates', () => {
  describe('ROLE_TEMPLATES', () => {
    it('has pharmacy templates', () => {
      expect(ROLE_TEMPLATES.pharmacy).toBeDefined()
      expect(ROLE_TEMPLATES.pharmacy.length).toBeGreaterThan(0)
    })

    it('has hospital templates', () => {
      expect(ROLE_TEMPLATES.hospital).toBeDefined()
      expect(ROLE_TEMPLATES.hospital.length).toBeGreaterThan(0)
    })

    it('has enterprise templates', () => {
      expect(ROLE_TEMPLATES.enterprise).toBeDefined()
      expect(ROLE_TEMPLATES.enterprise.length).toBeGreaterThan(0)
    })

    it('each template has required fields', () => {
      const allTemplates = [
        ...ROLE_TEMPLATES.pharmacy,
        ...ROLE_TEMPLATES.hospital,
        ...ROLE_TEMPLATES.enterprise,
      ]

      allTemplates.forEach(template => {
        expect(template.name).toBeDefined()
        expect(template.description).toBeDefined()
        expect(template.permissions).toBeDefined()
        expect(template.permissions.nav).toBeDefined()
        expect(Array.isArray(template.permissions.nav)).toBe(true)
      })
    })
  })

  describe('getTemplatesForBusinessType', () => {
    it('returns pharmacy templates for pharmacy business type', () => {
      const templates = getTemplatesForBusinessType('pharmacy')
      expect(templates).toEqual(ROLE_TEMPLATES.pharmacy)
    })

    it('returns pharmacy templates for skincare business type', () => {
      const templates = getTemplatesForBusinessType('skincare')
      expect(templates).toEqual(ROLE_TEMPLATES.pharmacy)
    })

    it('returns hospital templates for hospital business type', () => {
      const templates = getTemplatesForBusinessType('hospital')
      expect(templates).toEqual(ROLE_TEMPLATES.hospital)
    })

    it('returns enterprise templates for manufacturer_importer business type', () => {
      const templates = getTemplatesForBusinessType('manufacturer_importer')
      expect(templates).toEqual(ROLE_TEMPLATES.enterprise)
    })

    it('returns enterprise templates for wholesale business type', () => {
      const templates = getTemplatesForBusinessType('wholesale')
      expect(templates).toEqual(ROLE_TEMPLATES.enterprise)
    })

    it('returns empty array for unknown business type', () => {
      const templates = getTemplatesForBusinessType('unknown')
      expect(templates).toEqual([])
    })
  })

  describe('applyTemplate', () => {
    it('applies template permissions correctly', () => {
      const template = ROLE_TEMPLATES.pharmacy[0]
      const result = applyTemplate(template)

      expect(result.name).toBe(template.name)
      expect(result.label).toBe(template.name)
      expect(result.nav).toEqual(template.permissions.nav)
      expect(result.canEditPrice).toBe(template.permissions.canEditPrice)
      expect(result.canEditStock).toBe(template.permissions.canEditStock)
      expect(result.canDelete).toBe(template.permissions.canDelete)
      expect(result.canViewReports).toBe(template.permissions.canViewReports)
      expect(result.canExportReports).toBe(template.permissions.canExportReports)
      expect(result.canManageStaff).toBe(template.permissions.canManageStaff)
      expect(result.canViewFinance).toBe(template.permissions.canViewFinance)
      expect(result.canMakeSales).toBe(template.permissions.canMakeSales)
      expect(result.canViewSettings).toBe(template.permissions.canViewSettings)
    })

    it('applies Senior Pharmacist template correctly', () => {
      const seniorPharmacist = ROLE_TEMPLATES.pharmacy.find(t => t.name === 'Senior Pharmacist')
      const result = applyTemplate(seniorPharmacist)

      expect(result.nav).toContain('inventory')
      expect(result.nav).toContain('reports')
      expect(result.canEditStock).toBe(true)
      expect(result.canViewReports).toBe(true)
      expect(result.canExportReports).toBe(true)
    })

    it('applies Warehouse Operator template correctly', () => {
      const warehouseOp = ROLE_TEMPLATES.enterprise.find(t => t.name === 'Warehouse Operator')
      const result = applyTemplate(warehouseOp)

      expect(result.nav).toContain('warehouses')
      expect(result.nav).toContain('stock')
      expect(result.canEditStock).toBe(true)
      expect(result.canViewReports).toBe(false)
    })
  })
})

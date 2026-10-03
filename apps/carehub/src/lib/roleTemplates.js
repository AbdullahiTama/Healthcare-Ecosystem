// Role templates for common business types
// These provide sensible defaults that can be customized when creating new roles

export const ROLE_TEMPLATES = {
  pharmacy: [
    {
      name: 'Senior Pharmacist',
      description: 'Experienced pharmacist with inventory and reporting access',
      permissions: {
        nav: ['dashboard', 'pos', 'inventory', 'clients', 'consultation', 'rx_inbox', 'reports', 'adr-reports'],
        canEditPrice: false,
        canEditStock: true,
        canDelete: false,
        canViewReports: true,
        canExportReports: true,
        canManageStaff: false,
        canViewFinance: false,
        canMakeSales: true,
        canViewSettings: false,
      },
    },
    {
      name: 'Pharmacy Assistant',
      description: 'Front-counter staff focused on sales and customer service',
      permissions: {
        nav: ['dashboard', 'pos', 'clients'],
        canEditPrice: false,
        canEditStock: false,
        canDelete: false,
        canViewReports: false,
        canExportReports: false,
        canManageStaff: false,
        canViewFinance: false,
        canMakeSales: true,
        canViewSettings: false,
      },
    },
    {
      name: 'Inventory Manager',
      description: 'Manages stock levels, purchases, and warehouse operations',
      permissions: {
        nav: ['dashboard', 'inventory', 'purchases', 'demand', 'stock'],
        canEditPrice: true,
        canEditStock: true,
        canDelete: false,
        canViewReports: true,
        canExportReports: true,
        canManageStaff: false,
        canViewFinance: true,
        canMakeSales: false,
        canViewSettings: false,
      },
    },
  ],
  hospital: [
    {
      name: 'Head Nurse',
      description: 'Senior nursing staff with triage and patient management access',
      permissions: {
        nav: ['dashboard', 'triage', 'clients', 'reception', 'adr-reports'],
        canEditPrice: false,
        canEditStock: false,
        canDelete: false,
        canViewReports: true,
        canExportReports: false,
        canManageStaff: false,
        canViewFinance: false,
        canMakeSales: false,
        canViewSettings: false,
      },
    },
    {
      name: 'Medical Receptionist',
      description: 'Front desk staff managing appointments and patient intake',
      permissions: {
        nav: ['dashboard', 'reception', 'clients', 'appointments'],
        canEditPrice: false,
        canEditStock: false,
        canDelete: false,
        canViewReports: false,
        canExportReports: false,
        canManageStaff: false,
        canViewFinance: false,
        canMakeSales: false,
        canViewSettings: false,
      },
    },
    {
      name: 'Lab Supervisor',
      description: 'Manages laboratory operations and reporting',
      permissions: {
        nav: ['dashboard', 'lab', 'clients', 'reports', 'adr-reports'],
        canEditPrice: false,
        canEditStock: true,
        canDelete: false,
        canViewReports: true,
        canExportReports: true,
        canManageStaff: false,
        canViewFinance: false,
        canMakeSales: false,
        canViewSettings: false,
      },
    },
  ],
  enterprise: [
    {
      name: 'Regional Manager',
      description: 'Oversees multiple locations with full operational access',
      permissions: {
        nav: ['dashboard', 'orders', 'warehouses', 'stock', 'territories', 'reports', 'adr-reports'],
        canEditPrice: true,
        canEditStock: true,
        canDelete: false,
        canViewReports: true,
        canExportReports: true,
        canManageStaff: true,
        canViewFinance: true,
        canMakeSales: false,
        canViewSettings: false,
      },
    },
    {
      name: 'Warehouse Operator',
      description: 'Manages stock movements and warehouse operations',
      permissions: {
        nav: ['dashboard', 'warehouses', 'stock', 'orders'],
        canEditPrice: false,
        canEditStock: true,
        canDelete: false,
        canViewReports: false,
        canExportReports: false,
        canManageStaff: false,
        canViewFinance: false,
        canMakeSales: false,
        canViewSettings: false,
      },
    },
    {
      name: 'Sales Representative',
      description: 'Field sales staff with territory and order access',
      permissions: {
        nav: ['dashboard', 'territories', 'orders', 'clients'],
        canEditPrice: false,
        canEditStock: false,
        canDelete: false,
        canViewReports: false,
        canExportReports: false,
        canManageStaff: false,
        canViewFinance: false,
        canMakeSales: true,
        canViewSettings: false,
      },
    },
  ],
}

export function getTemplatesForBusinessType(businessType) {
  if (businessType === 'hospital') return ROLE_TEMPLATES.hospital
  if (businessType === 'manufacturer_importer' || businessType === 'wholesale') return ROLE_TEMPLATES.enterprise
  if (businessType === 'pharmacy' || businessType === 'skincare' || businessType === 'dental' || businessType === 'optical' || businessType === 'wellness') {
    return ROLE_TEMPLATES.pharmacy
  }
  return []
}

export function applyTemplate(template) {
  return {
    name: template.name,
    label: template.name,
    nav: template.permissions.nav,
    canEditPrice: template.permissions.canEditPrice,
    canEditStock: template.permissions.canEditStock,
    canDelete: template.permissions.canDelete,
    canViewReports: template.permissions.canViewReports,
    canExportReports: template.permissions.canExportReports,
    canManageStaff: template.permissions.canManageStaff,
    canViewFinance: template.permissions.canViewFinance,
    canMakeSales: template.permissions.canMakeSales,
    canViewSettings: template.permissions.canViewSettings,
  }
}

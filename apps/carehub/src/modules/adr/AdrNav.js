import {
  Dossier, Search, Clipboard,
  Pill, Stethoscope, Factory, Sparkles
} from 'lucide-react'
import { getPerms } from '../../lib/permissions'
import { getModuleTypeFromBusinessType } from './repositories'

export const ADR_NAV_ITEMS = {
  [ 'community_pharmacy' ]: [
    { id: 'adr-community-pharmacy', label: 'Community Pharmacy ADR', icon: Pill, section: 'intelligence' },
  ],
  [ 'hospital' ]: [
    { id: 'adr-hospital', label: 'Hospital ADR', icon: Stethoscope, section: 'clinical' },
  ],
  [ 'industry' ]: [
    { id: 'adr-industry', label: 'Industry ADR', icon: Factory, section: 'intelligence' },
    { id: 'pv-tracker', label: 'PV Tracker', icon: Factory, section: 'intelligence' },
  ],
  [ 'skincare' ]: [
    { id: 'adr-skincare', label: 'Adverse Cosmetic Event', icon: Sparkles, section: 'intelligence' },
  ],
}

// Maps each ADR nav item onto the permissions.js nav key that gates the same
// area in the real sidebar and route guards. The backend RLS remains the
// authoritative access control; this only decides what is offered.
const ITEM_PERMISSION = {
  'adr-community-pharmacy': 'adr-reports',
  'adr-hospital': 'adr-reports',
  'adr-industry': 'adr-reports',
  'adr-skincare': 'adr-reports',
  'pv-tracker': 'pv-tracker',
}

// The ADR variant resolves through repositories' business-type map — the same
// one validation and the reports list use — so the signup taxonomy (clinic,
// laboratory, aesthetic, spa, haircare, cosmetics) lands on the right
// presentation without a second mapping to keep in sync.
export function getAdrNavItems(role, businessType) {
  const moduleType = getModuleTypeFromBusinessType(businessType)
  const items = ADR_NAV_ITEMS[moduleType] || ADR_NAV_ITEMS['community_pharmacy']
  const nav = getPerms(role).nav || []
  return items.filter(item => nav.includes(ITEM_PERMISSION[item.id] || 'adr-reports'))
}

export const ALL_NAV_ADR_DEFAULT = ADR_NAV_ITEMS['community_pharmacy'].map(item => [item.id, item.icon, item.label])
export const ALL_NAV_ADR_HOSPITAL = ADR_NAV_ITEMS['hospital'].map(item => [item.id, item.icon, item.label])
export const ALL_NAV_ADR_ENTERPRISE = ADR_NAV_ITEMS['industry'].map(item => [item.id, item.icon, item.label])
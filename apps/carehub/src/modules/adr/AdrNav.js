import { 
  Dossier, Search, Clipboard, 
  Pill, Stethoscope, Factory, Sparkles
} from 'lucide-react'

export const ADR_NAV_ITEMS = {
  [ 'community_pharmacy' ]: [
    { id: 'adr-community-pharmacy', label: 'Community Pharmacy ADR', icon: Pill, section: 'intelligence' },
  ],
  [ 'hospital' ]: [
    { id: 'adr-hospital', label: 'Hospital ADR', icon: Stethoscope, section: 'clinical' },
  ],
  [ 'industry' ]: [
    { id: 'adr-industry', label: 'Industry ADR', icon: Factory, section: 'intelligence' },
  ],
  [ 'skincare' ]: [
    { id: 'adr-skincare', label: 'Adverse Cosmetic Event', icon: Sparkles, section: 'intelligence' },
  ],
}

export function getAdrNavItems(role, businessType) {
  const items = ADR_NAV_ITEMS[businessType] || ADR_NAV_ITEMS['community_pharmacy']
  return items.filter(item => /* role check could go here */ true)
}

export const ALL_NAV_ADR_DEFAULT = ADR_NAV_ITEMS['community_pharmacy'].map(item => [item.id, item.icon, item.label])
export const ALL_NAV_ADR_HOSPITAL = ADR_NAV_ITEMS['hospital'].map(item => [item.id, item.icon, item.label])
export const ALL_NAV_ADR_ENTERPRISE = ADR_NAV_ITEMS['industry'].map(item => [item.id, item.icon, item.label])
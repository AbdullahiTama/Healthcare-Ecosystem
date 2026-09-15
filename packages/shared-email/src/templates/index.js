import * as HubTemplates from './Transactional/index.js'
import * as FindTemplates from './Transactional/CareFind/index.js'

export const TEMPLATE_REGISTRY = {
  ...HubTemplates,
  ...FindTemplates,
}

export const CAREHUB_TEMPLATES = HubTemplates
export const CAREFIND_TEMPLATES = FindTemplates

export function getTemplate(templateKey) {
  return TEMPLATE_REGISTRY[templateKey] || null
}

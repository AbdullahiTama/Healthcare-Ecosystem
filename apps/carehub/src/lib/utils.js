import { BUSINESS_TYPES } from '../config/constants.js'
import { theme } from '../styles/theme.js'
import { Sparkles, Pill, Stethoscope, Smile, Eye, Leaf, Factory, Truck, Building2 } from 'lucide-react'

// Re-exported from theme.js so every existing importer keeps working
// unchanged while the tokens live in one place. Values are identical to the
// pre-existing constants — this is additive, not a behavior change.
export const TEAL = theme.tealGradient
export const DARK = theme.darkGradient
export const TEALC = theme.tealDeep

export const fmt = (n) => '₦' + Number(n || 0).toLocaleString()
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG') : 'Not recorded'
// Local calendar date: toISOString() is UTC, which is yesterday for the first hour of a Nigerian day.
const pad2 = (n) => String(n).padStart(2, '0')
export const todayDate = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
export const nowStr = () => new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
export const currentMonth = () => todayDate().slice(0, 7)
export const genId = (prefix = 'TXN') => prefix + Math.floor(Math.random() * 900000 + 100000)

export const businessIcon = (type) => BUSINESS_TYPES.find(b => b.id === type)?.icon || '🏥'
export const businessName = (type) => BUSINESS_TYPES.find(b => b.id === type)?.name || 'Healthcare'

// Lucide equivalents of the BUSINESS_TYPES emoji glyphs — the shared source
// for the emoji→lucide migration (used by Settings, and the auth screens can
// adopt it in place of their local copies). Returns a lucide component.
const BUSINESS_LUCIDE = {
  skincare: Sparkles, pharmacy: Pill, hospital: Stethoscope, dental: Smile,
  optical: Eye, wellness: Leaf, manufacturer_importer: Factory, wholesale: Truck,
}
export const businessLucideIcon = (type) => BUSINESS_LUCIDE[type] || Building2

// A business's complete profile for the admin console: what the detail sheet shows and what a single-business or
// list export contains. Reads the columns the admin list already loads (BUSINESS_PUBLIC_COLUMNS in services/supabase).
// Plan state is described with the same rules the app enforces (lib/planStatus), from the row's own expiry.

import { estimateFromBrand, NOTICE_DAYS } from '../../../lib/planStatus'
import { PLAN_LABELS } from '../../../lib/planLimits'

const yesNo = (v) => (v === null || v === undefined ? null : !!v)
const naira = (v) => (v === null || v === undefined || v === '' ? null : `₦${Number(v).toLocaleString()}`)

// "Active", "Expires in 9 days", "Expired 3 days ago", "No expiry"
export function planSummary(b, now = new Date()) {
  const status = estimateFromBrand(b, now)
  if (status.daysLeft == null) return 'No expiry'
  if (status.daysLeft < 0) return `Expired ${-status.daysLeft} day${status.daysLeft === -1 ? '' : 's'} ago`
  if (status.daysLeft <= NOTICE_DAYS) return `Expires in ${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'}`
  return 'Active'
}

export function businessSections(b, { now = new Date() } = {}) {
  if (!b) return []
  const coords = (b.latitude ?? b.lat) != null && (b.longitude ?? b.lng) != null ? `${b.latitude ?? b.lat}, ${b.longitude ?? b.lng}` : null
  return [
    { title: 'Business', fields: [
      ['Name', b.name], ['Branch name', b.branch_name], ['Type', b.business_type], ['Category', b.category],
      ['Enterprise type', b.enterprise_type], ['Description', b.description], ['Status', b.status],
      ['Main business', b.parent_business_id ? `Branch of ${b.parent_business_id}` : 'Yes'], ['Business ID', b.id],
    ] },
    { title: 'Owner and contact', fields: [
      ['Owner', b.owner_name || b.owner], ['Owner email', b.owner_email || b.email], ['Sign-in email', b.email],
      ['Phone', b.phone], ['WhatsApp', b.whatsapp], ['Website', b.website],
    ] },
    { title: 'Location', fields: [
      ['Address', b.address], ['Area', b.area], ['City', b.city], ['LGA', b.lga], ['State', b.state],
      ['Location label', b.location_label], ['Coordinates', coords], ['Map link', b.maps_link],
    ] },
    { title: 'Subscription', fields: [
      ['Plan', PLAN_LABELS[b.plan] || b.plan || 'Basic'], ['Plan expires', b.plan_expires_at], ['Plan state', planSummary(b, now)],
    ] },
    { title: 'CareFind and services', fields: [
      ['Visible on CareFind', yesNo(b.visible_on_carefind)], ['Shows prices', yesNo(b.show_prices ?? b.show_price_on_carefind)],
      ['Online store', yesNo(b.ecommerce_enabled)], ['Bookings', yesNo(b.booking_enabled)], ['Booking type', b.booking_type],
      ['Opening hours', b.hours], ['Online consultation fee', naira(b.online_consultation_fee)],
      ['In-person consultation fee', naira(b.physical_consultation_fee)], ['Consultation medium', b.consultation_medium],
    ] },
    { title: 'Onboarding', fields: [
      ['Date onboarded', b.created_at], ['Referral code used', b.referral_code_used], ['Referring agent', b.referring_agent_id],
    ] },
  ]
}

export const BUSINESS_FULL_EXPORT_COLUMNS = [
  { label: 'Business ID', key: 'id' },
  { label: 'Name', key: 'name' },
  { label: 'Branch of', key: 'parent_business_id' },
  { label: 'Type', key: 'business_type' },
  { label: 'Category', key: 'category' },
  { label: 'Status', key: 'status' },
  { label: 'Owner', get: b => b.owner_name || b.owner || '' },
  { label: 'Owner email', get: b => b.owner_email || b.email || '' },
  { label: 'Phone', key: 'phone' },
  { label: 'WhatsApp', key: 'whatsapp' },
  { label: 'Website', key: 'website' },
  { label: 'Address', key: 'address' },
  { label: 'Area', key: 'area' },
  { label: 'City', key: 'city' },
  { label: 'LGA', key: 'lga' },
  { label: 'State', key: 'state' },
  { label: 'Plan', get: b => b.plan || 'basic' },
  { label: 'Plan expires', get: b => (b.plan_expires_at ? String(b.plan_expires_at).slice(0, 10) : '') },
  { label: 'Plan state', get: b => planSummary(b) },
  { label: 'Visible on CareFind', get: b => (b.visible_on_carefind ? 'Yes' : 'No') },
  { label: 'Online store', get: b => (b.ecommerce_enabled ? 'Yes' : 'No') },
  { label: 'Bookings', get: b => (b.booking_enabled ? 'Yes' : 'No') },
  { label: 'Date onboarded', get: b => (b.created_at ? String(b.created_at).slice(0, 10) : '') },
  { label: 'Referral code used', key: 'referral_code_used' },
]

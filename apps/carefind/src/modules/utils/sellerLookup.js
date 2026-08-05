// Seller identity resolution for marketplace products.
//
// A product listing comes from one of two pathways (apps write the same
// `products` table):
//   * CareHub inventory  → business_id, seller is a `businesses` row
//   * CareFind uploads   → owner_id, seller is a `profiles` row
//
// The business side is resolved by PostgREST's foreign-key embed at query
// time. The owner side is not — there is no reliable FK embed on owner_id,
// so standalone sellers rendered as the generic "CareFind seller" with no
// profile link, no name and no contact. `attachOwnerProfiles` closes that
// gap with one batched query (the same pattern the reviews screens use for
// reviewer names), attaching a namespaced `_owner` to each product so the
// existing row shape is untouched.

import { supabase } from '../../config/supabaseClient'

export const SELLER_FIELDS = 'id, full_name, display_name, phone, avatar_url, is_verified, verification_label'

export async function attachOwnerProfiles(products) {
  const list = products || []
  const ownerIds = [...new Set(list.map(p => p.owner_id).filter(Boolean))]
  if (ownerIds.length === 0) return list
  const { data } = await supabase
    .from('profiles')
    .select(SELLER_FIELDS)
    .in('id', ownerIds)
  const map = {}
  ;(data || []).forEach(pr => { map[pr.id] = pr })
  return list.map(p => (p.owner_id && map[p.owner_id] ? { ...p, _owner: map[p.owner_id] } : p))
}

// Display name for a product's seller: the business name first (CareHub
// pathway), then the owner profile (CareFind pathway), then a neutral
// fallback.
export function sellerName(p) {
  if (p?.businesses?.name) return p.businesses.name
  if (p?._owner?.full_name) return p._owner.full_name
  if (p?._owner?.display_name) return p._owner.display_name
  return 'CareFind seller'
}

// Best contact for a product: the product's own WhatsApp number, then the
// business's, then the owner profile's phone.
export function sellerContact(p) {
  return p?.whatsapp || p?.businesses?.whatsapp || p?._owner?.phone || null
}

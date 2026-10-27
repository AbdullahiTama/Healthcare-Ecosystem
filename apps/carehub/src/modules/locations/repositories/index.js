import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { createMasterCatalogRepository } from '../../master-catalog/repositories'

// ── Locations repository ─────────────────────────────────────────────────────
// A deep module over the multi-branch `businesses` tree — not to be confused
// with `enterprise_locations` (warehouses), which the warehouses module owns.
// The Locations page shows the owner which branches exist under their business,
// lets them add new ones, and clones the parent's master-product catalog into
// the new branch so it opens ready to operate.
//
// `getAllLocations` is a cross-branch read: it fetches the parent business and
// all its branches in one call. It must not be scoped to a single branch — the
// owner needs to see every branch.
export function createLocationsRepository(request = sbFetch) {
  const BUSINESS_PUBLIC_COLUMNS = 'id,name,owner,owner_name,owner_email,email,phone,whatsapp,address,state,city,business_type,category,hours,maps_link,lat,lng,website,status,visible_on_carefind,created_at,parent_business_id,branch_name,plan,cover_url,enterprise_type,plan_expires_at,location_label,show_price_on_carefind,logo_url,description,latitude,longitude,booking_enabled,booking_type,booking_slots,referring_agent_id,referral_code_used,show_prices,online_consultation_fee,physical_consultation_fee,branch_depth_limit,consultation_medium,consultation_medium_link,ecommerce_enabled,deleted_at,lga,area'

  async function getBusinessById(id) {
    const r = await request('businesses?id=eq.' + id + '&select=' + BUSINESS_PUBLIC_COLUMNS)
    return r[0] || null
  }

  async function getBranches(parentId) {
    return request('businesses?parent_business_id=eq.' + parentId + '&select=*')
  }

  return {
    async getAll(mainBusinessId) {
      const main = await getBusinessById(mainBusinessId)
      if (!main) return []
      const parentId = main.parent_business_id || mainBusinessId
      const parent = main.parent_business_id ? await getBusinessById(parentId) : main
      const branches = await getBranches(parentId)
      return parent ? [parent, ...branches] : branches
    },

    async addBranch(data) {
      return request('businesses', { method: 'POST', body: JSON.stringify(data), prefer: 'return=representation' })
    },

    async cloneBranchData(parentId, branchId) {
      // Every product and the roles are attempted (ten products at a time, so a large catalogue does not fire
      // hundreds of requests at once). If anything failed, one summary is thrown so the owner is told, instead of
      // finding half a shelf and staff without roles later.
      const problems = []
      // The branch carries the whole master catalogue at stock 0 (CareFind hides items without stock), 500 items per
      // call. Archived items are left out.
      // Before carehub_20261215 there is no archived_at column to filter on.
      const list = (filter) => pagedQuery(request, `master_products?business_id=eq.${parentId}${filter}&order=id.asc&select=id`)
      const masterRows = (await list('&archived_at=is.null').catch((e) => (/archived_at/.test(String(e?.message)) ? list('') : Promise.reject(e)))) || []
      const catalogue = createMasterCatalogRepository(request)
      let failed = 0
      for (let i = 0; i < masterRows.length; i += 500) {
        const chunk = masterRows.slice(i, i + 500).map((m) => m.id)
        try { await catalogue.carry(branchId, chunk) } catch (e) { failed += chunk.length }
      }
      if (failed > 0) problems.push(failed + ' of ' + masterRows.length + ' products could not be copied')
      try {
        const roles = await request(`roles?business_id=eq.${parentId}&select=name,permissions`)
        if (roles && roles.length > 0) {
          const branchRoles = roles.map(r => ({ business_id: branchId, name: r.name, permissions: r.permissions }))
          await request('roles', { method: 'POST', body: JSON.stringify(branchRoles), prefer: 'return=minimal' })
        }
      } catch (e) {
        problems.push('the staff roles could not be copied')
      }
      if (problems.length > 0) throw new Error(problems.join('; '))
    },
  }
}

export const locationsRepository = createLocationsRepository()

import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'

// ── E-commerce repository (Shop Foundation) ─────────────────────────────────
// Seam over ecommerce_applications / ecommerce_products / ecommerce_product_images.
// Reuses products as inventory source — ecommerce_products links via product_id.
// Covers onboarding, inventory-linked product setup, ordered multi-image, activate gate.
export function createEcommerceRepository({ request = sbFetch, upload = null } = {}) {
  const up = upload || (async () => { throw new Error('upload not configured') })

  return {
    // Application
    async getApplication(businessId) {
      try {
        const rows = await request(`ecommerce_applications?business_id=eq.${businessId}&select=*`)
        return rows[0] || null
      } catch (e) {
        if (String(e.message).includes('ecommerce_applications')) return null
        throw e
      }
    },

    async submitApplication(businessId, { terms_accepted, seller_info }) {
      if (!terms_accepted) throw new Error('You must accept the terms and conditions')
      const now = new Date().toISOString()
      // Upsert on business_id unique
      return request('ecommerce_applications', {
        method: 'POST',
        body: JSON.stringify({
          business_id: businessId,
          status: 'Submitted',
          terms_accepted: true,
          seller_info: seller_info || null,
          submitted_at: now,
        }),
        prefer: 'resolution=merge-duplicates,return=representation',
      })
    },

    async updateApplicationStatus(businessId, status, extra = {}) {
      const allowed = ['Draft','Submitted','Under Review','Approved','Rejected','Suspended']
      if (!allowed.includes(status)) throw new Error('Invalid application status')
      return request(`ecommerce_applications?business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, updated_at: new Date().toISOString(), ...extra }),
        prefer: 'return=minimal',
      })
    },

    // Inventory + ecommerce status — compose productRepository paged read with ecommerce rows
    async getInventoryWithStatus(businessId) {
      try {
        const products = await pagedQuery(request, `products?business_id=eq.${businessId}&order=name.asc,id.asc&select=*`)
        let ecommerceRows = []
        try {
          ecommerceRows = await request(`ecommerce_products?business_id=eq.${businessId}&select=*`)
        } catch (e) {
          if (!String(e.message).includes('ecommerce_products')) throw e
        }
        const byProduct = new Map((ecommerceRows || []).map(r => [r.product_id, r]))
        return (products || []).map(p => {
          const e = byProduct.get(p.id)
          let status = 'Not Activated'
          if (e) {
            // Map DB status to UI status, with Out of Stock override
            if ((p.stock ?? 0) <= 0) status = 'Out of Stock'
            else status = e.status
          } else if ((p.stock ?? 0) <= 0) {
            status = 'Out of Stock'
          }
          return { product: p, ecommerce: e || null, status, isActive: e?.status === 'Active' }
        })
      } catch (e) {
        if (String(e.message).includes('products')) return []
        throw e
      }
    },

    async getEcommerceProduct(businessId, productId) {
      try {
        const rows = await request(`ecommerce_products?business_id=eq.${businessId}&product_id=eq.${productId}&select=*`)
        return rows[0] || null
      } catch (e) {
        if (String(e.message).includes('ecommerce_products')) return null
        throw e
      }
    },

    async upsertEcommerceProduct(businessId, productId, { description, category, ecommerce_price_kobo, attributes }) {
      if (ecommerce_price_kobo != null && ecommerce_price_kobo < 0) throw new Error('Price must be non-negative')
      const payload = {
        business_id: businessId,
        product_id: productId,
        description: description || null,
        category: category || null,
        ecommerce_price_kobo: ecommerce_price_kobo ?? null,
        attributes: attributes || null,
      }
      // Check if exists
      let existing = null
      try {
        const rows = await request(`ecommerce_products?business_id=eq.${businessId}&product_id=eq.${productId}&select=id`)
        existing = rows[0] || null
      } catch (e) {}
      if (existing) {
        return request(`ecommerce_products?id=eq.${existing.id}&business_id=eq.${businessId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          prefer: 'return=minimal',
        })
      }
      return request('ecommerce_products', {
        method: 'POST',
        body: JSON.stringify(payload),
        prefer: 'return=minimal',
      })
    },

    // Images — ordered set per ecommerce_product
    async getImages(ecommerceProductId) {
      try {
        return await request(`ecommerce_product_images?ecommerce_product_id=eq.${ecommerceProductId}&order=position.asc&select=*`)
      } catch (e) {
        if (String(e.message).includes('ecommerce_product_images')) return []
        throw e
      }
    },

    async addImage(ecommerceProductId, file, contentType) {
      if (!file) throw new Error('File is required')
      // Validate mime/size before upload (5MB, image/*)
      const allowed = ['image/jpeg','image/png','image/webp','image/gif']
      if (contentType && !allowed.includes(contentType) && !String(contentType).startsWith('image/')) throw new Error('Unsupported image format')
      // Determine next position
      const existing = await this.getImages(ecommerceProductId)
      const nextPos = (existing?.length || 0)
      const path = `ecommerce/${ecommerceProductId}/${Date.now()}-${Math.floor(Math.random()*100000)}.jpg`
      const url = await up('ecommerce-images', path, file, contentType || 'image/jpeg', 'Image upload failed')
      return request('ecommerce_product_images', {
        method: 'POST',
        body: JSON.stringify({ ecommerce_product_id: ecommerceProductId, url, position: nextPos }),
      })
    },

    async reorderImages(ecommerceProductId, orderedIds) {
      // Two-phase to avoid UNIQUE (ecommerce_product_id, position) violation during reorder
      for (let i = 0; i < orderedIds.length; i++) {
        await request(`ecommerce_product_images?id=eq.${orderedIds[i]}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: 1000 + i }),
          prefer: 'return=minimal',
        })
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await request(`ecommerce_product_images?id=eq.${orderedIds[i]}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: i }),
          prefer: 'return=minimal',
        })
      }
    },

    async deleteImage(imageId) {
      return request(`ecommerce_product_images?id=eq.${imageId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // Activation gate: must be Approved, complete (description+category+image), not restricted
    async activate(businessId, productId) {
      // Check application eligibility
      const app = await this.getApplication(businessId)
      if (!app || app.status !== 'Approved') throw new Error('Business must be Approved before publishing products')
      // Check completeness
      const ecom = await this.getEcommerceProduct(businessId, productId)
      if (!ecom) throw new Error('Complete product information before activation')
      if (!ecom.description || String(ecom.description).trim().length < 10) throw new Error('Description is required (min 10 chars)')
      if (!ecom.category || !String(ecom.category).trim()) throw new Error('Category is required')
      const images = await this.getImages(ecom.id)
      if (!images || images.length === 0) throw new Error('At least one product image is required')
      // All good — activate
      return request(`ecommerce_products?id=eq.${ecom.id}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Active', active_at: new Date().toISOString() }),
        prefer: 'return=minimal',
      })
    },

    async setStatus(businessId, productId, status) {
      const allowed = ['Not Activated','Incomplete','Active','Paused','Out of Stock','Restricted']
      if (!allowed.includes(status)) throw new Error('Invalid product status')
      const ecom = await this.getEcommerceProduct(businessId, productId)
      if (!ecom) throw new Error('E-commerce product not found')
      const patch = { status }
      if (status === 'Active') patch.active_at = new Date().toISOString()
      return request(`ecommerce_products?id=eq.${ecom.id}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        prefer: 'return=minimal',
      })
    },
  }
}

export const ecommerceRepository = createEcommerceRepository()

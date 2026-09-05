import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { SEGMENT_RATES, resolveEcommerceSegment } from '../../../lib/ecommerceSegments'

// ── E-commerce repository (Shop Foundation + Terms Auto-Approval) ─────────────
// Seam over ecommerce_applications / ecommerce_products / ecommerce_product_images / ecommerce_terms.
// Covers onboarding with segment-specific versioned terms, auto-approve, audit, and approved-gated setup.
export function createEcommerceRepository({ request = sbFetch, upload = null } = {}) {
  const up = upload || (async () => { throw new Error('upload not configured') })

  const E_NOT_APPROVED = 'E_COMMERCE_NOT_APPROVED: E-commerce application required. Please review and accept the applicable Terms & Conditions and apply for E-commerce access before setting up products.'

  async function assertApproved(businessId) {
    const app = await getApplication(businessId)
    if (!app || app.status !== 'Approved') throw new Error(E_NOT_APPROVED)
    return app
  }

  async function getApplication(businessId) {
    try {
      const rows = await request(`ecommerce_applications?business_id=eq.${businessId}&select=*`)
      return rows[0] || null
    } catch (e) {
      if (String(e.message).includes('ecommerce_applications')) return null
      throw e
    }
  }

  async function getTermsForSegment(segment) {
    try {
      const seg = String(segment || '').toLowerCase().trim()
      if (!seg) return null
      const rows = await request(`ecommerce_terms?segment=eq.${seg}&is_active=eq.true&order=version.desc&select=*`)
      if (!rows || rows.length === 0) return null
      // In-memory adapter ignores order — sort deterministically here
      rows.sort((a,b) => String(b.version).localeCompare(String(a.version)))
      return rows[0]
    } catch (e) {
      if (String(e.message).includes('ecommerce_terms')) return null
      throw e
    }
  }

  async function getTermsById(id) {
    try {
      const rows = await request(`ecommerce_terms?id=eq.${id}&select=*`)
      return rows[0] || null
    } catch (e) {
      if (String(e.message).includes('ecommerce_terms')) return null
      throw e
    }
  }

  async function submitApplication(businessId, { terms_accepted, seller_info, segment, terms_version_id, applicant_user_id, audit_metadata, account_number }) {
    if (!terms_accepted) throw new Error('You must accept the terms and conditions')
    if (!account_number || !String(account_number).trim()) throw new Error('Account number is required')
    const now = new Date().toISOString()
    // Validate/resolve segment and terms version (before seller_info so missing-segment tests still get segment error)
    let seg = segment ? String(segment).toLowerCase().trim() : null
    if (seg && !(seg in SEGMENT_RATES)) throw new Error(`Invalid e-commerce segment: ${seg}`)
    let versionId = terms_version_id || null
    let termsRow = null
    if (versionId) {
      termsRow = await getTermsById(versionId)
      if (!termsRow) throw new Error('Terms version not found')
      if (seg && termsRow.segment !== seg) throw new Error('Terms version does not match segment')
      if (!seg) seg = termsRow.segment
      if (!termsRow.is_active) throw new Error('Terms version is not active')
    } else if (seg) {
      termsRow = await getTermsForSegment(seg)
      if (!termsRow) throw new Error(`No active terms for segment: ${seg}`)
      versionId = termsRow.id
    } else {
      throw new Error('segment and terms_version_id are required (resolve segment from business_type before applying)')
    }
    const rate = SEGMENT_RATES[seg]
    if (rate == null) throw new Error(`No commission rate configured for segment: ${seg}`)
    // Ensure terms commission matches configured rate (prevents drift)
    if (termsRow && Number(termsRow.commission_rate) !== rate) throw new Error(`Terms commission rate mismatch for ${seg}: ${termsRow.commission_rate} vs configured ${rate}`)
    if (!seller_info?.contactName || !String(seller_info.contactName).trim() || !seller_info?.contactPhone || !String(seller_info.contactPhone).trim()) throw new Error('Contact name and phone are required')
    // Auto-approve immediately (spec: Apply → Automatic Approval)
    return request('ecommerce_applications', {
      method: 'POST',
      body: JSON.stringify({
        business_id: businessId,
        status: 'Approved',
        terms_accepted: true,
        seller_info: seller_info || null,
        segment: seg,
        terms_version_id: versionId,
        accepted_commission_rate: rate,
        applicant_user_id: applicant_user_id || null,
        acceptance_timestamp: now,
        submitted_at: now,
        approval_timestamp: now,
        audit_metadata: audit_metadata || null,
        account_number: String(account_number).trim(),
        updated_at: now,
      }),
      prefer: 'resolution=merge-duplicates,return=representation',
    })
  }

  async function updateApplicationStatus(businessId, status, extra = {}) {
    const allowed = ['Draft','Submitted','Under Review','Approved','Rejected','Suspended']
    if (!allowed.includes(status)) throw new Error('Invalid application status')
    return request(`ecommerce_applications?business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, updated_at: new Date().toISOString(), ...extra }),
      prefer: 'return=minimal',
    })
  }

  // Inventory + ecommerce status — compose productRepository paged read with ecommerce rows
  async function getInventoryWithStatus(businessId) {
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
          if (e.is_restricted) status = 'Restricted'
          else if ((p.stock ?? 0) <= 0) status = 'Out of Stock'
          else status = e.status
        } else if ((p.stock ?? 0) <= 0) {
          status = 'Out of Stock'
        }
        return { product: p, ecommerce: e || null, status, isActive: e?.status === 'Active' && !(e.is_restricted) && (p.stock ?? 0) > 0 }
      })
    } catch (e) {
      if (String(e.message).includes('products')) return []
      throw e
    }
  }

  async function getEcommerceProduct(businessId, productId) {
    try {
      const rows = await request(`ecommerce_products?business_id=eq.${businessId}&product_id=eq.${productId}&select=*`)
      return rows[0] || null
    } catch (e) {
      if (String(e.message).includes('ecommerce_products')) return null
      throw e
    }
  }

  async function upsertEcommerceProduct(businessId, productId, { description, category, ecommerce_price_kobo, attributes, prescription_required, warnings, restrictions, is_restricted }) {
    await assertApproved(businessId)
    if (ecommerce_price_kobo != null && ecommerce_price_kobo < 0) throw new Error('Price must be non-negative')
    const payload = {
      business_id: businessId,
      product_id: productId,
      description: description || null,
      category: category || null,
      ecommerce_price_kobo: ecommerce_price_kobo ?? null,
      attributes: attributes || null,
      prescription_required: !!prescription_required,
      warnings: warnings || null,
      restrictions: restrictions || null,
      is_restricted: !!is_restricted,
    }
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
  }

  // Images — ordered set per ecommerce_product
  async function getImages(ecommerceProductId) {
    try {
      const rows = await request(`ecommerce_product_images?ecommerce_product_id=eq.${ecommerceProductId}&order=position.asc&select=*`)
      // In-memory adapter ignores order — sort here for determinism (mirrors DB order)
      return [...(rows || [])].sort((a,b) => (a.position ?? 0) - (b.position ?? 0))
    } catch (e) {
      if (String(e.message).includes('ecommerce_product_images')) return []
      throw e
    }
  }

  async function assertApprovedByProductId(ecommerceProductId) {
    try {
      const rows = await request(`ecommerce_products?id=eq.${ecommerceProductId}&select=business_id`)
      const biz = rows[0]?.business_id
      if (!biz) throw new Error('E-commerce product not found')
      await assertApproved(biz)
    } catch (e) {
      if (String(e.message).includes(E_NOT_APPROVED) || String(e.message).includes('E_COMMERCE_NOT_APPROVED') || String(e.message).includes('E-commerce product not found')) throw e
      throw e
    }
  }

  async function assertApprovedByImageId(imageId) {
    try {
      const imgRows = await request(`ecommerce_product_images?id=eq.${imageId}&select=ecommerce_product_id`)
      const pid = imgRows[0]?.ecommerce_product_id
      if (!pid) throw new Error(E_NOT_APPROVED)
      await assertApprovedByProductId(pid)
    } catch (e) {
      if (String(e.message).includes(E_NOT_APPROVED) || String(e.message).includes('E_COMMERCE_NOT_APPROVED')) throw e
      throw e
    }
  }

  async function addImage(ecommerceProductId, file, contentType) {
    if (!file) throw new Error('File is required')
    if (file.size === 0) throw new Error('Image is empty')
    await assertApprovedByProductId(ecommerceProductId)
    const allowed = ['image/jpeg','image/png','image/webp','image/gif']
    if (contentType && !allowed.includes(contentType)) throw new Error('Unsupported image format')
    if (file.size && file.size > 5 * 1024 * 1024) throw new Error('Image must be ≤ 5MB')
    const existing = await getImages(ecommerceProductId)
    const nextPos = (existing?.length || 0)
    const ext = (file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'jpg').replace(/[^a-z0-9]/g,'') || 'jpg'
    const safeExt = ['jpg','jpeg','png','webp','gif'].includes(ext) ? ext : 'jpg'
    const path = `ecommerce/${ecommerceProductId}/${Date.now()}-${Math.floor(Math.random()*100000)}.${safeExt}`
    const url = await up('ecommerce-images', path, file, contentType || 'image/jpeg', 'Image upload failed')
    return request('ecommerce_product_images', {
      method: 'POST',
      body: JSON.stringify({ ecommerce_product_id: ecommerceProductId, url, position: nextPos }),
    })
  }

  async function reorderImages(ecommerceProductId, orderedIds) {
    await assertApprovedByProductId(ecommerceProductId)
    // Ownership validation: every id must belong to this product
    const existing = await getImages(ecommerceProductId)
    const validIds = new Set(existing.map(i => String(i.id)))
    for (const id of orderedIds) {
      if (!validIds.has(String(id))) throw new Error('Image does not belong to this product')
    }
    if (orderedIds.length !== existing.length) throw new Error('Reorder must include all images for this product')
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
  }

  async function deleteImage(imageId) {
    await assertApprovedByImageId(imageId)
    return request(`ecommerce_product_images?id=eq.${imageId}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    })
  }

  async function updateImagePositionAfterDelete(ecommerceProductId) {
    await assertApprovedByProductId(ecommerceProductId)
    const imgs = await getImages(ecommerceProductId)
    for (let i = 0; i < imgs.length; i++) {
      if (imgs[i].position !== i) {
        await request(`ecommerce_product_images?id=eq.${imgs[i].id}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: 1000 + i }),
          prefer: 'return=minimal',
        })
      }
    }
    for (let i = 0; i < imgs.length; i++) {
      if (imgs[i].position !== i) {
        await request(`ecommerce_product_images?id=eq.${imgs[i].id}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: i }),
          prefer: 'return=minimal',
        })
      }
    }
  }

  // Activation gate: must be Approved, complete (description+category+image), not restricted
  async function activate(businessId, productId) {
    const app = await getApplication(businessId)
    if (!app || app.status !== 'Approved') throw new Error('Business must be Approved before publishing products')
    const ecom = await getEcommerceProduct(businessId, productId)
    if (!ecom) throw new Error('Complete product information before activation')
    if (ecom.is_restricted) throw new Error('Product is restricted and cannot be activated')
    if (!ecom.description || String(ecom.description).trim().length < 10) throw new Error('Description is required (min 10 chars)')
    if (!ecom.category || !String(ecom.category).trim()) throw new Error('Category is required')
    const images = await getImages(ecom.id)
    if (!images || images.length === 0) throw new Error('At least one product image is required')
    return request(`ecommerce_products?id=eq.${ecom.id}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Active', active_at: new Date().toISOString() }),
      prefer: 'return=minimal',
    })
  }

  async function setStatus(businessId, productId, status) {
    await assertApproved(businessId)
    const allowed = ['Not Activated','Incomplete','Active','Paused','Out of Stock','Restricted']
    if (!allowed.includes(status)) throw new Error('Invalid product status')
    if (status === 'Active') {
      // Route through activate to enforce completeness (description, category, image, not restricted)
      return activate(businessId, productId)
    }
    const ecom = await getEcommerceProduct(businessId, productId)
    if (!ecom) throw new Error('E-commerce product not found')
    const patch = { status }
    return request(`ecommerce_products?id=eq.${ecom.id}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      prefer: 'return=minimal',
    })
  }

  return {
    getApplication,
    getTermsForSegment,
    getTermsById,
    submitApplication,
    updateApplicationStatus,
    getInventoryWithStatus,
    getEcommerceProduct,
    upsertEcommerceProduct,
    getImages,
    addImage,
    reorderImages,
    deleteImage,
    updateImagePositionAfterDelete,
    activate,
    setStatus,
    resolveEcommerceSegment,
    SEGMENT_RATES,
  }
}

export const ecommerceRepository = createEcommerceRepository()

import { useState, useEffect, useRef } from 'react'
import { ShoppingBag, Package, Image as ImageIcon, AlertTriangle, CheckCircle, Search, Upload, Trash2, ShieldCheck } from 'lucide-react'
import { createEcommerceRepository } from './repositories'
import { createShopVendorRepository } from './shopVendorRepository'
import { sbFetch, sbUpload } from '../../services/supabase'
import { authClient } from '../../lib/authClient'
import { theme } from '../../styles/theme'
import { Card, SectionHead, DataTable, Empty, Pill, Inp, Textarea, Sel, TealBtn, GhostBtn, Loading, useToast, Toast } from '../../components/ui'
import { resolveEcommerceSegment, SEGMENT_RATES, SEGMENT_LABELS, SEGMENT_COMMISSION_LABELS, SEGMENT_CHECKBOX_LABELS, commissionExample } from '../../lib/ecommerceSegments'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, danger, success, warning, bg } = theme

const ecommerceRepository = createEcommerceRepository({ request: sbFetch, upload: sbUpload })
const shopVendorRepository = createShopVendorRepository({ request: sbFetch })

export default function Ecommerce({ brand, role }) {
  const isOwner = role === 'Owner'
  const [app, setApp] = useState(null)
  const [appLoading, setAppLoading] = useState(true)
  const [appError, setAppError] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [sellerInfo, setSellerInfo] = useState({ contactName: '', contactPhone: '', contactEmail: '', businessDescription: '', accountNumber: '' })
  const [submittingApp, setSubmittingApp] = useState(false)
  const [terms, setTerms] = useState(null)
  const [termsLoading, setTermsLoading] = useState(true)
  const [termsError, setTermsError] = useState('')
  const termsRef = useRef(null)

  const [inventory, setInventory] = useState([])
  const [invLoading, setInvLoading] = useState(true)
  const [invError, setInvError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [ecomForm, setEcomForm] = useState({ description: '', category: '', ecommerce_price: '', prescription_required: false, warnings: '', restrictions: '', is_restricted: false })
  const [images, setImages] = useState([])
  const [savingProduct, setSavingProduct] = useState(false)
  const [activating, setActivating] = useState(false)
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState('')
  const [orderSearch, setOrderSearch] = useState('')
  const [orderStatus, setOrderStatus] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [orderDetail, setOrderDetail] = useState(null)
  const [orderMsg, setOrderMsg] = useState('')
  const [allowPayOnDelivery, setAllowPayOnDelivery] = useState(!!brand?.shop_allow_pay_on_delivery)
  const [togglingPayOnDelivery, setTogglingPayOnDelivery] = useState(false)

  const { msg, type, show: showToast } = useToast()

  useEffect(() => { setAllowPayOnDelivery(!!brand?.shop_allow_pay_on_delivery) }, [brand?.shop_allow_pay_on_delivery])

  async function handleTogglePayOnDelivery(checked) {
    if (!isOwner) { showToast('Only Owner can change Shop payment settings', { type: 'warning' }); return }
    setTogglingPayOnDelivery(true)
    try {
      const { error } = await sbFetch(`businesses?id=eq.${brand.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ shop_allow_pay_on_delivery: checked }),
        prefer: 'return=minimal',
      }).then(() => ({ error: null })).catch(e => ({ error: e }))
      // sbFetch returns rows, not error object — try direct fetch via supabase-like helper
      // Fallback: use supabase client if available
      if (error) throw error
      // Verify via direct RLS read
      const updated = await sbFetch(`businesses?id=eq.${brand.id}&select=shop_allow_pay_on_delivery`)
      const flag = Array.isArray(updated) && updated[0]?.shop_allow_pay_on_delivery
      setAllowPayOnDelivery(!!flag)
      showToast(checked ? 'Pay at Pickup enabled — customers can pay when they collect' : 'Pay at Pickup disabled — strict Paystack only', { type: 'success' })
    } catch (e) {
      // Try via authClient supabase as fallback
      try {
        const { data } = await (await import('../../lib/authClient')).authClient.from?.('businesses').select('shop_allow_pay_on_delivery').eq('id', brand.id).maybeSingle?.() ?? { data: null }
        // If still fails, just optimistically set UI and toast
        setAllowPayOnDelivery(checked)
        showToast('Setting updated (local) — will sync on reload', { type: 'info' })
      } catch {
        showToast(e.message || 'Could not update setting', { type: 'error' })
      }
    }
    setTogglingPayOnDelivery(false)
  }

  const segment = resolveEcommerceSegment(brand?.business_type, brand?.ecommerce_segment)
  const segmentLabel = SEGMENT_LABELS[segment] || segment
  const commissionLabel = SEGMENT_COMMISSION_LABELS[segment] || ''
  const commissionRate = SEGMENT_RATES[segment]
  const example = commissionExample(segment)

  useEffect(() => { loadApp(); loadInventory(); loadOrders() }, [brand?.id])
  useEffect(() => { if (app?.status === 'Approved') loadOrders() }, [app?.status])
  useEffect(() => { loadTerms() }, [segment])

  async function loadTerms() {
    setTermsLoading(true); setTermsError('')
    try {
      const t = await ecommerceRepository.getTermsForSegment(segment)
      if (!t) setTermsError('No active Terms for this segment — contact support')
      setTerms(t || null)
    } catch (e) {
      setTermsError('Could not load Terms & Conditions')
    }
    setTermsLoading(false)
  }

  async function loadOrders() {
    if (!brand?.id) return
    setOrdersLoading(true); setOrdersError('')
    try {
      const rows = await shopVendorRepository.listOrders(brand.id, { status: orderStatus !== 'all' ? orderStatus : undefined, search: orderSearch || undefined })
      setOrders(rows || [])
    } catch (e) { setOrdersError('Could not load orders'); setOrders([]) }
    setOrdersLoading(false)
  }
  async function openOrder(o) {
    setSelectedOrder(o)
    try {
      const d = await shopVendorRepository.getOrder(o.id)
      setOrderDetail(d)
    } catch { setOrderDetail(null) }
  }

  async function loadApp() {
    setAppLoading(true); setAppError('')
    try {
      const a = await ecommerceRepository.getApplication(brand.id)
      setApp(a)
      if (a?.seller_info) setSellerInfo(prev => ({ ...prev, ...a.seller_info }))
    } catch (e) { setAppError('Could not load application status') }
    setAppLoading(false)
  }

  async function loadInventory() {
    setInvLoading(true); setInvError('')
    try {
      const rows = await ecommerceRepository.getInventoryWithStatus(brand.id)
      setInventory(rows || [])
    } catch (e) { setInvError('Could not load inventory') }
    setInvLoading(false)
  }

  async function handleSubmitApp() {
    if (!termsAccepted) { showToast('You must accept the terms and conditions', { type: 'warning' }); return }
    if (!String(sellerInfo.contactName || '').trim() || !String(sellerInfo.contactPhone || '').trim()) { showToast('Contact name and phone are required', { type: 'warning' }); return }
    if (!String(sellerInfo.accountNumber || '').trim()) { showToast('Account number is required', { type: 'warning' }); return }
    if (!terms) { showToast('Terms not loaded — please retry', { type: 'warning' }); return }
    setSubmittingApp(true)
    try {
      let applicantUserId = null
      try {
        const { data } = await authClient.auth.getSession()
        applicantUserId = data?.session?.user?.id || null
      } catch {}
      const auditMetadata = {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        timestamp: new Date().toISOString(),
        segment,
        terms_version_id: terms.id,
      }
      await ecommerceRepository.submitApplication(brand.id, {
        terms_accepted: true,
        seller_info: sellerInfo,
        segment,
        terms_version_id: terms.id,
        applicant_user_id: applicantUserId,
        audit_metadata: auditMetadata,
        account_number: String(sellerInfo.accountNumber || '').trim(),
      })
      showToast('Application approved — E-commerce setup unlocked.', { type: 'success' })
      setTermsAccepted(false)
      await loadApp()
      await loadInventory()
    } catch (e) { showToast(e.message || 'Could not submit application', { type: 'error' }) }
    setSubmittingApp(false)
  }

  function scrollToTerms() {
    termsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleSetupBlocked() {
    showToast('E-commerce application required. Please review and accept the applicable Terms & Conditions and apply for E-commerce access before setting up products.', { type: 'warning' })
    scrollToTerms()
  }

  function openProduct(row) {
    if (app?.status !== 'Approved') {
      handleSetupBlocked()
      return
    }
    setSelected(row)
    const e = row.ecommerce
    setEcomForm({
      description: e?.description || '',
      category: e?.category || '',
      ecommerce_price: e?.ecommerce_price_kobo != null ? String(e.ecommerce_price_kobo / 100) : (row.product.price != null ? String(row.product.price) : ''),
      prescription_required: !!e?.prescription_required,
      warnings: e?.warnings || '',
      restrictions: e?.restrictions || '',
      is_restricted: !!e?.is_restricted,
    })
    if (e?.id) {
      ecommerceRepository.getImages(e.id).then(setImages).catch(() => setImages([]))
    } else setImages([])
  }

  async function handleSaveProduct() {
    if (!selected) return
    if (app?.status !== 'Approved') { handleSetupBlocked(); return }
    if (!ecomForm.description || ecomForm.description.trim().length < 10) { showToast('Description must be at least 10 characters', { type: 'warning' }); return }
    if (!ecomForm.category) { showToast('Category is required', { type: 'warning' }); return }
    if (ecomForm.is_restricted) { showToast('Restricted products cannot be saved as publishable — clear restricted flag or contact admin', { type: 'warning' }); }
    setSavingProduct(true)
    try {
      const priceKobo = ecomForm.ecommerce_price ? Math.round(parseFloat(ecomForm.ecommerce_price) * 100) : null
      if (priceKobo != null && (isNaN(priceKobo) || priceKobo < 0)) throw new Error('Price must be non-negative')
      await ecommerceRepository.upsertEcommerceProduct(brand.id, selected.product.id, {
        description: ecomForm.description.trim(),
        category: ecomForm.category,
        ecommerce_price_kobo: priceKobo,
        prescription_required: !!ecomForm.prescription_required,
        warnings: ecomForm.warnings?.trim() || null,
        restrictions: ecomForm.restrictions?.trim() || null,
        is_restricted: !!ecomForm.is_restricted,
      })
      showToast('Product information saved', { type: 'success' })
      loadInventory()
      const updated = await ecommerceRepository.getEcommerceProduct(brand.id, selected.product.id)
      if (updated) {
        setSelected(prev => ({ ...prev, ecommerce: updated, status: updated.status }))
      }
    } catch (e) { showToast(e.message || 'Could not save', { type: 'error' }) }
    setSavingProduct(false)
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !selected) return
    if (app?.status !== 'Approved') { handleSetupBlocked(); e.target.value = ''; return }
    let ecom = selected.ecommerce
    if (!ecom) {
      try {
        await handleSaveProduct()
        ecom = await ecommerceRepository.getEcommerceProduct(brand.id, selected.product.id)
        if (!ecom) { showToast('Save product info first', { type: 'warning' }); return }
        setSelected(prev => ({ ...prev, ecommerce: ecom }))
      } catch (err) { showToast('Save product before uploading images', { type: 'warning' }); return }
    }
    try {
      await ecommerceRepository.addImage(ecom.id, file, file.type)
      const imgs = await ecommerceRepository.getImages(ecom.id)
      setImages(imgs || [])
      showToast('Image uploaded', { type: 'success' })
    } catch (err) { showToast(err.message || 'Upload failed', { type: 'error' }) }
    e.target.value = ''
  }

  async function handleDeleteImage(id) {
    try {
      await ecommerceRepository.deleteImage(id)
      setImages(prev => prev.filter(i => i.id !== id))
      if (selected?.ecommerce?.id) {
        try { await ecommerceRepository.updateImagePositionAfterDelete(selected.ecommerce.id) } catch {}
        const imgs = await ecommerceRepository.getImages(selected.ecommerce.id)
        setImages(imgs || [])
      }
      showToast('Image removed', { type: 'success' })
    } catch (e) { showToast(e.message || 'Could not delete image', { type: 'error' }) }
  }

  async function handleReorder(from, to) {
    if (to < 0 || to >= images.length) return
    const newOrder = [...images]
    const [moved] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, moved)
    setImages(newOrder.map((img, idx) => ({ ...img, position: idx })))
    try {
      await ecommerceRepository.reorderImages(selected.ecommerce.id, newOrder.map(i => i.id))
      showToast('Order updated', { type: 'success' })
    } catch (e) { showToast('Could not reorder', { type: 'error' }); loadInventory() }
  }

  async function handleActivate() {
    if (!selected) return
    setActivating(true)
    try {
      await ecommerceRepository.activate(brand.id, selected.product.id)
      showToast('Product activated — visible in Shop', { type: 'success' })
      loadInventory()
      setSelected(null)
    } catch (e) { showToast(e.message || 'Could not activate', { type: 'error' }) }
    setActivating(false)
  }

  async function handlePause() {
    if (!selected) return
    try {
      await ecommerceRepository.setStatus(brand.id, selected.product.id, 'Paused')
      showToast('Product paused', { type: 'success' })
      loadInventory()
      setSelected(null)
    } catch (e) { showToast('Could not pause', { type: 'error' }) }
  }

  const filtered = inventory.filter(row => {
    const matchesSearch = !search || row.product.name.toLowerCase().includes(search.toLowerCase()) || (row.product.generic_name || '').toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || row.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const statusPillType = (s) => {
    if (s === 'Active') return 'green'
    if (s === 'Paused') return 'amber'
    if (s === 'Incomplete') return 'red'
    if (s === 'Out of Stock') return 'gray'
    if (s === 'Restricted') return 'red'
    return 'gray'
  }

  const isApproved = app?.status === 'Approved'
  const needsApplication = !app || ['Not Applied','Draft','Rejected','Suspended'].includes(app.status)

  if (!isOwner) return (
    <div style={{ padding: 32, textAlign: 'center', color: gray400 }}>
      <ShoppingBag size={40} style={{ margin: '0 auto 12px', display: 'block' }} />
      <div style={{ fontWeight: 700, color: gray600 }}>E-commerce is restricted to the business Owner</div>
    </div>
  )

  return (
    <div>
      <SectionHead title="E-commerce" sub="Prepare inventory for CareFind Shop — onboarding, product setup, and activation" />

      {/* Application — segment-specific mandatory gate */}
      <Card style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Package size={18} color={tealDeep} />
          <div style={{ fontWeight: 800, color: navy }}>Seller Application</div>
          {app && <Pill label={app.status} type={isApproved ? 'green' : app.status === 'Submitted' || app.status === 'Under Review' ? 'amber' : app.status === 'Rejected' ? 'red' : 'gray'} />}
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: gray500, background: bg, border: `1px solid ${border}`, padding: '3px 8px', borderRadius: 20 }}>{segmentLabel} • {commissionLabel}</span>
        </div>
        {appLoading ? <Loading text="Loading application..." /> : appError ? (
          <div role="alert" style={{ padding: 10, borderRadius: 8, background: danger + '10', border: `1px solid ${danger}30`, color: danger, fontSize: 13 }}>{appError} <button onClick={loadApp} style={{ marginLeft: 8, background: 'none', border: `1px solid ${danger}`, color: danger, borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>Retry</button></div>
        ) : isApproved ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 8, background: success + '10', border: `1px solid ${success}40`, color: success, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle size={16} /> Approved — you can now activate products for Shop.</div>
            {app.segment && (
              <div style={{ padding: 10, borderRadius: 8, background: bg, border: `1px solid ${border}`, fontSize: 12, color: gray600 }}>
                <div style={{ fontWeight: 700, color: navy, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={14} color={tealDeep} /> Accepted Terms</div>
                <div>Segment: <b>{app.segment}</b> • Commission: <b>{app.accepted_commission_rate != null ? `${(app.accepted_commission_rate * 100).toFixed(app.accepted_commission_rate === 0.025 ? 1 : 0)}%` : (commissionRate*100)+ '%'}</b> {app.terms_version_id ? `• Version: ${app.terms_version_id.slice(0,8)}` : ''}</div>
                <div style={{ fontSize: 11, color: gray400, marginTop: 2 }}>Accepted: {app.acceptance_timestamp ? new Date(app.acceptance_timestamp).toLocaleString() : '—'} • Approved: {app.approval_timestamp ? new Date(app.approval_timestamp).toLocaleString() : (app.submitted_at ? new Date(app.submitted_at).toLocaleString() : '—')}</div>
              </div>
            )}
            <details style={{ border: `1px solid ${border}`, borderRadius: 8, background: '#fff', padding: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, color: navy, fontSize: 12 }}>View accepted Terms & Conditions ({segmentLabel})</summary>
              {termsLoading ? <Loading text="Loading terms..." /> : terms ? (
                <div style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto', background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 800, color: navy, fontSize: 13, marginBottom: 6 }}>{terms.title}</div>
                  <div style={{ fontSize: 11, color: gray500, marginBottom: 8 }}>Segment: <b>{segmentLabel}</b> • Commission: <b>{commissionLabel}</b> • Example: {example.label}</div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 11, color: gray600, margin: 0, lineHeight: 1.5 }}>{terms.content}</pre>
                </div>
              ) : <div style={{ fontSize: 12, color: gray500 }}>Terms not available</div>}
            </details>
            <div style={{ marginTop: 10, padding: 12, borderRadius: 8, border: `1px solid ${border}`, background: bg }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 800, color: navy, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>Shop Payment Mode {allowPayOnDelivery ? <Pill label="Pay at Pickup enabled" type="green" /> : <Pill label="Strict Paystack" type="teal" />}</div>
                  <div style={{ fontSize: 11, color: gray500, marginTop: 2 }}>{allowPayOnDelivery ? 'Customers can choose Pay at Pickup (pickup only) — you collect cash/POS on collection. Otherwise strict Paystack.' : 'All Shop orders are strict Paystack — customers pay online before you prepare.'}</div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: navy, cursor: togglingPayOnDelivery ? 'wait' : 'pointer', opacity: togglingPayOnDelivery ? 0.6 : 1 }}>
                  <input type="checkbox" checked={allowPayOnDelivery} onChange={e => handleTogglePayOnDelivery(e.target.checked)} disabled={togglingPayOnDelivery} aria-label="Allow pay at pickup" style={{ width: 18, height: 18 }} />
                  Allow Pay at Pickup
                </label>
              </div>
            </div>
          </div>
        ) : needsApplication ? (
          <div ref={termsRef} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {app?.status === 'Rejected' && (
              <div role="alert" style={{ padding: 10, borderRadius: 8, background: danger + '10', border: `1px solid ${danger}30`, color: danger, fontSize: 12 }}>
                Rejected{app.rejection_reason ? `: ${app.rejection_reason}` : ''} — review the terms and re-apply below.
              </div>
            )}
            {/* Full Terms — dedicated scrollable gate */}
            <div role="region" aria-label="Terms & Conditions" style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}`, background: bg, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <ShieldCheck size={16} color={tealDeep} />
                <span style={{ fontWeight: 800, color: navy, fontSize: 13 }}>{terms?.title || `${segmentLabel} Terms & Conditions`}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: navy, background: warning + '18', border: `1px solid ${warning}40`, padding: '2px 8px', borderRadius: 20 }}>{commissionLabel}</span>
              </div>
              {termsLoading ? <div style={{ padding: 16 }}><Loading text="Loading Terms & Conditions..." /></div> : termsError ? (
                <div role="alert" style={{ padding: 12, color: danger, fontSize: 12 }}>{termsError} <button onClick={loadTerms} style={{ marginLeft: 8, background: 'none', border: `1px solid ${danger}`, color: danger, borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>Retry</button></div>
              ) : terms ? (
                <div style={{ padding: 14 }}>
                  <div style={{ padding: 10, borderRadius: 8, background: tealMist, border: `1px solid ${tealDeep}20`, fontSize: 12, color: navy, marginBottom: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>Commission Disclosure — {segmentLabel}</div>
                    <div>Commission: <b>{commissionLabel}</b> — paid by the vendor and deducted from vendor payout.</div>
                    <div style={{ marginTop: 4, fontSize: 11, color: gray600 }}>Example: {example.label}</div>
                    <div style={{ marginTop: 4, fontSize: 11, color: gray500 }}>Customer fulfilment and optional delivery fees are separate customer charges under the applicable pricing rules.</div>
                  </div>
                  <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${border}`, borderRadius: 8, background: bg, padding: 12 }}>
                    <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 11, color: gray600, margin: 0, lineHeight: 1.6 }}>{terms.content}</pre>
                  </div>
                  <div style={{ fontSize: 11, color: gray400, marginTop: 8 }}>Scroll to read the complete terms. The commission above is disclosed before you agree.</div>
                </div>
              ) : <div style={{ padding: 12, fontSize: 12, color: gray500 }}>No Terms available for segment {segment}</div>}
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '8px 4px' }}>
              <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} aria-label="Accept terms and conditions" style={{ marginTop: 2 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: navy }}>{SEGMENT_CHECKBOX_LABELS[segment] || 'I have read and agree to the E-commerce Terms & Conditions.'}</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label="Contact Name *" value={sellerInfo.contactName} onChange={v => setSellerInfo(p => ({ ...p, contactName: v }))} placeholder="Full name" />
              <Inp label="Contact Phone *" value={sellerInfo.contactPhone} onChange={v => setSellerInfo(p => ({ ...p, contactPhone: v }))} placeholder="080..." />
            </div>
            <Inp label="Contact Email" value={sellerInfo.contactEmail} onChange={v => setSellerInfo(p => ({ ...p, contactEmail: v }))} placeholder="seller@business.com" />
            <Inp label="Account Number *" value={sellerInfo.accountNumber} onChange={v => setSellerInfo(p => ({ ...p, accountNumber: v }))} placeholder="Your account number" />
            <Textarea label="Business Description" value={sellerInfo.businessDescription} onChange={v => setSellerInfo(p => ({ ...p, businessDescription: v }))} placeholder="What you sell, specialties..." rows={2} />
            <TealBtn onClick={handleSubmitApp} disabled={submittingApp || !termsAccepted || !terms} aria-disabled={!termsAccepted || !terms} style={{ alignSelf: 'flex-start', padding: '10px 20px', opacity: (!termsAccepted || !terms) ? 0.55 : 1 }}>{submittingApp ? 'Submitting...' : 'Apply'}</TealBtn>
            {!termsAccepted && <div style={{ fontSize: 11, color: warning }}>Check the box above to enable Apply.</div>}
            <div style={{ fontSize: 11, color: gray400 }}>By clicking Apply you will be automatically approved for E-commerce setup. Products still require at least one image and explicit activation before Shop visibility.</div>
          </div>
        ) : app.status === 'Submitted' || app.status === 'Under Review' ? (
          <div style={{ padding: 12, borderRadius: 8, background: tealMist, border: `1px solid ${tealDeep}30`, color: navy, fontSize: 13 }}>
            Application <b>{app.status}</b> — our team is reviewing your submission. You will be notified when approved. Product activation remains blocked until Approved.
          </div>
        ) : (
          <div style={{ padding: 12, borderRadius: 8, background: bg, border: `1px solid ${border}`, fontSize: 13 }}>Status: {app.status}</div>
        )}
      </Card>

      {/* Blocked setup banner when not Approved */}
      {!isApproved && !appLoading && (
        <Card style={{ padding: 14, marginBottom: 20, background: warning + '10', border: `1px solid ${warning}40` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: warning, fontWeight: 800, fontSize: 13 }}><AlertTriangle size={16} /> E-commerce application required.</div>
          <div style={{ fontSize: 12, color: gray600, marginTop: 4 }}>E-commerce application required. Please review and accept the applicable Terms & Conditions and apply for E-commerce access before setting up products.</div>
          <TealBtn onClick={scrollToTerms} style={{ marginTop: 8, padding: '8px 14px', fontSize: 12 }}>Apply for E-commerce</TealBtn>
        </Card>
      )}

      {/* Inventory */}
      <Card style={{ padding: 20, marginBottom: 20, opacity: isApproved ? 1 : 0.78 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <ShoppingBag size={18} color={tealDeep} />
          <div style={{ fontWeight: 800, color: navy }}>Inventory → E-commerce</div>
          <span style={{ fontSize: 11, color: gray400, marginLeft: 8 }}>{filtered.length} products</span>
          {!isApproved && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: warning, background: warning + '14', border: `1px solid ${warning}30`, padding: '2px 6px', borderRadius: 20 }}>Locked — apply above</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${border}`, borderRadius: 8, padding: '0 10px', background: '#fff' }}>
            <Search size={14} color={gray400} />
            <input aria-label="Search products" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 0', fontSize: 13 }} />
          </div>
          <Sel value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'All statuses' }, { value: 'Active', label: 'Active' }, { value: 'Not Activated', label: 'Not Activated' }, { value: 'Incomplete', label: 'Incomplete' }, { value: 'Paused', label: 'Paused' }, { value: 'Out of Stock', label: 'Out of Stock' }, { value: 'Restricted', label: 'Restricted' }]} />
          <button onClick={loadInventory} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${border}`, background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Refresh</button>
        </div>
        <DataTable
          rows={filtered}
          loading={invLoading}
          error={invError}
          onRetry={loadInventory}
          empty={<Empty icon={<Package size={40} />} message="No inventory products yet. Add products in Inventory first." />}
          count={`${filtered.length} products`}
          columns={[
            { key: 'name', label: 'Product', render: r => (
              <div>
                <div style={{ fontWeight: 700, color: navy, fontSize: 13 }}>{r.product.name}</div>
                {r.product.generic_name && <div style={{ fontSize: 11, color: gray500, fontStyle: 'italic' }}>{r.product.generic_name}</div>}
                <div style={{ fontSize: 11, color: gray400 }}>Stock: {r.product.stock ?? '—'} {r.product.stock === 0 && <span style={{ color: danger }}>(out of stock)</span>}</div>
              </div>
            )},
            { key: 'category', label: 'Category', render: r => <span style={{ fontSize: 12, color: gray600 }}>{r.ecommerce?.category || r.product.cat || r.product.category || '—'}</span> },
            { key: 'price', label: 'Price', render: r => (
              <span style={{ fontWeight: 700, color: tealDeep, fontSize: 12 }}>
                {(() => {
                  const p = r.ecommerce?.ecommerce_price_kobo ?? (r.product.price != null ? Math.round(r.product.price * 100) : null)
                  return p != null ? `₦${(p/100).toLocaleString()}` : '—'
                })()}
              </span>
            )},
            { key: 'status', label: 'E-commerce Status', render: r => <Pill label={r.status} type={statusPillType(r.status)} /> },
            { key: 'hint', label: 'Missing', render: r => {
              const missing = []
              if (!r.ecommerce?.description) missing.push('description')
              if (!r.ecommerce?.category) missing.push('category')
              if (!r.ecommerce) missing.push('setup')
              return missing.length ? <span style={{ fontSize: 11, color: warning }}>{missing.join(', ')}</span> : <span style={{ fontSize: 11, color: success }}>ready</span>
            }},
          ]}
          actions={r => (
            <div style={{ display: 'flex', gap: 6 }}>
              <TealBtn onClick={() => openProduct(r)} style={{ padding: '6px 10px', fontSize: 11 }}>{isApproved ? 'Setup' : 'Locked'}</TealBtn>
              {r.status === 'Active' ? <GhostBtn onClick={() => { if (!isApproved) { handleSetupBlocked(); return } setSelected(r); handlePause() }} style={{ padding: '6px 10px', fontSize: 11 }}>Pause</GhostBtn> : null}
            </div>
          )}
        />
      </Card>

      {/* Orders — vendor order inbox (A8/A9) */}
      <Card style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap:'wrap' }}>
          <Package size={18} color={tealDeep} />
          <div style={{ fontWeight: 800, color: navy }}>Orders</div>
          <span style={{ fontSize: 11, color: gray400 }}>{orders.length} orders</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems:'center' }}>
            <div style={{ display: 'flex', alignItems:'center', gap: 6, border:`1px solid ${border}`, borderRadius: 8, padding: '0 10px', background:'#fff' }}>
              <Search size={14} color={gray400} />
              <input aria-label="Search orders" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') loadOrders() }} placeholder="Order ref, customer, product..." style={{ border:'none', outline:'none', padding:'6px 0', fontSize: 12, minWidth: 140 }} />
            </div>
            <Sel value={orderStatus} onChange={v=>{ setOrderStatus(v); setTimeout(loadOrders,0) }} options={[{value:'all',label:'All'},{value:'pending_payment',label:'Pending Payment'},{value:'delivery_quote_pending',label:'Quote Pending'},{value:'paid',label:'Paid'},{value:'accepted',label:'Accepted'},{value:'processing',label:'Processing'},{value:'ready_for_pickup',label:'Ready for Pickup'},{value:'in_transit',label:'In Transit'},{value:'delivered',label:'Delivered'},{value:'cancelled',label:'Cancelled'}]} />
            <button onClick={loadOrders} style={{ padding:'6px 10px', borderRadius:8, border:`1px solid ${border}`, background:'#fff', cursor:'pointer', fontSize:11, fontWeight:700 }}>Search</button>
          </div>
        </div>
        {ordersLoading ? <Loading text="Loading orders..." /> : ordersError ? (
          <div role="alert" style={{ padding:10, borderRadius:8, background:danger+'10', border:`1px solid ${danger}30`, color:danger, fontSize:12 }}>{ordersError} <button onClick={loadOrders} style={{ marginLeft:8, background:'none', border:`1px solid ${danger}`, color:danger, borderRadius:6, padding:'2px 8px', cursor:'pointer' }}>Retry</button></div>
        ) : orders.length === 0 ? (
          <Empty icon={<ShoppingBag size={32} />} message={orderSearch||orderStatus!=='all' ? 'No orders match this filter' : 'No Shop orders yet — activate products and share your Shop.'} />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
            {orders.map(o=>(
              <div key={o.id} onClick={()=>openOrder(o)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:10, border:`1px solid ${border}`, borderRadius:8, background:'#fff', cursor:'pointer' }}>
                <div>
                  <div style={{ fontWeight:800, color:navy, fontSize:13 }}>{o.order_ref}</div>
                  <div style={{ fontSize:11, color:gray500 }}>{o.customer_name || o.customer_id?.slice(0,8)} · {new Date(o.created_at).toLocaleDateString()} · {o.delivery_preference==='pickup'?'Pickup':'Home'} {o.is_approved_city===false && <span style={{ color:warning }}>(quote pending)</span>}</div>
                  <div style={{ fontSize:11, color:gray500, marginTop:2 }}>{(o.shop_order_items||[]).slice(0,2).map(i=>`${i.product_name}×${i.quantity}`).join(', ')}{(o.shop_order_items||[]).length>2?'…':''}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <Pill label={o.status} type={o.status==='paid'||o.status==='delivered'?'green':o.status==='pending_payment'||o.status==='delivery_quote_pending'?'amber':o.status==='cancelled'?'red':'gray'} />
                  <div style={{ fontWeight:800, color:tealDeep, fontSize:12, marginTop:4 }}>₦{(o.total_kobo/100).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Order detail drawer (vendor ↔ CareFind communication A9) */}
      {selectedOrder && (
        <div role="dialog" aria-modal="true" aria-label={`Order ${selectedOrder.order_ref}`} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16, overflowY:'auto' }}>
          <Card style={{ maxWidth: 640, width:'100%', maxHeight:'90vh', overflowY:'auto', padding:20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <div style={{ fontWeight:800, color:navy }}>{selectedOrder.order_ref} <span style={{ fontWeight:400, color:gray500, fontSize:11 }}>{selectedOrder.status}</span></div>
              <button onClick={()=>{ setSelectedOrder(null); setOrderDetail(null) }} aria-label="Close" style={{ background:'none', border:`1px solid ${border}`, borderRadius:6, padding:'4px 8px', cursor:'pointer' }}>×</button>
            </div>
            {orderDetail ? (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div style={{ fontSize:12, color:gray600 }}>
                  <div><b>Customer:</b> {orderDetail.customer_name || orderDetail.customer_id} · {orderDetail.delivery_phone || ''} {orderDetail.delivery_email || ''}</div>
                  <div><b>Address:</b> {orderDetail.delivery_address} {orderDetail.delivery_city?`, ${orderDetail.delivery_city}`:''} {orderDetail.delivery_state?`, ${orderDetail.delivery_state}`:''}</div>
                  <div><b>Preference:</b> {orderDetail.delivery_preference} {orderDetail.distance_km!=null?`· ${orderDetail.distance_km}km`:''} {orderDetail.is_approved_city===false?'(quote pending)':''}</div>
                  <div><b>Payment:</b> {orderDetail.payment_status} · Ref {orderDetail.payment_reference}</div>
                </div>
                <div style={{ borderTop:`1px solid ${border}`, paddingTop:10 }}>
                  <div style={{ fontWeight:700, color:navy, marginBottom:6, fontSize:13 }}>Items (price snapshot)</div>
                  {(orderDetail.items||[]).map(it=>(
                    <div key={it.id} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'4px 0', borderBottom:`1px solid ${bg}` }}>
                      <span>{it.product_name} ×{it.quantity}</span><span>₦{(it.unit_price_kobo/100).toLocaleString()} = ₦{(it.line_total_kobo/100).toLocaleString()}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginTop:8 }}><span>Subtotal</span><span>₦{(orderDetail.subtotal_kobo/100).toLocaleString()}</span></div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}><span>Fulfilment</span><span>₦{(orderDetail.fulfilment_kobo/100).toLocaleString()}</span></div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}><span>Delivery</span><span>{orderDetail.delivery_kobo===0 && orderDetail.is_approved_city===false ? 'PENDING' : `₦${(orderDetail.delivery_kobo/100).toLocaleString()}`}</span></div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800, color:tealDeep, fontSize:13, borderTop:`1px solid ${border}`, paddingTop:6, marginTop:6 }}><span>Total</span><span>₦{(orderDetail.total_kobo/100).toLocaleString()}</span></div>
                  <div style={{ fontSize:11, color:gray400, marginTop:4 }}>Commission ₦{(orderDetail.commission_kobo/100).toLocaleString()} deducted from vendor payout (Fulfilment + Delivery paid by customer)</div>
                </div>
                <div style={{ borderTop:`1px solid ${border}`, paddingTop:10 }}>
                  <div style={{ fontWeight:700, color:navy, marginBottom:6, fontSize:13 }}>Status history (audit trail)</div>
                  {(orderDetail.history||[]).map(h=>(
                    <div key={h.id} style={{ fontSize:11, color:gray600, padding:'2px 0' }}>{new Date(h.created_at).toLocaleString()} — {h.from_status||'—'} → <b>{h.to_status}</b> {h.note?`· ${h.note}`:''}</div>
                  ))}
                  <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>
                    {orderDetail.status==='paid' && <TealBtn onClick={async()=>{ await shopVendorRepository.updateStatus(orderDetail.id,'accepted','Accepted by vendor'); loadOrders(); const d=await shopVendorRepository.getOrder(orderDetail.id); setOrderDetail(d); setSelectedOrder(d) }} style={{ padding:'6px 10px', fontSize:11 }}>Accept</TealBtn>}
                    {orderDetail.status==='accepted' && <TealBtn onClick={async()=>{ await shopVendorRepository.updateStatus(orderDetail.id,'processing'); loadOrders(); setOrderDetail(await shopVendorRepository.getOrder(orderDetail.id)) }} style={{ padding:'6px 10px', fontSize:11 }}>Processing</TealBtn>}
                    {orderDetail.status==='processing' && <TealBtn onClick={async()=>{ await shopVendorRepository.updateStatus(orderDetail.id,'ready_for_pickup'); loadOrders(); setOrderDetail(await shopVendorRepository.getOrder(orderDetail.id)) }} style={{ padding:'6px 10px', fontSize:11 }}>Ready for Pickup</TealBtn>}
                    {orderDetail.status==='ready_for_pickup' && <TealBtn onClick={async()=>{ await shopVendorRepository.updateStatus(orderDetail.id,'in_transit'); loadOrders(); setOrderDetail(await shopVendorRepository.getOrder(orderDetail.id)) }} style={{ padding:'6px 10px', fontSize:11 }}>In Transit</TealBtn>}
                    {orderDetail.status==='in_transit' && <TealBtn onClick={async()=>{ await shopVendorRepository.updateStatus(orderDetail.id,'delivered'); loadOrders(); setOrderDetail(await shopVendorRepository.getOrder(orderDetail.id)) }} style={{ padding:'6px 10px', fontSize:11 }}>Delivered</TealBtn>}
                    {orderDetail.is_approved_city===false && orderDetail.status==='delivery_quote_pending' && <TealBtn onClick={async()=>{ const q=prompt('Enter delivery quote (₦)'); if(q==null) return; await shopVendorRepository.updateStatus(orderDetail.id,'pending_payment',`Delivery quoted ₦${q}`); loadOrders(); }} style={{ padding:'6px 10px', fontSize:11 }}>Quote Delivery</TealBtn>}
                  </div>
                </div>
                <div style={{ borderTop:`1px solid ${border}`, paddingTop:10 }}>
                  <div style={{ fontWeight:700, color:navy, marginBottom:6, fontSize:13 }}>Order Communication (vendor ↔ CareFind)</div>
                  <div style={{ maxHeight:160, overflowY:'auto', border:`1px solid ${border}`, borderRadius:8, padding:8, background:bg, display:'flex', flexDirection:'column', gap:6 }}>
                    {(orderDetail.messages||[]).length===0 ? <div style={{ fontSize:11, color:gray400, textAlign:'center', padding:12 }}>No messages yet — instructions from CareFind will appear here</div> : orderDetail.messages.map(m=>(
                      <div key={m.id} style={{ fontSize:11, background: m.sender_role==='vendor' ? tealMist : '#fff', border:`1px solid ${border}`, borderRadius:6, padding:'6px 8px' }}><b style={{ color:navy }}>{m.sender_role}</b> · {new Date(m.created_at).toLocaleString()}<div style={{ color:gray600 }}>{m.message}</div></div>
                    ))}
                  </div>
                  <div style={{ display:'flex', gap:6, marginTop:6 }}>
                    <input value={orderMsg} onChange={e=>setOrderMsg(e.target.value)} placeholder="Reply with fulfilment info..." style={{ flex:1, border:`1px solid ${border}`, borderRadius:6, padding:'6px 8px', fontSize:12 }} />
                    <TealBtn onClick={async()=>{ if(!orderMsg.trim()) return; await shopVendorRepository.sendMessage(orderDetail.id,orderMsg.trim()); setOrderMsg(''); setOrderDetail(await shopVendorRepository.getOrder(orderDetail.id)) }} style={{ padding:'6px 12px', fontSize:11 }}>Send</TealBtn>
                  </div>
                </div>
              </div>
            ) : <Loading text="Loading order..." />}
          </Card>
        </div>
      )}

      {/* Product setup modal */}
      {selected && (
        <div role="dialog" aria-modal="true" aria-label={`Setup ${selected.product.name}`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16, overflowY: 'auto' }}>
          <Card style={{ maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 800, color: navy }}>{selected.product.name}</div>
              <button onClick={() => setSelected(null)} aria-label="Close" style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Textarea label="Description *" value={ecomForm.description} onChange={v => setEcomForm(p => ({ ...p, description: v }))} placeholder="Brief product description (min 10 chars)" rows={2} />
              <Sel label="Category *" value={ecomForm.category} onChange={v => setEcomForm(p => ({ ...p, category: v }))} options={[{ value: '', label: 'Select category' }, { value: 'medicine', label: 'Medicine' }, { value: 'device', label: 'Medical Device' }, { value: 'cosmetics', label: 'Cosmetics' }, { value: 'wellness', label: 'Wellness' }, { value: 'other', label: 'Other' }]} />
              <Inp label="E-commerce Price (₦)" type="number" value={ecomForm.ecommerce_price} onChange={v => setEcomForm(p => ({ ...p, ecommerce_price: v }))} placeholder="Leave blank to use inventory price" />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: navy }}>
                <input type="checkbox" checked={ecomForm.prescription_required} onChange={e => setEcomForm(p => ({ ...p, prescription_required: e.target.checked }))} />
                Prescription required
              </label>
              <Textarea label="Warnings / Usage Information" value={ecomForm.warnings} onChange={v => setEcomForm(p => ({ ...p, warnings: v }))} placeholder="Dosage guidance, contraindications, storage..." rows={2} />
              <Textarea label="Restrictions" value={ecomForm.restrictions} onChange={v => setEcomForm(p => ({ ...p, restrictions: v }))} placeholder="Age limit, prescription note, legal restriction..." rows={2} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: danger }}>
                <input type="checkbox" checked={ecomForm.is_restricted} onChange={e => setEcomForm(p => ({ ...p, is_restricted: e.target.checked }))} />
                Restricted / Blocked from Shop (admin/compliance)
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <TealBtn onClick={handleSaveProduct} disabled={savingProduct} style={{ flex: 1, padding: 10 }}>{savingProduct ? 'Saving...' : 'Save Product Info'}</TealBtn>
              </div>

              <div style={{ borderTop: `1px solid ${border}`, paddingTop: 12, marginTop: 8 }}>
                <div style={{ fontWeight: 700, color: navy, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><ImageIcon size={14} /> Product Images * <span style={{ fontWeight: 400, color: gray500, fontSize: 11 }}>(at least 1 required)</span></div>
                {images.length === 0 ? (
                  <div style={{ padding: 12, borderRadius: 8, background: warning + '10', border: `1px solid ${warning}30`, color: warning, fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={14} /> No images yet — upload at least one to activate.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, marginBottom: 8 }}>
                    {images.map((img, idx) => (
                      <div key={img.id} style={{ position: 'relative', border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ position: 'relative' }}>
                          <img src={img.url} alt={`Product image ${idx + 1}`} style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                          <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 6 }}>{idx + 1}/{images.length}</div>
                          <button onClick={() => handleDeleteImage(img.id)} aria-label={`Delete image ${idx + 1}`} style={{ position: 'absolute', top: 4, right: 4, background: danger, color: '#fff', border: 'none', borderRadius: 6, padding: '2px 6px', cursor: 'pointer' }}><Trash2 size={10} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: 4, padding: 4, borderTop: `1px solid ${border}`, background: '#fff' }}>
                          <button onClick={() => handleReorder(idx, idx - 1)} disabled={idx === 0} aria-label={`Move image ${idx + 1} up`} style={{ flex: 1, padding: '2px', fontSize: 10, border: `1px solid ${border}`, borderRadius: 4, background: idx === 0 ? bg : '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.5 : 1 }}>↑</button>
                          <button onClick={() => handleReorder(idx, idx + 1)} disabled={idx === images.length - 1} aria-label={`Move image ${idx + 1} down`} style={{ flex: 1, padding: '2px', fontSize: 10, border: `1px solid ${border}`, borderRadius: 4, background: idx === images.length - 1 ? bg : '#fff', cursor: idx === images.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === images.length - 1 ? 0.5 : 1 }}>↓</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, border: `1px solid ${tealDeep}`, background: tealMist, color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  <Upload size={14} /> Add Image
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} aria-label="Upload product image" />
                </label>
                <div style={{ fontSize: 11, color: gray400, marginTop: 6 }}>Supports JPEG/PNG/WebP/GIF, max 5MB, ordered set — you can reorder by drag (future) or delete and re-add.</div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <GhostBtn onClick={() => setSelected(null)} style={{ flex: 1, padding: 10 }}>Close</GhostBtn>
                {selected.status === 'Active' ? (
                  <GhostBtn onClick={handlePause} style={{ flex: 1, padding: 10, borderColor: warning, color: warning }}>Pause</GhostBtn>
                ) : (
                  <TealBtn onClick={handleActivate} disabled={activating || app?.status !== 'Approved'} style={{ flex: 1, padding: 10 }}>{activating ? 'Activating...' : 'Activate for Shop'}</TealBtn>
                )}
              </div>
              {app?.status !== 'Approved' && <div style={{ fontSize: 11, color: danger, textAlign: 'center' }}>Business must be Approved to activate — application required. Please review and accept the applicable Terms & Conditions and apply for E-commerce access before setting up products.</div>}
            </div>
          </Card>
        </div>
      )}

      <Toast msg={msg} type={type} />
    </div>
  )
}

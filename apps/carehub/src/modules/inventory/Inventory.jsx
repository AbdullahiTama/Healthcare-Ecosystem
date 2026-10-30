import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Download, Upload, AlertTriangle, Package, DollarSign, Search, Camera,
  FileUp, CheckCircle, ArrowRight, Clipboard, Plus, Loader2, TrendingUp, Percent,
} from 'lucide-react'
import { productRepository } from './repositories'
import { parseInventoryCsv } from './csvImport'
import { computeInventoryStats } from './inventoryStats'
import { exportInventoryXlsx } from './inventoryExport'
import { auditRepository } from '../audit/repositories'
import { fmt, todayDate } from '../../lib/utils'
import { PRODUCT_CATS } from '../../config/constants'
import { SALE_TYPES, SALE_TYPE_LABELS, unitLabel, unitsForSaleType, isUnitValidForSaleType, saleUnitError } from '@care-ecosystem/shared-marketplace'
import { findAllDuplicateGroups, createDuplicateIndex } from '../../lib/productMatches'
import { upsertProducts, removeProducts, toRows } from './productListState'
import { CatalogStatusBanner, CatalogSkeleton } from './components/CatalogStatus'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, Textarea, Toggle, GhostBtn, TealBtn, RedBtn, Loading, Empty, ErrorState, DataTable, useToast, Toast } from '../../components/ui'
import { planLimitsFor, PLAN_LABELS } from '../../lib/planLimits'
import { usePlanGate } from '../../hooks/usePlanGate'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray300, border, danger, dangerBg, warning, warningBg, success, successBg, bg } = theme

// One lucide icon per product row/tile — Clipboard for services, Package for
// stock goods — replacing the per-product emoji.
const productIcon = (p) => ((p.cat || p.category) === 'Services' ? Clipboard : Package)

export default function Inventory({ brand, products, setProducts, role, perms, loadProducts, catalog }) {
  // Catalog load state from BusinessDashboard (hooks/useProductCatalog.js).
  // Rendered without it (tests, older callers) the list is treated as loaded.
  const catalogState = catalog || { status: 'ready', refreshing: false, stale: false, loadedCount: 0, error: null, reload: loadProducts }
  const catalogLoading = catalogState.status === 'loading'
  const catalogFailed = catalogState.status === 'error'
  // Import, export, duplicate cleanup and the plan cap all need the whole list;
  // they wait until it has loaded.
  const catalogReady = catalogState.status === 'ready'
  const waitTitle = catalogReady ? undefined : 'Available once your products have loaded'
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [showRestock, setShowRestock] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadData, setUploadData] = useState([])
  const [uploadError, setUploadError] = useState('')
  const [importing, setImporting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const [showCleanup, setShowCleanup] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [exporting, setExporting] = useState(false)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  const plan = usePlanGate(showToast)

  // Both walk the whole catalog, so they are recomputed only when it changes,
  // not on every keystroke in the search box.
  const duplicateGroups = useMemo(() => findAllDuplicateGroups(products), [products])
  const totalDuplicateItems = duplicateGroups.reduce((s, g) => s + (g.length - 1), 0)

  // Built once per catalog change; the add form, CSV preview and CSV import
  // all check duplicates against it instead of scanning the catalog per row.
  const duplicateIndex = useMemo(() => createDuplicateIndex(products), [products])

  // Rows in a CSV being previewed that already exist (they will be skipped).
  const uploadDupeCount = useMemo(
    () => uploadData.filter(p => duplicateIndex.find(p.name, p.generic_name)).length,
    [uploadData, duplicateIndex],
  )

  const cats = useMemo(() => ['All', ...Array.from(new Set(products.map(p => p.cat || p.category)))], [products])

  // Deep-link filters (issue #4): the dashboard's proactive alerts link here
  // with ?stock=low|out and ?expiry=expiring|expired, so a tap opens the full
  // affected list rather than a summary line.
  const [searchParams] = useSearchParams()
  const [stockFilter, setStockFilter] = useState(searchParams.get('stock') === 'low' || searchParams.get('stock') === 'out' ? searchParams.get('stock') : '')
  const [expiryFilter, setExpiryFilter] = useState(searchParams.get('expiry') === 'expiring' || searchParams.get('expiry') === 'expired' ? searchParams.get('expiry') : '')

  const daysToExpiry = (p) => {
    if (!p.expiry_date) return null
    const d = new Date(p.expiry_date)
    if (Number.isNaN(d.getTime())) return null
    return Math.ceil((d - new Date()) / 86400000)
  }

  const filtered = useMemo(() => products.filter(p => {
    const pCat = p.cat || p.category || ''
    const pGeneric = p.generic_name || p.genericName || ''
    if (catFilter !== 'All' && pCat !== catFilter) return false
    if (!(p.name.toLowerCase().includes(search.toLowerCase()) || pGeneric.toLowerCase().includes(search.toLowerCase()))) return false
    const isService = pCat === 'Services'
    if (stockFilter === 'low' && (isService || !(p.stock > 0 && p.stock <= (p.reorder_level || 5)))) return false
    if (stockFilter === 'out' && (isService || p.stock > 0)) return false
    const t = expiryFilter ? daysToExpiry(p) : null
    if (expiryFilter === 'expiring' && !(t !== null && t >= 0 && t <= 60)) return false
    if (expiryFilter === 'expired' && !(t !== null && t < 0)) return false
    return true
  }), [products, catFilter, search, stockFilter, expiryFilter])

  // Pagination — 50 rows per page. Reset to page 0 whenever the result set
  // changes (search, filter, or a save) so the user never lands on an
  // empty page that no longer exists. DataTable does the slicing.
  function clearFilters() {
    setSearch('')
    setCatFilter('All')
    setStockFilter('')
    setExpiryFilter('')
  }

  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [search, catFilter, stockFilter, expiryFilter, products.length])
  // Summary figures (issue #3): one pass in inventoryStats.js, recomputed
  // whenever the product list changes so the KPI row tracks stock live.
  const { lowStock, outOfStock, stockValue, costValue, profit, margin, missingCost, onCareFind } =
    useMemo(() => computeInventoryStats(products), [products])

  // Exports the filtered list (all pages), so what the user sees is what they get.
  // The export is recorded in the audit log before the file is saved. A refusal
  // from the database (the role may not export) cancels the download; a missing
  // record for any other reason still delivers the file but says so.
  async function exportExcel() {
    if (filtered.length === 0) { showToast('There are no products to export.', { type: 'warning' }); return }
    if (!plan.allow('exporting')) return
    setExporting(true)
    try {
      let audit = { status: 'failed' }
      const saved = await exportInventoryXlsx(filtered, {
        beforeDownload: async () => {
          audit = await auditRepository.recordExport(brand.id, {
            exportType: 'inventory.xlsx',
            rowCount: filtered.length,
            // The search term itself is not stored, only that one was applied.
            filters: { category: catFilter === 'All' ? null : catFilter, stock: stockFilter || null, expiry: expiryFilter || null, search_applied: !!search.trim() },
          })
          return audit.status !== 'refused'
        },
      })
      if (!saved) {
        showToast('Your role is not allowed to export data.', { type: 'error' })
      } else if (audit.status === 'recorded') {
        showToast(`Exported ${filtered.length} product${filtered.length !== 1 ? 's' : ''} to Excel.`, { type: 'success' })
      } else {
        console.warn('[inventory] export audit record not saved:', audit.status)
        showToast(`Exported ${filtered.length} product${filtered.length !== 1 ? 's' : ''}, but the audit record could not be saved.`, { type: 'warning' })
      }
    } catch (e) {
      console.error('inventory export failed:', e)
      showToast('Could not export: ' + e.message, { type: 'error' })
    }
    setExporting(false)
  }

  // After a save the page applies the row the server returned to the list it
  // already holds (productListState.js) instead of re-downloading the whole
  // catalog. BusinessDashboard refreshes the offline cache from the new list.
  const applySaved = (result) => setProducts(prev => upsertProducts(prev, result))
  const applyRemoved = (ids) => setProducts(prev => removeProducts(prev, ids))

  async function saveProduct(data, isEdit) {
    try {
      const category = data.cat || data.category || 'Medicines'
      // Build clean productData — explicitly exclude 'cat' since Supabase only has 'category'
      const { cat, stock, ...rest } = data
      const productData = {
        ...rest,
        category,
        price: parseFloat(data.price) || 0,
        cost_price: parseFloat(data.cost_price) || 0,
        reorder_level: parseInt(data.reorder_level) || 5,
        shelf_label: data.shelf_label || null,
      }
      // Stock is only written when the caller sent it: ProductModal omits it on
      // an edit that did not change it (see ProductModal.save).
      if (category === 'Services') productData.stock = 999
      else if (stock !== undefined) productData.stock = parseInt(stock) || 0

      if (!isEdit) {
        if (!plan.allow('adding products')) return
        // Enforce product cap for Basic (5,000)
        const limit = planLimitsFor(brand?.plan)
        if (limit.maxProducts !== Infinity && products.length >= limit.maxProducts) {
          showToast(`Your ${PLAN_LABELS[brand?.plan] || 'Basic'} plan allows up to ${limit.maxProducts.toLocaleString()} products. Upgrade your plan in Settings to add more.`, { type: 'warning' })
          return
        }
        // Check for duplicate — but only if name is specific enough (more than 3 chars)
        const name = (productData.name || '').trim()
        const generic = (productData.generic_name || '').trim()
        if (name.length > 3) {
          const dupe = duplicateIndex.find(name, generic)
          if (dupe) {
            setDuplicateWarning({ existing: dupe, incoming: productData, key: intentKey('add-existing:' + dupe.id) })
            return
          }
        }
      }

      if (isEdit) {
        const saved = await productRepository.update(data.id, brand.id, productData)
        if (!saved) throw new Error('This product no longer exists. Refresh the page to see the latest list.')
        applySaved(saved)
        showToast('Product updated!', { type: 'success' })
      } else {
        const created = await productRepository.create(brand.id, productData)
        applySaved(created)
        showToast('Product added!', { type: 'success' })
      }
    } catch (e) {
      console.error('saveProduct error:', e)
      showToast(e.message || 'Could not save product. Please try again.', { type: 'error' })
    }
  }

  // The incoming units are added in the database through the stock ledger (receive_stock),
  // The incoming units are added in the database (increment_product_stock),
  // not written as existing.stock + incoming.stock: `existing` comes from the
  // page's product list, which goes stale as POS sells, so an absolute write
  // erased every sale made since it loaded. Fields are updated first so a
  // failure there adds no stock and a retry cannot double count it. Prices
  // change only for roles allowed to edit prices: this updates an existing
  // product, so Add Product's "new products may be priced" rule does not apply.
  async function updateExistingFromDuplicate() {
    if (!duplicateWarning) return
    try {
      const { existing, incoming } = duplicateWarning
      const updates = {
        reorder_level: incoming.reorder_level,
        category: incoming.category,
        barcode: incoming.barcode || existing.barcode,
        list_on_carefind: incoming.list_on_carefind,
      }
      if (perms?.canEditPrice) { updates.price = incoming.price; updates.cost_price = incoming.cost_price }
      const saved = await productRepository.update(existing.id, brand.id, updates)
      if (!saved) throw new Error('product not found')
      const added = incoming.category === 'Services' ? 0 : (parseInt(incoming.stock) || 0)
      let newStock = null
      if (added > 0) {
        try {
          // Through the stock ledger, keyed to this warning: pressing the
          // button again after a failure cannot add the units twice.
          const result = await productRepository.receiveStock(brand.id, existing.id, added, {
            movementType: 'adjustment',
            idempotencyKey: duplicateWarning.key,
            sourceType: 'inventory_add_existing',
            reason: 'Added through Add Product',
          })
          newStock = result?.stock ?? null
        } catch (e) {
          applySaved(saved)
          if (e.code === 'BATCH_REQUIRED' || e.code === 'EXPIRY_REQUIRED') {
            showToast('Details updated, but no stock was added: this product is tracked by batch. Add its stock with + Stock or Purchases so the batch is recorded.', { type: 'warning', duration: 9000 })
            setDuplicateWarning(null)
            setShowAdd(false)
            setEditItem(null)
            return
          }
          throw e
        }
      }
      applySaved({ ...saved, ...(newStock != null ? { stock: newStock } : {}) })
      showToast('Existing product updated' + (added > 0 ? ': ' + added + ' units added, now ' + newStock + ' in stock' : '') + '.', { type: 'success' })
      setDuplicateWarning(null)
      setShowAdd(false)
      setEditItem(null)
    } catch (e) {
      console.error('updateExistingFromDuplicate error:', e)
      showToast('Could not update the product. Check its stock before trying again.', { type: 'error' })
    }
  }

  // Each group is merged by merge_duplicate_products in ONE database
  // transaction: the duplicates' CURRENT stock moves into the kept product
  // through the stock ledger, everything that pointed at a duplicate (batches,
  // orders, reviews, shop listing, stock counts) is repointed, then the
  // duplicates are deleted. The old version wrote the kept product's stock as
  // the sum of this page's stale counts and bulk deleted the rest, which
  // erased sales, let reviews and listings cascade away, and failed halfway on
  // products with batches or orders. Groups run one at a time, so a group the
  // database refuses (for example a shop listing on two of them) leaves every
  // other group to merge normally.
  async function mergeAllDuplicates() {
    if (!perms?.canDelete) return
    setCleaningUp(true)
    let mergedGroups = 0
    let removed = 0
    const refused = []
    for (let gi = 0; gi < duplicateGroups.length; gi++) {
      const group = duplicateGroups[gi]
      const keeper = keeperOf(group)
      const others = group.filter(p => p.id !== keeper.id).map(p => p.id)
      try {
        const result = await productRepository.mergeDuplicates(brand.id, keeper.id, others)
        if (result?.stock != null) applySaved({ id: keeper.id, stock: result.stock })
        applyRemoved(others)
        mergedGroups++
        removed += others.length
      } catch (e) {
        console.error('[inventory] merge refused for', keeper.name, e)
        refused.push(keeper.name + ': ' + (e.code ? e.message : 'could not confirm the merge'))
      }
      showToast('Merging duplicates... ' + (gi + 1) + ' / ' + duplicateGroups.length, { type: 'info' })
    }
    // After any failure, reload so the list shows what the database really
    // holds (a network error can land after the merge committed).
    if (refused.length > 0 && loadProducts) loadProducts()
    if (refused.length === 0) {
      showToast('Merged ' + mergedGroups + ' duplicate group(s). Removed ' + removed + ' duplicate item(s); their stock, batches and sales history now sit on the product kept.', { type: 'success' })
    } else {
      showToast('Merged ' + mergedGroups + ' of ' + duplicateGroups.length + ' group(s). Not merged: ' + refused.slice(0, 3).join(' · ') + (refused.length > 3 ? ' · and ' + (refused.length - 3) + ' more' : ''), { type: 'warning', duration: 12000 })
    }
    setCleaningUp(false)
    setShowCleanup(false)
  }

  function askDelete(product) { setDeleteTarget(product) }
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try {
      await productRepository.delete(id, brand.id)
      applyRemoved([id])
      showToast('Product deleted.', { type: 'success' })
    } catch (e) {
      console.error('handleDelete error:', e)
      showToast('Could not delete product. Please try again.', { type: 'error' })
    }
  }

  // Restock goes through the stock ledger (receive_stock): added inside the
  // database, never as a total computed here, so a sale on a till at the same
  // moment is not overwritten, and journalled with who added it. `key` is
  // fixed for the life of the dialog, so pressing Add Stock again after a
  // failure replays the first request instead of adding twice. Returns true
  // when the dialog should close and false when the user should retry.
  async function handleRestock(product, amount, { key, batch, expiry }) {
    try {
      const result = await productRepository.receiveStock(brand.id, product.id, amount, {
        movementType: 'adjustment',
        idempotencyKey: key,
        sourceType: 'inventory_restock',
        reason: 'Restock from Inventory',
        batchNumber: batch,
        expiryDate: expiry,
      })
      if (result?.stock != null) applySaved({ id: product.id, stock: result.stock })
      showToast(amount + ' units added to ' + product.name + (result?.stock != null ? ': now ' + result.stock + ' in stock' : ''), { type: 'success' })
      return true
    } catch (e) {
      console.error('handleRestock error:', e)
      if (e.code === 'PRODUCT_NOT_FOUND') {
        applyRemoved([product.id])
        showToast(e.message, { type: 'error' })
        return true
      }
      if (e.code) {
        showToast(e.message, { type: 'warning' })
        return false
      }
      // A network failure can land after the database applied the change. The
      // key makes a retry safe, so say so instead of asking for a manual check.
      if (loadProducts) loadProducts()
      showToast('Could not confirm the stock was added. Press Add Stock again: it will not be added twice.', { type: 'error' })
      return false
    }
  }

  async function toggleCareFind(product) {
    try {
      const saved = await productRepository.update(product.id, brand.id, { list_on_carefind: !product.list_on_carefind })
      if (!saved) throw new Error('product not found')
      applySaved(saved)
    } catch (e) {
      console.error('toggleCareFind error:', e)
      showToast('Could not change the CareFind listing. Please try again.', { type: 'error' })
    }
  }

  function downloadTemplate() {
    const rows = [
      ['Product Name', 'Generic Name', 'Category', 'Selling Price (NGN)', 'Cost Price (NGN)', 'Stock Quantity', 'Reorder Level', 'Barcode', 'List on CareFind (yes/no)', 'Expiry Date'],
      ['Amoxicillin 500mg', 'Amoxicillin', 'Medicines', '1500', '800', '100', '20', '', 'yes', '2027-06-30'],
      ['Paracetamol 500mg', 'Paracetamol', 'Medicines', '800', '400', '200', '30', '', 'yes', '2028-01-31'],
      ['Consultation Fee', 'Medical Consultation', 'Services', '5000', '0', '', '0', '', 'yes', ''],
    ]
    const csv = rows.map(r => r.map(c => '"' + c + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_Inventory_Template.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('Template downloaded! Fill in Excel, save as CSV, then upload.', { type: 'success' })
  }

  function handleFileUpload(e) {
    const file = e.target.files[0]; if (!file) return
    setUploadError(''); setUploadData([])
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const { rows, error } = parseInventoryCsv(ev.target.result)
        if (error) { setUploadError(error); return }
        setUploadData(rows)
      } catch (err) { setUploadError('Error reading file. Use the downloaded template.') }
    }
    reader.readAsText(file); e.target.value = ''
  }

  // Bulk CSV import — batches parallel inserts (20 at a time) instead of the
  // old one-await-per-row loop, which took minutes and died on the first
  // network hiccup for 2,000+ product files. Duplicates are skipped up front
  // against the currently-loaded product list.
  async function importProducts() {
    if (!plan.allow('importing products')) return
    if (uploadData.length === 0) return
    setImporting(true)
    showToast('Importing ' + uploadData.length + ' products…', { type: 'info' })
    let added = 0
    let skipped = 0
    let failed = 0
    const skippedNames = []
    const failedNames = []
    const fresh = []
    for (const p of uploadData) {
      if (duplicateIndex.find(p.name, p.generic_name)) {
        skipped++
        skippedNames.push(p.name)
        continue
      }
      fresh.push({
        name: p.name,
        generic_name: p.generic_name || '',
        category: p.category || 'Medicines',
        price: parseFloat(p.price) || 0,
        cost_price: parseFloat(p.cost_price) || 0,
        stock: parseInt(p.stock) || 0,
        reorder_level: parseInt(p.reorder_level) || 5,
        barcode: p.barcode || '',
        list_on_carefind: p.list_on_carefind !== false,
        expiry_date: p.expiry_date || null,
        emoji: '💊',
        business_id: brand.id,
      })
    }
    // Enforce Basic 5k cap on bulk import
    const importLimit = planLimitsFor(brand?.plan)
    if (importLimit.maxProducts !== Infinity) {
      const remaining = importLimit.maxProducts - products.length
      if (remaining <= 0) {
        showToast(`Your ${PLAN_LABELS[brand?.plan] || 'Basic'} plan allows up to ${importLimit.maxProducts.toLocaleString()} products. Upgrade to import more.`, { type: 'warning' })
        setImporting(false)
        return
      }
      if (fresh.length > remaining) {
        fresh.splice(remaining)
        showToast(`Basic plan allows ${importLimit.maxProducts.toLocaleString()} products. Importing the first ${remaining} of ${fresh.length + (fresh.length - remaining)} new products. Upgrade for more.`, { type: 'warning' })
      }
    }
    const BATCH = 20
    const createdRows = []
    for (let i = 0; i < fresh.length; i += BATCH) {
      const batch = fresh.slice(i, i + BATCH)
      const results = await Promise.all(batch.map(p =>
        productRepository.create(brand.id, p).then(res => ({ ok: true, rows: toRows(res) })).catch(err => ({ ok: false, name: p.name, msg: err.message }))
      ))
      for (const r of results) {
        if (r.ok) { added++; createdRows.push(...r.rows) }
        else {
          failed++
          if (failedNames.length < 5) failedNames.push(r.name + ' (' + r.msg + ')')
        }
      }
    }
    // One list update for the whole file rather than one per batch.
    applySaved(createdRows)
    setUploadData([])
    setShowUpload(false)
    setImporting(false)
    const parts = [added + ' imported']
    if (skipped > 0) parts.push(skipped + ' skipped (already exist)')
    if (failed > 0) parts.push(failed + ' failed')
    const summary = parts.join(' · ')
    if (failed > 0) {
      showToast(summary + (failedNames.length > 0 ? ': ' + failedNames.join(', ') : ''), { type: 'warning' })
    } else {
      showToast(summary + '!', { type: 'success' })
    }
  }

  function startScan() {
    if ('BarcodeDetector' in window) {
      setScanning(true)
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
        const video = document.getElementById('inv-cam')
        if (video) { video.srcObject = stream; video.play() }
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a'] })
        let found = false
        const interval = setInterval(async () => {
          if (found || !video) return
          try {
            const codes = await detector.detect(video)
            if (codes.length > 0) {
              found = true; clearInterval(interval)
              stream.getTracks().forEach(t => t.stop())
              setScanning(false)
              const code = codes[0].rawValue
              const match = products.find(p => p.barcode === code)
              if (match) { setEditItem(match); showToast('Found: ' + match.name, { type: 'success' }) }
              else { setSearch(code); showToast('Barcode: ' + code, { type: 'info' }) }
            }
          } catch (e) {}
        }, 300)
        setTimeout(() => { if (!found) { clearInterval(interval); stream.getTracks().forEach(t => t.stop()); setScanning(false) } }, 15000)
      }).catch(() => { setScanning(false); showToast('Camera access denied. Check your browser permissions and try again.', { type: 'error' }) })
    } else {
      const code = prompt('Enter barcode:')
      if (code) { const m = products.find(p => p.barcode === code); if (m) setEditItem(m); else setSearch(code) }
    }
  }

  return (
    <>
    <style>{`.spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div><div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Inventory</div><div style={{ fontSize: '13px', color: gray500, marginTop: '3px' }}>Manage products, stock and CareFind listings</div></div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={downloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}><Download size={14} /> Template</button>
          <button onClick={() => setShowUpload(true)} disabled={!catalogReady} title={waitTitle} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '12px', cursor: catalogReady ? 'pointer' : 'not-allowed', opacity: catalogReady ? 1 : 0.6 }}><Upload size={14} /> Upload CSV</button>
          {perms?.canExportReports && (
            <button onClick={exportExcel} disabled={exporting || !catalogReady} title={waitTitle} aria-busy={exporting} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '12px', cursor: exporting ? 'wait' : catalogReady ? 'pointer' : 'not-allowed', opacity: exporting || !catalogReady ? 0.6 : 1 }}>
              {exporting ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
          )}
          {perms?.canDelete && catalogReady && totalDuplicateItems > 0 && (
            <button onClick={() => setShowCleanup(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${warning}`, background: warningBg, color: warning, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
              <AlertTriangle size={14} /> Clean up {totalDuplicateItems} duplicate{totalDuplicateItems > 1 ? 's' : ''}
            </button>
          )}
          {perms?.canEditStock && <TealBtn onClick={() => plan.allow('adding products') && setShowAdd(true)} disabled={!catalogReady} title={waitTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Add product</TealBtn>}
        </div>
      </div>

      <CatalogStatusBanner catalog={catalogState} />

      {catalogLoading ? <CatalogSkeleton loadedCount={catalogState.loadedCount} /> : catalogFailed ? (
        <Card><ErrorState message={catalogState.error || "We couldn't load your products."} onRetry={catalogState.reload} /></Card>
      ) : (<>

      {/* 6 tiles: auto-fit at a 180px minimum so a 7-figure naira value never
          gets squeezed — wraps to 3/2/1 columns down to mobile. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Package />} label='Total Products' value={products.length} />
        <StatCard icon={<AlertTriangle />} label='Low Stock' value={lowStock.length} alert={lowStock.length > 0} sub={outOfStock.length + ' out of stock'} />
        <StatCard icon={<DollarSign />} label='Stock Value' value={fmt(stockValue)} sub={'Cost: ' + fmt(costValue)} />
        <StatCard
          icon={<TrendingUp />} label='Total Profit' value={(profit < 0 ? '-' : '') + fmt(Math.abs(profit))}
          tone={profit < 0 ? 'danger' : undefined}
          sub={missingCost > 0 ? missingCost + ' item(s) have no cost price' : 'Stock value at cost'}
        />
        <StatCard
          icon={<Percent />} label='Profit Margin' value={margin === null ? 'Not set' : Math.round(margin) + '%'}
          tone={margin !== null && margin < 0 ? 'danger' : undefined}
          sub={margin === null ? 'No stock on hand' : 'Of stock value'}
        />
        <StatCard icon={<Search />} label='On CareFind' value={onCareFind} sub='Visible to public' />
      </div>

      {lowStock.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '14px 18px', borderRadius: theme.radius.lg, background: warningBg, border: `1px solid ${warning}`, display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <AlertTriangle size={20} color={warning} style={{ flexShrink: 0 }} />
          <div><div style={{ fontWeight: '700', color: warning, fontSize: '14px' }}>{lowStock.length} item(s) running low</div><div style={{ fontSize: '12px', color: gray500, marginTop: '4px' }}>{lowStock.map(p => p.name).join(' · ')}</div></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search name or generic name...'
            style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>
        <button onClick={startScan} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}><Camera size={15} /> Scan</button>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {cats.map(c => { const on = catFilter === c; return <button key={c} onClick={() => setCatFilter(c)} style={{ padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600 }}>{c}</button> })}
        </div>
      </div>

      {(stockFilter || expiryFilter) && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: gray500, fontWeight: '700' }}>Filtered by:</span>
          {stockFilter && (
            <button onClick={() => setStockFilter('')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: theme.radius.full, border: `1px solid ${warning}`, background: warningBg, color: warning, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
              {stockFilter === 'low' ? 'Low stock only' : 'Out of stock only'} ✕
            </button>
          )}
          {expiryFilter && (
            <button onClick={() => setExpiryFilter('')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: theme.radius.full, border: `1px solid ${danger}`, background: dangerBg, color: danger, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
              {expiryFilter === 'expiring' ? 'Expiring within 60 days' : 'Expired'} ✕
            </button>
          )}
        </div>
      )}

      {scanning && (
        <div style={{ marginBottom: '16px', borderRadius: theme.radius.lg, overflow: 'hidden', border: `2px solid ${tealDeep}`, position: 'relative', background: 'black' }}>
          <video id='inv-cam' style={{ width: '100%', maxHeight: '240px', objectFit: 'cover', display: 'block' }} autoPlay playsInline muted />
          <button onClick={() => { setScanning(false); const v = document.getElementById('inv-cam'); if (v?.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null } }}
            style={{ position: 'absolute', top: '8px', right: '8px', padding: '6px 14px', borderRadius: '8px', border: 'none', background: danger, color: 'white', fontWeight: '700', cursor: 'pointer' }}>Stop</button>
        </div>
      )}

      {products.length === 0 ? (
        <Empty icon={<Package size={56} strokeWidth={1.5} />} title='No products yet' description={perms?.canEditStock ? 'Add your first product, or upload a CSV to add many at once.' : 'Products added by your team will appear here.'} action={perms?.canEditStock ? '+ Add product' : undefined} onAction={() => plan.allow('adding products') && setShowAdd(true)} />
      ) : filtered.length === 0 ? (
        <Empty icon={<Search size={48} strokeWidth={1.5} />} cause='filtered' title='No products match' description='Try a different search, or clear the filters.' action='Clear filters' onAction={clearFilters} />
      ) : (
        <DataTable
          rows={filtered}
          page={page}
          setPage={setPage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          count={`${filtered.length} product${filtered.length !== 1 ? 's' : ''}`}
          onRetry={loadProducts}
          columns={[
            {
              key: 'name', label: 'Product', sortable: true,
              render: p => {
                const Icon = productIcon(p)
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: 30, height: 30, borderRadius: theme.radius.full, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={15} /></div>
                    <span style={{ fontWeight: '700', fontSize: '13px', color: navy, textTransform: 'uppercase' }}>{p.name}</span>
                  </div>
                )
              },
            },
            {
              key: 'shelf_label', label: 'Shelf', sortable: true,
              render: p => <span style={{ fontSize: '12px', color: gray500 }}>{p.shelf_label || 'Not set'}</span>
            },
            {
              key: 'generic_name', label: 'Generic Name', sortable: true,
              render: p => <span style={{ fontSize: '12px', color: gray500 }}>{p.generic_name || p.genericName || 'Not set'}</span>,
            },
            {
              key: 'cat', label: 'Cat', sortable: true,
              sortValue: p => p.cat || p.category || '',
              render: p => <Pill label={p.cat || p.category || ''} type='teal' />,
            },
            {
              key: 'price', label: 'Sell Price', sortable: true, align: 'right',
              render: p => <span style={{ fontSize: '13px', fontWeight: '700', color: navy }}>{fmt(p.price)}</span>,
            },
            {
              key: 'cost_price', label: 'Cost Price', sortable: true, align: 'right',
              render: p => <span style={{ fontSize: '13px', color: gray500 }}>{p.cost_price ? fmt(p.cost_price) : 'Not set'}</span>,
            },
            {
              key: 'margin', label: 'Margin', sortable: true, align: 'right',
              sortValue: p => (p.price && p.cost_price ? ((p.price - p.cost_price) / p.price) : -1),
              render: p => {
                const margin = p.price && p.cost_price ? Math.round(((p.price - p.cost_price) / p.price) * 100) : null
                return <span style={{ fontSize: '12px', fontWeight: '700', color: margin !== null ? (margin > 30 ? success : warning) : gray400 }}>
                  {margin !== null ? margin + '%' : 'Not set'}
                </span>
              },
            },
            {
              key: 'stock', label: 'Stock', sortable: true, align: 'right',
              render: p => {
                const cat = p.cat || p.category || ''
                const low = cat !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5)
                const out = cat !== 'Services' && p.stock <= 0
                return <span style={{ fontSize: '14px', fontWeight: '900', color: out ? danger : low ? warning : navy }}>
                  {cat === 'Services' ? '∞' : p.stock}
                </span>
              },
            },
            {
              key: 'carefind', label: 'CareFind', align: 'center',
              render: p => (
                <button onClick={() => toggleCareFind(p)} aria-label='Toggle CareFind listing'
                  style={{ width: '36px', height: '20px', borderRadius: '10px', border: 'none', cursor: 'pointer', position: 'relative', background: p.list_on_carefind !== false ? tealDeep : theme.gray200 }}>
                  <div style={{ position: 'absolute', top: '2px', left: p.list_on_carefind !== false ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                </button>
              ),
            },
            {
              key: 'status', label: 'Status', sortable: true,
              sortValue: p => (p.cat || p.category || '') === 'Services' ? 'service' : p.stock > 0 && p.stock <= (p.reorder_level || 5) ? 'low' : p.stock <= 0 ? 'out' : 'in',
              render: p => {
                const cat = p.cat || p.category || ''
                const low = cat !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5)
                const out = cat !== 'Services' && p.stock <= 0
                return cat === 'Services' ? <Pill label='Service' type='blue' /> : out ? <Pill label='Out of Stock' type='red' /> : low ? <Pill label='Low Stock' type='amber' /> : <Pill label='In Stock' type='green' />
              },
            },
            {
              key: 'expiry_date', label: 'Expiry Date', sortable: true,
              sortValue: p => p.expiry_date || '',
              render: p => {
                const days = (() => {
                  if (!p.expiry_date) return null
                  const d = new Date(p.expiry_date)
                  const now = new Date()
                  return Math.ceil((d - now) / (1000 * 60 * 60 * 24))
                })()
                if (!p.expiry_date) return <span style={{ color: gray500 }}>Not set</span>
                if (days < 0) return <span style={{ color: danger, fontWeight: '700' }}>EXPIRED</span>
                if (days <= 60) return <span style={{ color: warning, fontWeight: '700' }}>{days} days left</span>
                return <span style={{ color: navy, fontWeight: '700' }}>Exp {new Date(p.expiry_date).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })}</span>
              },
            },
          ]}
          rowStyle={p => {
            const cat = p.cat || p.category || ''
            const low = cat !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5)
            const out = cat !== 'Services' && p.stock <= 0
            return { background: out ? dangerBg : low ? warningBg : 'white' }
          }}
          actions={p => (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {perms?.canEditStock && (p.cat || p.category || '') !== 'Services' && <button onClick={() => setShowRestock(p)} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>+ Stock</button>}
              <GhostBtn onClick={() => setEditItem(p)}>Edit</GhostBtn>
              {perms?.canDelete && <RedBtn onClick={() => askDelete(p)}>Del</RedBtn>}
            </div>
          )}
        />
      )}
      </>)}

      {/* Add/Edit Product Modal */}
      {(showAdd || editItem) && (
        <ProductModal
          product={editItem}
          perms={perms}
          showToast={showToast}
          onSave={async (data) => { await saveProduct(data, !!editItem); setShowAdd(false); setEditItem(null) }}
          onClose={() => { setShowAdd(false); setEditItem(null) }}
        />
      )}

      {/* Restock Modal */}
      {showRestock && (
        <RestockModal
          product={showRestock}
          showToast={showToast}
          onRestock={async (qty, details) => { if (await handleRestock(showRestock, qty, details)) setShowRestock(null) }}
          onClose={() => setShowRestock(null)}
        />
      )}

      {/* Upload Modal */}
      <Modal show={showUpload} onClose={() => { setShowUpload(false); setUploadData([]); setUploadError('') }} title='Upload Products from Excel / CSV'>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: '12px', background: tealMist, border: `1px solid ${tealDeep}`, fontSize: '13px', color: tealDeep, lineHeight: '1.9' }}>
            1. Tap <strong>Download Template</strong><br />
            2. Open in <strong>Microsoft Excel</strong> or Google Sheets<br />
            3. Fill in your products row by row<br />
            4. Set <strong>Expiry Date</strong> as YYYY-MM-DD (for example 2027-06-30). Leave blank if there is none<br />
            5. Save as <strong>CSV</strong><br />
            6. Upload here
          </div>
          <label style={{ display: 'block', padding: '24px', borderRadius: '12px', border: `2px dashed ${border}`, textAlign: 'center', cursor: 'pointer', background: bg }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', color: gray500 }}><FileUp size={36} /></div>
            <div style={{ fontWeight: '700', color: gray600, fontSize: '14px' }}>Tap to select CSV file</div>
            <input type='file' accept='.csv,.xlsx,.xls,.txt' onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
          {uploadError && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '12px', borderRadius: '10px', background: dangerBg, border: `1px solid ${danger}`, fontSize: '13px', color: danger }}><AlertTriangle size={15} /> {uploadError}</div>}
          {uploadData.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', color: success, fontSize: '13px', marginBottom: '8px' }}>
                <CheckCircle size={15} /> {uploadData.length} products in file
                {uploadDupeCount > 0 && (
                  <span style={{ color: warning, fontWeight: '600' }}> · {uploadDupeCount} already exist (will be skipped)</span>
                )}
              </div>
              <div style={{ maxHeight: '180px', overflowY: 'auto', borderRadius: '10px', border: `1px solid ${gray100}` }}>
                {uploadData.map((p, i) => {
                  const isDupe = !!duplicateIndex.find(p.name, p.generic_name)
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', borderBottom: `1px solid ${gray100}`, fontSize: '12px', background: isDupe ? warningBg : 'transparent' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600', color: isDupe ? warning : navy }}>
                        {isDupe && <AlertTriangle size={12} />}{p.name}
                      </span>
                      <span style={{ color: isDupe ? warning : gray500 }}>
                        {isDupe ? 'Already exists' : p.category + ' · ₦' + p.price + ' · ' + p.stock + ' units'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <GhostBtn onClick={downloadTemplate} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Download size={14} /> Download Template</GhostBtn>
            {uploadData.length > 0 && (
              <button onClick={importProducts} disabled={importing} style={{ flex: 1, padding: '12px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: '800', fontSize: '14px', cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.7 : 1 }}>
                {importing
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Loader2 size={16} className="spin" aria-hidden="true" /> Importing…</span>
                  : 'Import ' + uploadData.length + ' Products'}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* Clean Up Duplicates Modal — review existing duplicates and merge them */}
      <Modal show={showCleanup} onClose={() => setShowCleanup(false)} title='Clean Up Duplicate Products'>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: '12px', background: warningBg, border: `1px solid ${warning}`, fontSize: '13px', color: theme.amberText, lineHeight: '1.7' }}>
            Found <strong>{duplicateGroups.length}</strong> group(s) of duplicate products already in your inventory. These match on brand name or generic name. Merging keeps one product per group and adds the others' current stock to it. Their batches, orders, reviews and shop listing move to the product kept, then the rest are removed.
          </div>

          <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {duplicateGroups.map((group, gi) => {
              const keeper = keeperOf(group)
              return (
                <div key={gi} style={{ padding: '12px', borderRadius: '10px', border: `1px solid ${warning}`, background: warningBg }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: warning, marginBottom: '8px' }}>
                    GROUP {gi + 1}: {group.length} duplicates · keeps {keeper.name}
                  </div>
                  {group.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: '6px', background: theme.gray50, marginBottom: '4px', fontSize: '12px' }}>
                      <div>
                        {p.id === keeper.id && <Pill label='Kept' type='teal' style={{ marginRight: 6 }} />}
                        <span style={{ fontWeight: '600' }}>{p.name}</span>
                        {(p.generic_name || p.genericName) && <span style={{ color: gray400 }}> · {p.generic_name || p.genericName}</span>}
                      </div>
                      <span style={{ color: gray500, fontWeight: '600' }}>{p.stock} units · {fmt(p.price)}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <GhostBtn onClick={() => setShowCleanup(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
            <button onClick={mergeAllDuplicates} disabled={cleaningUp}
              style={{ flex: 1, padding: '12px', borderRadius: theme.radius.md, border: 'none', background: cleaningUp ? theme.gray200 : tealDeep, color: cleaningUp ? gray400 : 'white', fontWeight: '800', fontSize: '14px', cursor: cleaningUp ? 'not-allowed' : 'pointer' }}>
              {cleaningUp ? 'Merging...' : 'Merge All ' + duplicateGroups.length + ' Group(s)'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Duplicate Product Warning */}
      <Modal show={!!duplicateWarning} onClose={() => setDuplicateWarning(null)} title='Product Already Exists'>
        {duplicateWarning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '14px', borderRadius: '12px', background: warningBg, border: `1px solid ${warning}`, fontSize: '13px', color: theme.amberText, lineHeight: '1.7' }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>A product with this name or generic name is already in your inventory. You can update the existing product instead of creating a duplicate.</span>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ flex: 1, padding: '12px', borderRadius: '10px', border: `1px solid ${border}`, background: bg }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: gray400, marginBottom: '6px' }}>Already in your inventory</div>
                <div style={{ fontWeight: '700', fontSize: '14px' }}>{duplicateWarning.existing.name}</div>
                {(duplicateWarning.existing.generic_name || duplicateWarning.existing.genericName) && (
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{duplicateWarning.existing.generic_name || duplicateWarning.existing.genericName}</div>
                )}
                <div style={{ fontSize: '13px', fontWeight: '700', color: tealDeep, marginTop: '6px' }}>{fmt(duplicateWarning.existing.price)}</div>
                <div style={{ fontSize: '12px', color: gray500 }}>{duplicateWarning.existing.stock} in stock</div>
              </div>
              <ArrowRight size={18} color={gray300} />
              <div style={{ flex: 1, padding: '12px', borderRadius: '10px', border: `1px solid ${theme.border}`, background: theme.gray50 }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: tealDeep, marginBottom: '6px' }}>YOU'RE ADDING</div>
                <div style={{ fontWeight: '700', fontSize: '14px' }}>{duplicateWarning.incoming.name}</div>
                {duplicateWarning.incoming.generic_name && (
                  <div style={{ fontSize: '12px', color: theme.textFaint, marginTop: '2px' }}>{duplicateWarning.incoming.generic_name}</div>
                )}
                <div style={{ fontSize: '13px', fontWeight: '700', color: tealDeep, marginTop: '6px' }}>{fmt(duplicateWarning.incoming.price)}</div>
                <div style={{ fontSize: '12px', color: theme.textFaint }}>+{duplicateWarning.incoming.stock} units</div>
              </div>
            </div>

            <div style={{ padding: '10px 14px', borderRadius: '10px', background: theme.gray50, fontSize: '12px', color: theme.gray600 }}>
              Updating will add {duplicateWarning.incoming.stock || 0} units to the existing product's stock{perms?.canEditPrice ? ' and apply the new price you entered' : '. Prices stay as they are: only roles with price permission can change them'}.
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <GhostBtn onClick={() => setDuplicateWarning(null)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
              <TealBtn onClick={updateExistingFromDuplicate} style={{ flex: 1, padding: '12px' }}>Update Existing Product</TealBtn>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title='Delete this product?'
        consequence={`This permanently removes "${deleteTarget?.name || 'this product'}" and its stock history from your inventory. This cannot be undone.`}
        confirmLabel='Delete' />

      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
    </>
  )
}

// Which product a duplicate group keeps: the one with a cost price, then a
// barcode, then the most stock (the rule the cleanup has always used, now also
// shown in the dialog so the owner sees it before merging).
function keeperOf(group) {
  return [...group].sort((a, b) => {
    const aScore = (a.cost_price > 0 ? 2 : 0) + (a.barcode ? 1 : 0)
    const bScore = (b.cost_price > 0 ? 2 : 0) + (b.barcode ? 1 : 0)
    if (aScore !== bScore) return bScore - aScore
    return (b.stock || 0) - (a.stock || 0)
  })[0]
}

function ProductModal({ product, perms, onSave, onClose, showToast }) {
  const [form, setForm] = useState(product ? { ...product, cat: product.cat || product.category, expiry_date: product.expiry_date } : { emoji: '💊', cat: 'Medicines', list_on_carefind: true, show_price: true, sale_type: 'retail', price_unit: 'piece', min_purchase: '', expiry_date: '' })
  const [saving, setSaving] = useState(false)
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const isEdit = !!product
  const canEditPrice = !isEdit || perms?.canEditPrice

  const isService = (form.cat || form.category) === 'Services'
  const hasSaleFields = !isService

  const setSaleType = (t) => {
    const currentUnit = form.price_unit
    f('sale_type', t)
    if (!isUnitValidForSaleType(currentUnit, t)) f('price_unit', '')
  }

  const save = async () => {
    if (!form.name || !form.price) { showToast('Please enter product name and selling price.', { type: 'warning' }); return }
    const listedOnCareFind = form.list_on_carefind !== false
    if (hasSaleFields && listedOnCareFind && form.price_unit && !isUnitValidForSaleType(form.price_unit, form.sale_type || 'retail')) {
      showToast(saleUnitError(form.price_unit, form.sale_type || 'retail'), { type: 'error' })
      return
    }
    setSaving(true)
    const { sale_type: _st, price_unit: _pu, min_purchase: _mp, show_price: _sp, expiry_date: _ed, ...restForm } = form
    const saleData = hasSaleFields
      ? {
          sale_type: form.sale_type || 'retail',
          price_unit: form.price_unit || null,
          min_purchase: form.min_purchase ? Number(form.min_purchase) : null,
          // show_price was previously never written by CareHub, so every
          // listed product was priced publicly with no opt-out. Written only
          // when actually listed; a stale value is preserved while unlisted.
          ...(listedOnCareFind ? { show_price: form.show_price !== false } : {}),
        }
      : {}
    // On an edit, stock is only sent when the user changed it. The form was
    // filled from the page's product list, which goes stale as POS sells, so
    // sending it back unchanged reset stock to that old figure on every price
    // or name edit. A changed value is a deliberate count correction.
    const { stock: _stock, ...withoutStock } = restForm
    const stockTouched = !isEdit || String(form.stock ?? '') !== String(product.stock ?? '')
    const stockData = isService ? { stock: 999 } : stockTouched ? { stock: parseInt(form.stock) || 0 } : {}
    await onSave({ ...withoutStock, ...saleData, ...stockData, price: parseFloat(form.price) || 0, cost_price: parseFloat(form.cost_price) || 0, reorder_level: parseInt(form.reorder_level) || 5, category: form.cat || form.category || 'Medicines', expiry_date: form.expiry_date || null })
    setSaving(false)
  }

  return (
    <Modal show title={isEdit ? 'Edit Product' : 'Add New Product'} onClose={onClose}
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Product'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Inp label='Product Name *' value={form.name} onChange={v => f('name', v)} placeholder='e.g. Amoxicillin 500mg' required />
        <Inp label='Generic / Common Name' value={form.generic_name} onChange={v => f('generic_name', v)} placeholder='e.g. Amoxicillin' />
        <Sel label='Category' value={form.cat} onChange={v => f('cat', v)} options={PRODUCT_CATS} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Inp label='Selling Price (₦) *' value={form.price} onChange={v => f('price', v)} type='number' placeholder='0' required readOnly={!canEditPrice} />
          <Inp label='Cost Price (₦)' value={form.cost_price} onChange={v => f('cost_price', v)} type='number' placeholder='0' readOnly={!canEditPrice} />
        </div>
        {form.price && form.cost_price && parseFloat(form.price) > 0 && (
          <div style={{ padding: '8px 12px', borderRadius: '8px', background: successBg, fontSize: '12px', color: success, fontWeight: '600' }}>
            Profit margin: {Math.round(((parseFloat(form.price) - parseFloat(form.cost_price)) / parseFloat(form.price)) * 100)}%
          </div>
        )}
        {!canEditPrice && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', background: warningBg, fontSize: '12px', color: warning }}><AlertTriangle size={13} /> Only the Owner can edit prices</div>}
        <Inp label='Barcode (optional)' value={form.barcode} onChange={v => f('barcode', v)} placeholder='Scan or type barcode' />
        <Inp label='Shelf Label' value={form.shelf_label} onChange={v => f('shelf_label', v)} placeholder='e.g. A-03, Rack B Shelf 3' />
        {isEdit && !form.expiry_date && form.cat !== 'Services' && (
          <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px 14px', borderRadius: '10px', background: warningBg, border: `1px solid ${warning}`, fontSize: '13px', color: warning, lineHeight: 1.6 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>No expiry date set. Add one to turn on expiry alerts and reports.</span>
          </div>
        )}
        {form.cat !== 'Services' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Stock Quantity' value={form.stock} onChange={v => f('stock', v)} type='number' placeholder='0' readOnly={!perms?.canEditStock} />
            <Inp label='Reorder Level' value={form.reorder_level} onChange={v => f('reorder_level', v)} type='number' placeholder='5' />
            <Inp label='Expiry Date' value={form.expiry_date} onChange={v => f('expiry_date', v)} type='date' />
          </div>
        )}
        {!isService && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Sel
              label='Sale Type'
              value={form.sale_type || 'retail'}
              onChange={setSaleType}
              options={SALE_TYPES.map(t => ({ value: t, label: SALE_TYPE_LABELS[t] || t }))}
              placeholder='Retail'
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Sel
                label='Price is per'
                value={form.price_unit || ''}
                onChange={v => f('price_unit', v)}
                options={unitsForSaleType(form.sale_type || 'retail').map(u => ({ value: u, label: unitLabel(u) }))}
                placeholder='Choose unit'
              />
              <Inp
                label='Min purchase'
                value={form.min_purchase}
                onChange={v => f('min_purchase', v)}
                type='number'
                min='0'
                placeholder={form.price_unit ? `In ${form.price_unit}s` : '0'}
              />
            </div>
          </div>
        )}
        <Toggle label='List on CareFind' desc='Show this product publicly on CareFind so patients can search for it' value={form.list_on_carefind !== false} onChange={v => f('list_on_carefind', v)} />
        {!isService && form.list_on_carefind !== false && (
          <Toggle label='Show price on CareFind' desc="Buyers see the selling price in search results. Turn off to show 'Ask for price' instead." value={form.show_price !== false} onChange={v => f('show_price', v)} />
        )}
      </div>
    </Modal>
  )
}

// A key naming one user intent (one restock dialog, one "Update Existing
// Product" warning) for receive_stock's idempotency: the same intent retried
// is recognised and not counted twice.
function intentKey(prefix) {
  const rand = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  return prefix + ':' + rand
}

function RestockModal({ product, onRestock, onClose, showToast }) {
  const [qty, setQty] = useState('')
  const [batch, setBatch] = useState('')
  const [expiry, setExpiry] = useState('')
  const [saving, setSaving] = useState(false)
  const [key] = useState(() => intentKey('restock:' + product.id))
  // A product tracked by batch must be received into a named batch (and an
  // expiry when tracked by expiry); the stock ledger refuses it otherwise.
  const tracking = product.tracking_mode || 'none'
  // Whole numbers only: stock is integral, and parseInt used to turn 2.5 into
  // 2 without a word.
  const units = Number(qty)
  const valid = qty !== '' && Number.isInteger(units) && units > 0
  const handle = async () => {
    // Every press is a real increment, so a second tap while the first is in
    // flight must not add the stock twice.
    if (saving) return
    if (!valid) { showToast('Enter a whole number of units above 0 (e.g. 2, not 2.5).', { type: 'warning' }); return }
    if (tracking !== 'none' && !batch.trim()) { showToast('This product is tracked by batch. Enter its batch number.', { type: 'warning' }); return }
    if (tracking === 'batch_expiry' && !expiry) { showToast('This product is tracked by batch and expiry. Enter the expiry date.', { type: 'warning' }); return }
    setSaving(true)
    await onRestock(units, { key, batch: batch.trim() || null, expiry: expiry || null })
    setSaving(false)
  }
  return (
    <Modal show title='Restock Product' onClose={onClose}
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={handle} disabled={saving} aria-busy={saving} style={{ flex: 1, padding: '12px', opacity: saving ? 0.7 : 1, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving...' : '+ Add Stock'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '12px', borderRadius: '10px', background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span style={{ color: gray500 }}>Current stock</span><span style={{ fontWeight: '700' }}>{product.stock} units</span>
        </div>
        <Inp label='Units to Add' id='restock-units' value={qty} onChange={setQty} type='number' inputMode='numeric' min='1' step='1' placeholder='e.g. 100' required />
        {valid && <div style={{ fontSize: '12px', color: success, fontWeight: '700' }}>Expected new total: {(product.stock || 0) + units} units</div>}
        {tracking !== 'none' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <Inp label='Batch number' id='restock-batch' value={batch} onChange={setBatch} placeholder='e.g. INS-0412' required />
            <Inp label='Expiry date' id='restock-expiry' value={expiry} onChange={setExpiry} type='date' required={tracking === 'batch_expiry'} />
          </div>
        )}
        {/* The old "Note" field was never saved anywhere. Deliveries with a
            supplier, cost, batch or expiry belong in Purchases, which keeps them. */}
        <div style={{ fontSize: '12px', color: gray500, lineHeight: 1.5 }}>Receiving a supplier delivery? Record it in Purchases to keep the supplier, cost, batch and expiry with the stock.</div>
        {product.list_on_carefind !== false && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px', borderRadius: '8px', background: theme.gray50, fontSize: '12px', color: tealDeep }}><Search size={13} /> After restocking this product will show as available on CareFind</div>}
      </div>
    </Modal>
  )
}

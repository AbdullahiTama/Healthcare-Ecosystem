import { useState, useEffect, useMemo } from 'react'
import {
  Download, Upload, AlertTriangle, Package, DollarSign, Search, Camera,
  FileUp, CheckCircle, ArrowRight, Clipboard, Plus, Loader2,
} from 'lucide-react'
import { productRepository } from './repositories'
import { fmt, todayDate } from '../../lib/utils'
import { PRODUCT_CATS } from '../../config/constants'
import { SALE_TYPES, SALE_TYPE_LABELS, unitLabel, unitsForSaleType, isUnitValidForSaleType, saleUnitError } from '@care-ecosystem/shared-marketplace'
import { findDuplicate, findAllDuplicateGroups } from '../../lib/productMatches'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, Textarea, Toggle, GhostBtn, TealBtn, RedBtn, Loading, Empty, DataTable, useToast, Toast } from '../../components/ui'
import { notify } from '../../services/supabase'
import { NOTIFICATION_TYPES, DEFAULT_MESSAGES } from '@care-ecosystem/shared-notifications'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray300, border, danger, dangerBg, warning, warningBg, success, successBg, bg } = theme

// One lucide icon per product row/tile — Clipboard for services, Package for
// stock goods — replacing the per-product emoji.
const productIcon = (p) => ((p.cat || p.category) === 'Services' ? Clipboard : Package)

export default function Inventory({ brand, products, setProducts, role, perms, loadProducts }) {
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
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  const duplicateGroups = findAllDuplicateGroups(products)
  const totalDuplicateItems = duplicateGroups.reduce((s, g) => s + (g.length - 1), 0)

  const cats = ['All', ...Array.from(new Set(products.map(p => p.cat || p.category)))]
  const filtered = useMemo(() => products.filter(p => {
    const pCat = p.cat || p.category || ''
    const pGeneric = p.generic_name || p.genericName || ''
    return (catFilter === 'All' || pCat === catFilter) &&
      (p.name.toLowerCase().includes(search.toLowerCase()) || pGeneric.toLowerCase().includes(search.toLowerCase()))
  }), [products, catFilter, search])

  // Pagination — 50 rows per page. Reset to page 0 whenever the result set
  // changes (search, filter, or data reload) so the user never lands on an
  // empty page that no longer exists. DataTable does the slicing.
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [search, catFilter, products.length])
  const lowStock = products.filter(p => (p.cat || p.category) !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5))
  const outOfStock = products.filter(p => (p.cat || p.category) !== 'Services' && p.stock <= 0)
  const stockValue = products.filter(p => (p.cat || p.category) !== 'Services').reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0)
  const costValue = products.filter(p => (p.cat || p.category) !== 'Services').reduce((s, p) => s + (p.cost_price || 0) * (p.stock || 0), 0)
  const onCareFind = products.filter(p => p.list_on_carefind !== false && p.stock > 0).length
  const today = new Date()
  const thirtyDays = today
  thirtyDays.setDate(thirtyDays.getDate() + 30)
  const expiringSoon = products.filter(p => {
    if (!p.expiry_date) return false
    const expDate = new Date(p.expiry_date)
    return expDate >= today && expDate <= thirtyDays
  })

  async function reload() {
    try {
      const p = await productRepository.getAll(brand.id)
      if (Array.isArray(p)) setProducts(p)
      if (loadProducts) loadProducts()
    } catch (e) {
      console.error('reload error:', e)
    }
  }

  async function saveProduct(data, isEdit) {
    try {
      const category = data.cat || data.category || 'Medicines'
      // Build clean productData — explicitly exclude 'cat' since Supabase only has 'category'
      const { cat, ...rest } = data
      const productData = {
        ...rest,
        category,
        price: parseFloat(data.price) || 0,
        cost_price: parseFloat(data.cost_price) || 0,
        stock: category === 'Services' ? 999 : parseInt(data.stock) || 0,
        reorder_level: parseInt(data.reorder_level) || 5,
      }

      if (!isEdit) {
        // Check for duplicate — but only if name is specific enough (more than 3 chars)
        const name = (productData.name || '').trim()
        const generic = (productData.generic_name || '').trim()
        if (name.length > 3) {
          const dupe = findDuplicate(products, name, generic, null)
          if (dupe) {
            setDuplicateWarning({ existing: dupe, incoming: productData })
            return
          }
        }
      }

      if (isEdit) {
        await productRepository.update(data.id, brand.id, productData)
        showToast('Product updated!', { type: 'success' })
      } else {
        await productRepository.create(brand.id, productData)
        showToast('Product added!', { type: 'success' })
      }
      await reload()
    } catch (e) {
      console.error('saveProduct error:', e)
      showToast(e.message || 'Could not save product. Please try again.', { type: 'error' })
    }
  }

  // Called when user confirms they want to update the existing duplicate instead of creating new
  async function updateExistingFromDuplicate() {
    if (!duplicateWarning) return
    try {
      const { existing, incoming } = duplicateWarning
      await productRepository.update(existing.id, brand.id, {
        price: incoming.price,
        cost_price: incoming.cost_price,
        stock: (existing.stock || 0) + (incoming.stock || 0),
        reorder_level: incoming.reorder_level,
        category: incoming.category,
        barcode: incoming.barcode || existing.barcode,
        list_on_carefind: incoming.list_on_carefind,
      })
      showToast('Existing product updated — stock combined!', { type: 'success' })
      setDuplicateWarning(null)
      setShowAdd(false)
      setEditItem(null)
      await reload()
    } catch (e) { showToast('Could not update product. Please try again.', { type: 'error' }) }
  }

  // Merge ALL detected duplicate groups in one go — batched version:
  // updates and deletes run in safe-sized parallel batches to avoid overwhelming
  // the connection or hitting URL length limits with very large duplicate counts
  async function mergeAllDuplicates() {
    setCleaningUp(true)
    try {
      const idsToDelete = []
      const updates = [] // { id, stock }

      for (const group of duplicateGroups) {
        // Pick the "keeper" — prefer the one with a cost_price set, then the one with more stock, then the first
        const keeper = [...group].sort((a, b) => {
          const aScore = (a.cost_price > 0 ? 2 : 0) + (a.barcode ? 1 : 0)
          const bScore = (b.cost_price > 0 ? 2 : 0) + (b.barcode ? 1 : 0)
          if (aScore !== bScore) return bScore - aScore
          return (b.stock || 0) - (a.stock || 0)
        })[0]
        const others = group.filter(p => p.id !== keeper.id)
        const combinedStock = group.reduce((s, p) => s + (p.stock || 0), 0)

        updates.push({ id: keeper.id, stock: combinedStock })
        others.forEach(o => idsToDelete.push(o.id))
      }

      // Run stock updates in parallel batches of 25 at a time (not all 900+ at once)
      const UPDATE_BATCH_SIZE = 25
      for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
        const batch = updates.slice(i, i + UPDATE_BATCH_SIZE)
        await Promise.all(batch.map(u => productRepository.update(u.id, brand.id, { stock: u.stock })))
        showToast('Updating products... ' + Math.min(i + UPDATE_BATCH_SIZE, updates.length) + ' / ' + updates.length, { type: 'info' })
      }

      // Delete duplicates in batches of 50 IDs per request to keep the URL short and safe
      const DELETE_BATCH_SIZE = 50
      let deletedSoFar = 0
      for (let i = 0; i < idsToDelete.length; i += DELETE_BATCH_SIZE) {
        const batch = idsToDelete.slice(i, i + DELETE_BATCH_SIZE)
        await productRepository.deleteBulk(batch, brand.id)
        deletedSoFar += batch.length
        showToast('Removing duplicates... ' + deletedSoFar + ' / ' + idsToDelete.length, { type: 'info' })
      }

      await reload()
      showToast('Cleaned up ' + duplicateGroups.length + ' duplicate group(s) — removed ' + idsToDelete.length + ' duplicate item(s)', { type: 'success' })
    } catch (e) {
      console.error('Error during cleanup:', e)
      showToast('Could not finish cleanup — please try again. (' + (e.message || 'unknown error') + ')', { type: 'error' })
    }
    setCleaningUp(false)
    setShowCleanup(false)
  }

  function askDelete(product) { setDeleteTarget(product) }
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try { await productRepository.delete(id, brand.id); await reload(); showToast('Product deleted.', { type: 'success' }) } catch (e) { showToast('Could not delete product. Please try again.', { type: 'error' }) }
  }

  async function handleRestock(product, qty, note) {
    try {
      await productRepository.update(product.id, brand.id, { stock: (product.stock || 0) + parseInt(qty) })
      await reload()
      showToast(qty + ' units added to ' + product.name, { type: 'success' })
    } catch (e) { showToast('Could not update stock. Please try again.', { type: 'error' }) }
  }

  async function toggleCareFind(product) {
    try {
      await productRepository.update(product.id, brand.id, { list_on_carefind: !product.list_on_carefind })
      await reload()
    } catch (e) {}
  }

  function downloadTemplate() {
    const rows = [
      ['Product Name', 'Generic Name', 'Category', 'Selling Price (NGN)', 'Cost Price (NGN)', 'Stock Quantity', 'Reorder Level', 'Barcode', 'Expiry Date', 'List on CareFind (yes/no)'],
      ['Amoxicillin 500mg', 'Amoxicillin', 'Medicines', '1500', '800', '100', '20', '', '', 'yes'],
      ['Paracetamol 500mg', 'Paracetamol', 'Medicines', '800', '400', '200', '30', '', '', 'yes'],
      ['Consultation Fee', 'Medical Consultation', 'Services', '5000', '0', '', '0', '', '', 'yes'],
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
        const lines = ev.target.result.split('\n').filter(l => l.trim())
        if (lines.length < 2) { setUploadError('File is empty or has no products.'); return }
        const parsed = lines.slice(1).map(line => {
          const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim())
          if (!cols[0]) return null
          return {
            name: cols[0] || '',
            generic_name: cols[1] || '',
            category: cols[2] || 'Medicines',
            price: parseFloat(cols[3]) || 0,
            cost_price: parseFloat(cols[4]) || 0,
            stock: cols[5] !== '' ? parseInt(cols[5]) || 0 : 999,
            reorder_level: parseInt(cols[6]) || 5,
            barcode: cols[7] || '',
            list_on_carefind: (cols[8] || 'yes').toLowerCase() !== 'no',
            emoji: '💊',
          }
        }).filter(Boolean)
        if (parsed.length === 0) { setUploadError('No valid products found.'); return }
        setUploadData(parsed)
      } catch (err) { setUploadError('Error reading file. Use the downloaded template.') }
    }
    reader.readAsText(file); e.target.value = ''
  }

  // Bulk CSV import — batches parallel inserts (20 at a time) instead of the
  // old one-await-per-row loop, which took minutes and died on the first
  // network hiccup for 2,000+ product files. Duplicates are skipped up front
  // against the currently-loaded product list.
  async function importProducts() {
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
      if (findDuplicate(products, p.name, p.generic_name)) {
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
        emoji: '💊',
        business_id: brand.id,
      })
    }
    const BATCH = 20
    for (let i = 0; i < fresh.length; i += BATCH) {
      const batch = fresh.slice(i, i + BATCH)
      const results = await Promise.all(batch.map(p =>
        productRepository.create(brand.id, p).then(() => ({ ok: true })).catch(err => ({ ok: false, name: p.name, msg: err.message }))
      ))
      for (const r of results) {
        if (r.ok) added++
        else {
          failed++
          if (failedNames.length < 5) failedNames.push(r.name + ' (' + r.msg + ')')
        }
      }
    }
    await reload()
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
          <button onClick={() => setShowUpload(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}><Upload size={14} /> Upload CSV</button>
          {totalDuplicateItems > 0 && (
            <button onClick={() => setShowCleanup(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${warning}`, background: warningBg, color: warning, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
              <AlertTriangle size={14} /> Clean up {totalDuplicateItems} duplicate{totalDuplicateItems > 1 ? 's' : ''}
            </button>
          )}
          {perms?.canEditStock && <TealBtn onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Add product</TealBtn>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Package />} label='Total Products' value={products.length} />
        <StatCard icon={<AlertTriangle />} label='Low Stock' value={lowStock.length} alert={lowStock.length > 0} sub={outOfStock.length + ' out of stock'} />
        <StatCard icon={<DollarSign />} label='Stock Value' value={fmt(stockValue)} sub={'Cost: ' + fmt(costValue)} />
        <StatCard icon={<Search />} label='On CareFind' value={onCareFind} sub='Visible to public' />
      </div>

      {lowStock.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '14px 18px', borderRadius: theme.radius.lg, background: warningBg, border: `1px solid ${warning}`, display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <AlertTriangle size={20} color={warning} style={{ flexShrink: 0 }} />
          <div><div style={{ fontWeight: '700', color: warning, fontSize: '14px' }}>{lowStock.length} item(s) running low</div><div style={{ fontSize: '12px', color: gray500, marginTop: '4px' }}>{lowStock.map(p => p.name).join(' · ')}</div></div>
        </div>
      )}

      {expiringSoon.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '14px 18px', borderRadius: theme.radius.lg, background: infoBg, border: `1px solid ${info}`, display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <Info size={20} color={info} style={{ flexShrink: 0 }} />
          <div><div style={{ fontWeight: '700', color: info, fontSize: '14x' }}>{expiringSoon.length} product(s) expiring soon</div><div style={{ fontSize: '12px', color: gray500, marginTop: '4px' }}>{expiringSoon.map(p => `${p.name} (expires ${new Date(p.expiry_date).toLocaleDateString('en-NG')})`).join(' · ')}</div></div>
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

      {scanning && (
        <div style={{ marginBottom: '16px', borderRadius: theme.radius.lg, overflow: 'hidden', border: `2px solid ${tealDeep}`, position: 'relative', background: 'black' }}>
          <video id='inv-cam' style={{ width: '100%', maxHeight: '240px', objectFit: 'cover', display: 'block' }} autoPlay playsInline muted />
          <button onClick={() => { setScanning(false); const v = document.getElementById('inv-cam'); if (v?.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null } }}
            style={{ position: 'absolute', top: '8px', right: '8px', padding: '6px 14px', borderRadius: '8px', border: 'none', background: danger, color: 'white', fontWeight: '700', cursor: 'pointer' }}>Stop</button>
        </div>
      )}

      {filtered.length === 0 ? <Empty icon={<Package size={40} />} message='No products found' action={perms?.canEditStock ? '+ Add First Product' : undefined} onAction={() => setShowAdd(true)} /> : (
        <DataTable
          rows={filtered}
          page={page}
          setPage={setPage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          count={`${filtered.length} product${filtered.length !== 1 ? 's' : ''}`}
          onRetry={reload}
          columns={[
            {
              key: 'name', label: 'Product', sortable: true,
              render: p => {
                const Icon = productIcon(p)
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: 30, height: 30, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={15} /></div>
                    <span style={{ fontWeight: '700', fontSize: '13px', color: navy }}>{p.name}</span>
                  </div>
                )
              },
            },
            {
              key: 'generic_name', label: 'Generic Name', sortable: true,
              render: p => <span style={{ fontSize: '12px', color: gray500 }}>{p.generic_name || p.genericName || '—'}</span>,
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
              render: p => <span style={{ fontSize: '13px', color: gray500 }}>{p.cost_price ? fmt(p.cost_price) : '—'}</span>,
            },
            {
              key: 'margin', label: 'Margin', sortable: true, align: 'right',
              sortValue: p => (p.price && p.cost_price ? ((p.price - p.cost_price) / p.price) : -1),
              render: p => {
                const margin = p.price && p.cost_price ? Math.round(((p.price - p.cost_price) / p.price) * 100) : null
                return <span style={{ fontSize: '12px', fontWeight: '700', color: margin !== null ? (margin > 30 ? success : warning) : gray400 }}>
                  {margin !== null ? margin + '%' : '—'}
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
                if (!p.expiry_date) return <span style={{ color: gray500 }}>—</span>
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
              {(p.cat || p.category || '') !== 'Services' && <button onClick={() => setShowRestock(p)} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>+ Stock</button>}
              <GhostBtn onClick={() => setEditItem(p)}>Edit</GhostBtn>
              {perms?.canDelete && <RedBtn onClick={() => askDelete(p)}>Del</RedBtn>}
            </div>
          )}
        />
      )}

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
          onRestock={async (qty, note) => { await handleRestock(showRestock, qty, note); setShowRestock(null) }}
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
            4. Save as <strong>CSV</strong><br />
            5. Upload here
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
                {uploadData.filter(p => findDuplicate(products, p.name, p.generic_name)).length > 0 && (
                  <span style={{ color: warning, fontWeight: '600' }}> · {uploadData.filter(p => findDuplicate(products, p.name, p.generic_name)).length} already exist (will be skipped)</span>
                )}
              </div>
              <div style={{ maxHeight: '180px', overflowY: 'auto', borderRadius: '10px', border: `1px solid ${gray100}` }}>
                {uploadData.map((p, i) => {
                  const isDupe = !!findDuplicate(products, p.name, p.generic_name)
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
            Found <strong>{duplicateGroups.length}</strong> group(s) of duplicate products already in your inventory — products matching by brand name or generic name. Merging will combine the stock of each group into one product and remove the rest.
          </div>

          <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {duplicateGroups.map((group, gi) => {
              const totalStock = group.reduce((s, p) => s + (p.stock || 0), 0)
              return (
                <div key={gi} style={{ padding: '12px', borderRadius: '10px', border: `1px solid ${warning}`, background: '#fffdf5' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: warning, marginBottom: '8px' }}>
                    GROUP {gi + 1} — {group.length} duplicates · will combine to {totalStock} units
                  </div>
                  {group.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: '6px', background: 'white', marginBottom: '4px', fontSize: '12px' }}>
                      <div>
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
                <div style={{ fontSize: '10px', fontWeight: '700', color: gray400, marginBottom: '6px' }}>EXISTING IN INVENTORY</div>
                <div style={{ fontWeight: '700', fontSize: '14px' }}>{duplicateWarning.existing.name}</div>
                {(duplicateWarning.existing.generic_name || duplicateWarning.existing.genericName) && (
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{duplicateWarning.existing.generic_name || duplicateWarning.existing.genericName}</div>
                )}
                <div style={{ fontSize: '13px', fontWeight: '700', color: tealDeep, marginTop: '6px' }}>{fmt(duplicateWarning.existing.price)}</div>
                <div style={{ fontSize: '12px', color: gray500 }}>{duplicateWarning.existing.stock} in stock</div>
              </div>
              <ArrowRight size={18} color={gray300} />
              <div style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #e5e7eb', background: '#FDFBF7' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: '#1E5A43', marginBottom: '6px' }}>YOU'RE ADDING</div>
                <div style={{ fontWeight: '700', fontSize: '14px' }}>{duplicateWarning.incoming.name}</div>
                {duplicateWarning.incoming.generic_name && (
                  <div style={{ fontSize: '12px', color: theme.textFaint, marginTop: '2px' }}>{duplicateWarning.incoming.generic_name}</div>
                )}
                <div style={{ fontSize: '13px', fontWeight: '700', color: tealDeep, marginTop: '6px' }}>{fmt(duplicateWarning.incoming.price)}</div>
                <div style={{ fontSize: '12px', color: theme.textFaint }}>+{duplicateWarning.incoming.stock} units</div>
              </div>
            </div>

            <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#f9fafb', fontSize: '12px', color: '#555' }}>
              Updating will combine stock ({duplicateWarning.existing.stock} + {duplicateWarning.incoming.stock} = {(duplicateWarning.existing.stock || 0) + (duplicateWarning.incoming.stock || 0)} units) and apply the new price you entered.
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
    await onSave({ ...restForm, ...saleData, price: parseFloat(form.price) || 0, cost_price: parseFloat(form.cost_price) || 0, stock: isService ? 999 : parseInt(form.stock) || 0, reorder_level: parseInt(form.reorder_level) || 5, category: form.cat || form.category || 'Medicines', expiry_date: form.expiry_date || null })
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

function RestockModal({ product, onRestock, onClose, showToast }) {
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const handle = async () => {
    if (!qty || parseInt(qty) <= 0) { showToast('Enter a valid quantity.', { type: 'warning' }); return }
    setSaving(true); await onRestock(qty, note); setSaving(false)
  }
  return (
    <Modal show title='Restock Product' onClose={onClose}
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={handle} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : '+ Add Stock'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '12px', borderRadius: '10px', background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span style={{ color: gray500 }}>Current stock</span><span style={{ fontWeight: '700' }}>{product.stock} units</span>
        </div>
        <Inp label='Units to Add *' value={qty} onChange={setQty} type='number' placeholder='e.g. 100' required />
        {qty && parseInt(qty) > 0 && <div style={{ fontSize: '12px', color: success, fontWeight: '700' }}>New total: {product.stock + parseInt(qty)} units</div>}
        <Inp label='Note (optional)' value={note} onChange={setNote} placeholder='Supplier name, invoice number...' />
        {product.list_on_carefind !== false && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px', borderRadius: '8px', background: '#FDFBF7', fontSize: '12px', color: '#1E5A43' }}><Search size={13} /> After restocking this product will show as available on CareFind</div>}
      </div>
    </Modal>
  )
}

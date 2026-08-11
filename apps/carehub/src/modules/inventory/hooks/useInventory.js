import { useState, useEffect, useCallback } from 'react'
import { productRepository } from '../repositories'
import { useToast } from '../../../components/ui'
import { findDuplicate, findAllDuplicateGroups } from '../../../lib/productMatches'

export function useInventory(businessId, brand) {
  const toast = useToast()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [duplicateGroups, setDuplicateGroups] = useState([])
  const [totalDuplicateItems, setTotalDuplicateItems] = useState(0)
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [showRestock, setShowRestock] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadData, setUploadData] = useState([])
  const [uploadError, setUploadError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const [showCleanup, setShowCleanup] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const reload = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const data = await productRepository.getAll(businessId)
      setProducts(data || [])
    } catch (e) {
      console.error('reload error:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => { reload() }, [reload])

  const computeDerived = useCallback(() => {
    const lowStock = products.filter(p => (p.cat || p.category) !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5))
    const outOfStock = products.filter(p => (p.cat || p.category) !== 'Services' && p.stock <= 0)
    const stockValue = products.filter(p => (p.cat || p.category) !== 'Services').reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0)
    const costValue = products.filter(p => (p.cat || p.category) !== 'Services').reduce((s, p) => s + (p.cost_price || 0) * (p.stock || 0), 0)
    const onCareFind = products.filter(p => p.list_on_carefind !== false && p.stock > 0).length
    const cats = ['All', ...Array.from(new Set(products.map(p => p.cat || p.category || '')))]
    const filtered = products.filter(p => {
      const pCat = p.cat || p.category || ''
      const pGeneric = p.generic_name || p.genericName || ''
      return (catFilter === 'All' || pCat === catFilter) &&
        (p.name.toLowerCase().includes(search.toLowerCase()) || pGeneric.toLowerCase().includes(search.toLowerCase()))
    })
    return { lowStock, outOfStock, stockValue, costValue, onCareFind, cats, filtered }
  }, [products, search, catFilter])

  const derived = computeDerived()

  const saveProduct = async (data, isEdit) => {
    try {
      const category = data.cat || data.category || 'Medicines'
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
        await productRepository.update(data.id, businessId, productData)
        toast.show('Product updated!', { type: 'success' })
      } else {
        await productRepository.create(businessId, productData)
        toast.show('Product added!', { type: 'success' })
      }
      await reload()
    } catch (e) {
      console.error('saveProduct error:', e)
      toast.show(e.message || 'Could not save product. Please try again.', { type: 'error' })
    }
  }

  const updateExistingFromDuplicate = async () => {
    if (!duplicateWarning) return
    try {
      const { existing, incoming } = duplicateWarning
      await productRepository.update(existing.id, businessId, {
        price: incoming.price,
        cost_price: incoming.cost_price,
        stock: (existing.stock || 0) + (incoming.stock || 0),
        reorder_level: incoming.reorder_level,
        category: incoming.category,
        barcode: incoming.barcode || existing.barcode,
        list_on_carefind: incoming.list_on_carefind,
      })
      toast.show('Existing product updated — stock combined!', { type: 'success' })
      setDuplicateWarning(null)
      setShowAdd(false)
      setEditItem(null)
      await reload()
    } catch (e) { toast.show('Could not update product. Please try again.', { type: 'error' }) }
  }

  const mergeAllDuplicates = async () => {
    setCleaningUp(true)
    try {
      const idsToDelete = []
      const updates = []

      for (const group of duplicateGroups) {
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

      const UPDATE_BATCH_SIZE = 25
      for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
        const batch = updates.slice(i, i + UPDATE_BATCH_SIZE)
        await Promise.all(batch.map(u => productRepository.update(u.id, businessId, { stock: u.stock })))
        toast.show('Updating products... ' + Math.min(i + UPDATE_BATCH_SIZE, updates.length) + ' / ' + updates.length, { type: 'info' })
      }

      const DELETE_BATCH_SIZE = 50
      let deletedSoFar = 0
      for (let i = 0; i < idsToDelete.length; i += DELETE_BATCH_SIZE) {
        const batch = idsToDelete.slice(i, i + DELETE_BATCH_SIZE)
        await productRepository.deleteBulk(batch, businessId)
        deletedSoFar += batch.length
        toast.show('Removing duplicates... ' + deletedSoFar + ' / ' + idsToDelete.length, { type: 'info' })
      }

      await reload()
      toast.show('Cleaned up ' + duplicateGroups.length + ' duplicate group(s) — removed ' + idsToDelete.length + ' duplicate item(s)', { type: 'success' })
    } catch (e) {
      console.error('Error during cleanup:', e)
      toast.show('Could not finish cleanup — please try again. (' + (e.message || 'unknown error') + ')', { type: 'error' })
    }
    setCleaningUp(false)
    setShowCleanup(false)
  }

  function askDelete(product) { setDeleteTarget(product) }
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try { await productRepository.delete(id, businessId); await reload(); toast.show('Product deleted.', { type: 'success' }) } catch (e) { toast.show('Could not delete product. Please try again.', { type: 'error' }) }
  }

  async function handleRestock(product, qty, note) {
    try {
      await productRepository.update(product.id, businessId, { stock: (product.stock || 0) + parseInt(qty) })
      await reload()
      toast.show(qty + ' units added to ' + product.name, { type: 'success' })
    } catch (e) { toast.show('Could not update stock. Please try again.', { type: 'error' }) }
  }

  async function toggleCareFind(product) {
    try {
      await productRepository.update(product.id, businessId, { list_on_carefind: !product.list_on_carefind })
      await reload()
    } catch (e) {}
  }

  return {
    // State
    products,
    loading,
    error,
    search, setSearch,
    catFilter, setCatFilter,
    duplicateGroups,
    totalDuplicateItems,
    showAdd, setShowAdd,
    editItem, setEditItem,
    showRestock, setShowRestock,
    showUpload, setShowUpload,
    uploadData, setUploadData,
    uploadError, setUploadError,
    scanning, setScanning,
    duplicateWarning, setDuplicateWarning,
    showCleanup, setShowCleanup,
    cleaningUp, setCleaningUp,
    deleteTarget, setDeleteTarget,
    // Derived
    ...derived,
    // Actions
    reload,
    saveProduct,
    updateExistingFromDuplicate,
    mergeAllDuplicates,
    askDelete,
    handleDelete,
    handleRestock,
    toggleCareFind,
    setDuplicateGroups,
    setTotalDuplicateItems,
  }
}

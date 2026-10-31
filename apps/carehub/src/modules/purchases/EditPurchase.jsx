import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, AlertTriangle } from 'lucide-react'
import { Modal, ConfirmDialog, GhostBtn, TealBtn, Loading, ErrorState, Textarea } from '../../components/ui'
import { usePurchase, usePurchaseForEdit, useEditPurchase } from '../../hooks/queries'
import { isMissingObject, refusalMessage } from '../../lib/dbErrors'
import { theme } from '../../styles/theme'
import { upsertProducts } from '../inventory/productListState'
import PurchaseForm, { formLineProblems, formTotal } from './PurchaseForm'
import { useSupplierDirectory, useProductInsights } from './hooks'
import { isBlankItem } from './lineItems'
import { formFromPurchase, editItemsFromForm } from './purchaseInvoice'

const { navy, gray500, gray600, danger, dangerBg } = theme

// Editing a recorded purchase (for the Owner, or a role granted "Edit
// purchases"). The form is the Record Purchase form, filled from the purchase
// and from what the database says about each line (get_purchase_for_edit); the
// save is one database transaction (edit_purchase) that moves stock, the debt,
// the payment history and the audit log together. A reason is required.
export default function EditPurchaseModal({ brand, purchase: row, inventory = [], inventoryStatus = 'ready', catalog, setProducts, staffName, showToast, onClose, onSaved }) {
  const full = usePurchase(brand?.id, row?.id, null)
  const forEdit = usePurchaseForEdit(brand?.id, row?.id)
  const save = useEditPurchase(brand?.id)
  const directory = useSupplierDirectory(brand?.id)
  const insights = useProductInsights(brand?.id)
  const formRef = useRef(null)
  const [form, setForm] = useState(null)
  const [initial, setInitial] = useState(null)
  const [reason, setReason] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)

  const purchase = full.data
  const editData = forEdit.data
  // Filled once, from the full record and the edit lines; later refetches
  // (another tab, a focus refresh) never overwrite what is being typed.
  useEffect(() => {
    if (form || !purchase || !editData?.items) return
    const next = formFromPurchase(purchase, editData.items)
    setForm(next)
    setInitial(next)
  }, [purchase, editData, form])

  const editLines = useMemo(() => Object.fromEntries((editData?.items || []).map(l => [l.id, l])), [editData])
  const dirty = !!form && (JSON.stringify(form) !== JSON.stringify(initial) || reason.trim() !== '')

  function requestClose() {
    if (save.isPending) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  async function submit() {
    if (save.isPending || !form) return
    setSaveError('')
    const started = form.items.filter(i => !isBlankItem(i))
    const problems = formLineProblems(form, inventory, editLines)
    const total = formTotal(form)
    const paid = parseFloat(form.amountPaid) || 0
    const why = reason.trim()
    let message = ''
    if (!String(form.supplier || '').trim()) message = 'Enter the supplier name.'
    else if (!form.supplyDate) message = 'Enter the supply date.'
    else if (started.length === 0) message = 'A purchase needs at least one item.'
    else if (problems.length > 0) {
      const nums = problems.map(x => x.idx + 1)
      message = (nums.length === 1 ? 'Line ' : 'Lines ') + nums.join(', ') + (nums.length === 1 ? ' needs' : ' need') + ' attention: see the highlighted fields.'
      formRef.current?.focusLine(form.items[problems[0].idx].id, Object.keys(problems[0].problems)[0])
    } else if (paid > total + 0.005) message = 'The amount paid is more than the new total.'
    else if (why.length < 3 || why.length > 300) message = 'Say why the purchase is being changed (3 to 300 characters).'
    if (message) {
      setShowErrors(true)
      setSaveError(message)
      return
    }

    const paidChanged = String(form.amountPaid) !== String(initial.amountPaid)
    try {
      const result = await save.mutateAsync({
        purchaseId: row.id,
        supplier: form.supplier.trim(),
        supplyDate: form.supplyDate,
        dueDate: form.dueDate || null,
        notes: form.notes || '',
        items: editItemsFromForm(started),
        amountPaid: paidChanged ? paid : null,
        reason: why,
        staffName: staffName || null,
        expectedEditCount: Number(purchase.edit_count) || 0,
        expectedAmountPaid: Number(purchase.amount_paid) || 0,
      })
      if (result?.unchanged) {
        showToast('Nothing was changed, so nothing was saved.', { type: 'info' })
        onClose()
        return
      }
      if (setProducts && result?.products?.length) setProducts(prev => upsertProducts(prev, result.products))
      const moves = (result?.stock_changes || []).filter(c => c.change)
      const parts = ['Purchase updated.']
      if (moves.length) parts.push('Stock: ' + moves.map(c => (c.change > 0 ? '+' : '−') + Math.abs(c.change) + ' ' + c.name).join(', ') + '.')
      if (result?.created_products > 0) parts.push(result.created_products + ' new product' + (result.created_products === 1 ? '' : 's') + ' added to Inventory.')
      console.info('[purchases] purchase edited', { purchase: row.id, stock_changes: moves.length })
      showToast(parts.join(' '), { type: 'success', duration: 7000 })
      onSaved?.(result)
      onClose()
    } catch (e) {
      console.error('[purchases] edit failed:', e)
      setSaveError(refusalMessage(e, "We couldn't save the changes. Your edits are still here: check your connection and try again."))
    }
  }

  const unavailable = (forEdit.isError && isMissingObject(forEdit.error))
  const loading = !form && !unavailable && !full.isError && !forEdit.isError
  const canEdit = editData?.can_edit !== false

  return (
    <>
      <Modal show onClose={requestClose} title={'Edit purchase from ' + (row?.supplier_name || 'supplier')} wide preventBackdropClose
        footer={form && canEdit ? (<>
          <GhostBtn onClick={requestClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
          <TealBtn onClick={submit} disabled={save.isPending || inventoryStatus === 'loading'} aria-busy={save.isPending}
            style={{ flex: 2, padding: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Pencil size={14} aria-hidden='true' /> {save.isPending ? 'Saving…' : 'Save changes'}
          </TealBtn>
        </>) : <GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>}>
        {unavailable ? (
          <div role='status' style={{ fontSize: 13, color: gray600 }}>Editing purchases becomes available once the latest database update is applied.</div>
        ) : full.isError || forEdit.isError ? (
          <ErrorState message="We couldn't load this purchase for editing." onRetry={() => { full.refetch(); forEdit.refetch() }} />
        ) : loading ? (
          <Loading text='Loading the purchase…' />
        ) : !canEdit ? (
          <div role='status' style={{ fontSize: 13, color: gray600 }}>You are not allowed to edit purchases. Ask the Owner for the “Edit purchases” permission.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {saveError && (
              <div role='alert' style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, background: dangerBg, border: `1px solid ${danger}`, color: danger, fontSize: 13 }}>
                <AlertTriangle size={15} aria-hidden='true' style={{ marginTop: 1, flexShrink: 0 }} />
                <span>{saveError}</span>
              </div>
            )}
            {Number(purchase?.edit_count) > 0 && (
              <div style={{ fontSize: 12, color: gray500 }}>Edited {purchase.edit_count} time{Number(purchase.edit_count) === 1 ? '' : 's'} before. The purchase’s history shows each change.</div>
            )}
            <PurchaseForm ref={formRef} mode='edit' form={form} setForm={(u) => setForm(prev => (typeof u === 'function' ? u(prev) : u))}
              inventory={inventory} inventoryStatus={inventoryStatus} catalog={catalog} canReprice={false} showErrors={showErrors}
              brandId={brand?.id} suppliers={directory.suppliers} suppliersStatus={directory.isLoading ? 'loading' : directory.isError ? 'error' : 'ready'}
              insights={insights} editLines={editLines} />
            <Textarea label='Reason for the change' required id='edit-purchase-reason' value={reason} onChange={setReason} rows={2}
              placeholder='e.g. Supplier invoice showed 12, not 10' maxLength={300}
              error={showErrors && (reason.trim().length < 3 || reason.trim().length > 300) ? 'Say why the purchase is being changed (3 to 300 characters)' : undefined} />
            <div style={{ fontSize: 11.5, color: navy, opacity: 0.7 }}>The reason, who made the change and the purchase before and after are kept in the audit log.</div>
          </div>
        )}
      </Modal>
      <ConfirmDialog show={confirmClose} onClose={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose() }}
        title='Discard your changes?' consequence='The purchase stays as it was. Nothing you changed here is saved.' confirmLabel='Discard changes' />
    </>
  )
}

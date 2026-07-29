import { useState, useEffect } from 'react'
import { Truck, CreditCard, Hourglass, Search } from 'lucide-react'
import { getPurchases, addPurchase, updatePurchase, recordUnderpayment, updateDebt, getDebts } from '../../services/supabase'
import { fmt, todayDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, gray100, gray50, border, danger, success, bg } = theme

export default function Purchases({ brand, role, perms }) {
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ supplyDate: todayDate() })
  const [saving, setSaving] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    try { const p = await getPurchases(brand.id); setPurchases(p || []) } catch (e) {}
    setLoading(false)
  }

  async function save() {
    if (!form.supplier || !form.totalCost) { showToast('Please enter supplier name and total cost.', { type: 'warning' }); return }
    setSaving(true)
    try {
      const total = parseFloat(form.totalCost) || 0
      const paid = parseFloat(form.amountPaid) || 0
      const balance = total - paid
      const purchase = await addPurchase({
        business_id: brand.id,
        supplier_name: form.supplier,
        product_name: form.product || '',
        quantity: parseInt(form.qty) || 0,
        cost_price: parseFloat(form.costPrice) || 0,
        total_cost: total,
        amount_paid: paid,
        balance: balance,
        supply_date: form.supplyDate || todayDate(),
        due_date: form.dueDate || '',
        status: paid >= total ? 'paid' : 'pending',
        notes: form.notes || '',
      })
      // AUTO-CREATE DEBT: if there is a balance, create a "We Owe" debt automatically
      if (balance > 0) {
        await recordUnderpayment({
          businessId: brand.id,
          direction: 'we_owe',
          partyName: form.supplier,
          amount: total,
          amountPaid: paid,
          dueDate: form.dueDate || '',
          description: 'Purchase — ' + (form.product || 'Stock') + ' — Due: ' + (form.dueDate || 'Not set'),
          source: 'purchase',
          sourceRef: (purchase[0] || {}).id || '',
        })
      }
      showToast('Purchase recorded!' + (balance > 0 ? ' Debt of ' + fmt(balance) + ' added to Debts automatically.' : ''), { type: 'success' })
      setForm({ supplyDate: todayDate() }); setShowAdd(false); load()
    } catch (e) { showToast('Could not save purchase. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  async function markPaid(p) {
    try {
      await updatePurchase(p.id, { amount_paid: p.total_cost, balance: 0, status: 'paid' })
      // AUTO-UPDATE DEBT: find matching debt and mark as paid
      try {
        const debts = await getDebts(brand.id)
        const matchDebt = debts.find(d => d.source === 'purchase' && d.source_ref === p.id && d.status !== 'paid')
        if (matchDebt) {
          await updateDebt(matchDebt.id, { amount_paid: p.total_cost, balance: 0, status: 'paid' })
        }
      } catch (e) {}
      load(); showToast('Marked as paid! Debt updated automatically.', { type: 'success' })
    } catch (e) { showToast('Could not mark as paid. Please try again.', { type: 'error' }) }
  }

  const filtered = purchases.filter(p => {
    const matchSearch = !search || p.supplier_name.toLowerCase().includes(search.toLowerCase()) || (p.product_name && p.product_name.toLowerCase().includes(search.toLowerCase()))
    const matchMonth = !filterMonth || p.created_at?.startsWith(filterMonth)
    const matchYear = !filterYear || p.created_at?.startsWith(filterYear)
    return matchSearch && matchMonth && matchYear
  })

  const totalOwed = purchases.reduce((s, p) => s + (p.balance || 0), 0)
  const totalPaid = purchases.reduce((s, p) => s + (p.amount_paid || 0), 0)
  const years = [...new Set(purchases.map(p => p.created_at?.slice(0, 4)).filter(Boolean))].sort().reverse()

  return (
    <div>
      <SectionHead title='Purchases' sub='Track supplier purchases and payments' btn='+ Record Purchase' onBtn={() => setShowAdd(true)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Truck />} label='Total Purchases' value={purchases.length} />
        <StatCard icon={<CreditCard />} label='Total Paid' value={fmt(totalPaid)} />
        <StatCard icon={<Hourglass />} label='Balance Owed' value={fmt(totalOwed)} alert={totalOwed > 0} />
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search supplier or product...'
            style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>
        <input type='month' value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setFilterYear('') }}
          style={{ padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        <select value={filterYear} onChange={e => { setFilterYear(e.target.value); setFilterMonth('') }}
          style={{ padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', background: 'white', color: navy }}>
          <option value=''>All years</option>
          {years.map(y => <option key={y}>{y}</option>)}
        </select>
        {(filterMonth || filterYear) && <button onClick={() => { setFilterMonth(''); setFilterYear('') }} style={{ padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>Clear</button>}
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty icon={<Truck size={40} />} message='No purchases recorded' action='+ Record Purchase' onAction={() => setShowAdd(true)} />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {['Supplier', 'Product', 'Qty', 'Unit Cost', 'Total', 'Paid', 'Balance', 'Supply Date', 'Due Date', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${gray100}` }}>
                    <td style={{ padding: '12px 12px', fontWeight: '700', fontSize: '13px', color: navy }}>{p.supplier_name}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: gray600 }}>{p.product_name || '—'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: navy }}>{p.quantity || '—'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: navy }}>{p.cost_price ? fmt(p.cost_price) : '—'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', fontWeight: '700', color: navy }}>{fmt(p.total_cost || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: success }}>{fmt(p.amount_paid || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', fontWeight: '900', color: (p.balance || 0) > 0 ? danger : success }}>{fmt(p.balance || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray500 }}>{p.supply_date || '—'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray400 }}>{p.due_date || '—'}</td>
                    <td style={{ padding: '12px 12px' }}><Pill label={p.status} type={p.status === 'paid' ? 'green' : 'amber'} /></td>
                    <td style={{ padding: '12px 12px' }}>
                      {p.status !== 'paid' && <button onClick={() => markPaid(p)} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Mark paid</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({ supplyDate: todayDate() }) }} title='Record Purchase'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({ supplyDate: todayDate() }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Purchase'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Supplier Name *' value={form.supplier} onChange={v => f('supplier', v)} placeholder='e.g. MedSupply Ltd' required />
          <Inp label='Product / Item Name' value={form.product} onChange={v => f('product', v)} placeholder='e.g. Amoxicillin 500mg x 1000 caps' />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Quantity' value={form.qty} onChange={v => f('qty', v)} type='number' placeholder='e.g. 100' />
            <Inp label='Unit Cost Price (₦)' value={form.costPrice} onChange={v => f('costPrice', v)} type='number' placeholder='0' />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Total Cost (₦) *' value={form.totalCost} onChange={v => f('totalCost', v)} type='number' placeholder='0' required />
            <Inp label='Amount Paid (₦)' value={form.amountPaid} onChange={v => f('amountPaid', v)} type='number' placeholder='0' />
          </div>
          {form.totalCost && (
            <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: gray500 }}>Balance remaining</span>
              <span style={{ fontWeight: '900', color: danger }}>{fmt((parseFloat(form.totalCost) || 0) - (parseFloat(form.amountPaid) || 0))}</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Supply Date' value={form.supplyDate} onChange={v => f('supplyDate', v)} type='date' />
            <Inp label='Payment Due Date' value={form.dueDate} onChange={v => f('dueDate', v)} type='date' />
          </div>
          <Textarea label='Notes' value={form.notes} onChange={v => f('notes', v)} placeholder='Invoice number, delivery notes...' rows={2} />
        </div>
      </Modal>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

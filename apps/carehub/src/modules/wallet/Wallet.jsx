import { useState, useEffect, useRef } from 'react'
import { Wallet as WalletIcon, Banknote, ArrowUpCircle, ArrowDownCircle, Clock, CheckCircle, AlertTriangle, Download } from 'lucide-react'
import { sbFetch } from '../../services/supabase'
import { authClient } from '../../lib/authClient'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Pill, Inp, GhostBtn, TealBtn, Loading, Empty, DataTable, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, success, danger, warning, bg } = theme

export default function Wallet({ brand, role }) {
  const [wallet, setWallet] = useState(null)
  const [txs, setTxs] = useState([])
  const [withdrawals, setWithdrawals] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawForm, setWithdrawForm] = useState({})
  const [withdrawing, setWithdrawing] = useState(false)
  const [banks, setBanks] = useState([])
  const [accountResolving, setAccountResolving] = useState(false)
  const [accountResolved, setAccountResolved] = useState(false)
  const resolveTimer = useRef(null)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()

  useEffect(() => { load() }, [brand?.id])

  useEffect(() => {
    async function loadBanks() {
      try {
        const res = await fetch('/api/banks')
        if (res.ok) {
          const data = await res.json()
          setBanks(data)
        }
      } catch (err) {}
    }
    loadBanks()
  }, [])

  // Resolve account name when bank code and 10-digit account number are both set.
  // Debounced to avoid firing on every keystroke.
  useEffect(() => {
    if (resolveTimer.current) clearTimeout(resolveTimer.current)

    // Clear resolved state when inputs change
    setAccountResolved(false)
    setWithdrawForm(prev => ({ ...prev, accountName: '' }))

    const acctNum = withdrawForm.accountNumber || ''
    const bankCode = withdrawForm.bankCode || ''

    if (!bankCode || acctNum.length !== 10) return

    resolveTimer.current = setTimeout(async () => {
      setAccountResolving(true)
      try {
        const res = await fetch('/api/resolve-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bankCode, accountNumber: acctNum }),
        })
        const data = await res.json()
        if (res.ok && data.accountName) {
          setWithdrawForm(prev => ({ ...prev, accountName: data.accountName }))
          setAccountResolved(true)
        } else {
          setAccountResolved(false)
          showToast(data.detail || data.error || 'Could not verify account name.', { type: 'error' })
        }
      } catch {
        setAccountResolved(false)
        showToast('Network error. Please check your connection.', { type: 'error' })
      } finally {
        setAccountResolving(false)
      }
    }, 500)

    return () => { if (resolveTimer.current) clearTimeout(resolveTimer.current) }
  }, [withdrawForm.bankCode, withdrawForm.accountNumber])

  async function load() {
    setLoading(true)
    try {
      const [w, t, wd] = await Promise.all([
        sbFetch(`business_wallets?business_id=eq.${brand.id}`).catch(() => []),
        sbFetch(`business_wallet_transactions?business_id=eq.${brand.id}&order=created_at.desc&limit=100`).catch(() => []),
        sbFetch(`business_withdrawal_requests?business_id=eq.${brand.id}&order=created_at.desc&limit=50`).catch(() => []),
      ])
      setWallet(Array.isArray(w) && w[0] ? w[0] : { available_balance: 0, held_balance: 0 })
      setTxs(Array.isArray(t) ? t : [])
      setWithdrawals(Array.isArray(wd) ? wd : [])
    } catch (e) { setWallet({ available_balance: 0, held_balance: 0 }) }
    setLoading(false)
  }

  const naira = (kobo) => `₦${((kobo || 0) / 100).toLocaleString()}`

  async function handleWithdraw() {
    if (!withdrawForm.amount || !withdrawForm.bankName || !withdrawForm.bankCode || !withdrawForm.accountNumber || !withdrawForm.accountName) {
      showToast('Fill in amount and bank details.', { type: 'warning' }); return
    }
    const amountKobo = Math.round(parseFloat(withdrawForm.amount) * 100)
    if (amountKobo > (wallet?.available_balance || 0)) {
      showToast('Amount exceeds available balance.', { type: 'warning' }); return
    }
    setWithdrawing(true)
    try {
      const { data: { session } } = await authClient.auth.getSession()
      if (!session) { showToast('Please log in again.', { type: 'warning' }); setWithdrawing(false); return }
      const res = await fetch('/api/initiate-business-withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          business_id: brand.id,
          amount: amountKobo,
          bankCode: withdrawForm.bankCode,
          bankName: withdrawForm.bankName,
          accountNumber: withdrawForm.accountNumber,
          accountName: withdrawForm.accountName,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error === 'insufficient' ? 'Not enough available balance.' : data.error || 'Could not start withdrawal.', { type: 'error' })
        setWithdrawing(false); return
      }
      setWithdrawForm({}); setShowWithdraw(false); setAccountResolved(false)
      load()
      showToast('Withdrawal started — will arrive shortly.', { type: 'success' })
    } catch (e) { showToast('Network error.', { type: 'error' }) }
    setWithdrawing(false)
  }

  function exportCsv() {
    const rows = [['Date', 'Type', 'Amount', 'Reference']]
    txs.forEach(tx => rows.push([tx.created_at?.split('T')[0] || '', tx.type || '', naira(tx.amount), tx.reference || '']))
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_Wallet_Transactions.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('Transactions exported!', { type: 'success' })
  }

  const filtered = filter === 'all' ? txs : txs.filter(t => t.type === filter)
  const totalReceived = txs.filter(t => t.type === 'booking_credit' || t.type === 'release').reduce((s, t) => s + (t.amount || 0), 0)
  const isOwner = role === 'Owner'

  if (loading) return <Loading text="Loading wallet..." />
  if (!isOwner) return (
    <div style={{ padding: '32px', textAlign: 'center', color: gray400 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}><WalletIcon size={40} /></div>
      <div style={{ fontWeight: '700', color: gray600 }}>Wallet is restricted to the business Owner</div>
      <div style={{ fontSize: '13px', marginTop: '6px' }}>Contact the owner to view transactions or withdraw</div>
    </div>
  )

  return (
    <div>
      <SectionHead title="Wallet" sub="Payments received through CareFindHub" extraBtn={{ label: 'Export CSV', icon: <Download size={14} />, onClick: exportCsv }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<WalletIcon />} label="Available" value={naira(wallet?.available_balance)} sub="Withdrawable" />
        <StatCard icon={<Clock />} label="Held" value={naira(wallet?.held_balance)} sub="Awaiting completion" />
        <StatCard icon={<Banknote />} label="Total Received" value={naira(totalReceived)} sub={`${txs.length} transactions`} />
        <StatCard icon={<ArrowUpCircle />} label="Pending Withdrawals" value={withdrawals.filter(w => w.status === 'pending' || w.status === 'processing').length} sub="In progress" />
      </div>

      {wallet?.available_balance > 0 && (
        <Card style={{ marginBottom: '16px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: 40, height: 40, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Banknote size={18} /></div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '800', color: navy }}>Ready to withdraw</div>
              <div style={{ fontSize: '12px', color: gray500 }}>{naira(wallet.available_balance)} available to your bank</div>
            </div>
          </div>
          <TealBtn onClick={() => setShowWithdraw(true)}><Banknote size={14} style={{ marginRight: 6 }} />Withdraw</TealBtn>
        </Card>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {['all', 'booking_credit', 'release', 'refund', 'withdrawal'].map(s => {
          const on = filter === s
          return <button key={s} onClick={() => setFilter(s)} style={{ padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600, textTransform: 'capitalize' }}>{s === 'booking_credit' ? 'Credits' : s}</button>
        })}
      </div>

      <DataTable
        rows={filtered}
        loading={false}
        empty={<Empty icon={<WalletIcon size={40} />} message="No transactions yet. Payments from booked appointments will appear here." />}
        count={`${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`}
        columns={[
          { key: 'created_at', label: 'Date', sortable: true, render: r => <span style={{ fontSize: '12px', color: gray600 }}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</span> },
          { key: 'type', label: 'Type', sortable: true, render: r => <Pill label={r.type} type={r.type === 'booking_credit' || r.type === 'release' ? 'green' : r.type === 'refund' ? 'red' : r.type === 'withdrawal' ? 'amber' : 'gray'} /> },
          { key: 'amount', label: 'Amount', sortable: true, render: r => <span style={{ fontWeight: '800', fontSize: '13px', color: r.amount < 0 ? danger : success }}>{r.amount < 0 ? '-' : '+'}{naira(Math.abs(r.amount || 0))}</span> },
          { key: 'reference', label: 'Reference', render: r => <span style={{ fontSize: '11px', color: gray400, fontFamily: theme.fontMono }}>{r.reference || '—'}</span> },
        ]}
      />

      {withdrawals.length > 0 && (
        <>
          <div style={{ fontSize: '16px', fontWeight: '800', color: navy, margin: '24px 0 12px' }}>Withdrawal History</div>
          <DataTable
            rows={withdrawals}
            empty={<Empty message="No withdrawals yet" />}
            count={`${withdrawals.length} withdrawal${withdrawals.length !== 1 ? 's' : ''}`}
            columns={[
              { key: 'created_at', label: 'Date', render: r => <span style={{ fontSize: '12px' }}>{r.created_at?.split('T')[0]}</span> },
              { key: 'amount', label: 'Amount', render: r => <span style={{ fontWeight: '700' }}>{naira(r.amount)}</span> },
              { key: 'bank_name', label: 'Bank', render: r => <span style={{ fontSize: '12px' }}>{r.bank_name} · {r.account_number}</span> },
              { key: 'status', label: 'Status', render: r => <Pill label={r.status} type={r.status === 'completed' ? 'green' : r.status === 'failed' ? 'red' : 'amber'} /> },
            ]}
          />
        </>
      )}

      {showWithdraw && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <Card style={{ maxWidth: '480px', width: '100%', padding: '24px' }}>
            <div style={{ fontSize: '16px', fontWeight: '800', color: navy, marginBottom: '12px' }}>Withdraw to Bank</div>
            <div style={{ fontSize: '12px', color: gray500, marginBottom: '16px' }}>Available: <strong style={{ color: success }}>{naira(wallet?.available_balance)}</strong></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Inp label="Amount (₦)" type="number" value={withdrawForm.amount || ''} onChange={v => setWithdrawForm(p => ({ ...p, amount: v }))} placeholder="e.g. 5000" min="1" max={Math.floor((wallet?.available_balance ?? 0) / 100)} required />
              {withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0) && (
                <span style={{ fontSize: '11px', color: danger, fontWeight: '700' }}>Amount exceeds available balance of {naira(wallet?.available_balance)}</span>
              )}
              <label style={{ fontSize: '12px', fontWeight: '700', color: gray600, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                Bank *
                <select
                  value={withdrawForm.bankCode || ''}
                  onChange={e => {
                    const bank = banks.find(b => b.code === e.target.value)
                    setWithdrawForm(p => ({ ...p, bankCode: e.target.value, bankName: bank ? bank.name : '' }))
                  }}
                  required
                  style={{
                    padding: '10px 12px', fontSize: '13px', borderRadius: '8px',
                    border: `1px solid ${border}`, background: '#fff',
                    color: navy, fontFamily: 'inherit',
                  }}
                >
                  <option value="">Select your bank</option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
                {banks.length === 0 && (
                  <span style={{ fontSize: '11px', color: gray400 }}>Loading banks...</span>
                )}
              </label>
              <Inp label="Account number" value={withdrawForm.accountNumber || ''} onChange={v => setWithdrawForm(p => ({ ...p, accountNumber: String(v || '').replace(/\D/g, '').slice(0, 10) }))} placeholder="10 digits" inputMode="numeric" pattern="[0-9]*" required />
              <div>
                <Inp
                  label={accountResolving ? 'Account name (verifying...)' : 'Account name'}
                  value={withdrawForm.accountName || ''}
                  onChange={v => setWithdrawForm(p => ({ ...p, accountName: v }))}
                  placeholder={accountResolving ? 'Verifying account...' : 'Select bank and enter account number'}
                  readOnly={accountResolved || accountResolving}
                  required
                  style={accountResolved ? { background: success + '10', borderColor: success } : undefined}
                />
                {accountResolving && (
                  <span style={{ fontSize: '11px', color: gray400 }}>Verifying account name with your bank...</span>
                )}
                {accountResolved && withdrawForm.accountName && (
                  <span style={{ fontSize: '11px', color: success, fontWeight: '700' }}>✓ Account name verified</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <GhostBtn onClick={() => { setShowWithdraw(false); setAccountResolved(false); setWithdrawForm({}) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
                <TealBtn onClick={handleWithdraw} disabled={withdrawing || !accountResolved || !withdrawForm.accountName || (withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0))} style={{ flex: 1, padding: '12px', opacity: (withdrawing || !accountResolved || !withdrawForm.accountName || (withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0))) ? 0.6 : 1 }}>{withdrawing ? 'Withdrawing...' : 'Withdraw'}</TealBtn>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

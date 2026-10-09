import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { Wallet as WalletIcon, Banknote, ArrowUpCircle, ArrowDownCircle, Clock, CheckCircle, AlertTriangle, Download } from 'lucide-react'
import { walletRepository } from './repositories'
import WithdrawalPinField from './WithdrawalPinField'
import PayoutAccountsPanel from './PayoutAccountsPanel.jsx'
import BankPicker from './BankPicker.jsx'
import { createPayoutManager, rankBanks } from '@care-ecosystem/shared-payout-ui'
import { startBusinessWithdrawal, withdrawalErrorMessage } from './withdrawalApi'
import { authClient } from '../../lib/authClient'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Pill, Inp, GhostBtn, TealBtn, Loading, Empty, DataTable, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, success, danger, warning, bg } = theme

// Ledger types as the owner reads them (the table stores the raw type).
const TYPE_LABELS = {
  booking_credit: 'booking', shop_credit: 'shop sale', shop_release: 'shop sale released',
  refund_debit: 'refund', refund_restore: 'refund reversed', withdrawal: 'withdrawal', withdrawal_refund: 'withdrawal returned',
}

export default function Wallet({ brand, role }) {
  const [wallet, setWallet] = useState(null)
  const [txs, setTxs] = useState([])
  const [withdrawals, setWithdrawals] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawForm, setWithdrawForm] = useState({})
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawPin, setWithdrawPin] = useState('')
  const [needsPin, setNeedsPin] = useState(false)
  const [banks, setBanks] = useState([])
  const [banksStatus, setBanksStatus] = useState('loading')
  // Saved, identity-verified payout accounts (the safe way to say where the money goes).
  const payouts = useMemo(() => createPayoutManager({ getToken: async () => (await authClient.auth.getSession()).data.session?.access_token }), [])
  const payoutState = useSyncExternalStore(payouts.subscribe, payouts.getState)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [useTyped, setUseTyped] = useState(false)
  const [accountResolving, setAccountResolving] = useState(false)
  const [accountResolved, setAccountResolved] = useState(false)
  const resolveTimer = useRef(null)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()

  useEffect(() => { load() }, [brand?.id])

  async function loadBanks() {
    setBanksStatus('loading')
    try {
      const res = await fetch('/api/banks')
      if (!res.ok) throw new Error('banks')
      // Popular banks first (Access, GTBank, UBA, Zenith, Sterling, Jaiz, OPay, PalmPay, Moniepoint...), then A-Z.
      setBanks(rankBanks(await res.json()))
      setBanksStatus('ready')
    } catch {
      setBanksStatus('error')
    }
  }
  useEffect(() => { loadBanks() }, [])

  // Load identity + accounts when the withdraw dialog opens.
  useEffect(() => { if (showWithdraw) payouts.load() }, [showWithdraw, payouts])
  // Keep a valid account selected: the one already chosen, else the default, else the first.
  useEffect(() => {
    const list = payoutState.accounts
    if (list.length === 0) { setSelectedAccountId(''); return }
    if (!list.some((a) => a.id === selectedAccountId)) setSelectedAccountId((list.find((a) => a.isDefault) || list[0]).id)
  }, [payoutState.accounts, selectedAccountId])
  const savedAccount = payoutState.accounts.find((a) => a.id === selectedAccountId) || null
  const typedAllowed = !payoutState.required
  const typedMode = !savedAccount || useTyped

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
        const { data: { session } } = await authClient.auth.getSession()
        const res = await fetch('/api/resolve-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ bankCode, accountNumber: acctNum }),
        })
        const data = await res.json()
        if (res.ok && data.accountName) {
          setWithdrawForm(prev => ({ ...prev, accountName: data.accountName }))
          setAccountResolved(true)
        } else if (data.unsupportedBank) {
          setAccountResolved(false)
          showToast(data.error || 'This bank does not support automatic verification. Please enter your account name manually.', { type: 'warning' })
        } else {
          setAccountResolved(false)
          showToast(data.error || data.detail || 'Could not verify account name.', { type: 'error' })
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
        walletRepository.getWallet(brand.id).catch(() => []),
        walletRepository.getTransactions(brand.id).catch(() => []),
        walletRepository.getWithdrawals(brand.id).catch(() => []),
      ])
      setWallet(Array.isArray(w) && w[0] ? w[0] : { available_balance: 0, held_balance: 0 })
      setTxs(Array.isArray(t) ? t : [])
      setWithdrawals(Array.isArray(wd) ? wd : [])
    } catch (e) { setWallet({ available_balance: 0, held_balance: 0 }) }
    setLoading(false)
  }

  const naira = (kobo) => `₦${((kobo || 0) / 100).toLocaleString()}`

  async function handleWithdraw() {
    if (!withdrawForm.amount || (typedMode && (!withdrawForm.bankName || !withdrawForm.bankCode || !withdrawForm.accountNumber || !withdrawForm.accountName))) {
      showToast('Fill in amount and bank details.', { type: 'warning' }); return
    }
    const amountKobo = Math.round(parseFloat(withdrawForm.amount) * 100)
    if (amountKobo > (wallet?.available_balance || 0)) {
      showToast('Amount exceeds available balance.', { type: 'warning' }); return
    }
    if (!/^\d{4,6}$/.test(withdrawPin)) {
      showToast('Enter your 4-6 digit withdrawal PIN.', { type: 'warning' }); return
    }
    setWithdrawing(true)
    try {
      const r = await startBusinessWithdrawal(typedMode
        ? { businessId: brand.id, amountKobo, bankCode: withdrawForm.bankCode, bankName: withdrawForm.bankName, accountNumber: withdrawForm.accountNumber, accountName: withdrawForm.accountName, pin: withdrawPin }
        : { businessId: brand.id, amountKobo, payoutAccountId: savedAccount.id, pin: withdrawPin })
      if (r.sessionExpired) { showToast('Please log in again.', { type: 'warning' }); setWithdrawing(false); return }
      if (r.networkError) { showToast('Network error.', { type: 'error' }); setWithdrawing(false); return }
      if (!r.ok) {
        if (r.data.needsPin) setNeedsPin(true)
        if (r.data.code === 'payout_account_required') payouts.load()
        showToast(withdrawalErrorMessage(r.data), { type: 'error' })
        setWithdrawPin('')
        setWithdrawing(false); return
      }
      setWithdrawForm({}); setWithdrawPin(''); setNeedsPin(false); setShowWithdraw(false); setAccountResolved(false)
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

  const filtered = filter === 'all' ? txs : txs.filter(t => (filter === 'booking_credit' ? t.type === 'booking_credit' || t.type === 'shop_credit' : t.type === filter))
  const totalReceived = txs.filter(t => t.type === 'booking_credit' || t.type === 'shop_credit' || t.type === 'release').reduce((s, t) => s + (t.amount || 0), 0)
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
        <StatCard icon={<ArrowUpCircle />} label="Pending Withdrawals" value={withdrawals.filter(w => w.status === 'reserved' || w.status === 'processing').length} sub="In progress" />
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
          { key: 'type', label: 'Type', sortable: true, render: r => <Pill label={TYPE_LABELS[r.type] || r.type} type={r.type === 'booking_credit' || r.type === 'shop_credit' || r.type === 'shop_release' || r.type === 'release' ? 'green' : r.type === 'refund' ? 'red' : r.type === 'withdrawal' ? 'amber' : 'gray'} /> },
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
              { key: 'status', label: 'Status', render: r => <Pill label={r.status} type={r.status === 'completed' ? 'green' : r.status === 'failed' || r.status === 'reversed' ? 'red' : r.status === 'refunded' ? 'gray' : 'amber'} /> },
            ]}
          />
        </>
      )}

      {showWithdraw && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <Card style={{ maxWidth: '480px', width: '100%', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: '16px', fontWeight: '800', color: navy, marginBottom: '12px' }}>Withdraw to Bank</div>
            <div style={{ fontSize: '12px', color: gray500, marginBottom: '16px' }}>Available: <strong style={{ color: success }}>{naira(wallet?.available_balance)}</strong></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Inp label="Amount (₦)" type="number" value={withdrawForm.amount || ''} onChange={v => setWithdrawForm(p => ({ ...p, amount: v }))} placeholder="e.g. 5000" min="1" max={Math.floor((wallet?.available_balance ?? 0) / 100)} required />
              {withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0) && (
                <span style={{ fontSize: '11px', color: danger, fontWeight: '700' }}>Amount exceeds available balance of {naira(wallet?.available_balance)}</span>
              )}
              <PayoutAccountsPanel
                manager={payouts}
                selectedId={selectedAccountId}
                onSelect={(id) => { setSelectedAccountId(id); setUseTyped(false) }}
                banks={banks}
                banksStatus={banksStatus}
                onRetryBanks={loadBanks}
              />
              {savedAccount && (
                <div style={{ fontSize: '12.5px', color: gray600, padding: '8px 12px', borderRadius: '12px', background: tealMist }}>
                  Paying to <strong>{savedAccount.bankName} ••••{savedAccount.accountLast4}</strong> — {savedAccount.accountName}
                  {typedAllowed && (
                    <button type="button" onClick={() => setUseTyped((v) => !v)} style={{ marginLeft: '8px', background: 'none', border: 'none', padding: 0, color: theme.tealDeep, fontWeight: 800, fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {useTyped ? 'Use saved account' : 'Use a different account'}
                    </button>
                  )}
                </div>
              )}
              {!savedAccount && !typedAllowed && (
                <span role="status" style={{ fontSize: '12.5px', color: danger, fontWeight: 700 }}>Add and verify a payout account above before you can withdraw.</span>
              )}
              {typedMode && typedAllowed && (
                <>
                <BankPicker
                  banks={banks}
                  status={banksStatus}
                  selectedCode={withdrawForm.bankCode || ''}
                  onSelect={(bank) => setWithdrawForm(p => ({ ...p, bankCode: bank ? bank.code : '', bankName: bank ? bank.name : '' }))}
                  onRetry={loadBanks}
                />
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
                  {!accountResolved && !accountResolving && withdrawForm.bankCode && (withdrawForm.accountNumber || '').length === 10 && (
                    <span style={{ fontSize: '11px', color: warning, fontWeight: '700' }}>Automatic verification unavailable for this bank. Please enter your account name manually.</span>
                  )}
                </div>
                </>
              )}
              <WithdrawalPinField pin={withdrawPin} onPinChange={setWithdrawPin} needsPin={needsPin} disabled={withdrawing} />
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <GhostBtn onClick={() => { setShowWithdraw(false); setAccountResolved(false); setWithdrawForm({}); setWithdrawPin(''); setNeedsPin(false) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
                <TealBtn onClick={handleWithdraw} disabled={withdrawing || !/^\d{4,6}$/.test(withdrawPin) || !(typedMode ? (typedAllowed && (accountResolved || withdrawForm.accountName)) : savedAccount) || (withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0))} style={{ flex: 1, padding: '12px', opacity: (withdrawing || !/^\d{4,6}$/.test(withdrawPin) || !(typedMode ? (typedAllowed && (accountResolved || withdrawForm.accountName)) : savedAccount) || (withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0))) ? 0.6 : 1 }}>{withdrawing ? 'Withdrawing...' : 'Withdraw'}</TealBtn>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

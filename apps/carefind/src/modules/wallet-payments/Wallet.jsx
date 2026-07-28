import { useEffect, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient.js'
import { useAuth } from '../../providers/AuthContext.jsx'
import { ArrowLeft, Banknote, Coins, Gift, Landmark, RotateCcw, Wallet as WalletIcon } from 'lucide-react'
import { theme } from '../../styles/theme.js'
import { useBreakpoint } from '../../hooks/useBreakpoint.js'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity.js'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Inp, Loading, Toast, useToast } from '../../components/ui/index.jsx'

const WITHDRAWAL_FEE_RATE = 0.2

const WITHDRAWAL_ERRORS = {
  not_logged_in: 'Please log in again.',
  below_minimum: 'Minimum withdrawal is 5 CareCoins.',
  missing_bank_details: 'Please fill in all bank details.',
  insufficient: "You don't have enough CareCoins for that amount.",
}

const COIN_VALUE_NAIRA = 200
const TOPUP_PACKAGES = [
  { coins: 1, naira: 200, label: 'Starter' },
  { coins: 5, naira: 950, label: 'Popular', savings: 50 },
  { coins: 15, naira: 2700, label: 'Value', savings: 300 },
  { coins: 50, naira: 8500, label: 'Pro', savings: 1500 },
]

function Wallet() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  const [wallet, setWallet] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('wallet')
  const [searchParams] = useSearchParams()
  const [wdAmount, setWdAmount] = useState('')
  const [wdBankName, setWdBankName] = useState('')
  const [wdAccountNumber, setWdAccountNumber] = useState('')
  const [wdAccountName, setWdAccountName] = useState('')
  const [wdSubmitting, setWdSubmitting] = useState(false)

  // Handle return from Paystack redirect. The wallet is credited server-side
  // in /api/verify-payment, which asks Paystack to confirm the charge before
  // crediting anything — this used to trust whatever `coins`/`naira` numbers
  // were sitting in the URL, which meant anyone could hand-edit the address
  // bar to credit themselves for free. Only `reference` (an opaque lookup
  // key, not an amount) comes from the URL now.
  useEffect(() => {
    async function handlePaystackReturn() {
      const ref = searchParams.get('reference') || searchParams.get('trxref')
      if (!ref || !user) return

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      try {
        const response = await fetch('/api/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ reference: ref }),
        })
        const data = await response.json()
        window.history.replaceState({}, '', '/wallet')

        if (!response.ok) {
          showToast(`Could not confirm payment: ${data.error || 'unknown error'}`, { type: 'error' })
          return
        }
        if (data.alreadyProcessed) return

        const { data: freshWallet } = await supabase
          .from('wallets').select('balance').eq('user_id', user.id).maybeSingle()
        setWallet((prev) => ({ ...(prev || {}), balance: freshWallet?.balance ?? data.newBalance }))

        const { data: txData } = await supabase
          .from('transactions').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(20)
        setTransactions(txData || [])

        setTab('history')
        showToast(`${data.credited} CareCoin${data.credited > 1 ? 's' : ''} added! New balance: ${data.newBalance} coins`, { type: 'success' })
      } catch (err) {
        window.history.replaceState({}, '', '/wallet')
        showToast('Could not confirm payment. If you were charged, contact support with your reference.', { type: 'error' })
      }
    }
    if (!authLoading && user) handlePaystackReturn()
  }, [searchParams, user, authLoading])

  useEffect(() => {
    async function load() {
      if (!user) { setLoading(false); return }
      setLoading(true)

      let { data: walletData } = await supabase
        .from('wallets').select('*').eq('user_id', user.id).maybeSingle()

      if (!walletData) {
        const { data: newWallet } = await supabase
          .from('wallets').insert({ user_id: user.id, balance: 0 }).select().single()
        walletData = newWallet
      }
      setWallet(walletData)

      const { data: txData } = await supabase
        .from('transactions').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(20)
      setTransactions(txData || [])
      setLoading(false)
    }
    if (!authLoading) load()
  }, [user, authLoading])

  async function handleTopUp(pkg) {
    if (!user) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { showToast('Please log in again.', { type: 'error' }); return }

    try {
      const response = await fetch('/api/initiate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          // packageId, not an amount — the server looks up the real price
          // itself so a tampered request can't buy coins below cost.
          packageId: pkg.coins,
          callback_url: `${window.location.origin}/wallet`,
        }),
      })

      const data = await response.json()

      if (data.authorization_url) {
        window.location.href = data.authorization_url
      } else {
        showToast(`Payment error: ${data.error || 'Could not initialize payment'}`, { type: 'error' })
      }
    } catch (err) {
      showToast('Network error. Please check your connection and try again.', { type: 'error' })
    }
  }

  async function handleWithdraw(e) {
    e.preventDefault()
    setWdSubmitting(true)
    const { data, error } = await supabase.rpc('request_withdrawal', {
      p_amount: parseInt(wdAmount, 10),
      p_bank_name: wdBankName.trim(),
      p_account_number: wdAccountNumber.trim(),
      p_account_name: wdAccountName.trim(),
    })
    setWdSubmitting(false)

    if (error) { showToast('Could not submit withdrawal request. Please try again.', { type: 'error' }); return }
    if (data !== 'ok') { showToast(WITHDRAWAL_ERRORS[data] || 'Could not submit withdrawal request.', { type: 'warning' }); return }

    setWdAmount(''); setWdBankName(''); setWdAccountNumber(''); setWdAccountName('')
    const { data: freshWallet } = await supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle()
    setWallet((prev) => ({ ...(prev || {}), balance: freshWallet?.balance ?? prev?.balance }))
    const { data: txData } = await supabase
      .from('transactions').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(20)
    setTransactions(txData || [])
    setTab('history')
    showToast('Withdrawal requested — it will be reviewed and paid out within 1-3 business days.', { type: 'success' })
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  // Each transaction kind gets a distinct icon and a semantic colour, so a
  // ledger can be scanned without reading every row (SCREEN_PATTERNS.md 20).
  const TX_KIND = {
    topup:             { Icon: Coins,     tint: theme.success },
    gift_sent:         { Icon: Gift,      tint: theme.gray500 },
    gift_received:     { Icon: Banknote,  tint: theme.success },
    withdrawal:        { Icon: Landmark,  tint: theme.gray500 },
    withdrawal_refund: { Icon: RotateCcw, tint: theme.warning },
  }
  const txKind = (type) => TX_KIND[type] || { Icon: WalletIcon, tint: theme.gray500 }
  const isCredit = (type) => type === 'topup' || type === 'gift_received' || type === 'withdrawal_refund'

  if (authLoading || loading) return <Loading />

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: theme.fontFamily, maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to access your wallet.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 90 }
      : { fontFamily: theme.fontFamily, maxWidth: 640, margin: '0 auto' }}>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
      <div style={{
        background: theme.navy, color: '#fff',
        ...(isMobile ? { padding: '22px 20px 30px 20px', borderRadius: '0 0 28px 28px' } : { padding: '24px 26px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        {isMobile && (
          <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            <ArrowLeft size={15} aria-hidden="true" /> Profile
          </Link>
        )}
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 21, fontWeight: 900, margin: isMobile ? '14px 0 4px 0' : '0 0 4px 0' }}>
          <WalletIcon size={21} aria-hidden="true" /> My wallet
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 20px 0' }}>CareCoins — 1 coin = ₦{COIN_VALUE_NAIRA}</p>
        <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 20, padding: 20, textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>BALANCE</p>
          <p style={{ margin: '0 0 4px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 42, fontWeight: 900 }}>
            <Coins size={30} aria-hidden="true" /> {wallet?.balance || 0}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
            ≈ ₦{((wallet?.balance || 0) * COIN_VALUE_NAIRA).toLocaleString()}
          </p>
        </div>
      </div>

      <div style={isMobile ? { padding: '20px 20px 0 20px' } : {}}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {['wallet', 'history', 'withdraw'].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: 9, borderRadius: 12, border: tab === t ? 'none' : `1px solid ${theme.border}`,
              background: tab === t ? theme.tealDeep : theme.bg,
              color: tab === t ? '#fff' : theme.textMid, fontWeight: 700, fontSize: 13,
            }}>
              {t === 'wallet' ? 'Top Up' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'wallet' && (
          <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: 10 } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>
              Choose a package
            </p>
            {TOPUP_PACKAGES.map((pkg) => (
              <button
                key={pkg.coins}
                onClick={() => handleTopUp(pkg)}
                style={{
                  border: `1px solid ${theme.border}`, borderRadius: 16, padding: '16px 14px',
                  background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  textAlign: 'left', width: '100%',
                }}
              >
                <div>
                  <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 15, color: theme.navy }}>
                    <Coins size={15} color={theme.tealDeep} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 7 }} />{pkg.coins} CareCoin{pkg.coins > 1 ? 's' : ''} — {pkg.label}
                  </p>
                  {pkg.savings && (
                    <p style={{ margin: 0, fontSize: 11, color: theme.success, fontWeight: 700 }}>Save ₦{pkg.savings.toLocaleString()}</p>
                  )}
                </div>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: theme.tealDeep }}>
                  ₦{pkg.naira.toLocaleString()}
                </p>
              </button>
            ))}
            <p style={{ fontSize: 11, color: theme.textLight, textAlign: 'center', marginTop: 4 }}>
              Tapping a package will open Paystack to complete payment
            </p>
          </div>
        )}

        {tab === 'history' && (
          <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: 10 } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {transactions.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <Coins size={40} color={theme.gray300} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <p style={{ color: theme.gray500, fontSize: 13 }}>No transactions yet</p>
              </div>
            )}
            {transactions.map((tx) => (
              <div key={tx.id} style={{
                border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {(() => {
                    const { Icon, tint } = txKind(tx.type)
                    return (
                      <span style={{
                        width: 36, height: 36, borderRadius: theme.radius.md, flexShrink: 0,
                        background: theme.gray50, color: tint,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}><Icon size={18} aria-hidden="true" /></span>
                    )
                  })()}
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontSize: 13.5, fontWeight: 700, color: theme.navy, textTransform: 'capitalize' }}>
                      {tx.type.replace('_', ' ')}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(tx.created_at)}</p>
                  </div>
                </div>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 14, color: isCredit(tx.type) ? theme.success : theme.alert }}>
                  {isCredit(tx.type) ? '+' : '-'}{tx.amount} <Coins size={13} aria-label="CareCoins" style={{ verticalAlign: '-2px' }} />
                </p>
              </div>
            ))}
          </div>
        )}

        {tab === 'withdraw' && (
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 16, background: theme.cardBg }}>
            <p style={{ fontSize: 13, color: theme.textMid, lineHeight: 1.6, margin: '0 0 12px 0' }}>
              Withdraw your earned CareCoins as naira to your bank account.
              Minimum: <strong>5 CareCoins (₦800 after 20% platform fee)</strong>.
            </p>
            <p style={{ fontSize: 13, color: theme.textMid, margin: '0 0 16px 0' }}>
              Your balance: <strong>{wallet?.balance || 0} CareCoins</strong>
            </p>
            {(wallet?.balance || 0) >= 5 ? (
              <form onSubmit={handleWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Inp
                  label="Amount to withdraw (CareCoins)"
                  type="number"
                  value={wdAmount}
                  onChange={setWdAmount}
                  placeholder={`5–${wallet.balance}`}
                  min={5}
                  required
                />
                {wdAmount >= 5 && (
                  <p style={{ margin: '-4px 0 0 0', fontSize: 12, color: theme.textLight }}>
                    You'll receive ≈ ₦{Math.floor(wdAmount * COIN_VALUE_NAIRA * (1 - WITHDRAWAL_FEE_RATE)).toLocaleString()} after the 20% platform fee
                  </p>
                )}
                <Inp label="Bank name" value={wdBankName} onChange={setWdBankName} placeholder="e.g. GTBank" required />
                <Inp label="Account number" value={wdAccountNumber} onChange={setWdAccountNumber} placeholder="0123456789" required />
                <Inp label="Account name" value={wdAccountName} onChange={setWdAccountName} placeholder="As it appears on your bank account" required />
                <button
                  type="submit"
                  disabled={wdSubmitting || !wdAmount || wdAmount < 5 || wdAmount > wallet.balance}
                  style={{
                    width: '100%', padding: 13, background: theme.tealDeep, color: '#fff',
                    border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 14,
                    opacity: (wdSubmitting || !wdAmount || wdAmount < 5 || wdAmount > wallet.balance) ? 0.6 : 1,
                  }}
                >
                  {wdSubmitting ? 'Submitting…' : 'Request Withdrawal'}
                </button>
              </form>
            ) : (
              <p style={{ color: theme.textLight, fontSize: 13, textAlign: 'center' }}>
                You need at least 5 CareCoins to withdraw.
              </p>
            )}
            <p style={{ fontSize: 11, color: theme.textLight, marginTop: 10, textAlign: 'center' }}>
              Withdrawals processed within 1-3 business days
            </p>
          </div>
        )}
      </div>
      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
      {bodyContent}
    </AppShell>
  )
}

export default Wallet

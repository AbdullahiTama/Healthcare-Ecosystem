import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'

const COIN_VALUE_NAIRA = 200
const TOPUP_PACKAGES = [
  { coins: 1, naira: 200, label: 'Starter' },
  { coins: 5, naira: 950, label: 'Popular', savings: 50 },
  { coins: 15, naira: 2700, label: 'Value', savings: 300 },
  { coins: 50, naira: 8500, label: 'Pro', savings: 1500 },
]

function Wallet() {
  const { user, loading: authLoading } = useAuth()
  const [wallet, setWallet] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('wallet')
  const [searchParams] = useSearchParams()

  // Handle return from Paystack redirect
  useEffect(() => {
    async function handlePaystackReturn() {
      const ref = searchParams.get('reference')
      const coins = searchParams.get('coins')
      const naira = searchParams.get('naira')

      if (ref && coins && user) {
        // Check if already processed
        const { data: existing } = await supabase
          .from('transactions')
          .select('id')
          .eq('reference', ref)
          .maybeSingle()

        if (!existing) {
          const newCoins = parseInt(coins)

          // Get fresh wallet balance from DB
          const { data: freshWallet } = await supabase
            .from('wallets')
            .select('balance')
            .eq('user_id', user.id)
            .maybeSingle()

          const currentBalance = freshWallet?.balance || 0
          const newBalance = currentBalance + newCoins

          await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', user.id)
          await supabase.from('transactions').insert({
            user_id: user.id, type: 'topup', amount: newCoins,
            naira_amount: parseInt(naira) * 100, reference: ref, status: 'success',
          })

          // Reload wallet and transactions
          setWallet((prev) => ({ ...(prev || {}), balance: newBalance }))

          const { data: txData } = await supabase
            .from('transactions').select('*').eq('user_id', user.id)
            .order('created_at', { ascending: false }).limit(20)
          setTransactions(txData || [])

          setTab('history')
          window.history.replaceState({}, '', '/wallet')
          alert(`✅ ${newCoins} CareCoin${newCoins > 1 ? 's' : ''} added! New balance: ${newBalance} coins`)
        } else {
          // Already processed — just clean the URL
          window.history.replaceState({}, '', '/wallet')
        }
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
    const ref = `cf_${user.id.slice(0, 8)}_${Date.now()}`
    const callbackUrl = `${window.location.origin}/wallet?reference=${ref}&coins=${pkg.coins}&naira=${pkg.naira}`

    try {
      const response = await fetch('/api/initiate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          amount: pkg.naira * 100,
          ref,
          callback_url: callbackUrl,
        }),
      })

      const data = await response.json()

      if (data.authorization_url) {
        window.location.href = data.authorization_url
      } else {
        alert(`Payment error: ${data.error || 'Could not initialize payment'}`)
      }
    } catch (err) {
      alert('Network error. Please check your connection and try again.')
    }
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  const txIcon = (type) => ({ topup: '🪙', gift_sent: '🎁', gift_received: '💰', withdrawal: '🏦' }[type] || '💳')

  if (authLoading || loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to access your wallet.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{ background: theme.heroGradient, padding: '22px 20px 30px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: '14px 0 4px 0' }}>My Wallet</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 20px 0' }}>CareCoins — 1 coin = ₦{COIN_VALUE_NAIRA}</p>
        <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 20, padding: 20, textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>BALANCE</p>
          <p style={{ margin: '0 0 4px 0', fontSize: 42, fontWeight: 900 }}>🪙 {wallet?.balance || 0}</p>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
            ≈ ₦{((wallet?.balance || 0) * COIN_VALUE_NAIRA).toLocaleString()}
          </p>
        </div>
      </div>

      <div style={{ padding: '20px 20px 0 20px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {['wallet', 'history', 'withdraw'].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: 9, borderRadius: 12, border: tab === t ? 'none' : `1px solid ${theme.border}`,
              background: tab === t ? theme.tealGradient : theme.bg,
              color: tab === t ? '#fff' : theme.textMid, fontWeight: 700, fontSize: 13,
            }}>
              {t === 'wallet' ? 'Top Up' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'wallet' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                    🪙 {pkg.coins} CareCoin{pkg.coins > 1 ? 's' : ''} — {pkg.label}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {transactions.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                <div style={{ fontSize: 26, marginBottom: 10 }}>🪙</div>
                <p style={{ color: theme.textLight, fontSize: 13 }}>No transactions yet</p>
              </div>
            )}
            {transactions.map((tx) => (
              <div key={tx.id} style={{
                border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{txIcon(tx.type)}</span>
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontSize: 13.5, fontWeight: 700, color: theme.navy, textTransform: 'capitalize' }}>
                      {tx.type.replace('_', ' ')}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(tx.created_at)}</p>
                  </div>
                </div>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 14, color: tx.type === 'topup' || tx.type === 'gift_received' ? theme.success : theme.alert }}>
                  {tx.type === 'topup' || tx.type === 'gift_received' ? '+' : '-'}{tx.amount} 🪙
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
              Your balance: <strong>🪙 {wallet?.balance || 0} CareCoins</strong>
            </p>
            {(wallet?.balance || 0) >= 5 ? (
              <button style={{
                width: '100%', padding: 13, background: theme.tealGradient, color: '#fff',
                border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 14,
              }}>
                Request Withdrawal
              </button>
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
      <BottomNav />
    </div>
  )
}

export default Wallet

import { theme } from '../../../styles/theme'
import { Card, Button, Empty, StatCard } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, AdminSection } from '../ui'
import { DollarSign, TrendingUp, Download, ArrowUpRight, Coins } from 'lucide-react'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function exportCSV(data, filename) {
  if (!data.length) return
  const keys = Object.keys(data[0])
  const csv = [keys.join(','), ...data.map(row => keys.map(k => `"${(row[k] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
}

export default function RevenueTab({ transactions }) {
  const totalRevenue = transactions
    .filter(t => t.type === 'topup')
    .reduce((s, t) => s + (t.naira_amount || 0), 0) / 100

  const topupCount = transactions.filter(t => t.type === 'topup').length
  const withdrawalCount = transactions.filter(t => t.type === 'withdrawal').length

  return (
    <div>
      <AdminPageHeader
        title="Revenue"
        subtitle="Transaction history and financial overview"
      >
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Download size={14} />}
          onClick={() => exportCSV(transactions, 'transactions.csv')}
        >
          Export CSV
        </Button>
      </AdminPageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: theme.space[4], marginBottom: theme.space[6] }}>
        <StatCard
          icon={<DollarSign size={20} />}
          label="Total Revenue"
          value={`₦${totalRevenue.toLocaleString()}`}
          sub="All top-ups"
          tone="teal"
        />
        <StatCard
          icon={<TrendingUp size={20} />}
          label="Top-ups"
          value={topupCount}
          sub="Transactions"
          tone="green"
        />
        <StatCard
          icon={<ArrowUpRight size={20} />}
          label="Withdrawals"
          value={withdrawalCount}
          sub="Requests"
          tone="amber"
        />
      </div>

      <AdminSection title="Transactions" subtitle={`${transactions.length} total`}>
        {transactions.length === 0 ? (
          <Empty
            icon={<Coins size={40} strokeWidth={1.5} />}
            message="No transactions yet"
            cause="none"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
            {transactions.map(t => (
              <Card
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: theme.space[5],
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[4] }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: theme.radius.md,
                    background: t.type === 'topup' ? theme.successBg : theme.dangerBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {t.type === 'topup'
                      ? <TrendingUp size={18} color={theme.success} />
                      : <ArrowUpRight size={18} color={theme.danger} />
                    }
                  </div>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: theme.type.body.size, color: theme.textDark, textTransform: 'capitalize' }}>
                      {t.type?.replace('_', ' ')}
                    </p>
                    <p style={{ margin: 0, fontSize: theme.type.caption.size, color: theme.textLight }}>
                      {timeAgo(t.created_at)}
                    </p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '0 0 2px 0', fontWeight: 900, fontSize: 14, color: theme.success }}>
                    {t.amount} <Coins size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />
                  </p>
                  {t.naira_amount && (
                    <p style={{ margin: 0, fontSize: theme.type.caption.size, color: theme.textLight }}>
                      ₦{(t.naira_amount / 100).toLocaleString()}
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </AdminSection>
    </div>
  )
}

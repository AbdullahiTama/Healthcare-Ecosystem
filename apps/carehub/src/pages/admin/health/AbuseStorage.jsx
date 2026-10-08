import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, HardDrive, ShieldAlert } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { createHealthRepository } from '../../../modules/health/repositories'

export default function AbuseStorage({ repository = createHealthRepository() }) {
  const [storageInfo, setStorageInfo] = useState([
    { bucket: 'credentials', used: '—', limit: '5 MB', visibility: 'private', note: 'Hardened 20260822 — MIME whitelist + folder-scoped policies' },
    { bucket: 'live-media', used: '—', limit: '—', visibility: 'public', note: 'Trailers + live items' },
    { bucket: 'promo-images', used: '—', limit: '—', visibility: 'public', note: 'Promotions' },
    { bucket: 'adr-evidence', used: '—', limit: '—', visibility: '—', note: 'ADR photos + hospital attachments' },
  ])
  const [loading, setLoading] = useState(false)
  const { msg, type, show: showToast } = useToast()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><ShieldAlert size={14} /> Abuse & Storage <span style={{ fontSize: 11, background: 'var(--hairline)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6 }}>read-only MVP</span></div>
        <GhostBtn onClick={() => showToast('Storage check: query storage.buckets via service-role to fill used/size', { type: 'info' })}><RefreshCw size={12} style={{ marginRight: 6 }} />Check</GhostBtn>
      </Card>

      <Card style={{ padding: 14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--fg)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><HardDrive size={12} /> Buckets</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
          {storageInfo.map(b => (
            <div key={b.bucket} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--hairline)' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{b.bucket}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.visibility} • limit {b.limit} • used {b.used}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{b.note}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>MVP is inventory + guidance. Next: wire `storage.buckets` read via admin-auth proxy, orphans: `storage.objects` where `business_id` orphaned, rate: top RPM from `postgres_logs`.</div>
      </Card>

      <Card style={{ padding: 14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--fg)', marginBottom: 8 }}>Rate limits (next)</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: 10, border: '1px dashed var(--border)', borderRadius: 10, textAlign: 'center' }}>Top 10 RPM last hour from <code>postgres_logs</code> + Throttle/Block — ships after H2/H3; audit-only for now.</div>
      </Card>
      <Toast msg={msg} type={type} />
    </div>
  )
}

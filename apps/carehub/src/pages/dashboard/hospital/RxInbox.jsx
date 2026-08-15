import { useState, useEffect } from 'react'
import { ArrowLeft, Pill as PillIcon, RefreshCw, Bell, CheckCircle, ClipboardList, AlertTriangle, Check } from 'lucide-react'
import { getPrescriptions, updatePrescription, updatePatient } from '../../../services/supabase'
import { fmt } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { Card, StatCard, SectionHead, Pill, TealBtn, GhostBtn, Avatar, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, dangerBg, success, successBg, bg } = theme

export default function RxInbox({ brand, products }) {
  const [prescriptions, setPrescriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState(null)
  const [dispensing, setDispensing] = useState(false)
  const { msg, show: showToast } = useToast()

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [brand?.id])

  async function load() {
    try { const p = await getPrescriptions(brand.id); setPrescriptions(p || []); setLoadError('') } catch (e) { setLoadError('Could not load prescriptions. Check your connection and try again.') }
    setLoading(false)
  }

  async function markDispensed(rx) {
    setDispensing(true)
    try {
      await updatePrescription(rx.id, { status: 'dispensed' })
      if (rx.patient_id) await updatePatient(rx.patient_id, { status: 'discharged' })
      showToast('Prescription dispensed! Patient discharged.')
      load(); setSelected(null)
    } catch (e) { showToast('Error. Please try again.') }
    setDispensing(false)
  }

  const pending = prescriptions.filter(p => p.status === 'pending')
  const dispensed = prescriptions.filter(p => p.status === 'dispensed')

  if (selected) {
    let meds = []
    try { meds = JSON.parse(selected.medicines || '[]') } catch (e) {}
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <button onClick={() => setSelected(null)} aria-label='Back' style={{ width: '38px', height: '38px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: navy, flexShrink: 0 }}><ArrowLeft size={16} /></button>
          <div><div style={{ fontWeight: '900', fontSize: '18px', color: navy }}>Prescription Details</div><div style={{ fontSize: '12px', color: gray400 }}>Patient: {selected.patient_name}</div></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '12px', color: tealDeep, fontWeight: '600', marginBottom: '14px' }}>
          <PillIcon size={14} /> Pharmacy — Prescription received from Doctor
        </div>
        <Card style={{ padding: '16px', marginBottom: '14px', background: bg }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '8px' }}>Prescription Info</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {[['Patient', selected.patient_name], ['Doctor', selected.doctor_name || '—'], ['Date', selected.created_at?.split('T')[0] || '—'], ['Status', selected.status]].map(([l, v]) => (
              <div key={l}><div style={{ fontSize: '10px', color: gray400, fontWeight: '700' }}>{l}</div><div style={{ fontSize: '12px', fontWeight: '600', color: navy }}>{v}</div></div>
            ))}
          </div>
        </Card>
        <Card style={{ padding: '16px', marginBottom: '14px' }}>
          <div style={{ fontSize: '14px', fontWeight: '800', marginBottom: '12px', color: navy }}>Prescribed Medicines ({meds.length})</div>
          {meds.length === 0 ? <div style={{ color: gray400, fontSize: '13px' }}>No medicines prescribed</div>
            : meds.map((med, i) => {
              const stockItem = (products || []).find(p => p.id === med.id || p.name === med.name)
              return (
                <div key={i} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, marginBottom: '8px', background: bg }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: '700', fontSize: '14px', marginBottom: '6px', color: navy }}><PillIcon size={15} color={tealDeep} /> {med.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '6px' }}>
                    {[['Dose', med.dose], ['Frequency', med.freq], ['Duration', med.dur], ['Route', med.route]].filter(([, v]) => v).map(([l, v]) => (
                      <div key={l} style={{ fontSize: '12px', color: navy }}><span style={{ color: gray500, fontWeight: '600' }}>{l}: </span><span>{v}</span></div>
                    ))}
                  </div>
                  {med.instructions && <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: gray600, padding: '6px 8px', borderRadius: theme.radius.sm, background: 'white', border: `1px solid ${border}` }}><ClipboardList size={12} /> {med.instructions}</div>}
                  {stockItem && stockItem.stock <= 0 && <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', padding: '6px 8px', borderRadius: theme.radius.sm, background: dangerBg, fontSize: '12px', color: danger, fontWeight: '700' }}><AlertTriangle size={12} /> OUT OF STOCK — Please inform doctor</div>}
                  {stockItem && stockItem.stock > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '11px', color: success }}><Check size={11} /> {stockItem.stock} units in stock</div>}
                </div>
              )
            })}
        </Card>
        {selected.lab_tests && <Card style={{ padding: '16px', marginBottom: '14px' }}><div style={{ fontSize: '14px', fontWeight: '800', marginBottom: '8px', color: navy }}>Lab Tests</div><div style={{ fontSize: '13px', color: gray600 }}>{selected.lab_tests}</div></Card>}
        {selected.imaging && <Card style={{ padding: '16px', marginBottom: '14px' }}><div style={{ fontSize: '14px', fontWeight: '800', marginBottom: '8px', color: navy }}>Imaging</div><div style={{ fontSize: '13px', color: gray600 }}>{selected.imaging}</div></Card>}
        {selected.notes && <Card style={{ padding: '16px', marginBottom: '14px' }}><div style={{ fontSize: '14px', fontWeight: '800', marginBottom: '8px', color: navy }}>Doctor Notes</div><div style={{ fontSize: '13px', color: gray600 }}>{selected.notes}</div></Card>}
        {selected.status === 'pending' ? (
          <button onClick={() => markDispensed(selected)} disabled={dispensing}
            style={{ width: '100%', padding: '14px', borderRadius: theme.radius.md, border: 'none', background: dispensing ? theme.gray200 : tealDeep, color: dispensing ? gray400 : 'white', fontWeight: '800', fontSize: '15px', cursor: dispensing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            {dispensing ? 'Saving...' : <><CheckCircle size={16} /> Mark as Dispensed — Discharge Patient</>}
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '14px', borderRadius: theme.radius.md, background: successBg, border: `1px solid ${success}`, textAlign: 'center', fontSize: '14px', fontWeight: '700', color: success }}><CheckCircle size={15} /> Already Dispensed</div>
        )}
        <Toast msg={msg} />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div><div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Prescription Inbox</div><div style={{ fontSize: '13px', color: gray500, marginTop: '3px' }}>Prescriptions sent from doctors</div></div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '9px 16px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}><RefreshCw size={13} /> Refresh</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
        <StatCard icon={<PillIcon />} label='Pending Dispensing' value={pending.length} alert={pending.length > 0} />
        <StatCard icon={<CheckCircle />} label='Dispensed' value={dispensed.length} />
      </div>
      {pending.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '14px 18px', borderRadius: theme.radius.lg, background: tealMist, border: `1px solid ${tealMist}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Bell size={20} color={tealDeep} style={{ flexShrink: 0 }} />
          <div><div style={{ fontWeight: '700', color: tealDeep, fontSize: '14px' }}>{pending.length} prescription(s) waiting to be dispensed!</div><div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>{pending.map(p => p.patient_name).join(' · ')}</div></div>
        </div>
      )}
      {loading ? <Loading /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : prescriptions.length === 0 ? (
        <Empty icon={<PillIcon size={40} />} message='No prescriptions yet' />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {prescriptions.map(rx => {
            let medCount = 0; try { medCount = JSON.parse(rx.medicines || '[]').length } catch (e) {}
            return (
              <Card key={rx.id} style={{ padding: '16px', cursor: 'pointer', border: rx.status === 'pending' ? `1px solid ${tealDeep}` : `1px solid ${border}` }} onClick={() => setSelected(rx)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '44px', height: '44px', borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><PillIcon size={20} /></div>
                    <div>
                      <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{rx.patient_name}</div>
                      <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>Dr. {rx.doctor_name || 'Unknown'} · {medCount} medicine(s)</div>
                      <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>{rx.created_at?.split('T')[0]}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <Pill label={rx.status === 'pending' ? 'Pending' : 'Dispensed'} type={rx.status === 'pending' ? 'amber' : 'green'} />
                    <span style={{ fontSize: '12px', color: tealDeep, fontWeight: '600' }}>View →</span>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Toast msg={msg} />
    </div>
  )
}

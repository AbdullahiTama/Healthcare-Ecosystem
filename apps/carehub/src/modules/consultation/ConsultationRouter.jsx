import { Clipboard } from 'lucide-react'
import { Card } from '../../components/ui'

export default function ConsultationRouter({ brand, products }) {
  const bType = brand?.business_type || brand?.type || 'skincare'
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Clipboard size={40} /></div>
      <div style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px' }}>Consultations</div>
      <div style={{ fontSize: '14px', color: '#888' }}>Consultation forms for {bType} coming in the next update.</div>
    </div>
  )
}

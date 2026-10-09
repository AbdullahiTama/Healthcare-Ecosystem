import { useState } from 'react'
import { Phone, Navigation, MapPin, Share2, Flag, Mail, Globe, User, Clock, Plus } from 'lucide-react'
import { Modal, GhostBtn, TealBtn, Textarea, Pill } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { VerificationBadge, SourceBadge } from './BusinessBadges'
import { formatDistance } from '../services/distance'
import { safeWebsiteUrl } from '../services/normalize'

const { navy, gray500, gray600, border, tealDeep } = theme

function Row({ icon: Icon, label, children }) {
  if (!children) return null
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: `1px solid ${border}` }}>
      <Icon size={15} color={gray500} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden='true' />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: gray500, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 13, color: navy, wordBreak: 'break-word' }}>{children}</div>
      </div>
    </div>
  )
}

// One profile for Directory and Discovery. `onViewOnMap` is optional (the
// Discovery map passes it). `onReport` is optional too — when present the
// "Report incorrect information" action is offered.
export default function BusinessProfile({ business, categoryName, subcategoryName, onClose, onViewOnMap, onReport, onAdopt, onToast }) {
  const [reporting, setReporting] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [adopting, setAdopting] = useState(false)
  if (!business) return null
  const b = business
  const hasCoords = b.latitude != null && b.longitude != null
  const site = safeWebsiteUrl(b.website)
  const directions = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${b.latitude},${b.longitude}`
    : b.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([b.name, b.address, b.state].filter(Boolean).join(', '))}` : null

  async function share() {
    const text = [b.name, b.address, b.phone].filter(Boolean).join(' · ') + (hasCoords ? `\nhttps://www.openstreetmap.org/?mlat=${b.latitude}&mlon=${b.longitude}#map=18/${b.latitude}/${b.longitude}` : '')
    try {
      if (navigator.share) await navigator.share({ title: b.name, text })
      else { await navigator.clipboard.writeText(text); onToast && onToast('Copied to clipboard', { type: 'success' }) }
    } catch (e) { /* user dismissed the share sheet */ }
  }

  async function sendReport() {
    if (!note.trim()) return
    setSending(true)
    try {
      await onReport(b, note.trim())
      setReporting(false)
      setNote('')
      onToast && onToast('Thanks — the directory managers have been told.', { type: 'success' })
    } catch (e) {
      onToast && onToast('Could not send report: ' + e.message, { type: 'error' })
    }
    setSending(false)
  }

  const actionStyle = { padding: '10px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }

  return (
    <Modal show onClose={onClose} title={b.name}
      footer={<GhostBtn onClick={onClose}>Close</GhostBtn>}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <VerificationBadge status={b.verification_status} />
        {b.origin === 'platform' ? <Pill label='Platform registry' type='purple' /> : <SourceBadge source={b.data_source} />}
        {!b.is_active && <span style={{ fontSize: 11, fontWeight: 700, color: theme.danger }}>Inactive</span>}
      </div>
      <div style={{ fontSize: 13, color: gray600, marginBottom: 6 }}>
        {[categoryName, subcategoryName, b.business_type].filter(Boolean).join(' · ') || 'Uncategorised'}
      </div>
      {b.data_source === 'demo' && (
        <div role='note' style={{ padding: '8px 10px', borderRadius: 8, background: theme.dangerBg, color: theme.danger, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          DEMO DATA — this is not a real business.
        </div>
      )}

      <Row icon={MapPin} label='Address'>{[b.address, b.city, b.lga, b.state].filter(Boolean).join(', ')}</Row>
      <Row icon={Navigation} label='Distance from search location'>{b.distance_km != null ? formatDistance(b.distance_km) : null}</Row>
      <Row icon={Phone} label='Phone'>{b.phone}</Row>
      <Row icon={Mail} label='Email'>{b.email && <a href={`mailto:${b.email}`} style={{ color: tealDeep }}>{b.email}</a>}</Row>
      <Row icon={Globe} label='Website'>{site && <a href={site} target='_blank' rel='noopener noreferrer' style={{ color: tealDeep }}>{b.website}</a>}</Row>
      <Row icon={User} label='Contact person'>{b.contact_person}</Row>
      <Row icon={Clock} label='Opening hours'>{b.opening_hours}</Row>
      <Row icon={MapPin} label='Coordinates'>{hasCoords ? `${Number(b.latitude).toFixed(5)}, ${Number(b.longitude).toFixed(5)}` : 'No coordinates on file — not shown on the map.'}</Row>
      {b.description && <div style={{ fontSize: 13, color: navy, padding: '10px 0' }}>{b.description}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {b.phone && <a href={`tel:${b.phone.replace(/[^+\d]/g, '')}`} style={{ ...actionStyle, borderRadius: 10, border: `1px solid ${border}`, color: navy, fontWeight: 700, fontSize: 13 }}><Phone size={14} aria-hidden='true' /> Call</a>}
        {directions && <a href={directions} target='_blank' rel='noopener noreferrer' style={{ ...actionStyle, borderRadius: 10, border: `1px solid ${border}`, color: navy, fontWeight: 700, fontSize: 13 }}><Navigation size={14} aria-hidden='true' /> Directions</a>}
        {hasCoords && onViewOnMap && <GhostBtn onClick={() => onViewOnMap(b)} style={actionStyle}><MapPin size={14} aria-hidden='true' /> View on map</GhostBtn>}
        {onAdopt && b.origin === 'platform' && (
          <TealBtn disabled={adopting} style={actionStyle} onClick={async () => { setAdopting(true); try { await onAdopt(b) } finally { setAdopting(false) } }}>
            <Plus size={14} aria-hidden='true' /> {adopting ? 'Adding…' : 'Add to my directory'}
          </TealBtn>
        )}
        <GhostBtn onClick={share} style={actionStyle}><Share2 size={14} aria-hidden='true' /> Share</GhostBtn>
        {onReport && <GhostBtn onClick={() => setReporting(true)} style={actionStyle}><Flag size={14} aria-hidden='true' /> Report incorrect information</GhostBtn>}
      </div>

      {reporting && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` }}>
          <Textarea label='What is wrong?' value={note} onChange={setNote} rows={3} placeholder='e.g. This pharmacy has moved / the phone number is wrong' />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <TealBtn onClick={sendReport} disabled={sending || !note.trim()}>{sending ? 'Sending…' : 'Send report'}</TealBtn>
            <GhostBtn onClick={() => setReporting(false)}>Cancel</GhostBtn>
          </div>
        </div>
      )}
    </Modal>
  )
}

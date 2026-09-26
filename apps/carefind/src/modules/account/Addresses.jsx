import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { addressesRepository } from './addressesRepository'
import { theme } from '../../styles/theme'
import { Card, Button, Empty, Modal, ConfirmDialog, Loading } from '../../components/ui'
import { MapPin, Plus, Pencil, Trash2, ArrowLeft, Star } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import AddressForm from './AddressForm.jsx'

export default function Addresses() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const [addresses, setAddresses] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    loadAddresses()
  }, [user])

  async function loadAddresses() {
    try {
      setLoading(true)
      const data = await addressesRepository.list(user.id)
      setAddresses(data)
    } catch (err) {
      setError(err.message || 'Failed to load addresses')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(formData) {
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await addressesRepository.update(editing.id, formData)
      } else {
        await addressesRepository.create({ user_id: user.id, ...formData })
      }
      await loadAddresses()
      setModalOpen(false)
      setEditing(null)
    } catch (err) {
      setError(err.message || 'Failed to save address')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    setError('')
    try {
      await addressesRepository.remove(deleteId)
      await loadAddresses()
    } catch (err) {
      setError(err.message || 'Failed to delete address')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  async function handleSetDefault(id) {
    try {
      await addressesRepository.setDefault(id)
      await loadAddresses()
    } catch (err) {
      setError(err.message || 'Failed to set default')
    }
  }

  function openEdit(addr) {
    setEditing(addr)
    setModalOpen(true)
  }

  function openAdd() {
    setEditing(null)
    setModalOpen(true)
  }

  const bodyContent = (
    <div style={{ fontFamily: theme.fontFamily, maxWidth: isMobile ? 480 : 640, margin: '0 auto', padding: isMobile ? '24px 16px calc(90px + env(safe-area-inset-bottom)) 16px' : '24px 16px', paddingBottom: isMobile ? 'calc(90px + env(safe-area-inset-bottom))' : 24 }}>
      <button
        onClick={() => navigate(-1)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
          color: theme.tealDeep, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 16,
        }}
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 21, fontWeight: 900, color: theme.navy, margin: 0 }}>Saved Addresses</h1>
        <Button variant="primary" onClick={openAdd}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={16} /> Add Address
          </span>
        </Button>
      </div>

      {error && (
        <div role="alert" style={{ padding: 12, borderRadius: 8, background: theme.dangerBg, border: `1px solid ${theme.danger}`, color: theme.danger, fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <Loading text="Loading addresses..." />
      ) : addresses.length === 0 ? (
        <Empty
          icon={<MapPin size={48} />}
          title="No saved addresses"
          description="Add an address to speed up checkout"
          action="Add Address"
          onAction={openAdd}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {addresses.map((addr) => (
            <Card key={addr.id} style={{ padding: 16, position: 'relative', border: addr.is_default ? `2px solid ${theme.tealDeep}` : undefined }}>
              {addr.is_default && (
                <span style={{
                  position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: theme.tealDeep, color: '#fff', fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  <Star size={10} /> Default
                </span>
              )}
              <p style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>{addr.label}</p>
              <p style={{ margin: '0 0 2px 0', fontSize: 13, color: theme.textMid, lineHeight: 1.5 }}>{addr.street}</p>
              <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>{addr.city}, {addr.state}</p>
              {addr.postal_code && <p style={{ margin: '2px 0 0 0', fontSize: 12, color: theme.textLight }}>{addr.postal_code}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {!addr.is_default && (
                  <button
                    onClick={() => handleSetDefault(addr.id)}
                    style={{ background: 'none', border: 'none', color: theme.tealDeep, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    Set as default
                  </button>
                )}
                <button
                  onClick={() => openEdit(addr)}
                  style={{ background: 'none', border: 'none', color: theme.textMid, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Pencil size={12} /> Edit
                </button>
                <button
                  onClick={() => setDeleteId(addr.id)}
                  style={{ background: 'none', border: 'none', color: theme.danger, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal show={modalOpen} onClose={() => { setModalOpen(false); setEditing(null) }} title={editing ? 'Edit Address' : 'Add New Address'} sheet={isMobile}>
        <AddressForm
          initialData={editing}
          onSubmit={handleSave}
          onCancel={() => { setModalOpen(false); setEditing(null) }}
          saving={saving}
        />
      </Modal>

      <ConfirmDialog
        show={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete this address?"
        consequence="This address will be removed from your saved addresses. Existing orders will keep their original delivery address."
        confirmLabel="Delete"
      />

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return <AppShell user={user}>{bodyContent}</AppShell>
}

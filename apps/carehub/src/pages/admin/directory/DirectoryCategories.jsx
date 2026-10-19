import { useState, useEffect, useCallback } from 'react'
import { Button, Input, Select, Loading, Empty, ErrorState, Toast, useToast } from '../../../components/ui'
import { directoryRepository as repo } from '../../../modules/directory/repositories'

const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export default function DirectoryCategories() {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const [cats, setCats] = useState(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try { setCats(await repo.listCategories()) } catch (e) { setError(e.message || 'Could not load categories.') }
  }, [])
  useEffect(() => { load() }, [load])

  async function add() {
    const slug = slugify(name)
    if (!slug) { showToast('Enter a category name.', { type: 'warning' }); return }
    setSaving(true)
    try {
      await repo.saveCategory({ name: name.trim(), slug, parent_id: parentId || null, sort_order: 500 })
      setName(''); showToast('Category added', { type: 'success' }); load()
    } catch (e) {
      showToast(/duplicate|409/i.test(e.message) ? 'A category with that name already exists.' : 'Could not add: ' + e.message, { type: 'error' })
    } finally { setSaving(false) }
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!cats) return <Loading text="Loading categories..." />
  const tops = cats.filter((c) => !c.parent_id)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <Input label="New category or subcategory" value={name} onChange={setName} style={{ flex: '2 1 220px' }} />
        <Select label="Under" value={parentId} onChange={setParentId} placeholder="Top level" options={tops.map((c) => ({ value: c.id, label: c.name }))} style={{ flex: '1 1 200px' }} />
        <Button variant="primary" size="md" disabled={saving} onClick={add}>{saving ? 'Adding...' : 'Add'}</Button>
      </div>
      {tops.length === 0 ? <Empty title="No categories" /> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tops.map((c) => (
            <li key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel)', padding: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({c.slug})</span></div>
              {cats.filter((s) => s.parent_id === c.id).map((s) => <div key={s.id} style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 12 }}>{s.name}</div>)}
            </li>
          ))}
        </ul>
      )}
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Inbox, Clock, AlertTriangle, CheckCircle, UserCheck } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Inp, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { createOpsRepository } from '../../../modules/ops/repositories'

function PriorityDot({ p }) {
  const m = { urgent: 'var(--red)', high: 'var(--amber)', medium: 'var(--teal)', low: 'var(--gray)' }
  return <span style={{ width: 8, height: 8, borderRadius: 9999, background: m[p] || 'var(--gray)', display: 'inline-block' }} />
}
function slaTone(due) {
  if (!due) return 'var(--muted)'
  const left = new Date(due).getTime() - Date.now()
  if (left < 0) return 'var(--red)'
  if (left < 4 * 3600000) return 'var(--amber)'
  return 'var(--muted)'
}

export default function SupportInbox({ repository = createOpsRepository() }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newTicket, setNewTicket] = useState({ subject: '', body: '', priority: 'medium' })
  const [busy, setBusy] = useState(false)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getTickets({ status: statusFilter || undefined, priority: priorityFilter || undefined, limit: 50 })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository, statusFilter, priorityFilter])
  useEffect(() => { load() }, [load])

  const filtered = (() => {
    let list = Array.isArray(rows) ? rows : []
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => `${r.subject} ${r.body} ${r.business_id}`.toLowerCase().includes(q))
    }
    return list
  })()

  const openTicket = async (t) => {
    setSelected(t)
    try {
      const msgs = await repository.getMessages(t.id)
      setMessages(Array.isArray(msgs) ? msgs : [])
    } catch { setMessages([]) }
  }

  const handleCreate = async () => {
    if (!newTicket.subject.trim() || !newTicket.body.trim()) { showToast('Subject/body required', { type: 'error' }); return }
    setBusy(true)
    try {
      await repository.createTicket({ subject: newTicket.subject.trim(), body: newTicket.body.trim(), priority: newTicket.priority })
      showToast('Ticket created', { type: 'success' }); setShowNew(false); setNewTicket({ subject: '', body: '', priority: 'medium' }); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const handleAssign = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await repository.updateTicket(selected.id, { status: 'triaged', assignee_admin_id: selected.assignee_admin_id || null })
      showToast('Triaged', { type: 'success' }); load(); setSelected(null)
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const handleResolve = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await repository.updateTicket(selected.id, { status: 'resolved' })
      showToast('Resolved', { type: 'success' }); load(); setSelected(null)
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const handleAddMessage = async () => {
    if (!selected || !newMsg.trim()) return
    setBusy(true)
    try {
      await repository.addMessage(selected.id, newMsg.trim(), null)
      setNewMsg(''); const msgs = await repository.getMessages(selected.id); setMessages(Array.isArray(msgs) ? msgs : [])
      showToast('Message added', { type: 'success' })
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  if (loading && rows == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search subject / business" aria-label="Search inbox" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter status" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="open">open</option>
            <option value="triaged">triaged</option>
            <option value="waiting">waiting</option>
            <option value="resolved">resolved</option>
            <option value="closed">closed</option>
            <option value="">all</option>
          </select>
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} aria-label="Filter priority" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="">All priorities</option>
            <option value="urgent">urgent</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} tickets</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
          <TealBtn onClick={() => setShowNew(true)}>+ New ticket</TealBtn>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Inbox size={28} />} message={search ? 'No tickets match search.' : `No ${statusFilter || 'all'} tickets.`} /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ borderBottom: '1px solid var(--border)' }}><tr style={{ height: 36 }}>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Ticket</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Priority</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>SLA</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Open</th>
              </tr></thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} onClick={() => openTicket(t)} style={{ height: 40, borderBottom: '1px solid var(--hairline)', cursor: 'pointer', background: selected?.id === t.id ? 'var(--teal-mist)' : 'transparent' }}>
                    <td style={{ padding: '0 12px', fontWeight: 700, color: 'var(--fg)' }}>{t.subject} <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>• {t.business_id?.slice(0, 6) || 'no biz'}</span></td>
                    <td style={{ padding: '0 12px' }}><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 700, fontSize: 11, color: t.priority === 'urgent' ? 'var(--red)' : t.priority === 'high' ? 'var(--amber)' : 'var(--muted)' }}><PriorityDot p={t.priority} /> {t.priority}</span></td>
                    <td style={{ padding: '0 12px', fontSize: 11, color: slaTone(t.sla_due_at), fontWeight: 700 }}><Clock size={11} style={{ marginRight: 4 }} />{t.sla_due_at ? new Date(t.sla_due_at).toLocaleString() : '—'}</td>
                    <td style={{ padding: '0 12px' }}><span style={{ padding: '3px 7px', borderRadius: 6, background: 'var(--hairline)', color: 'var(--fg)', fontWeight: 700, fontSize: 11 }}>{t.status}</span></td>
                    <td style={{ padding: '0 12px', textAlign: 'right' }} onClick={e => e.stopPropagation()}><GhostBtn onClick={() => openTicket(t)}>Open</GhostBtn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selected && (
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--teal)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)' }}>{selected.subject} <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--muted)' }}>• {selected.status} • {selected.priority}</span></div>
            <GhostBtn onClick={() => setSelected(null)}>Close</GhostBtn>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--hairline)', padding: 10, borderRadius: 8, marginBottom: 10 }}>{selected.body}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <GhostBtn disabled={busy} onClick={handleAssign}><UserCheck size={12} style={{ marginRight: 6 }} />Triaged / Assign</GhostBtn>
            <TealBtn disabled={busy} onClick={handleResolve}><CheckCircle size={12} style={{ marginRight: 6 }} />Resolve</TealBtn>
          </div>
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--fg)', marginBottom: 6 }}>Messages</div>
          {messages.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: 8, border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center' }}>No messages — add one.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
              {messages.map(m => (
                <div key={m.id} style={{ padding: '8px 10px', background: 'var(--hairline)', borderRadius: 8, fontSize: 12, color: 'var(--fg)' }}>{m.body} <span style={{ fontSize: 11, color: 'var(--muted)' }}>• {new Date(m.created_at).toLocaleString()}</span></div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Add message" style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
            <TealBtn disabled={busy || !newMsg.trim()} onClick={handleAddMessage}>Send</TealBtn>
          </div>
        </Card>
      )}

      {showNew && (
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--teal)' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', marginBottom: 10 }}>New ticket</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Inp label="Subject *" value={newTicket.subject} onChange={v => setNewTicket(s => ({ ...s, subject: v }))} placeholder="e.g. Payout delayed" />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}><span style={{ fontWeight: 600, color: 'var(--fg)' }}>Body *</span><textarea value={newTicket.body} onChange={e => setNewTicket(s => ({ ...s, body: e.target.value }))} rows={3} style={{ padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} /></label>
            <select value={newTicket.priority} onChange={e => setNewTicket(s => ({ ...s, priority: e.target.value }))} style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="urgent">urgent (4h SLA)</option>
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <GhostBtn onClick={() => setShowNew(false)} style={{ flex: 1 }}>Cancel</GhostBtn>
              <TealBtn disabled={busy} onClick={handleCreate} style={{ flex: 1 }}>{busy ? 'Creating...' : 'Create'}</TealBtn>
            </div>
          </div>
        </Card>
      )}

      <Toast msg={msg} type={type} />
    </div>
  )
}

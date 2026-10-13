import { useEffect, useId, useRef, useState } from 'react'
import { ListTodo, Plus } from 'lucide-react'
import { Button, Empty, Input, Textarea } from '@care-ecosystem/design-system/components/ui'
import { useTasksData, useTaskActions } from '../hooks/useTasksData'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { timeAgo } from '../ui/adminHelpers.js'
import '../ui/admin.css'

// Sponsored tasks: create one and see what exists. The list is a real read: a
// failed read says so with Retry and is never shown as "No tasks yet"; a failed
// refresh keeps the list and says so. Task text is rendered as text only.
// Creating validates the compensation here (a whole number above zero, shown
// under the field) as well as in the hook; a failure keeps every field, a
// success clears them all. Submissions to tasks are not reviewable from this
// console yet, and the screen says so.

const WHOLE_NUMBER = /^\d+$/
const BAD_PAY = 'Enter a positive whole-number compensation'

const naira = (c) => {
  const n = Number(c)
  return c == null || c === '' || !Number.isFinite(n) ? '—' : `₦${n.toLocaleString()}`
}
const created = (d) => {
  const t = d ? new Date(d).getTime() : NaN
  return Number.isNaN(t) ? '—' : timeAgo(d)
}

function TaskList({ query }) {
  const retry = () => query.refetch()
  const tasks = query.data
  if (!tasks && query.isError) {
    return (
      <div role="alert" className="adm-live-warn adm-live-inset-warn">
        <span>Couldn't load tasks</span>
        <Button variant="ghost" size="sm" onClick={retry} aria-label="Retry loading tasks">Retry</Button>
      </div>
    )
  }
  if (!tasks) return <p role="status" className="adm-note adm-live-inset">Loading tasks…</p>
  return (
    <>
      {query.isError && (
        <div role="alert" className="adm-live-warn adm-live-inset-warn">
          <span>Couldn't refresh tasks</span>
          <Button variant="ghost" size="sm" onClick={retry} aria-label="Retry refreshing tasks">Retry</Button>
        </div>
      )}
      {tasks.length === 0 ? (
        <Empty icon={<ListTodo size={40} strokeWidth={1.5} />} message="No tasks yet" cause="none" />
      ) : (
        <ul className="adm-role-list adm-live-inset">
          {tasks.map(t => (
            <li key={t.id} className="adm-role-item">
              <div className="adm-role-head">
                <strong className="adm-role-name">{t.title}</strong>
                <span className="adm-role-badge">{naira(t.compensation)}</span>
                <span className="adm-role-badge">{t.specialty || 'All specialties'}</span>
              </div>
              {t.description && <p className="adm-note">{t.description}</p>}
              <p className="adm-note">{created(t.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function CreateTaskForm() {
  const { createTask, busy } = useTaskActions()
  const { showToast } = useAdmin()
  const ids = useId()
  const mounted = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [title, setTitle] = useState('')
  const [pay, setPay] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [description, setDescription] = useState('')
  const [payError, setPayError] = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (busy || inFlight.current) return
    const cleanPay = pay.trim()
    if (!WHOLE_NUMBER.test(cleanPay) || Number(cleanPay) <= 0) {
      setPayError(BAD_PAY)
      return
    }
    inFlight.current = true
    setPayError(''); setError('')
    let res
    try {
      res = await createTask({
        title: title.trim(), description: description.trim(), compensation: cleanPay, specialty: specialty.trim() || null,
      })
    } catch (err) {
      res = { ok: false, error: err?.message || 'Something went wrong' }
    } finally {
      inFlight.current = false
    }
    // A result after the screen has gone is toasted, not dropped.
    if (!mounted.current) {
      if (!res.ok) showToast(`Couldn't create the task: ${res.error}`, { type: 'error' })
      return
    }
    if (res.ok) {
      setTitle(''); setPay(''); setSpecialty(''); setDescription('')
    } else {
      setError(`Couldn't create the task: ${res.error}`)
    }
  }

  return (
    <form onSubmit={submit} aria-label="Create a task" className="adm-staff-form">
      <Input id={`${ids}-title`} label="Task title" value={title} onChange={setTitle} required disabled={busy}
        placeholder="e.g. Review drug interaction guide" />
      <Input id={`${ids}-pay`} label="Compensation (₦)" type="text" inputMode="numeric" value={pay}
        onChange={(v) => { setPayError(''); setPay(v) }} required disabled={busy} placeholder="500"
        error={payError} helperText="Whole naira, e.g. 500" />
      <Input id={`${ids}-spec`} label="Target specialty" value={specialty} onChange={setSpecialty} disabled={busy}
        placeholder="e.g. Pharmacist (optional)" helperText="Leave empty for all specialties" />
      <Textarea id={`${ids}-desc`} label="Description" value={description} onChange={setDescription} required
        disabled={busy} rows={3} placeholder="Describe what the professional needs to do..." />
      {error && <p role="alert" className="adm-live-alert">{error}</p>}
      <Button type="submit" variant="primary" fullWidth disabled={busy} loading={busy} loadingText="Creating…"
        leftIcon={<Plus size={14} aria-hidden="true" />}>
        Create task
      </Button>
    </form>
  )
}

export default function TasksSection() {
  const query = useTasksData()
  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Sponsored Tasks</h1>
          <p className="adm-note">Create and manage tasks for healthcare professionals</p>
        </div>
      </header>

      <section className="adm-panel adm-staff-create" aria-labelledby="tasks-create-h">
        <div className="adm-live-heading">
          <h2 id="tasks-create-h">Create task</h2>
          <p className="adm-note">Assign a sponsored task with compensation</p>
        </div>
        <CreateTaskForm />
      </section>

      <section className="adm-panel" aria-labelledby="tasks-list-h">
        <div className="adm-phead"><h2 id="tasks-list-h">Tasks{query.data ? ` (${query.data.length})` : ''}</h2></div>
        <TaskList query={query} />
        <p className="adm-note adm-live-inset">Task submissions can't be reviewed from the console yet.</p>
      </section>
    </div>
  )
}

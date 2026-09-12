import { theme } from '../../../styles/theme'
import { Card, Button, Empty, Input, Textarea } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, AdminSection } from '../ui'
import { ListTodo, Plus, Coins, Target, Loader2 } from 'lucide-react'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function TasksTab({
  tasks,
  taskTitle, setTaskTitle,
  taskDesc, setTaskDesc,
  taskComp, setTaskComp,
  taskSpec, setTaskSpec,
  savingTask,
  createTask,
}) {
  return (
    <div>
      <AdminPageHeader
        title="Sponsored Tasks"
        subtitle="Create and manage tasks for healthcare professionals"
      />

      <AdminSection title="Create Task" subtitle="Assign a sponsored task with compensation">
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          <Input
            label="Task Title"
            value={taskTitle}
            onChange={setTaskTitle}
            placeholder="e.g. Review drug interaction guide"
          />
          <Input
            label="Compensation (₦)"
            type="number"
            value={taskComp}
            onChange={setTaskComp}
            placeholder="500"
          />
          <Input
            label="Target Specialty"
            value={taskSpec}
            onChange={setTaskSpec}
            placeholder="e.g. Pharmacist (optional)"
            helperText="Leave empty for all specialties"
          />
          <Textarea
            label="Description"
            value={taskDesc}
            onChange={setTaskDesc}
            rows={3}
            placeholder="Describe what the professional needs to do..."
          />
          <Button
            variant="primary"
            size="md"
            fullWidth
            leftIcon={savingTask ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            loading={savingTask}
            loadingText="Creating..."
            onClick={createTask}
            disabled={savingTask}
          >
            Create Task
          </Button>
        </div>
      </AdminSection>

      <AdminSection title="Active Tasks" subtitle={`${tasks.length} tasks available`} style={{ marginTop: theme.space[4] }}>
        {tasks.length === 0 ? (
          <Empty
            icon={<ListTodo size={40} strokeWidth={1.5} />}
            message="No tasks created yet"
            cause="none"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
            {tasks.map(t => (
              <Card key={t.id} style={{ padding: theme.space[5] }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.space[3] }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: theme.type.h3.size, color: theme.textDark }}>
                      {t.title}
                    </p>
                    <p style={{ margin: 0, fontSize: theme.type.bodySm.size, color: theme.textMid }}>
                      {t.description?.slice(0, 120)}{t.description?.length > 120 ? '…' : ''}
                    </p>
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.space[2],
                    background: theme.successBg,
                    padding: `${theme.space[2]}px ${theme.space[4]}px`,
                    borderRadius: theme.radius.full,
                    flexShrink: 0,
                  }}>
                    <Coins size={14} color={theme.success} />
                    <span style={{ fontWeight: 800, fontSize: theme.type.body.size, color: theme.success }}>
                      ₦{t.compensation?.toLocaleString()}
                    </span>
                  </div>
                </div>
                {t.specialty && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: theme.space[2],
                    background: theme.tealMist,
                    padding: `${theme.space[1]}px ${theme.space[3]}px`,
                    borderRadius: theme.radius.full,
                    fontSize: theme.type.caption.size,
                    fontWeight: 700,
                    color: theme.tealDeep,
                  }}>
                    <Target size={12} />
                    {t.specialty}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </AdminSection>
    </div>
  )
}

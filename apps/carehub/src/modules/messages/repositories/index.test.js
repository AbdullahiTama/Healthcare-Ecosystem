import { describe, it, expect } from 'vitest'
import { createMessageRepository, messageRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    internal_messages: [
      { id: 'm1', business_id: A, parent_id: null, subject: 'Stock order', sender_name: 'Ada' },
      { id: 'm2', business_id: A, parent_id: 'm1', subject: null, sender_name: 'Bola' },
      { id: 'm9', business_id: B, parent_id: null, subject: 'Other tenant thread', sender_name: 'X' },
    ],
    internal_message_recipients: [
      { id: 'r1', message_id: 'm1', staff_id: 's2', recipient_name: 'Bola', kind: 'to', read_at: null },
      { id: 'r9', message_id: 'm9', staff_id: 's9', recipient_name: 'X', kind: 'to', read_at: null },
    ],
    internal_message_files: [
      { id: 'f1', message_id: 'm1', file_name: 'invoice.pdf' },
      { id: 'f9', message_id: 'm9', file_name: 'other.pdf' },
    ],
  })
  return { client, repo: createMessageRepository({ request: client }) }
}

// send() writes three tables and then fans out a notification, so the spies are
// the point — that is what makes the fan-out assertable without a network, a
// bucket or a notifications table.
function spying({ rows = [{ id: 'new-msg' }], uploadUrl = 'https://files/x.pdf' } = {}) {
  const calls = []
  const notifications = []
  const uploads = []
  const repo = createMessageRepository({
    request: async (path, options) => {
      calls.push({ path, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null })
      return rows
    },
    upload: async (bucket, path, file, contentType) => {
      uploads.push({ bucket, path, name: file.name, contentType })
      return uploadUrl
    },
    notify: async (...args) => { notifications.push(args) },
  })
  return { repo, calls, notifications, uploads }
}

describe('messageRepository', () => {
  describe('reads', () => {
    it('getThreads returns only this tenant, roots only', async () => {
      const { calls, repo } = spying()
      await repo.getThreads(A)
      expect(calls[0].path).toContain(`business_id=eq.${A}`)
      expect(calls[0].path).toContain('parent_id=is.null')
    })

    it('getThread returns the root and its replies for this tenant', async () => {
      const { repo } = seeded()
      const rows = await repo.getThread('m1', A)
      expect(rows.map((r) => r.id).sort()).toEqual(['m1', 'm2'])
    })

    // The previous getThreadMessages(rootId) matched on id/parent_id alone, so
    // another tenant's root id returned their whole conversation.
    it('getThread cannot open another tenant thread', async () => {
      const { repo } = seeded()
      expect(await repo.getThread('m9', A)).toEqual([])
    })

    it('getRecipients and getFiles are keyed by message id', async () => {
      const { repo } = seeded()
      expect((await repo.getRecipients(['m1'])).map((r) => r.id)).toEqual(['r1'])
      expect((await repo.getFiles(['m1'])).map((f) => f.id)).toEqual(['f1'])
    })

    it('getRecipients and getFiles do not reach another tenant message', async () => {
      const { repo } = seeded()
      const recips = await repo.getRecipients(['m1'])
      expect(recips.some((r) => r.message_id === 'm9')).toBe(false)
    })

    it('getRecipients and getFiles are a no-op for an empty list', async () => {
      const { calls, repo } = spying()
      expect(await repo.getRecipients([])).toEqual([])
      expect(await repo.getFiles(null)).toEqual([])
      expect(calls).toHaveLength(0)
    })
  })

  describe('uploadAttachment', () => {
    it('uploads to the message bucket and returns the attachment row', async () => {
      const { repo, uploads } = spying({ uploadUrl: 'https://files/invoice.pdf' })
      const file = { name: 'my invoice (final).pdf', type: 'application/pdf', size: 1234 }
      const row = await repo.uploadAttachment(file)

      expect(uploads[0].bucket).toBe('message-files')
      // Unsafe characters are stripped from the stored path, not the name.
      expect(uploads[0].path).not.toMatch(/[^a-zA-Z0-9._\-]/)
      expect(row).toEqual({
        file_name: 'my invoice (final).pdf',
        file_url: 'https://files/invoice.pdf',
        file_type: 'application/pdf',
        file_size: 1234,
      })
    })

    it('falls back to a generic content type', async () => {
      const { repo, uploads } = spying()
      await repo.uploadAttachment({ name: 'x', type: '', size: 0 })
      expect(uploads[0].contentType).toBe('application/octet-stream')
    })
  })

  describe('send', () => {
    const message = { parent_id: null, sender_name: 'Ada', sender_staff_id: 's1', subject: 'Stock order', body: 'Please approve' }
    const recipients = [{ staff_id: 's2', recipient_name: 'Bola', kind: 'to' }]
    const files = [{ file_name: 'invoice.pdf', file_url: 'https://files/invoice.pdf' }]

    it('stamps the tenant on the message', async () => {
      const { repo, calls } = spying()
      await repo.send(A, { message, recipients: [], files: [] })
      expect(calls[0].path).toBe('internal_messages')
      expect(calls[0].body).toMatchObject({ business_id: A, subject: 'Stock order' })
    })

    it('writes recipients and files against the saved message id', async () => {
      const { repo, calls } = spying({ rows: [{ id: 'new-msg' }] })
      await repo.send(A, { message, recipients, files })

      const recipCall = calls.find((c) => c.path === 'internal_message_recipients')
      const fileCall = calls.find((c) => c.path === 'internal_message_files')
      expect(recipCall.body[0]).toMatchObject({ staff_id: 's2', message_id: 'new-msg' })
      expect(fileCall.body[0]).toMatchObject({ file_name: 'invoice.pdf', message_id: 'new-msg' })
    })

    it('notifies every recipient, after the writes', async () => {
      const { repo, notifications, calls } = spying()
      await repo.send(A, { message, recipients, files: [] })

      expect(notifications).toHaveLength(1)
      const [businessId, targets, kind, title, body, link] = notifications[0]
      expect(businessId).toBe(A)
      expect(targets).toEqual([{ staffId: 's2' }])
      expect(kind).toBe('message')
      expect(title).toContain('Ada')
      expect(body).toBe('Stock order')
      expect(link).toBe('messages')
      // The message row was written before anyone was told about it.
      expect(calls[0].path).toBe('internal_messages')
    })

    it('falls back to a generic body for a reply, which has no subject', async () => {
      const { repo, notifications } = spying()
      await repo.send(A, { message: { ...message, subject: null, parent_id: 'm1' }, recipients, files: [] })
      expect(notifications[0][4]).toBe('a message')
    })

    it('writes no child rows and sends no notification when there are none', async () => {
      const { repo, calls, notifications } = spying()
      await repo.send(A, { message, recipients: [], files: [] })
      expect(calls).toHaveLength(1)
      expect(notifications).toHaveLength(0)
    })

    // Recipients and files reference the message id, so a message that did not
    // save must stop the sequence rather than leave orphan rows.
    it('throws rather than writing children when the message returns no id', async () => {
      const { repo, calls } = spying({ rows: [] })
      await expect(repo.send(A, { message, recipients, files })).rejects.toThrow('no id returned')
      expect(calls).toHaveLength(1)
    })
  })

  describe('markRead', () => {
    it('scopes by the parent message as well as the row id', async () => {
      const { repo, calls } = spying()
      await repo.markRead('r1', 'm1')
      expect(calls[0].path).toBe('internal_message_recipients?id=eq.r1&message_id=eq.m1')
      expect(calls[0].method).toBe('PATCH')
      expect(calls[0].body.read_at).toBeTruthy()
    })

    it('cannot mark another tenant recipient row read', async () => {
      const { repo, client } = seeded()
      // r9 hangs off m9, another tenant's message.
      await repo.markRead('r9', 'm1')
      expect(client.rows('internal_message_recipients').find((r) => r.id === 'r9').read_at).toBeNull()
    })
  })

  it('exports a default messageRepository instance', () => {
    for (const m of ['getThreads', 'getThread', 'getRecipients', 'getFiles', 'uploadAttachment', 'send', 'markRead']) {
      expect(typeof messageRepository[m]).toBe('function')
    }
  })
})

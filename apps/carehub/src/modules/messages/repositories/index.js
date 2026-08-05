import { sbFetch, sbUpload, notify as defaultNotify } from '../../../services/supabase'

const FILE_BUCKET = 'message-files'

// ── Message repository ────────────────────────────────────────────────────────
// A deep module over the internal correspondence aggregate: `internal_messages`
// (threads and their replies), plus the `internal_message_recipients` and
// `internal_message_files` rows that hang off each message.
//
// Three collaborators are injected, the same three `orders` uses and for the
// same reasons:
//   request — the transport, sbFetch's shape (path, options) => Promise<rows>
//   upload  — object storage, sbUpload's shape
//   notify  — the notification fan-out, a different system again
// Production binds the real ones (the defaults); tests bind in-memory or spy
// adapters, which is what makes `send()`'s fan-out assertable without a
// network, a bucket or a notifications table.
//
// TENANCY, and it is not uniform — mirrored from the live policies rather than
// invented:
//   `internal_messages`            has business_id; scoped directly, matching
//                                  "internal_messages of own business".
//   `..._recipients` / `..._files` have NO business_id. Their live policies are
//                                  "… via parent message", deriving tenancy
//                                  through internal_messages. So this scopes
//                                  them by message id — ids that callers only
//                                  ever obtain from a business-scoped read
//                                  above — which is the same boundary the
//                                  server applies.
export function createMessageRepository({
  request = sbFetch,
  upload = sbUpload,
  notify = defaultNotify,
} = {}) {
  const repo = {
    // Thread roots only — a reply carries parent_id, a thread root does not.
    async getThreads(businessId) {
      return request(
        `internal_messages?business_id=eq.${businessId}&parent_id=is.null&order=created_at.desc&select=*`
      )
    },

    // One whole thread: the root plus its replies, oldest first so it reads as
    // a conversation.
    //
    // The business filter is new. The previous getThreadMessages(rootId)
    // matched on `or=(id.eq.X,parent_id.eq.X)` and nothing else, so a root id
    // from another tenant would have returned that entire conversation. Latent
    // rather than live — ids came from the business-scoped thread list — but it
    // was the one read in this module with no tenant filter at all.
    async getThread(rootId, businessId) {
      return request(
        `internal_messages?business_id=eq.${businessId}&or=(id.eq.${rootId},parent_id.eq.${rootId})` +
          '&order=created_at.asc&select=*'
      )
    },

    // Recipients and attachments for a set of messages. Empty list is a no-op:
    // an unscoped `in.()` is a malformed PostgREST request.
    async getRecipients(messageIds) {
      if (!messageIds || messageIds.length === 0) return []
      return request(`internal_message_recipients?message_id=in.(${messageIds.join(',')})&select=*`)
    },

    async getFiles(messageIds) {
      if (!messageIds || messageIds.length === 0) return []
      return request(`internal_message_files?message_id=in.(${messageIds.join(',')})&select=*`)
    },

    // Uploads an attachment and returns the row shape `send()` expects, so the
    // page no longer has to know what an attachment record looks like.
    async uploadAttachment(file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${Date.now()}-${Math.floor(Math.random() * 100000)}-${safeName}`
      const url = await upload(FILE_BUCKET, path, file, file.type || 'application/octet-stream')
      return { file_name: file.name, file_url: url, file_type: file.type || null, file_size: file.size || null }
    },

    // Sends a message — new thread or reply — writing the message, its
    // recipients and its attachments, then telling every recipient it landed.
    // One intent for the caller; the fan-out is not theirs to reassemble.
    //
    // Ordering is deliberate: the message must exist before rows that reference
    // its id, and the notification goes last so nobody is told about
    // correspondence that failed to save.
    async send(businessId, { message, recipients = [], files = [] }) {
      const rows = await request('internal_messages', {
        method: 'POST',
        body: JSON.stringify({ ...message, business_id: businessId }),
      })
      const saved = Array.isArray(rows) ? rows[0] : rows
      if (!saved || !saved.id) throw new Error('Message was not saved — no id returned.')

      if (recipients.length > 0) {
        await request('internal_message_recipients', {
          method: 'POST',
          body: JSON.stringify(recipients.map((r) => ({ ...r, message_id: saved.id }))),
          prefer: 'return=minimal',
        })
      }

      if (files.length > 0) {
        await request('internal_message_files', {
          method: 'POST',
          body: JSON.stringify(files.map((f) => ({ ...f, message_id: saved.id }))),
          prefer: 'return=minimal',
        })
      }

      if (recipients.length > 0) {
        await notify(
          businessId,
          recipients.map((r) => ({ staffId: r.staff_id })),
          'message',
          `${message.sender_name} sent you correspondence`,
          message.subject || 'a message',
          'messages'
        )
      }

      return saved
    },

    // Marks one recipient row read. Scoped by its parent message as well as
    // its own id — `internal_message_recipients` has no business_id, so the
    // message is the boundary, the same one its RLS policy uses. The previous
    // markMessageRead(id) filtered on the row id alone.
    async markRead(recipientRowId, messageId) {
      return request(
        `internal_message_recipients?id=eq.${recipientRowId}&message_id=eq.${messageId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ read_at: new Date().toISOString() }),
          prefer: 'return=minimal',
        }
      )
    },
  }

  return repo
}

export const messageRepository = createMessageRepository()

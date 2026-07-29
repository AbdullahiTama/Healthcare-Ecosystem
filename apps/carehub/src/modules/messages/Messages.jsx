import { useState, useEffect } from 'react'
import { getMessageThreads, getThreadMessages, getMessageRecipients, getMessageFiles, uploadMessageFile, sendMessage, markMessageRead, getStaff } from '../../services/supabase'
import { Card, Inp, TealBtn, GhostBtn, Modal, useToast, Toast, Loading } from '../../components/ui'
import { theme } from '../../styles/theme'
const { tealDeep, tealMist, tealBright, navy, gray600, gray500, gray400, gray200, gray100, gray50, border, danger, dangerBg, success, successBg, warning, warningBg, info, infoBg, purple, bg } = theme

function fmtStamp(d) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function refFor(id) {
  return 'REF-' + String(id).replace(/-/g, '').slice(0, 8).toUpperCase()
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function readAuth() {
  try { return JSON.parse(localStorage.getItem('carehub_auth') || '{}') } catch (e) { return {} }
}

export default function Messages({ brand }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const authData = readAuth()
  const meStaffId = (authData && authData.staff && authData.staff.id) ? authData.staff.id : null
  const meName = (authData && authData.staff && authData.staff.full_name)
    ? authData.staff.full_name
    : ((authData && authData.brand && authData.brand.owner) ? authData.brand.owner : 'Owner')
  const meTitle = (authData && authData.staff)
    ? (authData.staff.public_title || authData.staff.role || 'Staff')
    : 'Owner'

  const [threads, setThreads] = useState([])
  const [recipientsByMsg, setRecipientsByMsg] = useState({})
  const [filesByMsg, setFilesByMsg] = useState({})
  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)

  const [openThread, setOpenThread] = useState(null)
  const [threadMsgs, setThreadMsgs] = useState([])
  const [threadRecips, setThreadRecips] = useState({})
  const [threadFiles, setThreadFiles] = useState({})
  const [loadingThread, setLoadingThread] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [replyFiles, setReplyFiles] = useState([])
  const [sendingReply, setSendingReply] = useState(false)

  const [composing, setComposing] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [toIds, setToIds] = useState([])
  const [ccIds, setCcIds] = useState([])
  const [attachments, setAttachments] = useState([])
  const [sending, setSending] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    if (!brand || !brand.id) return
    setLoading(true)
    try {
      const ths = await getMessageThreads(brand.id)
      const stf = await getStaff(brand.id)
      setThreads(ths || [])
      setStaffList(stf || [])
      const ids = (ths || []).map(function (t) { return t.id })
      const recips = await getMessageRecipients(ids)
      const rmap = {}
      ;(recips || []).forEach(function (r) {
        if (!rmap[r.message_id]) rmap[r.message_id] = []
        rmap[r.message_id].push(r)
      })
      setRecipientsByMsg(rmap)
      const fls = await getMessageFiles(ids)
      const fmap = {}
      ;(fls || []).forEach(function (f) {
        if (!fmap[f.message_id]) fmap[f.message_id] = []
        fmap[f.message_id].push(f)
      })
      setFilesByMsg(fmap)
    } catch (e) {
      showToast('Could not load correspondence: ' + e.message, { type: 'error' })
    }
    setLoading(false)
  }

  const ownerName = (brand && brand.owner) ? brand.owner : 'Owner'
  const addressBook = [{ id: 'OWNER', name: ownerName + ' (Owner)', title: 'Owner' }]
    .concat(staffList.map(function (s) {
      return { id: s.id, name: s.full_name, title: s.public_title || s.role }
    }))
    .filter(function (p) {
      if (meStaffId === null) return p.id !== 'OWNER'
      return p.id !== meStaffId
    })

  function nameFor(id) {
    const found = addressBook.filter(function (p) { return p.id === id })[0]
    return found ? found.name : 'Unknown'
  }

  function staffIdFor(id) {
    return id === 'OWNER' ? null : id
  }

  function toggleTo(id) {
    setToIds(function (prev) {
      return prev.indexOf(id) >= 0 ? prev.filter(function (x) { return x !== id }) : prev.concat([id])
    })
    setCcIds(function (prev) { return prev.filter(function (x) { return x !== id }) })
  }

  function toggleCc(id) {
    setCcIds(function (prev) {
      return prev.indexOf(id) >= 0 ? prev.filter(function (x) { return x !== id }) : prev.concat([id])
    })
    setToIds(function (prev) { return prev.filter(function (x) { return x !== id }) })
  }

  function pickAttachments(e) {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    const tooBig = picked.filter(function (f) { return f.size > 20 * 1024 * 1024 })
    if (tooBig.length > 0) {
      showToast('These files are over 20MB and cannot be attached: ' + tooBig.map(function (f) { return f.name }).join(', '), { type: 'warning' })
    }
    const ok = picked.filter(function (f) { return f.size <= 20 * 1024 * 1024 })
    setAttachments(function (prev) { return prev.concat(ok) })
    e.target.value = ''
  }

  function removeAttachment(i) {
    setAttachments(function (prev) { return prev.filter(function (f, idx) { return idx !== i }) })
  }

  function pickReplyFiles(e) {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    const ok = picked.filter(function (f) { return f.size <= 20 * 1024 * 1024 })
    if (ok.length !== picked.length) showToast('Some files were over 20MB and were skipped.', { type: 'warning' })
    setReplyFiles(function (prev) { return prev.concat(ok) })
    e.target.value = ''
  }

  function removeReplyFile(i) {
    setReplyFiles(function (prev) { return prev.filter(function (f, idx) { return idx !== i }) })
  }

  async function uploadAll(list) {
    const out = []
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      setUploadStatus('Uploading ' + (i + 1) + ' of ' + list.length + ' — ' + f.name)
      const url = await uploadMessageFile(f)
      out.push({ file_name: f.name, file_url: url, file_type: f.type || null, file_size: f.size || null })
    }
    setUploadStatus('')
    return out
  }

  async function send() {
    if (!subject.trim()) { showToast('Please enter a subject.', { type: 'warning' }); return }
    if (!body.trim()) { showToast('Please write your message.', { type: 'warning' }); return }
    if (toIds.length === 0) { showToast('Please select at least one recipient in the "To" field.', { type: 'warning' }); return }
    setSending(true)
    try {
      const uploaded = await uploadAll(attachments)

      const recipients = toIds.map(function (id) {
        return { staff_id: staffIdFor(id), recipient_name: nameFor(id), kind: 'to' }
      }).concat(ccIds.map(function (id) {
        return { staff_id: staffIdFor(id), recipient_name: nameFor(id), kind: 'cc' }
      }))

      await sendMessage({
        business_id: brand.id,
        parent_id: null,
        sender_staff_id: meStaffId,
        sender_name: meName,
        sender_title: meTitle,
        subject: subject.trim(),
        body: body.trim(),
      }, recipients, uploaded)

      showToast('Message sent', { type: 'success' })
      setSubject('')
      setBody('')
      setToIds([])
      setCcIds([])
      setAttachments([])
      setComposing(false)
      load()
    } catch (e) {
      showToast('Could not send: ' + e.message, { type: 'error' })
    }
    setUploadStatus('')
    setSending(false)
  }

  async function openThreadView(t) {
    setOpenThread(t)
    setLoadingThread(true)
    setReplyBody('')
    setReplyFiles([])
    try {
      const msgs = await getThreadMessages(t.id)
      setThreadMsgs(msgs || [])
      const ids = (msgs || []).map(function (m) { return m.id })
      const recips = await getMessageRecipients(ids)
      const rmap = {}
      ;(recips || []).forEach(function (r) {
        if (!rmap[r.message_id]) rmap[r.message_id] = []
        rmap[r.message_id].push(r)
      })
      setThreadRecips(rmap)

      const fls = await getMessageFiles(ids)
      const fmap = {}
      ;(fls || []).forEach(function (f) {
        if (!fmap[f.message_id]) fmap[f.message_id] = []
        fmap[f.message_id].push(f)
      })
      setThreadFiles(fmap)

      const mine = (recips || []).filter(function (r) {
        return r.staff_id === meStaffId && !r.read_at
      })
      for (let i = 0; i < mine.length; i++) {
        try { await markMessageRead(mine[i].id) } catch (e) {}
      }
    } catch (e) {
      showToast('Could not open thread: ' + e.message, { type: 'error' })
    }
    setLoadingThread(false)
  }

  async function sendReply() {
    if (!replyBody.trim()) { showToast('Please write a reply.', { type: 'warning' }); return }
    if (threadMsgs.length === 0) { showToast('Thread not loaded.', { type: 'warning' }); return }
    setSendingReply(true)
    try {
      const uploaded = await uploadAll(replyFiles)

      const root = threadMsgs[0]
      const seen = {}
      const recipients = []

      threadMsgs.forEach(function (m) {
        if (m.sender_staff_id !== meStaffId) {
          const key = String(m.sender_staff_id)
          if (!seen[key]) {
            seen[key] = true
            recipients.push({ staff_id: m.sender_staff_id, recipient_name: m.sender_name, kind: 'to' })
          }
        }
        const rows = threadRecips[m.id] || []
        rows.forEach(function (r) {
          if (r.staff_id !== meStaffId) {
            const key = String(r.staff_id)
            if (!seen[key]) {
              seen[key] = true
              recipients.push({ staff_id: r.staff_id, recipient_name: r.recipient_name, kind: 'to' })
            }
          }
        })
      })

      await sendMessage({
        business_id: brand.id,
        parent_id: root.id,
        sender_staff_id: meStaffId,
        sender_name: meName,
        sender_title: meTitle,
        subject: null,
        body: replyBody.trim(),
      }, recipients, uploaded)

      showToast('Reply sent', { type: 'success' })
      setReplyBody('')
      setReplyFiles([])
      openThreadView(openThread)
      load()
    } catch (e) {
      showToast('Could not send reply: ' + e.message, { type: 'error' })
    }
    setUploadStatus('')
    setSendingReply(false)
  }

  function unreadCount(threadId) {
    const rows = recipientsByMsg[threadId] || []
    return rows.filter(function (r) { return r.staff_id === meStaffId && !r.read_at }).length
  }

  function toLine(msgId) {
    return (recipientsByMsg[msgId] || []).filter(function (r) { return r.kind === 'to' })
      .map(function (r) { return r.recipient_name }).join(', ')
  }

  function ccLine(msgId) {
    return (recipientsByMsg[msgId] || []).filter(function (r) { return r.kind === 'cc' })
      .map(function (r) { return r.recipient_name }).join(', ')
  }

  function tToLine(msgId) {
    return (threadRecips[msgId] || []).filter(function (r) { return r.kind === 'to' })
      .map(function (r) { return r.recipient_name }).join(', ')
  }

  function tCcLine(msgId) {
    return (threadRecips[msgId] || []).filter(function (r) { return r.kind === 'cc' })
      .map(function (r) { return r.recipient_name }).join(', ')
  }

  function attachCount(msgId) {
    return (filesByMsg[msgId] || []).length
  }

  return (
    <div style={{ padding: '24px', maxWidth: '820px' }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: '900', color: navy }}>Internal Correspondence</div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '2px' }}>Official record of communication. Every message is logged with sender, recipients, attachments, and time.</div>
        </div>
        <TealBtn onClick={function () { setComposing(true) }}>+ New Message</TealBtn>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', borderRadius: '8px', background: bg, border: `1px solid ${border}`, marginBottom: '20px' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: tealDeep, letterSpacing: '0.04em' }}>SECURE</span>
        <span style={{ fontSize: '11.5px', color: gray500 }}>Internal to {brand && brand.name ? brand.name : 'this company'} — not visible outside your organisation.</span>
      </div>

      {loading && <Loading text="Loading correspondence..." />}

      {!loading && threads.length === 0 && (
        <Card style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontWeight: '800', color: navy, marginBottom: '6px' }}>No correspondence yet</div>
          <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>Send an official message to your line manager, your team, or head office.</div>
          <TealBtn onClick={function () { setComposing(true) }}>+ New Message</TealBtn>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {threads.map(function (t) {
          const unread = unreadCount(t.id)
          const nFiles = attachCount(t.id)
          return (
            <Card key={t.id} style={{ padding: '0', overflow: 'hidden', borderLeft: unread > 0 ? `3px solid ${tealDeep}` : '3px solid transparent' }}>
              <button onClick={function () { openThreadView(t) }}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '15px 16px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '14.5px', fontWeight: unread > 0 ? '900' : '700', color: navy }}>{t.subject || '(no subject)'}</span>
                      {unread > 0 && <span style={{ fontSize: '9.5px', fontWeight: '800', padding: '2px 7px', borderRadius: '20px', background: tealDeep, color: 'white' }}>NEW</span>}
                      {nFiles > 0 && <span style={{ fontSize: '10px', fontWeight: '700', color: gray500 }}>{nFiles} attachment{nFiles > 1 ? 's' : ''}</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: gray600, marginTop: '5px' }}>
                      <strong>From:</strong> {t.sender_name}{t.sender_title ? ' · ' + t.sender_title : ''}
                    </div>
                    {toLine(t.id) && (
                      <div style={{ fontSize: '11.5px', color: gray500, marginTop: '2px' }}>
                        <strong>To:</strong> {toLine(t.id)}
                      </div>
                    )}
                    {ccLine(t.id) && (
                      <div style={{ fontSize: '11.5px', color: gray500, marginTop: '1px' }}>
                        <strong>Cc:</strong> {ccLine(t.id)}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '10.5px', color: gray400, fontWeight: '600' }}>{fmtStamp(t.created_at)}</div>
                    <div style={{ fontSize: '9.5px', color: gray400, fontFamily: 'monospace', marginTop: '3px' }}>{refFor(t.id)}</div>
                  </div>
                </div>
              </button>
            </Card>
          )
        })}
      </div>

      <Modal show={composing} onClose={function () { setComposing(false) }} sheet wide title='New Message'
        footer={<>
          <GhostBtn onClick={function () { setComposing(false) }} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
          <TealBtn onClick={send} style={{ flex: 2, padding: '13px' }}>{sending ? 'Sending...' : 'Send Message'}</TealBtn>
        </>}>
            <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '16px' }}>Sending as <strong>{meName}</strong>{meTitle ? ' · ' + meTitle : ''}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <Inp label='Subject' value={subject} onChange={function (v) { setSubject(v) }} placeholder='e.g. Q3 Territory Coverage Report' required />

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '2px' }}>To *</div>
                <div style={{ fontSize: '11px', color: gray400, marginBottom: '6px' }}>Tap as many people as you need.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {addressBook.map(function (p) {
                    const on = toIds.indexOf(p.id) >= 0
                    return (
                      <button key={'to' + String(p.id)} type='button' onClick={function () { toggleTo(p.id) }}
                        style={{ fontSize: '11.5px', fontWeight: '600', padding: '7px 11px', borderRadius: '8px', cursor: 'pointer',
                          border: `1px solid ${on ? tealDeep : border}`,
                          background: on ? tealDeep : 'white',
                          color: on ? 'white' : gray600 }}>
                        {p.name}
                      </button>
                    )
                  })}
                </div>
                {addressBook.length === 0 && <div style={{ fontSize: '11.5px', color: gray400, marginTop: '4px' }}>No one to send to yet — add staff first.</div>}
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '2px' }}>Cc</div>
                <div style={{ fontSize: '11px', color: gray400, marginBottom: '6px' }}>Copied — they are notified and can see the whole thread. Tap as many as you need.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {addressBook.map(function (p) {
                    const on = ccIds.indexOf(p.id) >= 0
                    return (
                      <button key={'cc' + String(p.id)} type='button' onClick={function () { toggleCc(p.id) }}
                        style={{ fontSize: '11.5px', fontWeight: '600', padding: '7px 11px', borderRadius: '8px', cursor: 'pointer',
                          border: `1px solid ${on ? tealDeep : border}`,
                          background: on ? gray600 : 'white',
                          color: on ? 'white' : gray600 }}>
                        {p.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Message *</div>
                <textarea value={body} onChange={function (e) { setBody(e.target.value) }} rows={7}
                  placeholder='Write your message...'
                  style={{ width: '100%', padding: '12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13.5px', fontFamily: 'inherit', lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '2px' }}>Attachments</div>
                <div style={{ fontSize: '11px', color: gray400, marginBottom: '8px' }}>Photos, PDFs, documents — attach as many as you need. Max 20MB each.</div>

                <label style={{ display: 'block', border: `2px dashed ${border}`, borderRadius: '10px', padding: '14px', textAlign: 'center', cursor: 'pointer', background: bg }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: tealDeep }}>+ Attach files</div>
                  <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>You can select more than one at a time</div>
                  <input type='file' multiple onChange={pickAttachments} style={{ display: 'none' }} />
                </label>

                {attachments.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {attachments.map(function (f, i) {
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '9px 11px', borderRadius: '8px', border: `1px solid ${border}`, background: 'white' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '12.5px', fontWeight: '700', color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                            <div style={{ fontSize: '10.5px', color: gray400 }}>{fmtSize(f.size)}</div>
                          </div>
                          <button type='button' onClick={function () { removeAttachment(i) }}
                            style={{ flexShrink: 0, border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: '7px', padding: '5px 9px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>
                            Remove
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {uploadStatus && (
              <div style={{ marginTop: '14px', padding: '9px 11px', borderRadius: '8px', background: tealMist, border: `1px solid ${tealMist}`, fontSize: '12px', color: tealDeep, fontWeight: '600' }}>
                {uploadStatus}
              </div>
            )}
      </Modal>

      <Modal show={!!openThread} onClose={function () { setOpenThread(null); setThreadMsgs([]) }} sheet wide title={openThread ? (<>
          <div>{openThread.subject || '(no subject)'}</div>
          <div style={{ fontSize: '10.5px', color: gray400, fontFamily: 'monospace', fontWeight: '600', marginTop: '2px' }}>{refFor(openThread.id)}</div>
        </>) : null}>
          {openThread && (
            <div style={{ margin: '-20px -24px', background: bg, padding: '18px 20px' }}>
              {loadingThread && <Loading text="Loading conversation..." />}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {threadMsgs.map(function (m) {
                  const files = threadFiles[m.id] || []
                  return (
                    <div key={m.id} style={{ background: 'white', border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
                      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${border}`, background: bg }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: '800', color: navy }}>{m.sender_name}</div>
                            {m.sender_title && <div style={{ fontSize: '11px', color: tealDeep, fontWeight: '600' }}>{m.sender_title}</div>}
                          </div>
                          <div style={{ fontSize: '10.5px', color: gray400, fontWeight: '600', textAlign: 'right', flexShrink: 0 }}>
                            {fmtStamp(m.created_at)}
                          </div>
                        </div>
                        {tToLine(m.id) && (
                          <div style={{ fontSize: '11px', color: gray500, marginTop: '6px' }}>
                            <strong>To:</strong> {tToLine(m.id)}
                          </div>
                        )}
                        {tCcLine(m.id) && (
                          <div style={{ fontSize: '11px', color: gray500, marginTop: '1px' }}>
                            <strong>Cc:</strong> {tCcLine(m.id)}
                          </div>
                        )}
                      </div>

                      <div style={{ padding: '14px', fontSize: '13.5px', color: navy, lineHeight: '1.65', whiteSpace: 'pre-wrap' }}>
                        {m.body}
                      </div>

                      {files.length > 0 && (
                        <div style={{ padding: '0 14px 14px 14px' }}>
                          <div style={{ fontSize: '10.5px', fontWeight: '800', color: gray500, letterSpacing: '0.04em', marginBottom: '7px' }}>
                            ATTACHMENTS ({files.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {files.map(function (f) {
                              const isImage = f.file_type && f.file_type.indexOf('image/') === 0
                              return (
                                <a key={f.id} href={f.file_url} target='_blank' rel='noreferrer'
                                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 11px', borderRadius: '8px', border: `1px solid ${border}`, background: bg, textDecoration: 'none' }}>
                                  {isImage ? (
                                    <div style={{ width: '38px', height: '38px', borderRadius: '6px', flexShrink: 0, background: 'url(' + f.file_url + ') center/cover', border: `1px solid ${border}` }} />
                                  ) : (
                                    <div style={{ width: '38px', height: '38px', borderRadius: '6px', flexShrink: 0, background: navy, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '800' }}>
                                      FILE
                                    </div>
                                  )}
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: '12.5px', fontWeight: '700', color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</div>
                                    <div style={{ fontSize: '10.5px', color: gray400 }}>{fmtSize(f.file_size)} · Tap to open</div>
                                  </div>
                                </a>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ marginTop: '18px', background: 'white', border: `1px solid ${border}`, borderRadius: '10px', padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '8px' }}>Reply</div>
                <div style={{ fontSize: '11px', color: gray400, marginBottom: '8px' }}>Goes to everyone on this thread, including those copied.</div>
                <textarea value={replyBody} onChange={function (e) { setReplyBody(e.target.value) }} rows={4}
                  placeholder='Write your reply...'
                  style={{ width: '100%', padding: '11px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13.5px', fontFamily: 'inherit', lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box' }} />

                <label style={{ display: 'block', marginTop: '10px', border: `2px dashed ${border}`, borderRadius: '8px', padding: '11px', textAlign: 'center', cursor: 'pointer', background: bg }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: tealDeep }}>+ Attach files to reply</span>
                  <input type='file' multiple onChange={pickReplyFiles} style={{ display: 'none' }} />
                </label>

                {replyFiles.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {replyFiles.map(function (f, i) {
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${border}` }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '12px', fontWeight: '700', color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                            <div style={{ fontSize: '10px', color: gray400 }}>{fmtSize(f.size)}</div>
                          </div>
                          <button type='button' onClick={function () { removeReplyFile(i) }}
                            style={{ flexShrink: 0, border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: '7px', padding: '4px 8px', fontSize: '10.5px', fontWeight: '700', cursor: 'pointer' }}>
                            Remove
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {uploadStatus && (
                  <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: tealMist, border: `1px solid ${tealMist}`, fontSize: '11.5px', color: tealDeep, fontWeight: '600' }}>
                    {uploadStatus}
                  </div>
                )}

                <TealBtn onClick={sendReply} style={{ width: '100%', padding: '12px', marginTop: '10px' }}>
                  {sendingReply ? 'Sending...' : 'Send Reply'}
                </TealBtn>
              </div>

              <div style={{ marginTop: '14px', fontSize: '10.5px', color: gray400, textAlign: 'center', lineHeight: '1.6' }}>
                This correspondence is an official company record.<br />Sender, recipients, attachments and timestamps are permanently logged.
              </div>
            </div>
          )}
      </Modal>
    </div>
  )
}

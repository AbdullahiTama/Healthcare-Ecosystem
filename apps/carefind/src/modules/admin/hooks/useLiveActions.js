import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { bestEffort } from '../lib/bestEffort'
import { uploadToBucket } from '../lib/uploadMedia'

// The live show handlers that used to live in LegacyTabHost, calling the same
// server actions with the same payloads. Each resolves { ok } or
// { ok: false, error } so the card can show a failure where the admin is looking.
//
// Differences from the legacy handlers: failures are returned, not toasted; a
// failed trailer or image upload stops the action and is returned (legacy
// scheduled without the trailer, and dropped the image while still posting the
// text); empty guards return an error; postItem no longer reads the dead
// admin_token or sends a token. If the image posts but the text then fails the
// result carries partial: true, so the caller keeps only the text draft.
//
// `busy` is the name of the running action ('startShow', 'scheduleShow',
// 'startScheduled', 'cancelScheduled', 'endShow', 'postItem', 'postMedia',
// 'hideComment') or null. It covers uploads too. The cards disable their
// controls while it is non-null, so only one action runs at a time.

export const slideContent = (url, num, total) => `${url}|||${num}|||${total}`

export function useLiveActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const [busy, setBusy] = useState(null)

  // `work` does the uploads and server calls and returns the result plus
  // whether the control room changed. The refresh and toast run after it and
  // cannot throw out of here: once the server has committed, the admin must
  // never be told the action failed.
  const perform = useCallback(async (name, work, success) => {
    setBusy(name)
    let outcome
    try {
      outcome = await work()
    } catch (err) {
      outcome = { result: { ok: false, error: err.message }, changed: false }
    } finally {
      setBusy(null)
    }
    if (outcome.changed) bestEffort(`refreshing after ${name}`, invalidateAdmin)
    if (outcome.result.ok && success) bestEffort(`toasting ${name}`, () => showToast(success, { type: 'success' }))
    return outcome.result
  }, [showToast, invalidateAdmin])

  // A single server call.
  const simple = useCallback((name, action, payload, success) => perform(name, async () => {
    await callAdminAuth(action, payload)
    return { result: { ok: true }, changed: true }
  }, success), [perform])

  const startShow = useCallback(({ title, guestIds }) => {
    if (!(title || '').trim()) return Promise.resolve({ ok: false, error: 'Add a show title' })
    return simple('startShow', 'start_live_show', { title: title.trim(), guestIds },
      'Live show started! Open the Control Room to begin posting.')
  }, [simple])

  const scheduleShow = useCallback(({ title, scheduledAt, trailerFile, guestIds }) => {
    if (!(title || '').trim()) return Promise.resolve({ ok: false, error: 'Add a show title' })
    if (!scheduledAt) return Promise.resolve({ ok: false, error: 'Pick a date & time for the show' })
    return perform('scheduleShow', async () => {
      let trailerUrl = null
      if (trailerFile) {
        const upload = await uploadToBucket('live-media', trailerFile, 'trailer', { contentType: trailerFile.type || 'video/mp4' })
        if (!upload.ok) return { result: { ok: false, error: `Couldn't upload the trailer: ${upload.error}` }, changed: false }
        trailerUrl = upload.url
      }
      await callAdminAuth('schedule_show', { title: title.trim(), scheduledAt, trailerUrl, guestIds })
      return { result: { ok: true }, changed: true }
    }, 'Show scheduled! It will show a countdown to your audience. Tap "Start Now" when you\'re ready to go live.')
  }, [perform])

  const startScheduled = useCallback((id) => simple('startScheduled', 'start_scheduled_show', { showId: id }, 'You are now LIVE!'), [simple])
  const cancelScheduled = useCallback((id) => simple('cancelScheduled', 'cancel_scheduled_show', { showId: id }, 'Scheduled show cancelled'), [simple])
  const endShow = useCallback((id) => simple('endShow', 'end_live_show', { showId: id }, 'Live show ended'), [simple])

  // Image first, then text, as the legacy handler did.
  const postItem = useCallback(({ showId, text, imageFile }) => {
    const cleanText = (text || '').trim()
    if (!cleanText && !imageFile) return Promise.resolve({ ok: false, error: 'Write something or add an image' })
    return perform('postItem', async () => {
      let imagePosted = false
      try {
        if (imageFile) {
          const upload = await uploadToBucket('live-media', imageFile, `live-${showId}`)
          if (!upload.ok) return { result: { ok: false, error: `Couldn't upload the image: ${upload.error}` }, changed: false }
          await callAdminAuth('post_live_item', { showId, kind: 'image', content: upload.url })
          imagePosted = true
        }
        if (cleanText) await callAdminAuth('post_live_item', { showId, kind: 'text', content: cleanText })
      } catch (err) {
        // The image is already live when only the text failed: refresh, and
        // tell the caller to keep just the text draft.
        return imagePosted
          ? { result: { ok: false, error: err.message, partial: true }, changed: true }
          : { result: { ok: false, error: err.message }, changed: false }
      }
      return { result: { ok: true }, changed: true }
    })
  }, [perform])

  const postMedia = useCallback(({ showId, kind, content }) => simple('postMedia', 'post_live_item', { showId, kind, content }), [simple])
  const hideComment = useCallback((id) => simple('hideComment', 'hide_live_comment', { id }), [simple])

  return { busy, startShow, scheduleShow, startScheduled, cancelScheduled, endShow, postItem, postMedia, hideComment }
}

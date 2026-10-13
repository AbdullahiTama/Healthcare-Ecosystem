import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { bestEffort } from '../lib/bestEffort'
import { uploadToBucket } from '../lib/uploadMedia'

// The live show handlers that used to live in LegacyTabHost, calling the same
// server actions with the same payloads. Each resolves { ok } or
// { ok: false, error } so the card can show a failure where the admin is looking.
//
// Posting and hiding refresh only that show's control room; everything else
// refreshes all admin data.
//
// Differences from the legacy handlers: failures are returned, not toasted; a
// failed trailer or image upload stops the action and is returned (legacy
// scheduled without the trailer, and dropped the image while still posting the
// text); empty guards return an error; postItem no longer reads the dead
// admin_token or sends a token. If the image posts but the text then fails the
// result carries partial: true, so the caller keeps only the text draft.
//
// In-flight guard: each run has a key `${action}:${targetId ?? ''}` (e.g.
// 'endShow:<showId>', 'hideComment:<commentId>', 'startShow:'; a media post is keyed by show and content, so
// two different items post together and only a true duplicate is refused). A run whose key
// is already running resolves { ok: false, error: 'Already running' } with no
// server call, so a double click cannot post or end twice. Different keys may
// overlap (hide a comment while a slide uploads). The key covers uploads too and
// is held until the server call and the list refresh have both finished (the
// refresh is awaited, never able to fail the action), then released in `finally`.
// The wait for the refresh is capped at 10 s, so a hung query cannot keep the
// controls disabled for good. `busyKeys` and `isBusy(action, targetId)`
// drive the UI; `busy` is the action name of the oldest running key, or null.

// Waits for `promise`, but at most `ms`; the timer is cleared when the promise
// settles first, so none leaks.
const REFRESH_CAP_MS = 10000
const capped = (promise, ms) => {
  let timer
  const cap = new Promise(resolve => { timer = setTimeout(resolve, ms) })
  return Promise.race([promise, cap]).finally(() => clearTimeout(timer))
}

export const slideContent = (url, num, total) => `${url}|||${num}|||${total}`

export function useLiveActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const queryClient = useQueryClient()
  const running = useRef(new Set())
  const [busyKeys, setBusyKeys] = useState([])
  const isBusy = useCallback((action, targetId) => busyKeys.includes(`${action}:${targetId ?? ''}`), [busyKeys])
  const busy = busyKeys.length ? busyKeys[0].split(':')[0] : null

  // `work` does the uploads and server calls and returns the result plus
  // whether the control room changed. The refresh and toast run after it and
  // cannot throw out of here: once the server has committed, the admin must
  // never be told the action failed.
  const perform = useCallback(async (name, targetId, work, success, controlShowId) => {
    const key = `${name}:${targetId ?? ''}`
    if (running.current.has(key)) return { ok: false, error: 'Already running' }
    running.current.add(key)
    setBusyKeys([...running.current])
    let outcome
    try {
      outcome = await work()
    } catch (err) {
      outcome = { result: { ok: false, error: err?.message || String(err) }, changed: false }
    }
    // The key is held until the refresh has landed: while the card is still
    // shown, a second click must not re-send the server action.
    try {
      // Posting and hiding only change one show's control room; the rest
      // refresh everything (a show started, scheduled, ended or cancelled
      // changes the lists too).
      if (outcome.changed) {
        const refresh = controlShowId
          ? () => queryClient.invalidateQueries({ queryKey: ['admin', 'live', 'control', controlShowId] })
          : invalidateAdmin
        await capped(bestEffort(`refreshing after ${name}`, refresh), REFRESH_CAP_MS)
      }
    } finally {
      running.current.delete(key)
      setBusyKeys([...running.current])
    }
    if (outcome.result.ok && success) bestEffort(`toasting ${name}`, () => showToast(success, { type: 'success' }))
    return outcome.result
  }, [showToast, invalidateAdmin, queryClient])

  // A single server call.
  const simple = useCallback((name, targetId, action, payload, success, controlShowId) => perform(name, targetId, async () => {
    await callAdminAuth(action, payload)
    return { result: { ok: true }, changed: true }
  }, success, controlShowId), [perform])

  const startShow = useCallback(({ title, guestIds }) => {
    if (!(title || '').trim()) return Promise.resolve({ ok: false, error: 'Add a show title' })
    return simple('startShow', null, 'start_live_show', { title: title.trim(), guestIds },
      'Live show started. Its control room is under Currently live.')
  }, [simple])

  const scheduleShow = useCallback(({ title, scheduledAt, trailerFile, guestIds }) => {
    if (!(title || '').trim()) return Promise.resolve({ ok: false, error: 'Add a show title' })
    if (!scheduledAt) return Promise.resolve({ ok: false, error: 'Pick a date & time for the show' })
    return perform('scheduleShow', null, async () => {
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

  const startScheduled = useCallback((id) => simple('startScheduled', id, 'start_scheduled_show', { showId: id }, 'You are now LIVE!'), [simple])
  const cancelScheduled = useCallback((id) => simple('cancelScheduled', id, 'cancel_scheduled_show', { showId: id }, 'Scheduled show cancelled'), [simple])
  const endShow = useCallback((id) => simple('endShow', id, 'end_live_show', { showId: id }, 'Live show ended'), [simple])

  // Image first, then text, as the legacy handler did.
  const postItem = useCallback(({ showId, text, imageFile }) => {
    const cleanText = (text || '').trim()
    if (!cleanText && !imageFile) return Promise.resolve({ ok: false, error: 'Write something or add an image' })
    return perform('postItem', showId, async () => {
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
          ? { result: { ok: false, error: err?.message || String(err), partial: true }, changed: true }
          : { result: { ok: false, error: err?.message || String(err) }, changed: false }
      }
      return { result: { ok: true }, changed: true }
    }, undefined, showId)
  }, [perform])

  const postMedia = useCallback(({ showId, kind, content }) => simple('postMedia', `${showId}:${content}`, 'post_live_item', { showId, kind, content }, undefined, showId), [simple])
  // The optional { showId } narrows the refresh to that show's control room.
  const hideComment = useCallback((id, { showId } = {}) => simple('hideComment', id, 'hide_live_comment', { id }, undefined, showId), [simple])

  return { busy, busyKeys, isBusy, startShow, scheduleShow, startScheduled, cancelScheduled, endShow, postItem, postMedia, hideComment }
}

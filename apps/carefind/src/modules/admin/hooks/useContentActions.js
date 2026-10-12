import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { bestEffort } from '../lib/bestEffort'
import { uploadToBucket } from '../lib/uploadMedia'

// The story and promotion handlers that used to live in LegacyTabHost, calling
// the same server actions with the same payloads. Each resolves { ok } or
// { ok: false, error } so the form can show a failure where the admin is
// looking.
//
// Differences from the legacy handlers: a failed image upload stops the create
// and is returned (legacy ignored it and published without the image), the
// empty-story and blank-title guards return an error instead of silently
// returning or toasting, and the lists are refreshed once.

export function useContentActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const [busy, setBusy] = useState(false)

  // Only the server call decides the result. The refresh and toast run after it
  // and cannot throw out of here: once the server has saved the change, the
  // admin must never be told it failed.
  const finish = useCallback((action, success) => {
    bestEffort(`refreshing after ${action}`, invalidateAdmin)
    bestEffort(`toasting ${action}`, () => showToast(success, { type: 'success' }))
  }, [showToast, invalidateAdmin])

  const call = useCallback(async (action, payload, success) => {
    let result
    try {
      await callAdminAuth(action, payload)
      result = { ok: true }
    } catch (err) {
      result = { ok: false, error: err.message }
    }
    if (result.ok) finish(action, success)
    return result
  }, [finish])

  // Wraps a whole operation so `busy` covers the upload as well as the call.
  const withBusy = useCallback(async (fn) => {
    setBusy(true)
    try {
      return await fn()
    } finally {
      setBusy(false)
    }
  }, [])

  const createStory = useCallback(({ title, body, bgColor, imageFile }) => {
    const cleanTitle = (title || '').trim()
    const cleanBody = (body || '').trim()
    if (!cleanTitle && !cleanBody && !imageFile) {
      return Promise.resolve({ ok: false, error: 'Add a title, a message or an image' })
    }
    return withBusy(async () => {
      const upload = await uploadToBucket('story-images', imageFile, 'story')
      if (!upload.ok) return { ok: false, error: `Couldn't upload the image: ${upload.error}` }
      return call('create_story', {
        title: cleanTitle || null,
        body: cleanBody || null,
        imageUrl: upload.url,
        bgColor,
      }, 'Story published')
    })
  }, [withBusy, call])

  const deleteStory = useCallback((id) => withBusy(() => call('delete_story', { id }, 'Story deleted')), [withBusy, call])

  const createPromotion = useCallback(({ title, linkUrl, days, imageFile }) => {
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return Promise.resolve({ ok: false, error: 'Add a title' })
    return withBusy(async () => {
      const upload = await uploadToBucket('promo-images', imageFile, 'promo')
      if (!upload.ok) return { ok: false, error: `Couldn't upload the image: ${upload.error}` }
      return call('create_promotion', {
        title: cleanTitle,
        linkUrl: (linkUrl || '').trim() || null,
        imageUrl: upload.url,
        days,
      }, 'Promotion created')
    })
  }, [withBusy, call])

  const deletePromotion = useCallback((id) => withBusy(() => call('delete_promotion', { id }, 'Promotion deleted')), [withBusy, call])

  return { busy, createStory, deleteStory, createPromotion, deletePromotion }
}

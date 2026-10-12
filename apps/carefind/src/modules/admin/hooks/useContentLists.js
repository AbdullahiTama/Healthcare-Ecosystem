import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { contentRepository } from '../repositories/contentRepository'
import { commerceRepository } from '../repositories/commerceRepository'

// Read the same sources as the legacy useAdminStories/useAdminNews/
// useAdminPromotions (src/hooks/queries.js), but a failure rejects instead of
// becoming an empty list. The legacy hooks stay until Phase 5.
const requireList = (data, what) => {
  if (!Array.isArray(data)) throw new Error(`${what} returned no list`)
  return data
}

export const useStoriesList = () => useQuery({
  queryKey: ['admin', 'content', 'stories'],
  queryFn: async () => requireList(await contentRepository.getStories(), 'stories'),
})

export const useNewsList = () => useQuery({
  queryKey: ['admin', 'content', 'news'],
  queryFn: async () => {
    const r = await callAdminAuth('list_news')
    return { items: requireList(r?.data, 'list_news'), phones: r.phones || {} }
  },
})

export const usePromotionsList = () => useQuery({
  queryKey: ['admin', 'content', 'promotions'],
  queryFn: async () => requireList(await commerceRepository.getPromotions(), 'promotions'),
})

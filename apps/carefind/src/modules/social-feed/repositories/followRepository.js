import { supabase } from '../../../config/supabaseClient'

export function createFollowRepository({ client = supabase } = {}) {
  return {
    async getFollowsForUsers(userIds) {
      if (!userIds || userIds.length === 0) return []
      const { data, error } = await client
        .from('follows')
        .select('id, follower_id, following_id')
        .in('following_id', userIds)
      if (error) throw error
      return data || []
    },

    async getMyFollowing(userId, targetIds) {
      if (!targetIds || targetIds.length === 0) return []
      const { data, error } = await client
        .from('follows')
        .select('following_id')
        .eq('follower_id', userId)
        .in('following_id', targetIds)
      if (error) throw error
      return (data || []).map(d => d.following_id)
    },

    async follow(followerId, followingId) {
      const { error } = await client
        .from('follows').insert({ follower_id: followerId, following_id: followingId })
      if (error) throw error
    },

    async unfollow(followerId, followingId) {
      const { error } = await client
        .from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId)
      if (error) throw error
    },

    async removeFollowById(followId) {
      const { error } = await client.from('follows').delete().eq('id', followId)
      if (error) throw error
    },

    async getFollowersForUsers(userIds) {
      if (!userIds || userIds.length === 0) return []
      const { data, error } = await client
        .from('follows').select('id, follower_id, following_id').in('following_id', userIds)
      if (error) throw error
      return data || []
    },
  }
}

export const followRepository = createFollowRepository()

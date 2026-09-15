import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../config/supabaseClient'
import { postRepository } from '../repositories/postRepository'
import { followRepository } from '../repositories/followRepository'
import { useAuth } from '../../../providers/AuthContext'
import { notify } from '../../../services/notify.js'
import { useToast } from '../../../components/ui'

export function useFeed() {
  const { user } = useAuth()
  const toast = useToast()

  const [posts, setPosts] = useState([])
  const [reactions, setReactions] = useState([])
  const [profiles, setProfiles] = useState({})
  const [follows, setFollows] = useState([])
  const [commentCounts, setCommentCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [feedTab, setFeedTab] = useState('foryou')

  const loadFeed = useCallback(async () => {
    setLoading(true)
    try {
      const postData = await postRepository.getFeed('foryou', 50, 0)

      if (!postData || postData.length === 0) {
        setPosts([])
        setLoading(false)
        return
      }

      const postIds = postData.map(p => p.id)
      const userIds = [...new Set(postData.map(p => p.user_id))]

      const [reactionData, followData] = await Promise.all([
        postRepository.getReactions(postIds),
        followRepository.getFollowsForUsers(userIds),
      ])

      const profileMap = {}
      postData.forEach(p => { if (p.profiles) profileMap[p.user_id] = p.profiles })
      setProfiles(profileMap)

      const followMap = {}
      followData?.forEach(f => {
        if (!followMap[f.following_id]) followMap[f.following_id] = []
        followMap[f.following_id].push(f.follower_id)
      })

      const cCounts = await postRepository.getCommentCounts(postIds)
      setCommentCounts(cCounts)

      const lCounts = {}
      reactionData?.forEach(r => { lCounts[r.post_id] = (lCounts[r.post_id] || 0) + 1 })

      const scored = postData.map(p => {
        const likes = lCounts[p.id] || 0
        const comments = cCounts[p.id] || 0
        const verified = profileMap[p.user_id]?.is_verified ? 1 : 0
        const ageHours = (Date.now() - new Date(p.created_at)) / 3600000
        let recency = 0
        if (ageHours < 1) recency = 15
        else if (ageHours < 6) recency = 10
        else if (ageHours < 24) recency = 6
        else if (ageHours < 72) recency = 3
        else if (ageHours < 168) recency = 1
        return { ...p, _score: (likes * 3) + (comments * 5) + (verified * 25) + recency }
      })

      scored.sort((a, b) => b._score - a._score)
      setPosts(scored)
      setReactions(reactionData || [])
      setFollows(followData || [])
    } catch (e) {
      console.error('Load feed error:', e)
      toast.show('Failed to load feed', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadFeed() }, [loadFeed])

  const toggleLike = useCallback(async (postId) => {
    if (!user) return
    const existing = reactions.find(r => r.post_id === postId && r.user_id === user.id)

    if (existing) {
      setReactions(prev => prev.filter(r => r.id !== existing.id))
      await postRepository.removeReaction(postId, user.id)
    } else {
      const tempReaction = { id: `temp_${Date.now()}`, post_id: postId, user_id: user.id, reaction_type: 'like' }
      setReactions(prev => [...prev, tempReaction])
      await postRepository.addReaction(postId, user.id)
      const post = posts.find(p => p.id === postId)
      if (post) notify({ recipientId: post.user_id, actorId: user.id, type: 'like', message: 'liked your post', link: '/', postId })
    }
  }, [user, reactions, posts, notify])

  const userHasLiked = useCallback((postId) => (reactions || []).some(r => r.post_id === postId && r.user_id === user?.id), [reactions, user])
  const likeCount = useCallback((postId) => (reactions || []).filter(r => r.post_id === postId).length, [reactions])
  const commentTotal = useCallback((postId) => (commentCounts || {})[postId] || 0, [commentCounts])

  return {
    posts,
    reactions,
    profiles,
    follows,
    commentCounts,
    loading,
    feedTab,
    setFeedTab,
    toggleLike,
    userHasLiked,
    likeCount,
    commentTotal,
    loadFeed
  }
}
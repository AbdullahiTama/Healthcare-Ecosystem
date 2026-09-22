import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../config/supabaseClient'
import { healthcareRepository } from '../modules/healthcare-discovery/repositories'
import { attachOwnerProfiles } from '../modules/utils/sellerLookup'
import { fetchViewedStoryIds } from '../modules/social-feed/storyViews'

// ── Query Keys ───────────────────────────────────────────────────────────────
export const keys = {
  profile: (userId) => ['profile', userId],
  profilePosts: (userId) => ['profile', 'posts', userId],
  profileReviews: (subjectId) => ['profile', 'reviews', subjectId],
  profileStories: (userId) => ['profile', 'stories', userId],
  profilePlaylists: (ownerId) => ['profile', 'playlists', ownerId],
  followerCount: (userId) => ['profile', 'followers', userId],
  followingCount: (userId) => ['profile', 'following', userId],
  followStatus: (followerId, followingId) => ['follow', followerId, followingId],
  subscriptionAccess: (viewerId, creatorId) => ['subscription', viewerId, creatorId],
  consultationOffer: (professionalId) => ['consultation', 'offer', professionalId],
  consultationBooked: (viewerId, professionalId) => ['consultation', 'booked', viewerId, professionalId],
  myPosts: (userId) => ['myPosts', userId],
  savedPosts: (userId) => ['savedPosts', userId],
  myPlaylists: (userId) => ['myPlaylists', userId],
  myReviews: (userId) => ['myReviews', userId],
  myStories: (userId) => ['myStories', userId],
  myShows: (userId) => ['myShows', userId],
  walletBalance: (userId) => ['wallet', userId],
  walletData: (userId) => ['wallet', 'data', userId],
  transactions: (userId) => ['transactions', userId],
  banks: ['banks'],
  dashboardData: ['dashboard'],
  newsArticles: ['news', 'articles'],
  myPendingNews: (userId) => ['news', 'pending', userId],
  newsQueueInfo: (userId) => ['news', 'queue', userId],
  featured: ['featured'],
  searchResults: (params) => ['search', params],
  feedProfile: (userId) => ['feed', 'profile', userId],
  feedLatestNews: ['feed', 'latestNews'],
  feedUnreadNotifs: (userId) => ['feed', 'unreadNotifs', userId],
  feedLiveSessions: ['feed', 'liveSessions'],
  feedSeriesList: ['feed', 'seriesList'],
  feedPlatformLive: ['feed', 'platformLive'],
  postCount: (userId) => ['postCount', userId],
  ownedBusinesses: (userId) => ['businesses', 'owned', userId],
  approvedClaims: (userId) => ['claims', 'approved', userId],
  adminData: ['admin', 'data'],
  adminStories: ['admin', 'stories'],
  adminNews: ['admin', 'news'],
  adminPromotions: ['admin', 'promotions'],
  adminSearchLogs: ['admin', 'searchLogs'],
  adminLiveShows: ['admin', 'liveShows'],
  adminShopData: ['admin', 'shopData'],
  adminRoles: ['admin', 'roles'],
}

// ── Profile Queries ──────────────────────────────────────────────────────────

export function useProfile(userId) {
  return useQuery({
    queryKey: keys.profile(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, display_name, is_verified, verification_label, location, website, avatar_url, cover_url, subscription_price, bio, show_followers, phone, email, specialty, country')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!userId,
    staleTime: 60_000,
  })
}

export function useProfilePosts(userId) {
  return useQuery({
    queryKey: keys.profilePosts(userId),
    queryFn: async () => {
      const { data: ownPosts } = await supabase
        .from('posts')
        .select('id, content, created_at, post_type, theme, image_url, image_urls, repost_of, user_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(60)

      const posts = ownPosts || []
      const sourceIds = [...new Set(posts.filter(p => p.repost_of).map(p => p.repost_of))]
      if (sourceIds.length) {
        const { data: sources } = await supabase
          .from('posts')
          .select('id, content, created_at, post_type, theme, image_url, image_urls, user_id')
          .in('id', sourceIds)
        const byId = {}
        ;(sources || []).forEach(s => { byId[s.id] = s })
        return posts.map(p => p.repost_of ? { ...p, source: byId[p.repost_of] || null } : p)
      }
      return posts
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useProfileReviews(subjectId) {
  return useQuery({
    queryKey: keys.profileReviews(subjectId),
    queryFn: async () => {
      const { data } = await supabase
        .from('user_reviews')
        .select('id, rating, comment, created_at, user_id')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false })

      const reviews = data || []
      const userIds = [...new Set(reviews.map(r => r.user_id).filter(Boolean))]
      let reviewers = {}
      if (userIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, display_name, is_verified, specialty, verification_label')
          .in('id', userIds)
        ;(profs || []).forEach(pr => { reviewers[pr.id] = pr })
      }
      return { reviews, reviewers }
    },
    enabled: !!subjectId,
    staleTime: 30_000,
  })
}

export function useProfileStories(userId) {
  return useQuery({
    queryKey: keys.profileStories(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from('stories')
        .select('id, title, body, image_url, bg_color, created_at, position, view_count')
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })

      return (data || []).sort((a, b) => {
        const pa = a.position ?? Infinity
        const pb = b.position ?? Infinity
        if (pa !== pb) return pa - pb
        if ((b.view_count || 0) !== (a.view_count || 0)) return (b.view_count || 0) - (a.view_count || 0)
        return new Date(b.created_at) - new Date(a.created_at)
      })
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useProfilePlaylists(ownerId) {
  return useQuery({
    queryKey: keys.profilePlaylists(ownerId),
    queryFn: async () => {
      const { data } = await supabase
        .from('playlists')
        .select('id, title, description, created_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!ownerId,
    staleTime: 60_000,
  })
}

export function useFollowerCount(userId) {
  return useQuery({
    queryKey: keys.followerCount(userId),
    queryFn: async () => {
      const { count } = await supabase
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', userId)
      return count || 0
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useFollowingCount(userId) {
  return useQuery({
    queryKey: keys.followingCount(userId),
    queryFn: async () => {
      const { count } = await supabase
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', userId)
      return count || 0
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useFollowStatus(followerId, followingId) {
  return useQuery({
    queryKey: keys.followStatus(followerId, followingId),
    queryFn: async () => {
      const { data } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', followerId)
        .eq('following_id', followingId)
        .maybeSingle()
      return !!data
    },
    enabled: !!followerId && !!followingId && followerId !== followingId,
    staleTime: 60_000,
  })
}

// ── Subscription Queries ─────────────────────────────────────────────────────

export function useSubscriptionAccess(viewerId, creatorId) {
  return useQuery({
    queryKey: keys.subscriptionAccess(viewerId, creatorId),
    queryFn: async () => {
      if (!viewerId || !creatorId || viewerId === creatorId) return { active: false, sub: null }
      const { checkAccess } = await import('../modules/subscriptions-monetization/subscriptions.js')
      const res = await checkAccess(viewerId, creatorId)
      return { active: !!res.active, sub: res.sub || null }
    },
    enabled: !!viewerId && !!creatorId && viewerId !== creatorId,
    staleTime: 60_000,
  })
}

export function useConsultationOffer(professionalId) {
  return useQuery({
    queryKey: keys.consultationOffer(professionalId),
    queryFn: async () => {
      const { fetchConsultationOffer } = await import('../modules/subscriptions-monetization/consultations.js')
      return fetchConsultationOffer(professionalId)
    },
    enabled: !!professionalId,
    staleTime: 300_000,
  })
}

export function useConsultationBooked(viewerId, professionalId) {
  return useQuery({
    queryKey: keys.consultationBooked(viewerId, professionalId),
    queryFn: async () => {
      if (!viewerId || !professionalId || viewerId === professionalId) return false
      const { hasBookedConsultation } = await import('../modules/subscriptions-monetization/consultations.js')
      return hasBookedConsultation(viewerId, professionalId)
    },
    enabled: !!viewerId && !!professionalId && viewerId !== professionalId,
    staleTime: 60_000,
  })
}

// ── Profile Queries (Own Profile) ────────────────────────────────────────────

export function useMyPosts(userId) {
  return useQuery({
    queryKey: keys.myPosts(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from('posts')
        .select('id, content, created_at, post_type, image_url, image_urls, repost_of, user_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(60)

      const posts = data || []
      const sourceIds = [...new Set(posts.filter(p => p.repost_of).map(p => p.repost_of))]
      const sourceAuthors = {}
      if (sourceIds.length) {
        const { data: sources } = await supabase
          .from('posts')
          .select('id, content, created_at, post_type, image_url, image_urls, user_id')
          .in('id', sourceIds)
        const byId = {}
        ;(sources || []).forEach(s => { byId[s.id] = s })

        const authorIds = [...new Set((sources || []).map(s => s.user_id).filter(Boolean))]
        if (authorIds.length) {
          const { data: authors } = await supabase
            .from('profiles')
            .select('id, display_name, full_name, is_verified')
            .in('id', authorIds)
          ;(authors || []).forEach(a => { sourceAuthors[a.id] = a })
        }

        return {
          posts: posts.map(p => p.repost_of ? { ...p, source: byId[p.repost_of] || null } : p),
          sourceAuthors,
        }
      }
      return { posts, sourceAuthors }
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useSavedPosts(userId) {
  return useQuery({
    queryKey: keys.savedPosts(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from('saved_posts')
        .select('post_id, posts(id, content, created_at, post_type, image_url, image_urls, repost_of, user_id)')
        .eq('user_id', userId)
        .limit(60)

      const posts = (data || []).map(s => s.posts).filter(Boolean)
      const sourceIds = [...new Set(posts.filter(p => p.repost_of).map(p => p.repost_of))]
      const sourceAuthors = {}
      if (sourceIds.length) {
        const { data: sources } = await supabase
          .from('posts')
          .select('id, content, created_at, post_type, image_url, image_urls, user_id')
          .in('id', sourceIds)
        const byId = {}
        ;(sources || []).forEach(s => { byId[s.id] = s })

        const authorIds = [...new Set((sources || []).map(s => s.user_id).filter(Boolean))]
        if (authorIds.length) {
          const { data: authors } = await supabase
            .from('profiles')
            .select('id, display_name, full_name, is_verified')
            .in('id', authorIds)
          ;(authors || []).forEach(a => { sourceAuthors[a.id] = a })
        }

        return {
          posts: posts.map(p => p.repost_of ? { ...p, source: byId[p.repost_of] || null } : p),
          sourceAuthors,
        }
      }
      return { posts, sourceAuthors }
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useMyPlaylists(userId) {
  return useQuery({
    queryKey: keys.myPlaylists(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from('playlists')
        .select('id, title, description, created_at')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!userId,
    staleTime: 60_000,
  })
}

export function useMyReviews(userId) {
  return useQuery({
    queryKey: keys.myReviews(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from('user_reviews')
        .select('id, rating, comment, created_at, user_id')
        .eq('subject_id', userId)
        .order('created_at', { ascending: false })

      const reviews = data || []
      const userIds = [...new Set(reviews.map(r => r.user_id).filter(Boolean))]
      let reviewers = {}
      if (userIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, display_name, is_verified, specialty, verification_label')
          .in('id', userIds)
        ;(profs || []).forEach(pr => { reviewers[pr.id] = pr })
      }
      return { reviews, reviewers }
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useMyStories(userId) {
  return useQuery({
    queryKey: keys.myStories(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from('stories')
        .select('id, title, body, image_url, bg_color, created_at, position, view_count')
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })

      return (data || []).sort((a, b) => {
        const pa = a.position ?? Infinity
        const pb = b.position ?? Infinity
        if (pa !== pb) return pa - pb
        if ((b.view_count || 0) !== (a.view_count || 0)) return (b.view_count || 0) - (a.view_count || 0)
        return new Date(b.created_at) - new Date(a.created_at)
      })
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useMyShows(userId) {
  return useQuery({
    queryKey: keys.myShows(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from('live_shows')
        .select('id, title, status, scheduled_at, trailer_url, host_id')
        .eq('host_id', userId)
        .in('status', ['live', 'scheduled', 'ended'])
        .order('scheduled_at', { ascending: true })
      return data || []
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useWalletBalance(userId) {
  return useQuery({
    queryKey: keys.walletBalance(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle()
      return data?.balance ?? 0
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useWalletData(userId) {
  return useQuery({
    queryKey: keys.walletData(userId),
    queryFn: async () => {
      let { data: wallet } = await supabase
        .from('wallets').select('*').eq('user_id', userId).maybeSingle()
      if (!wallet) {
        const { data: newWallet } = await supabase
          .from('wallets').insert({ user_id: userId, balance: 0 }).select().single()
        wallet = newWallet
      }
      return wallet
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useTransactions(userId) {
  return useQuery({
    queryKey: keys.transactions(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return data || []
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useBanks() {
  return useQuery({
    queryKey: keys.banks,
    queryFn: async () => {
      const res = await fetch('/api/banks')
      if (!res.ok) throw new Error('Failed to load banks')
      return res.json()
    },
    staleTime: 300_000,
  })
}

const BUSINESSES_COLUMNS = 'id,name,owner_name,owner_email,status,ecommerce_enabled,created_at,category,state,plan'
const AGENTS_COLUMNS = 'id,full_name,email,name,contact_email,status,created_at,tier,state'
const APPLICATIONS_COLUMNS = 'id,applicant_name,applicant_email,type,status,submitted_at,created_at,details'

function getData(res) {
  if (!res) return []
  if (Array.isArray(res.data)) return res.data
  if (Array.isArray(res)) return res
  return []
}

export function useDashboardData() {
  return useQuery({
    queryKey: keys.dashboardData,
    queryFn: async () => {
      const [bizRes, teamsRes, agentsRes, appsRes] = await Promise.all([
        supabase.from('businesses').select(BUSINESSES_COLUMNS).order('created_at', { ascending: false }).limit(100),
        supabase.from('admin_team_members').select('id').limit(1000),
        supabase.from('agents').select(AGENTS_COLUMNS).eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
        supabase.from('applications').select(APPLICATIONS_COLUMNS).eq('type', 'agent').eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
      ])
      if (bizRes.error) throw new Error(bizRes.error.message || 'Failed to load businesses')
      const bizData = getData(bizRes)
      const teamsCount = teamsRes && !teamsRes.error ? (typeof teamsRes.count === 'number' ? teamsRes.count : getData(teamsRes).length) : 0
      const agentsData = !agentsRes || agentsRes.error ? [] : getData(agentsRes).slice(0, 5)
      const appsData = !appsRes || appsRes.error ? [] : getData(appsRes).slice(0, 5)

      const total = bizRes.count != null ? bizRes.count : bizData.length
      const pending = bizData.filter(b => b.status === 'pending').length
      const active = bizData.filter(b => b.status === 'active').length
      const ecommerce = bizData.filter(b => b.ecommerce_enabled === true).length
      const pendingBusinesses = bizData.filter(b => b.status === 'pending').slice(0, 5)

      const seen = new Set()
      const pendingAgents = [
        ...agentsData.map(a => ({ id: a.id, name: a.full_name || a.name || a.email || a.contact_email || 'Agent', email: a.email || a.contact_email || '', source: 'agents', created_at: a.created_at })),
        ...appsData.map(a => ({ id: a.id, name: a.applicant_name || a.applicant_email || 'Applicant', email: a.applicant_email || '', source: 'applications', created_at: a.submitted_at || a.created_at })),
      ].filter(it => { if (seen.has(it.id)) return false; seen.add(it.id); return true }).slice(0, 5)

      return { stats: { total, pending, active, teams: teamsCount, ecommerce }, pendingBusinesses, pendingAgents }
    },
    staleTime: 30 * 1000,
  })
}

export function useOwnedBusinesses(userId) {
  return useQuery({
    queryKey: keys.ownedBusinesses(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, business_type, cover_url, visible_on_carefind')
        .eq('owner_id', userId)
      if (error) throw error
      return data || []
    },
    enabled: !!userId,
    staleTime: 60_000,
  })
}

export function usePostCount(userId) {
  return useQuery({
    queryKey: keys.postCount(userId),
    queryFn: async () => {
      const { count } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      return count || 0
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useApprovedClaims(userId) {
  return useQuery({
    queryKey: keys.approvedClaims(userId),
    queryFn: async () => {
      const { data: claims } = await supabase
        .from('staff_claims')
        .select('id, staff_id, status, staff:staff_id(id, full_name, public_title, business_id)')
        .eq('user_id', userId)
        .eq('status', 'approved')

      const list = claims || []
      const bizIds = [...new Set(list.map(c => c.staff?.business_id).filter(Boolean))]
      let bizMap = {}
      if (bizIds.length) {
        const { data: bizzes } = await supabase
          .from('businesses')
          .select('id, name')
          .in('id', bizIds)
        ;(bizzes || []).forEach(b => { bizMap[b.id] = b.name })
      }

      return list.map(c => ({
        ...c,
        businessName: c.staff?.business_id ? (bizMap[c.staff.business_id] || 'Company') : 'Company',
      }))
    },
    enabled: !!userId,
    staleTime: 60_000,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useToggleFollow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ followerId, followingId, isFollowing }) => {
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId)
      } else {
        await supabase.from('follows').insert({ follower_id: followerId, following_id: followingId })
      }
      return !isFollowing
    },
    onSuccess: (_, { followerId, followingId }) => {
      qc.invalidateQueries({ queryKey: keys.followStatus(followerId, followingId) })
      qc.invalidateQueries({ queryKey: keys.followerCount(followingId) })
    },
  })
}

export function usePostReview(subjectId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, rating, comment }) => {
      const { error } = await supabase.from('user_reviews').insert({
        subject_id: subjectId,
        user_id: userId,
        rating,
        comment: comment?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.profileReviews(subjectId) })
    },
  })
}

// ── News Queries ─────────────────────────────────────────────────────────────

export function useNewsArticles() {
  return useQuery({
    queryKey: keys.newsArticles,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('news')
        .select('id, headline, subtitle, hero_image_url, published_at, created_at, status, author_id, profiles!news_author_id_fkey(full_name, display_name)')
        .eq('status', 'approved')
        .order('published_at', { ascending: false })
        .limit(40)
      if (error) throw error
      return data || []
    },
    staleTime: 2 * 60_000,
  })
}

export function useMyPendingNews(userId) {
  return useQuery({
    queryKey: keys.myPendingNews(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('news')
        .select('id, headline, status, created_at')
        .eq('author_id', userId)
        .neq('status', 'approved')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!userId,
    staleTime: 60_000,
  })
}

const BASE_REVIEW_TIME_MIN = 30
const REVIEW_TIME_PER_ITEM_MIN = 15

function formatEstimatedTime(minutes) {
  if (minutes < 60) return `~${minutes} minutes`
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `~${hours} hour${hours > 1 ? 's' : ''}`
  const days = Math.ceil(hours / 24)
  return `~${days} day${days > 1 ? 's' : ''}`
}

export function useNewsQueueInfo(userId) {
  return useQuery({
    queryKey: keys.newsQueueInfo(userId),
    queryFn: async () => {
      const { data: pendingItems, error } = await supabase
        .from('news')
        .select('id, created_at, author_id')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
      if (error) throw error
      const userSubmissions = []
      const totalPending = pendingItems?.length || 0
      pendingItems?.forEach((item, index) => {
        if (item.author_id === userId) {
          const position = index + 1
          const estimatedMinutes = BASE_REVIEW_TIME_MIN + (position * REVIEW_TIME_PER_ITEM_MIN)
          userSubmissions.push({ id: item.id, position, estimatedMinutes, estimatedHours: Math.ceil(estimatedMinutes / 60), estimatedText: formatEstimatedTime(estimatedMinutes) })
        }
      })
      return { totalPending, userSubmissions }
    },
    enabled: !!userId,
    staleTime: 60_000,
  })
}

// ── Marketplace / Search Queries ─────────────────────────────────────────────

export function useFeatured() {
  return useQuery({
    queryKey: keys.featured,
    queryFn: async () => {
      const promos = await healthcareRepository.getFeaturedPromotions()
      if (promos.length > 0) return { items: promos, type: 'promo' }
      const prods = await healthcareRepository.getFeaturedProducts()
      return { items: prods.filter(p => p.list_on_carefind !== false), type: 'product' }
    },
    staleTime: 300_000,
  })
}

export function useSearchResults({ searchQuery, tab, stateFilter, saleType, specialtyFilter, userId }) {
  return useQuery({
    queryKey: keys.searchResults({ searchQuery, tab, stateFilter, saleType, specialtyFilter }),
    queryFn: async () => {
      const q = (searchQuery || '').trim()
      let products = [], businesses = [], professionals = [], proStories = [], proViewed = new Set(), filterCategories = ['all']

      if (tab === 'products') {
        const data = await healthcareRepository.searchProducts(q, saleType)
        let list = data.filter(p => p.list_on_carefind !== false)
        if (stateFilter) list = list.filter(p => (p.seller_location || p.businesses?.state || p.businesses?.city || '').toLowerCase().includes(stateFilter.toLowerCase()))
        list = await attachOwnerProfiles(list)
        products = list
        const cats = new Set(list.map(p => p.category).filter(Boolean))
        filterCategories = ['all', ...Array.from(cats)]
      } else if (tab === 'businesses') {
        const { data } = await healthcareRepository.buildBusinessesQuery(q, stateFilter).range(0, 39)
        businesses = data || []
      } else if (tab === 'professionals') {
        const data = await healthcareRepository.searchVerifiedProfiles(q, specialtyFilter, stateFilter)
        professionals = data
        const ids = data.map(p => p.id)
        if (ids.length) {
          const rows = await healthcareRepository.getActiveStoriesByUsers(ids)
          proStories = rows || []
          if (proStories.length && userId) {
            proViewed = await fetchViewedStoryIds(supabase, proStories.map(x => x.id))
          }
        }
      }

      // Log search (fire-and-forget)
      if (q || stateFilter || specialtyFilter) {
        healthcareRepository.logSearch({ query: q || null, category: tab, user_id: userId || null, results_count: products.length || businesses.length || professionals.length, found: (products.length || businesses.length || professionals.length) > 0 }).catch(() => {})
      }

      return { products, businesses, professionals, proStories, proViewed, filterCategories }
    },
    enabled: tab !== 'shop',
    staleTime: 30_000,
  })
}

// ── Feed Ancillary Queries ───────────────────────────────────────────────────

export function useFeedProfile(userId) {
  return useQuery({
    queryKey: keys.feedProfile(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, display_name, phone, is_verified, verification_label, avatar_url')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!userId,
    staleTime: 2 * 60_000,
  })
}

export function useLatestNews() {
  return useQuery({
    queryKey: keys.feedLatestNews,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('news')
        .select('id, headline, hero_image_url, published_at')
        .eq('status', 'approved')
        .order('published_at', { ascending: false })
        .limit(6)
      if (error) throw error
      return data || []
    },
    staleTime: 2 * 60_000,
  })
}

export function useUnreadNotifs(userId) {
  return useQuery({
    queryKey: keys.feedUnreadNotifs(userId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId)
        .eq('read', false)
      if (error) throw error
      return count || 0
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useLiveSessions() {
  return useQuery({
    queryKey: keys.feedLiveSessions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('live_sessions')
        .select('*, profiles(full_name, display_name, specialty)')
        .eq('status', 'live')
        .order('started_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data || []
    },
    staleTime: 30_000,
  })
}

export function useSeriesList() {
  return useQuery({
    queryKey: keys.feedSeriesList,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('playlists')
        .select('id, title, description, owner_id, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data || []
    },
    staleTime: 2 * 60_000,
  })
}

export function usePlatformLive() {
  return useQuery({
    queryKey: keys.feedPlatformLive,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('live_shows')
        .select('id, title')
        .eq('status', 'live')
        .eq('is_platform', true)
        .order('started_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return data && data[0] ? data[0] : null
    },
    staleTime: 30_000,
  })
}

// ── Admin Queries ─────────────────────────────────────────────────────────────

function adminToken() {
  return localStorage.getItem('admin_token')
}

function adminRole() {
  try { return JSON.parse(localStorage.getItem('admin_user') || '{}').role || '' } catch { return '' }
}

export function useAdminData(enabled = true) {
  return useQuery({
    queryKey: keys.adminData,
    queryFn: async () => {
      const { dashboardRepository } = await import('../modules/admin/repositories/dashboardRepository')
      const { usersRepository } = await import('../modules/admin/repositories/usersRepository')
      const { contentRepository } = await import('../modules/admin/repositories/contentRepository')
      const { commerceRepository } = await import('../modules/admin/repositories/commerceRepository')
      const { callAdminAuth } = await import('../modules/admin/adminApi')
      const token = adminToken()
      const [postsData, usersData, , verifRes, claimsRes, reportsRes, txRes, tasksRes, teamsRes, bizRes, staffRes, withdrawRes, taskSubRes, consultRes, newsRes] = await Promise.all([
        contentRepository.getPosts({ limit: 50 }).catch(() => []),
        usersRepository.getUsers({ limit: 100 }).catch(() => []),
        usersRepository.getUsers({ limit: 1 }).then(() => 0).catch(() => 0),
        callAdminAuth('list_verification_requests', { token }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
        callAdminAuth('list_business_claims', { token }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
        callAdminAuth('list_reports', { token }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
        callAdminAuth('list_transactions', { token }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
        dashboardRepository.getTasks().then(data => ({ data })).catch(() => ({ data: [] })),
        callAdminAuth('list_teams', { token }).then(r => ({ data: r.teams })).catch(() => ({ data: [] })),
        commerceRepository.getBusinesses().then(data => ({ data })).catch(() => ({ data: [] })),
        callAdminAuth('list_staff', { token }).then(r => ({ data: r.staff })).catch(() => ({ data: [] })),
        callAdminAuth('list_withdrawal_requests', { token }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
        callAdminAuth('list_task_submissions', { token }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
        dashboardRepository.getProfessionalConsultations().then(data => ({ data })).catch(() => ({ data: [] })),
        callAdminAuth('list_news', { token }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      ])

      const vData = verifRes.data || []
      const cData = claimsRes.data || []
      const rData = reportsRes.data || []
      const txData = txRes.data || []
      const tasksData = tasksRes.data || []
      const teamsData = teamsRes.data || []
      const bizData = bizRes.data || []
      const staffData = staffRes.data || []
      const wData = withdrawRes.data || []
      const tsData = taskSubRes.data || []
      const consultData = consultRes.data || []
      const newsData = newsRes.data || []

      const phoneMap = {}
      vData.forEach(v => { if (v.user_id && v.phone) phoneMap[v.user_id] = v.phone })

      const notifications = [
        ...vData.filter(v => v.status === 'pending').map(v => ({ id: v.id, type: 'verification', icon: '\u{1FA7A}', title: `Verification request from ${v.full_name}`, subtitle: v.profession, time: v.created_at, severity: 'warning', tab: 'verifications', role: 'verification_officer' })),
        ...cData.filter(c => c.status === 'pending').map(c => ({ id: c.id, type: 'claim', icon: '\u{1F3E5}', title: `Business claim: ${c.businesses?.name}`, subtitle: 'Pending approval', time: c.created_at, severity: 'warning', tab: 'claims', role: 'business_manager' })),
        ...rData.filter(r => r.status === 'pending').map(r => ({ id: r.id, type: 'report', icon: '\u{1F6A9}', title: `Post reported: ${r.reason}`, subtitle: r.posts?.content?.slice(0, 60), time: r.created_at, severity: 'urgent', tab: 'reports', role: 'moderator' })),
        ...wData.filter(w => w.status === 'pending').map(w => ({ id: w.id, type: 'withdrawal', icon: '\u{1F4B0}', title: `Withdrawal request: \u20A6${(w.amount * 200).toLocaleString()}`, subtitle: w.profiles?.full_name || 'User', time: w.created_at, severity: 'warning', tab: 'withdrawals', role: 'super_admin' })),
        ...tsData.filter(s => s.status === 'pending').map(s => ({ id: s.id, type: 'task', icon: '\u{1F4CB}', title: `Task submission: ${s.tasks?.title}`, subtitle: s.profiles?.full_name || 'Professional', time: s.created_at, severity: 'info', tab: 'tasks', role: 'super_admin' })),
        ...consultData.map(c => ({ id: c.id, type: 'consultation', icon: '\u{1F4C5}', title: 'New consultation booking', subtitle: c.profiles?.full_name || 'Professional', time: c.created_at, severity: 'info', tab: 'overview', role: 'verification_officer' })),
        ...newsData.filter(n => n.status === 'pending').map(n => ({ id: n.id, type: 'news', icon: '\u{1F4F0}', title: `News submission: ${(n.headline || 'New article').slice(0, 60)}`, subtitle: n.profiles?.full_name || n.profiles?.display_name || 'Contributor', time: n.created_at, severity: 'warning', tab: 'news', role: 'super_admin' })),
      ].sort((a, b) => new Date(b.time) - new Date(a.time))

      const usersCount = await usersRepository.getUsers({ limit: 1 }).then(() => 0).catch(() => 0)
      const pendingVerifs = vData.filter(v => v.status === 'pending').length
      const pendingClaims = cData.filter(c => c.status === 'pending').length
      const openReports = rData.filter(r => r.status === 'pending').length
      const rev = txData.filter(t => t.type === 'topup').reduce((s, t) => s + (t.naira_amount || 0), 0)
      const pendingWithdrawals = wData.filter(w => w.status === 'pending').length
      const pendingTaskSubs = tsData.filter(s => s.status === 'pending').length
      const newConsults = consultData.length
      const pendingNews = newsData.filter(n => n.status === 'pending').length
      const totalNotifs = pendingVerifs + pendingClaims + openReports + pendingWithdrawals + pendingTaskSubs + pendingNews

      const role = adminRole()
      let roleNotifCount = 0
      if (role === 'super_admin') roleNotifCount = totalNotifs
      else if (role === 'verification_officer') roleNotifCount = pendingVerifs + newConsults
      else if (role === 'business_manager') roleNotifCount = pendingClaims
      else if (role === 'moderator' || role === 'content_manager') roleNotifCount = openReports + pendingNews
      else if (role === 'analytics_manager') roleNotifCount = pendingWithdrawals
      else roleNotifCount = pendingNews ? pendingNews : 0

      return {
        posts: postsData || [],
        users: usersData || [],
        verifications: vData,
        claims: cData,
        reports: rData,
        transactions: txData,
        tasks: tasksData,
        teams: teamsData,
        businesses: bizData,
        staff: staffData,
        withdrawals: wData,
        notifications,
        phoneMap,
        notifCount: totalNotifs,
        roleNotifCount,
        stats: {
          users: usersCount || usersData?.length || 0,
          posts: postsData?.length || 0,
          pendingVerifs,
          pendingClaims,
          reports: openReports,
          revenue: rev / 100,
          transactions: txData?.length || 0,
        },
      }
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useAdminStories(enabled = true) {
  return useQuery({
    queryKey: keys.adminStories,
    queryFn: async () => {
      const { contentRepository } = await import('../modules/admin/repositories/contentRepository')
      const data = await contentRepository.getStories()
      return data || []
    },
    enabled,
    staleTime: 60_000,
  })
}

export function useAdminNews(enabled = true) {
  return useQuery({
    queryKey: keys.adminNews,
    queryFn: async () => {
      const { callAdminAuth } = await import('../modules/admin/adminApi')
      const token = adminToken()
      try {
        const { data, phones } = await callAdminAuth('list_news', { token })
        return { items: data || [], phones: phones || {} }
      } catch (error) {
        if (/invalid|expired|unauthori[sz]ed|session/i.test(error?.message || '')) throw error
        return { items: [], phones: {} }
      }
    },
    enabled,
    staleTime: 60_000,
  })
}

export function useAdminPromotions(enabled = true) {
  return useQuery({
    queryKey: keys.adminPromotions,
    queryFn: async () => {
      const { commerceRepository } = await import('../modules/admin/repositories/commerceRepository')
      const data = await commerceRepository.getPromotions()
      return data || []
    },
    enabled,
    staleTime: 60_000,
  })
}

export function useAdminSearchLogs(enabled = true) {
  return useQuery({
    queryKey: keys.adminSearchLogs,
    queryFn: async () => {
      const { callAdminAuth } = await import('../modules/admin/adminApi')
      const token = adminToken()
      try {
        const { data } = await callAdminAuth('list_search_logs', { token })
        return data || []
      } catch {
        return []
      }
    },
    enabled,
    staleTime: 60_000,
  })
}

export function useAdminLiveShows(enabled = true) {
  return useQuery({
    queryKey: keys.adminLiveShows,
    queryFn: async () => {
      const [activeRes, schedRes] = await Promise.all([
        supabase.from('live_shows').select('id, title, status, started_at, host_id').eq('status', 'live').order('started_at', { ascending: false }),
        supabase.from('live_shows').select('id, title, status, scheduled_at, trailer_url, host_id').eq('status', 'scheduled').order('scheduled_at', { ascending: true }),
      ])
      return { active: activeRes.data || [], scheduled: schedRes.data || [] }
    },
    enabled,
    staleTime: 30_000,
  })
}

export function useAdminShopData(enabled = true) {
  return useQuery({
    queryKey: keys.adminShopData,
    queryFn: async () => {
      const { callAdminAuth } = await import('../modules/admin/adminApi')
      const token = adminToken()
      const [appsRes, prodsRes, ordersRes] = await Promise.all([
        callAdminAuth('list_ecommerce_applications', { token }).catch(() => ({ data: [] })),
        callAdminAuth('list_ecommerce_products_admin', { token }).catch(() => ({ data: [] })),
        callAdminAuth('list_shop_orders_admin', { token }).catch(() => ({ data: [] })),
      ])
      return { apps: appsRes.data || [], products: prodsRes.data || [], orders: ordersRes.data || [] }
    },
    enabled,
    staleTime: 60_000,
  })
}

export function useAdminRoles(enabled = true) {
  return useQuery({
    queryKey: keys.adminRoles,
    queryFn: async () => {
      const { callAdminAuth } = await import('../modules/admin/adminApi')
      const token = adminToken()
      try {
        const { data } = await callAdminAuth('list_admin_roles', { token })
        return data || []
      } catch {
        return []
      }
    },
    enabled,
    staleTime: 60_000,
  })
}

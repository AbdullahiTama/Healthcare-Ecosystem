// Smart Recommendations Engine
// Provides content and product recommendations based on user behavior

import { supabase } from '../config/supabaseClient'

// Get user's interaction history
async function getUserInteractions(userId) {
  const [likedPosts, savedPosts, comments, viewedNews] = await Promise.all([
    supabase.from('post_likes').select('post_id').eq('user_id', userId),
    supabase.from('saved_posts').select('post_id').eq('user_id', userId),
    supabase.from('comments').select('post_id, content').eq('user_id', userId),
    supabase.from('news_views').select('news_id').eq('user_id', userId),
  ])
  
  return {
    likedPostIds: likedPosts.data?.map(p => p.post_id) || [],
    savedPostIds: savedPosts.data?.map(p => p.post_id) || [],
    commentedPostIds: comments.data?.map(c => c.post_id) || [],
    viewedNewsIds: viewedNews.data?.map(n => n.news_id) || [],
  }
}

// Extract categories/tags from posts user has interacted with
async function getUserPreferences(userId, interactions) {
  const allPostIds = [
    ...interactions.likedPostIds,
    ...interactions.savedPostIds,
    ...interactions.commentedPostIds,
  ]
  
  if (allPostIds.length === 0) return { categories: [], tags: [] }
  
  const { data: posts } = await supabase
    .from('posts')
    .select('category, tags')
    .in('id', allPostIds.slice(0, 50)) // Limit to avoid large queries
  
  const categoryCount = {}
  const tagCount = {}
  
  posts?.forEach(post => {
    if (post.category) {
      categoryCount[post.category] = (categoryCount[post.category] || 0) + 1
    }
    if (post.tags && Array.isArray(post.tags)) {
      post.tags.forEach(tag => {
        tagCount[tag] = (tagCount[tag] || 0) + 1
      })
    }
  })
  
  // Sort by frequency
  const categories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat]) => cat)
  
  const tags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag)
  
  return { categories, tags }
}

// Recommend posts based on user preferences
async function recommendPosts(userId, preferences, interactions, limit = 10) {
  const interactedPostIds = [
    ...interactions.likedPostIds,
    ...interactions.savedPostIds,
    ...interactions.commentedPostIds,
  ]
  
  let query = supabase
    .from('posts')
    .select('id, content, category, tags, created_at, like_count, user_id, profiles(full_name, username, avatar_url)')
    .not('id', 'in', `(${interactedPostIds.join(',')})`)
    .order('created_at', { ascending: false })
  
  // Filter by preferred categories if any
  if (preferences.categories.length > 0) {
    query = query.in('category', preferences.categories)
  }
  
  const { data: posts } = await query.limit(limit)
  
  return posts || []
}

// Recommend news articles based on viewing history
async function recommendNews(userId, interactions, limit = 5) {
  const { data: news } = await supabase
    .from('news')
    .select('id, title, category, created_at, author_id, profiles(full_name)')
    .eq('status', 'approved')
    .not('id', 'in', `(${interactions.viewedNewsIds.join(',') || 'null'})`)
    .order('created_at', { ascending: false })
    .limit(limit)
  
  return news || []
}

// Recommend products based on order history
async function recommendProducts(userId, limit = 10) {
  // Get user's order history
  const { data: orders } = await supabase
    .from('orders')
    .select('id, status')
    .eq('user_id', userId)
    .eq('status', 'completed')
  
  if (!orders || orders.length === 0) {
    // No order history, return popular products
    const { data: products } = await supabase
      .from('products')
      .select('id, name, category, price, image_url, rating, review_count')
      .eq('is_active', true)
      .order('rating', { ascending: false })
      .limit(limit)
    
    return products || []
  }
  
  const orderIds = orders.map(o => o.id)
  
  // Get products from order history
  const { data: orderItems } = await supabase
    .from('order_items')
    .select('product_id')
    .in('order_id', orderIds)
  
  const purchasedProductIds = orderItems?.map(i => i.product_id) || []
  
  // Get categories of purchased products
  const { data: purchasedProducts } = await supabase
    .from('products')
    .select('category')
    .in('id', purchasedProductIds)
  
  const categories = [...new Set(purchasedProducts?.map(p => p.category).filter(Boolean))]
  
  // Recommend products from same categories
  let query = supabase
    .from('products')
    .select('id, name, category, price, image_url, rating, review_count')
    .eq('is_active', true)
    .not('id', 'in', `(${purchasedProductIds.join(',') || 'null'})`)
  
  if (categories.length > 0) {
    query = query.in('category', categories)
  }
  
  const { data: products } = await query
    .order('rating', { ascending: false })
    .limit(limit)
  
  return products || []
}

// Main recommendation function
export async function getRecommendations(userId) {
  try {
    const interactions = await getUserInteractions(userId)
    const preferences = await getUserPreferences(userId, interactions)
    
    const [postRecommendations, newsRecommendations, productRecommendations] = await Promise.all([
      recommendPosts(userId, preferences, interactions),
      recommendNews(userId, interactions),
      recommendProducts(userId),
    ])
    
    return {
      posts: postRecommendations,
      news: newsRecommendations,
      products: productRecommendations,
      preferences,
    }
  } catch (error) {
    console.error('Error getting recommendations:', error)
    return {
      posts: [],
      news: [],
      products: [],
      preferences: { categories: [], tags: [] },
    }
  }
}

// Get trending content (high engagement in last 7 days)
export async function getTrendingContent(limit = 10) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  
  const { data: posts } = await supabase
    .from('posts')
    .select('id, content, category, created_at, like_count, comment_count, user_id, profiles(full_name, username, avatar_url)')
    .gte('created_at', sevenDaysAgo)
    .order('like_count', { ascending: false })
    .limit(limit)
  
  return posts || []
}

// Get personalized feed for user
export async function getPersonalizedFeed(userId, limit = 20) {
  const recommendations = await getRecommendations(userId)
  const trending = await getTrendingContent(5)
  
  // Combine recommendations and trending, removing duplicates
  const recommendedIds = new Set(recommendations.posts.map(p => p.id))
  const combined = [
    ...recommendations.posts,
    ...trending.filter(p => !recommendedIds.has(p.id)),
  ]
  
  return combined.slice(0, limit)
}

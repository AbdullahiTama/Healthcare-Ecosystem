// Admin AI Co-pilot - Query parser and executor
// Converts natural language queries to structured database queries
// Phase 4: Routes all queries through service-role API via callAdminAuth
//          Adds sentiment analysis and recommendation query patterns

import { callAdminAuth } from '../modules/admin/adminApi'

const QUERY_PATTERNS = {
  // User queries
  users: {
    patterns: [
      /(?:show|find|get|list)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?users/i,
      /how\s+many\s+users/i,
      /users?\s+(?:from|in|at)\s+(\w+)/i,
      /verified\s+users/i,
      /new\s+users/i,
    ],
    handler: async (match) => {
      const token = localStorage.getItem('admin_token')
      if (match[0].includes('how many')) {
        const { data } = await callAdminAuth('list_user_profiles', { token, limit: 1 })
        return { type: 'count', value: data?.length || 0, label: 'Total users' }
      }
      
      if (match[0].includes('verified')) {
        const { data } = await callAdminAuth('list_user_profiles', { token, verified: 'verified' })
        return { type: 'list', data: (data || []).slice(0, 10), label: 'Verified users' }
      }
      
      if (match[0].includes('new')) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data } = await callAdminAuth('list_user_profiles', { token })
        const recent = (data || []).filter(u => u.created_at >= sevenDaysAgo).slice(0, 10)
        return { type: 'list', data: recent, label: 'New users (last 7 days)' }
      }
      
      // Default: show recent users
      const { data } = await callAdminAuth('list_user_profiles', { token })
      return { type: 'list', data: (data || []).slice(0, 10), label: 'Recent users' }
    }
  },
  
  // News queries
  news: {
    patterns: [
      /(?:show|find|get|list)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?news/i,
      /pending\s+news/i,
      /how\s+many\s+(?:pending\s+)?news/i,
      /approved\s+news/i,
    ],
    handler: async (match) => {
      const token = localStorage.getItem('admin_token')
      const { data: allNews } = await callAdminAuth('list_news', { token })
      const news = allNews || []
      
      if (match[0].includes('how many')) {
        if (match[0].includes('pending')) {
          const pending = news.filter(n => n.status === 'pending')
          return { type: 'count', value: pending.length, label: 'Pending news articles' }
        }
        return { type: 'count', value: news.length, label: 'Total news articles' }
      }
      
      if (match[0].includes('pending')) {
        const pending = news.filter(n => n.status === 'pending').slice(0, 10)
        return { type: 'list', data: pending.map(n => ({ id: n.id, title: n.headline || n.title, created_at: n.created_at })), label: 'Pending news articles' }
      }
      
      if (match[0].includes('approved')) {
        const approved = news.filter(n => n.status === 'approved').slice(0, 10)
        return { type: 'list', data: approved.map(n => ({ id: n.id, title: n.headline || n.title, created_at: n.created_at })), label: 'Recently approved news' }
      }
      
      return { type: 'list', data: news.slice(0, 10).map(n => ({ id: n.id, title: n.headline || n.title, status: n.status, created_at: n.created_at })), label: 'Recent news articles' }
    }
  },
  
  // Orders queries
  orders: {
    patterns: [
      /(?:show|find|get|list)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?orders?/i,
      /pending\s+orders?/i,
      /how\s+many\s+(?:pending\s+)?orders?/i,
      /(?:today'?s?\s+)?orders?\s+(?:from|in)\s+(\w+)/i,
    ],
    handler: async (match) => {
      const token = localStorage.getItem('admin_token')
      if (match[0].includes('how many')) {
        const { data } = await callAdminAuth('list_shop_orders_admin', { token })
        const orders = data || []
        if (match[0].includes('pending')) {
          const pending = orders.filter(o => ['pending_payment', 'paid'].includes(o.status))
          return { type: 'count', value: pending.length, label: 'Pending orders' }
        }
        return { type: 'count', value: orders.length, label: 'Total orders' }
      }
      
      if (match[0].includes('pending')) {
        const { data } = await callAdminAuth('list_shop_orders_admin', { token })
        const pending = (data || []).filter(o => ['pending_payment', 'paid'].includes(o.status)).slice(0, 10)
        return { type: 'list', data: pending.map(o => ({ id: o.id, order_ref: o.order_ref, status: o.status, total_kobo: o.total_kobo, created_at: o.created_at })), label: 'Pending orders' }
      }
      
      const { data } = await callAdminAuth('list_shop_orders_admin', { token })
      return { type: 'list', data: (data || []).slice(0, 10).map(o => ({ id: o.id, order_ref: o.order_ref, status: o.status, total_kobo: o.total_kobo, created_at: o.created_at })), label: 'Recent orders' }
    }
  },
  
  // Revenue queries
  revenue: {
    patterns: [
      /(?:show|calculate|get)\s+(?:me\s+)?(?:total\s+)?revenue/i,
      /how\s+much\s+(?:money|revenue)/i,
      /revenue\s+(?:from|in|for)\s+(?:this\s+)?(?:month|week|year|today)/i,
      /(?:today'?s?\s+)?sales/i,
    ],
    handler: async (match) => {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('list_transactions', { token })
      const txns = (data || []).filter(t => t.type === 'topup')
      
      let startDate = new Date()
      let label = 'Total revenue'
      
      if (match[0].includes('today')) {
        startDate.setHours(0, 0, 0, 0)
        label = "Today's revenue"
      } else if (match[0].includes('week')) {
        startDate.setDate(startDate.getDate() - 7)
        label = 'Revenue this week'
      } else if (match[0].includes('month')) {
        startDate.setMonth(startDate.getMonth() - 1)
        label = 'Revenue this month'
      } else if (match[0].includes('year')) {
        startDate.setFullYear(startDate.getFullYear() - 1)
        label = 'Revenue this year'
      }
      
      const filtered = txns.filter(t => new Date(t.created_at) >= startDate)
      const total = filtered.reduce((sum, t) => sum + (t.naira_amount || 0), 0)
      return { type: 'revenue', value: total, label }
    }
  },
  
  // Posts queries
  posts: {
    patterns: [
      /(?:show|find|get|list)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?posts?/i,
      /how\s+many\s+posts/i,
      /reported\s+posts?/i,
      /popular\s+posts?/i,
      /flagged\s+posts?/i,
    ],
    handler: async (match) => {
      const token = localStorage.getItem('admin_token')
      if (match[0].includes('how many')) {
        const { data } = await callAdminAuth('list_posts', { token, limit: 1 })
        return { type: 'count', value: data?.length || 0, label: 'Total posts' }
      }

      if (match[0].includes('reported') || match[0].includes('flagged')) {
        const { data } = await callAdminAuth('list_reports', { token })
        const reported = (data || []).map(r => ({ id: r.post_id, content: r.posts?.content?.slice(0, 60), reason: r.reason, created_at: r.created_at })).slice(0, 10)
        return { type: 'list', data: reported, label: 'Reported posts' }
      }

      if (match[0].includes('popular')) {
        const { data } = await callAdminAuth('list_posts', { token, limit: 10 })
        return { type: 'list', data: (data || []).slice(0, 10).map(p => ({ id: p.id, content: p.content?.slice(0, 60), view_count: p.view_count, created_at: p.created_at })), label: 'Popular posts' }
      }

      const { data } = await callAdminAuth('list_posts', { token, limit: 10 })
      return { type: 'list', data: (data || []).map(p => ({ id: p.id, content: p.content?.slice(0, 60), created_at: p.created_at })), label: 'Recent posts' }
    }
  },

  // Moderation queue queries
  moderation: {
    patterns: [
      /(?:show|find|get|list)\s+(?:me\s+)?(?:the\s+)?moderation\s*(?:queue)?/i,
      /moderation\s+queue/i,
      /pending\s+(?:reports?|moderation)/i,
      /how\s+many\s+pending\s+(?:reports?|moderation)/i,
      /show\s+me\s+posts?\s+flagged/i,
    ],
    handler: async (match) => {
      const token = localStorage.getItem('admin_token')
      
      if (match[0].includes('how many')) {
        const { data } = await callAdminAuth('list_reports', { token })
        const pending = (data || []).filter(r => r.status === 'pending')
        return { type: 'count', value: pending.length, label: 'Pending moderation items' }
      }

      const { data: reports } = await callAdminAuth('list_reports', { token })
      const { data: flaggedPosts } = await callAdminAuth('list_posts', { token, limit: 50 })

      const items = [
        ...((reports || []).filter(r => r.status === 'pending').slice(0, 10).map(r => ({
          id: r.id,
          type: 'report',
          reason: r.reason,
          content: r.posts?.content?.slice(0, 60),
          created_at: r.created_at,
        }))),
        ...((flaggedPosts || []).filter(p => p.report_count > 0).slice(0, 5).map(p => ({
          id: p.id,
          type: 'flagged_post',
          reason: `${p.report_count} reports`,
          content: p.content?.slice(0, 60),
          created_at: p.created_at,
        }))),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

      return { type: 'list', data: items, label: 'Moderation queue items' }
    }
  },

  // Audit log queries
  audit: {
    patterns: [
      /(?:show|find|get|list)\s+(?:me\s+)?(?:the\s+)?audit\s*(?:log)?/i,
      /audit\s+log/i,
      /who\s+(?:did|approved|deleted|rejected)/i,
      /admin\s+(?:actions?|activity)/i,
    ],
    handler: async (match) => {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('list_audit_logs', { token })
      return { type: 'list', data: (data || []).slice(0, 10), label: 'Recent admin actions' }
    }
  },

  // Sentiment analysis queries
  sentiment: {
    patterns: [
      /(?:analyze|check|what(?:'s| is))\s+(?:the\s+)?sentiment/i,
      /(?:analyze|check)\s+this\s+(?:post|message|content|comment)/i,
      /is\s+this\s+(?:toxic|harassment|spam)/i,
      /(?:check|analyze)\s+for\s+(?:toxicity|harassment|spam)/i,
      /sentiment\s+(?:of|on|for)\s+(?:this|the)/i,
    ],
    handler: async (match, _supabase, extra) => {
      const text = extra?.text || extra?.content || ''
      if (!text) {
        return { type: 'sentiment', sentiment: { score: 0, category: 'neutral', confidence: 0, reason: 'No content provided for analysis' }, label: 'Sentiment Analysis' }
      }
      const token = localStorage.getItem('admin_token')
      const sentiment = await callAdminAuth('analyze_sentiment', { token, text })
      return { type: 'sentiment', sentiment, label: 'Sentiment Analysis' }
    }
  },

  // Recommendation queries
  recommendations: {
    patterns: [
      /what\s+should\s+I\s+do\s+(?:next|now)/i,
      /suggest\s+(?:an?\s+)?(?:action|next)/i,
      /recommend/i,
      /what(?:'s| is)\s+next/i,
      /help\s+me\s+decide/i,
      /next\s+(?:step|action)/i,
    ],
    handler: async (match, _supabase, extra) => {
      const token = localStorage.getItem('admin_token')
      const currentTab = extra?.currentTab || 'overview'
      const recentActions = extra?.recentActions || []
      const { recommendations } = await callAdminAuth('get_recommendations', { token, currentTab, recentActions })
      return { type: 'recommendations', recommendations: recommendations || [], label: 'Suggestions' }
    }
  },
}

// Parse natural language query and return structured result
// extra: { text, content, currentTab, recentActions } for sentiment/recommendation queries
export async function parseAdminQuery(query, supabase, extra = {}) {
  const normalizedQuery = query.trim().toLowerCase()
  
  // Try to match against known patterns
  for (const [category, config] of Object.entries(QUERY_PATTERNS)) {
    for (const pattern of config.patterns) {
      const match = normalizedQuery.match(pattern)
      if (match) {
        try {
          const result = await config.handler(match, supabase, extra)
          return {
            success: true,
            category,
            ...result,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to execute query: ${error.message}`,
          }
        }
      }
    }
  }
  
  // No pattern matched
  return {
    success: false,
    error: 'I couldn\'t understand that query. Try asking about users, news, orders, revenue, posts, sentiment analysis, recommendations, or the moderation queue.',
    suggestions: [
      'Show me pending news',
      'How many users do we have?',
      'Show me today\'s revenue',
      'Analyze this post for sentiment',
      'What should I do next?',
      'Show moderation queue',
    ],
  }
}

// Format query result for display
export function formatQueryResult(result) {
  if (!result.success) {
    return {
      type: 'error',
      message: result.error,
      suggestions: result.suggestions || [],
    }
  }
  
  switch (result.type) {
    case 'count':
      return {
        type: 'stat',
        label: result.label,
        value: result.value?.toLocaleString() || '0',
      }
    
    case 'list':
      return {
        type: 'table',
        label: result.label,
        data: result.data || [],
        columns: Object.keys(result.data?.[0] || {}),
      }
    
    case 'revenue':
      return {
        type: 'stat',
        label: result.label,
        value: `₦${result.value?.toLocaleString() || '0'}`,
      }

    case 'sentiment':
      return {
        type: 'sentiment',
        label: result.label,
        sentiment: result.sentiment,
      }

    case 'recommendations':
      return {
        type: 'recommendations',
        label: result.label,
        recommendations: result.recommendations || [],
      }
    
    default:
      return {
        type: 'text',
        message: JSON.stringify(result, null, 2),
      }
  }
}

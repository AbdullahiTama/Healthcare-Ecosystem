// Admin AI Co-pilot - Query parser and executor
// Converts natural language queries to structured database queries

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
    handler: async (match, supabase) => {
      if (match[0].includes('how many')) {
        const { count, error } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
        return { type: 'count', value: count, label: 'Total users' }
      }
      
      if (match[0].includes('verified')) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, username, created_at')
          .eq('is_verified', true)
          .order('created_at', { ascending: false })
          .limit(10)
        return { type: 'list', data, label: 'Verified users' }
      }
      
      if (match[0].includes('new')) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, username, created_at')
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(10)
        return { type: 'list', data, label: 'New users (last 7 days)' }
      }
      
      // Default: show recent users
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, created_at')
        .order('created_at', { ascending: false })
        .limit(10)
      return { type: 'list', data, label: 'Recent users' }
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
    handler: async (match, supabase) => {
      if (match[0].includes('how many')) {
        if (match[0].includes('pending')) {
          const { count, error } = await supabase
            .from('news')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')
          return { type: 'count', value: count, label: 'Pending news articles' }
        }
        const { count, error } = await supabase
          .from('news')
          .select('*', { count: 'exact', head: true })
        return { type: 'count', value: count, label: 'Total news articles' }
      }
      
      if (match[0].includes('pending')) {
        const { data, error } = await supabase
          .from('news')
          .select('id, title, created_at, author_id')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(10)
        return { type: 'list', data, label: 'Pending news articles' }
      }
      
      if (match[0].includes('approved')) {
        const { data, error } = await supabase
          .from('news')
          .select('id, title, created_at, author_id')
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(10)
        return { type: 'list', data, label: 'Recently approved news' }
      }
      
      // Default: show recent news
      const { data, error } = await supabase
        .from('news')
        .select('id, title, status, created_at, author_id')
        .order('created_at', { ascending: false })
        .limit(10)
      return { type: 'list', data, label: 'Recent news articles' }
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
    handler: async (match, supabase) => {
      if (match[0].includes('how many')) {
        if (match[0].includes('pending')) {
          const { count, error } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')
          return { type: 'count', value: count, label: 'Pending orders' }
        }
        const { count, error } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
        return { type: 'count', value: count, label: 'Total orders' }
      }
      
      if (match[0].includes('pending')) {
        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, status, total_amount, created_at, user_id')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(10)
        return { type: 'list', data, label: 'Pending orders' }
      }
      
      // Default: show recent orders
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, total_amount, created_at, user_id')
        .order('created_at', { ascending: false })
        .limit(10)
      return { type: 'list', data, label: 'Recent orders' }
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
    handler: async (match, supabase) => {
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
      
      const { data, error } = await supabase
        .from('orders')
        .select('total_amount, status')
        .eq('status', 'completed')
        .gte('created_at', startDate.toISOString())
      
      if (error) throw error
      
      const total = data.reduce((sum, order) => sum + (order.total_amount || 0), 0)
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
    ],
    handler: async (match, supabase) => {
      if (match[0].includes('how many')) {
        const { count, error } = await supabase
          .from('posts')
          .select('*', { count: 'exact', head: true })
        return { type: 'count', value: count, label: 'Total posts' }
      }
      
      if (match[0].includes('reported')) {
        const { data, error } = await supabase
          .from('posts')
          .select('id, content, created_at, user_id, report_count')
          .gt('report_count', 0)
          .order('report_count', { ascending: false })
          .limit(10)
        return { type: 'list', data, label: 'Reported posts' }
      }
      
      if (match[0].includes('popular')) {
        const { data, error } = await supabase
          .from('posts')
          .select('id, content, created_at, user_id, like_count, comment_count')
          .order('like_count', { ascending: false })
          .limit(10)
        return { type: 'list', data, label: 'Popular posts' }
      }
      
      // Default: show recent posts
      const { data, error } = await supabase
        .from('posts')
        .select('id, content, created_at, user_id')
        .order('created_at', { ascending: false })
        .limit(10)
      return { type: 'list', data, label: 'Recent posts' }
    }
  },
}

// Parse natural language query and return structured result
export async function parseAdminQuery(query, supabase) {
  const normalizedQuery = query.trim().toLowerCase()
  
  // Try to match against known patterns
  for (const [category, config] of Object.entries(QUERY_PATTERNS)) {
    for (const pattern of config.patterns) {
      const match = normalizedQuery.match(pattern)
      if (match) {
        try {
          const result = await config.handler(match, supabase)
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
    error: 'I couldn\'t understand that query. Try asking about users, news, orders, revenue, or posts.',
    suggestions: [
      'Show me pending news',
      'How many users do we have?',
      'Show me today\'s revenue',
      'List pending orders',
      'Show popular posts',
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
    
    default:
      return {
        type: 'text',
        message: JSON.stringify(result, null, 2),
      }
  }
}

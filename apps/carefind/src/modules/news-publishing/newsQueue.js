import { supabase } from '../../config/supabaseClient'

// Average review time per submission in minutes
const BASE_REVIEW_TIME_MIN = 30
const REVIEW_TIME_PER_ITEM_MIN = 15

export async function getNewsQueueInfo(userId) {
  try {
    // Get all pending news items ordered by creation time
    const { data: pendingItems, error } = await supabase
      .from('news')
      .select('id, created_at, author_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (error) throw error

    // Find user's submissions and their positions
    const userSubmissions = []
    const totalPending = pendingItems?.length || 0

    pendingItems?.forEach((item, index) => {
      if (item.author_id === userId) {
        const position = index + 1
        const estimatedMinutes = BASE_REVIEW_TIME_MIN + (position * REVIEW_TIME_PER_ITEM_MIN)
        const estimatedHours = Math.ceil(estimatedMinutes / 60)

        userSubmissions.push({
          id: item.id,
          position,
          estimatedMinutes,
          estimatedHours,
          estimatedText: formatEstimatedTime(estimatedMinutes),
        })
      }
    })

    return {
      totalPending,
      userSubmissions,
    }
  } catch (error) {
    console.error('Error fetching news queue info:', error)
    return { totalPending: 0, userSubmissions: [] }
  }
}

function formatEstimatedTime(minutes) {
  if (minutes < 60) {
    return `~${minutes} minutes`
  }
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) {
    return `~${hours} hour${hours > 1 ? 's' : ''}`
  }
  const days = Math.ceil(hours / 24)
  return `~${days} day${days > 1 ? 's' : ''}`
}

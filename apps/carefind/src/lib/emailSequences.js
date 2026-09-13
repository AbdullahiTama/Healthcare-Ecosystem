// Automated Email Sequences
// Handles onboarding, win-back, and notification email sequences

import { supabase } from '../config/supabaseClient'

// Email sequence types
export const SEQUENCE_TYPES = {
  ONBOARDING: 'onboarding',
  WIN_BACK: 'win-back',
  ORDER_FOLLOWUP: 'order-followup',
  INACTIVITY: 'inactivity',
}

// Email sequence steps
const SEQUENCES = {
  [SEQUENCE_TYPES.ONBOARDING]: [
    {
      id: 'welcome',
      delay: 0, // Immediate
      subject: 'Welcome to CareFind! 🎉',
      template: 'welcome',
    },
    {
      id: 'getting-started',
      delay: 2 * 24 * 60 * 60 * 1000, // 2 days
      subject: 'Get started with CareFind',
      template: 'getting-started',
    },
    {
      id: 'explore-features',
      delay: 5 * 24 * 60 * 60 * 1000, // 5 days
      subject: 'Explore what you can do',
      template: 'explore-features',
    },
  ],
  [SEQUENCE_TYPES.WIN_BACK]: [
    {
      id: 'we miss you',
      delay: 7 * 24 * 60 * 60 * 1000, // 7 days inactive
      subject: 'We miss you at CareFind',
      template: 'win-back-1',
    },
    {
      id: 'come-back',
      delay: 14 * 24 * 60 * 60 * 1000, // 14 days inactive
      subject: 'Here\'s what you\'ve missed',
      template: 'win-back-2',
    },
    {
      id: 'special-offer',
      delay: 30 * 24 * 60 * 60 * 1000, // 30 days inactive
      subject: 'A special offer just for you',
      template: 'win-back-3',
    },
  ],
  [SEQUENCE_TYPES.ORDER_FOLLOWUP]: [
    {
      id: 'order-delivered',
      delay: 1 * 24 * 60 * 60 * 1000, // 1 day after delivery
      subject: 'How was your order?',
      template: 'order-review-request',
    },
    {
      id: 'reorder',
      delay: 14 * 24 * 60 * 60 * 1000, // 14 days after delivery
      subject: 'Time to reorder?',
      template: 'reorder-suggestion',
    },
  ],
}

// Get user's email sequence progress
async function getUserSequenceProgress(userId, sequenceType) {
  const { data, error } = await supabase
    .from('email_sequence_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('sequence_type', sequenceType)
    .maybeSingle()

  if (error) throw error
  return data
}

// Start email sequence for user
export async function startEmailSequence(userId, sequenceType) {
  try {
    // Check if sequence already started
    const existing = await getUserSequenceProgress(userId, sequenceType)
    if (existing) {
      return { success: false, message: 'Sequence already started' }
    }

    // Get user email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', userId)
      .single()

    if (!profile?.email) {
      return { success: false, message: 'User email not found' }
    }

    // Create sequence progress record
    const { error } = await supabase
      .from('email_sequence_progress')
      .insert({
        user_id: userId,
        sequence_type: sequenceType,
        current_step: 0,
        started_at: new Date().toISOString(),
      })

    if (error) throw error

    // Send first email if delay is 0
    const sequence = SEQUENCES[sequenceType]
    if (sequence && sequence[0]?.delay === 0) {
      await sendSequenceEmail(userId, sequenceType, 0)
    }

    return { success: true, message: 'Sequence started' }
  } catch (error) {
    console.error('Error starting email sequence:', error)
    return { success: false, message: error.message }
  }
}

// Send sequence email
async function sendSequenceEmail(userId, sequenceType, stepIndex) {
  try {
    const sequence = SEQUENCES[sequenceType]
    if (!sequence || !sequence[stepIndex]) {
      return { success: false, message: 'Invalid sequence step' }
    }

    const step = sequence[stepIndex]

    // Get user details
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name, username')
      .eq('id', userId)
      .single()

    if (!profile?.email) {
      return { success: false, message: 'User email not found' }
    }

    // Send email via Edge Function
    const { data: emailData, error } = await supabase.functions.invoke('send-sequence-email', {
      body: {
        userId,
        email: profile.email,
        name: profile.full_name || profile.username,
        template: step.template,
        subject: step.subject,
        sequenceType,
        stepIndex,
      },
    })

    if (error) throw error

    // Update sequence progress
    await supabase
      .from('email_sequence_progress')
      .update({
        current_step: stepIndex + 1,
        last_sent_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('sequence_type', sequenceType)

    return { success: true, message: 'Email sent', data: emailData }
  } catch (error) {
    console.error('Error sending sequence email:', error)
    return { success: false, message: error.message }
  }
}

// Process pending sequence emails (should be called by cron job)
export async function processPendingSequences() {
  try {
    const now = new Date()
    
    // Get all active sequences
    const { data: sequences, error } = await supabase
      .from('email_sequence_progress')
      .select('*')
      .eq('completed', false)

    if (error) throw error

    let sentCount = 0

    for (const progress of sequences || []) {
      const sequence = SEQUENCES[progress.sequence_type]
      if (!sequence) continue

      const nextStep = sequence[progress.current_step]
      if (!nextStep) {
        // Mark as completed
        await supabase
          .from('email_sequence_progress')
          .update({ completed: true })
          .eq('id', progress.id)
        continue
      }

      // Check if it's time to send
      const lastSent = progress.last_sent_at ? new Date(progress.last_sent_at) : new Date(progress.started_at)
      const nextSendTime = new Date(lastSent.getTime() + nextStep.delay)

      if (now >= nextSendTime) {
        const result = await sendSequenceEmail(progress.user_id, progress.sequence_type, progress.current_step)
        if (result.success) {
          sentCount++
        }
      }
    }

    return { success: true, sentCount }
  } catch (error) {
    console.error('Error processing pending sequences:', error)
    return { success: false, message: error.message }
  }
}

// Check and trigger win-back sequences for inactive users
export async function checkInactiveUsers() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    
    // Get users who haven't logged in in 30 days
    const { data: inactiveUsers, error } = await supabase
      .from('profiles')
      .select('id')
      .lt('last_login_at', thirtyDaysAgo)
      .limit(100)

    if (error) throw error

    let startedCount = 0

    for (const user of inactiveUsers || []) {
      // Check if already in win-back sequence
      const existing = await getUserSequenceProgress(user.id, SEQUENCE_TYPES.WIN_BACK)
      if (!existing) {
        const result = await startEmailSequence(user.id, SEQUENCE_TYPES.WIN_BACK)
        if (result.success) {
          startedCount++
        }
      }
    }

    return { success: true, startedCount }
  } catch (error) {
    console.error('Error checking inactive users:', error)
    return { success: false, message: error.message }
  }
}

// Start onboarding sequence for new user
export async function startOnboardingSequence(userId) {
  return startEmailSequence(userId, SEQUENCE_TYPES.ONBOARDING)
}

// Start order followup sequence
export async function startOrderFollowupSequence(userId) {
  return startEmailSequence(userId, SEQUENCE_TYPES.ORDER_FOLLOWUP)
}

// Cancel sequence for user
export async function cancelEmailSequence(userId, sequenceType) {
  try {
    const { error } = await supabase
      .from('email_sequence_progress')
      .update({ completed: true, cancelled: true })
      .eq('user_id', userId)
      .eq('sequence_type', sequenceType)

    if (error) throw error

    return { success: true, message: 'Sequence cancelled' }
  } catch (error) {
    console.error('Error cancelling sequence:', error)
    return { success: false, message: error.message }
  }
}

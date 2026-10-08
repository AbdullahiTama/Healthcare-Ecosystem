import { theme } from '../styles/theme'
import { Avatar } from './ui'

export function StoryAvatar({
  profile,
  userId,
  stories = [],
  size = 40,
  onClick,
  hasStory: hasStoryProp,
  allSeen: allSeenProp,
  src: srcProp,
  name: nameProp,
  isLive = false,
  hasNewPosts = false,
}) {
  const hasStory = hasStoryProp !== undefined ? hasStoryProp : (Array.isArray(stories) && stories.length > 0)
  const allSeen = allSeenProp !== undefined ? allSeenProp : false

  // Determine ring color based on state priority:
  // 1. Live (purple) - highest priority
  // 2. Unseen stories (teal)
  // 3. Seen stories (gray)
  // 4. New posts (orange) - lowest priority
  // 5. No ring (transparent)
  let ringColor = 'transparent'
  let hasRing = false

  if (isLive) {
    ringColor = '#7C3AED' // purple
    hasRing = true
  } else if (hasStory && !allSeen) {
    ringColor = theme.tealDeep
    hasRing = true
  } else if (hasStory && allSeen) {
    ringColor = theme.gray300
    hasRing = true
  } else if (hasNewPosts) {
    ringColor = '#F59E0B' // amber/orange
    hasRing = true
  }

  const ringPad = hasRing ? Math.round(size * 0.045) + 2 : 0

  const avatarSrc = srcProp || profile?.avatar_url
  const avatarName = nameProp || profile?.display_name || profile?.full_name

  const wrapperStyle = {
    width: size + ringPad * 2,
    height: size + ringPad * 2,
    borderRadius: '50%',
    padding: ringPad,
    background: ringColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: onClick ? 'pointer' : 'default',
    flexShrink: 0,
    position: 'relative',
  }

  const innerStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    overflow: 'hidden',
    background: '#fff',
    padding: hasRing ? 2 : 0,
    boxSizing: 'border-box',
  }

  const getAriaLabel = () => {
    if (isLive) return `${avatarName || 'User'} is live now`
    if (hasStory && !allSeen) return `View ${avatarName || 'user'}'s story`
    if (hasStory && allSeen) return `${avatarName || 'user'}'s story (seen)`
    if (hasNewPosts) return `${avatarName || 'user'} has new posts`
    return undefined
  }

  return (
    <div style={wrapperStyle} onClick={onClick} role={onClick ? 'button' : undefined} aria-label={getAriaLabel()}>
      <div style={innerStyle}>
        <Avatar name={avatarName} src={avatarSrc} size={size - (hasRing ? 4 : 0)} />
      </div>
      {isLive && (
        <div style={{
          position: 'absolute',
          bottom: -2,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#DC2626',
          color: '#fff',
          fontSize: 8,
          fontWeight: 900,
          padding: '1px 4px',
          borderRadius: 4,
          letterSpacing: '0.05em',
          border: '1.5px solid #fff',
        }}>
          LIVE
        </div>
      )}
    </div>
  )
}

export default StoryAvatar

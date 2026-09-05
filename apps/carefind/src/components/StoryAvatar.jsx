import { theme } from '../styles/theme'
import { Avatar } from './ui'

export function StoryAvatar({ profile, userId, stories = [], size = 40, onClick, hasStory: hasStoryProp, allSeen: allSeenProp }) {
  // Allow direct props or derive via hasStory/allSeen logic inline if stories provided
  const hasStory = hasStoryProp !== undefined ? hasStoryProp : (Array.isArray(stories) && stories.length > 0)
  const allSeen = allSeenProp !== undefined ? allSeenProp : false
  const ringPad = hasStory ? Math.round(size * 0.045) + 2 : 0
  const ringColor = hasStory ? (allSeen ? theme.gray300 : theme.tealDeep) : 'transparent'

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
  }

  const innerStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    overflow: 'hidden',
    background: '#fff',
    padding: hasStory ? 2 : 0,
    boxSizing: 'border-box',
  }

  return (
    <div style={wrapperStyle} onClick={onClick} role={onClick ? 'button' : undefined} aria-label={hasStory ? `View ${profile?.display_name || profile?.full_name || 'user'}'s story` : undefined}>
      <div style={innerStyle}>
        <Avatar name={profile?.display_name || profile?.full_name || profile?.name} src={profile?.avatar_url || profile?.src} size={size - (hasStory ? 4 : 0)} />
      </div>
    </div>
  )
}

export default StoryAvatar

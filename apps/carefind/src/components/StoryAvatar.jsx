import { theme } from '../styles/theme'
import { Avatar } from './ui'

export function StoryAvatar({ profile, userId, stories = [], size = 40, onClick, hasStory: hasStoryProp, allSeen: allSeenProp, src: srcProp, name: nameProp }) {
  const hasStory = hasStoryProp !== undefined ? hasStoryProp : (Array.isArray(stories) && stories.length > 0)
  const allSeen = allSeenProp !== undefined ? allSeenProp : false
  const ringPad = hasStory ? Math.round(size * 0.045) + 2 : 0
  const ringColor = hasStory ? (allSeen ? theme.gray300 : theme.tealDeep) : 'transparent'

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
    <div style={wrapperStyle} onClick={onClick} role={onClick ? 'button' : undefined} aria-label={hasStory ? `View ${avatarName || 'user'}'s story` : undefined}>
      <div style={innerStyle}>
        <Avatar name={avatarName} src={avatarSrc} size={size - (hasStory ? 4 : 0)} />
      </div>
    </div>
  )
}

export default StoryAvatar

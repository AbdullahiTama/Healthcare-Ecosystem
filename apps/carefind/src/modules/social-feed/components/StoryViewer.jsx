import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { renderMarkdown } from '../markdown.jsx'

// Shared full-screen sequential story viewer used by the feed rail
// (Stories.jsx), the own-profile rail (Profile.jsx) and the public profile
// (PublicProfile.jsx). Owns the auto-advance timer, progress bars, tap zones
// and content layout so the same interaction works everywhere.
//
// Props:
//   stories       — the list of stories being watched (viewer shows stories[index])
//   index         — current story index; null/out-of-range renders nothing
//   onNavigate    — (nextIndex) => …; called on auto-advance and tap zones. The
//                   caller clamps: out of range means "close".
//   onClose       — () => …; called by the close button (and via onNavigate)
//   onViewStory   — (story) => …; fired once when a story starts displaying
//                   (view counting, seen marking)
//   renderHeader  — (story, helpers) => node; avatar + name block. helpers = { onClose }
const StoryViewer = ({ stories, index, onNavigate, onClose, onViewStory, renderHeader }) => {
  const [progress, setProgress] = useState(0)
  const timerRef = useRef(null)

  const STORY_DURATION = 6000

  useEffect(() => {
    if (index === null) return
    setProgress(0)
    const st = stories[index]
    if (st && onViewStory) onViewStory(st)
    const start = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, (elapsed / STORY_DURATION) * 100)
      setProgress(pct)
      if (pct >= 100) {
        clearInterval(timerRef.current)
        onNavigate(index + 1)
      }
    }, 50)
    return () => clearInterval(timerRef.current)
  }, [index])

  if (index === null || !stories[index]) return null

  const story = stories[index]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 4, padding: '10px 10px 0' }}>
        {stories.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, background: '#fff', width: i < index ? '100%' : i === index ? `${progress}%` : '0%', transition: i === index ? 'width 0.05s linear' : 'none' }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        {renderHeader && renderHeader(story, { onClose })}
        <button onClick={onClose} aria-label="Close story" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={24} aria-hidden="true" /></button>
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => onNavigate(index - 1)} aria-label="Previous story" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '35%', zIndex: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} />
        <button onClick={() => onNavigate(index + 1)} aria-label="Next story" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '35%', zIndex: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} />

        {story.image_url ? (
          <div style={{ width: '100%', height: '100%', background: `url(${story.image_url})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: story.bg_color || theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, boxSizing: 'border-box' }}>
            <div style={{ textAlign: 'center', maxWidth: 340 }}>
              {story.title && <div role="heading" aria-level={2} style={{ color: '#fff', fontSize: 26, fontWeight: 900, margin: '0 0 14px 0', lineHeight: 1.2 }}>{renderMarkdown(story.title)}</div>}
              {story.body && <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 17, lineHeight: 1.5, margin: 0 }}>{renderMarkdown(story.body)}</div>}
            </div>
          </div>
        )}

        {story.image_url && (story.title || story.body) && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3, padding: '40px 20px 24px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
            {story.title && <div role="heading" aria-level={2} style={{ color: '#fff', fontSize: 20, fontWeight: 900, margin: '0 0 6px 0' }}>{renderMarkdown(story.title)}</div>}
            {story.body && <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 1.5, margin: 0 }}>{renderMarkdown(story.body)}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

export default StoryViewer
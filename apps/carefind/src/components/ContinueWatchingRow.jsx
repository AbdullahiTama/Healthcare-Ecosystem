import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { theme } from '../styles/theme'

export function ContinueWatchingRow({ videos, progress, onClear, authorName }) {
  if (!videos || videos.length === 0) return null

  const continueItems = videos
    .filter(v => progress[v.id] && progress[v.id].percent >= 5 && progress[v.id].percent < 95)
    .sort((a, b) => (progress[b.id]?.updatedAt || 0) - (progress[a.id]?.updatedAt || 0))
    .slice(0, 5)

  if (continueItems.length === 0) return null

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: `1px solid ${theme.border}`,
      background: theme.bg,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <h3 style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 800,
          color: theme.navy,
        }}>
          Continue Watching
        </h3>
        <span style={{
          fontSize: 11,
          color: theme.textLight,
          fontWeight: 600,
        }}>
          {continueItems.length} video{continueItems.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{
        display: 'flex',
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 4,
        scrollbarWidth: 'none',
      }}>
        <style>{`.cwr-scroll::-webkit-scrollbar { display: none; }`}</style>
        <div className="cwr-scroll" style={{
          display: 'flex',
          gap: 12,
        }}>
          {continueItems.map(video => {
            const prog = progress[video.id]
            return (
              <Link
                key={video.id}
                to={`/feed?video=${video.id}`}
                style={{
                  flexShrink: 0,
                  width: 140,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{
                  position: 'relative',
                  width: 140,
                  height: 186,
                  borderRadius: theme.radius.md,
                  overflow: 'hidden',
                  background: '#000',
                }}>
                  {video.image_url && (
                    <img
                      src={video.image_url}
                      alt=""
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)',
                  }} />
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '8px 10px',
                  }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#fff',
                      marginBottom: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {authorName(video)}
                    </div>
                    <div style={{
                      height: 3,
                      background: 'rgba(255,255,255,0.3)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${prog.percent}%`,
                        height: '100%',
                        background: theme.tealDeep,
                        borderRadius: 2,
                      }} />
                    </div>
                    <div style={{
                      fontSize: 10,
                      color: 'rgba(255,255,255,0.7)',
                      marginTop: 3,
                    }}>
                      {prog.percent}% watched
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onClear(video.id)
                    }}
                    aria-label="Remove from Continue Watching"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: '#fff',
                      padding: 0,
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ContinueWatchingRow

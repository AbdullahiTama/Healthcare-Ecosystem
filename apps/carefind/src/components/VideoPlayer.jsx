// A real <video> player for the feed (Phase 5, Feature Group H).
//
// Feed videos autoplay muted, but only while they're actually on screen: an
// IntersectionObserver plays the video once it crosses ~35% of the viewport
// and pauses it when it scrolls out, so a long feed never has every video
// decoding at once (battery + scroll jank). Loading and error states are
// rendered instead of a blank hole, and the element stays accessible: a real
// button affordance when autoplay is off (or the user prefers reduced
// motion), an aria-label, and a visible "couldn't load" fallback instead of
// a silent failure.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, VideoOff, Volume2, VolumeX } from 'lucide-react'
import { theme } from '../styles/theme'

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function VideoPlayer({
  src,
  poster = null,
  ariaLabel = 'Video',
  controls = false,
  autoPlay = true,
  loop = true,
  muted: initialMuted = true,
  style,
}) {
  const videoRef = useRef(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(initialMuted)

  // Feed autoplay is a nice-to-have, never a requirement: reduced-motion
  // users get a paused, controllable video instead of an unasked-for one.
  const [wantsAutoplay, setWantsAutoplay] = useState(
    () => autoPlay && !prefersReducedMotion(),
  )

  // Play only while on screen. Play()/pause() run straight from the observer
  // callback rather than through state, so a burst of intersection events
  // can't desync the element from the DOM.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !wantsAutoplay) return

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = videoRef.current
          if (!video) return
          if (entry.isIntersecting) video.play().catch(() => {})
          else video.pause()
        })
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [src, wantsAutoplay])

  // Nothing should play while the tab is hidden; resume when it's visible
  // again (the observer alone won't re-fire on tab focus).
  useEffect(() => {
    if (!wantsAutoplay) return
    const onVisibility = () => {
      const video = videoRef.current
      if (!video) return
      if (document.hidden) video.pause()
      else video.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [wantsAutoplay])

  // Keep the DOM element's muted property in sync with state so a user
  // gesture can actually make audio audible (browser autoplay policy requires
  // muted for autoplay, but unmuting via a tap must reach the element).
  useEffect(() => {
    const el = videoRef.current
    if (el) el.muted = muted
  }, [muted])

  // If the caller changes the initial muted prop, reflect it.
  useEffect(() => {
    setMuted(initialMuted)
  }, [initialMuted])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }

  function toggleMute(e) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    setMuted((m) => !m)
  }

  const overlay = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'rgba(0,0,0,0.28)',
    pointerEvents: status === 'error' ? 'auto' : 'none',
  }

  const playButton = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.35)',
    border: 'none',
    cursor: 'pointer',
    color: '#fff',
    zIndex: 2,
  }

  return (
    <div
      style={{ position: 'relative', background: '#0B4A3E', ...style }}
      onClick={controls ? togglePlay : undefined}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster || undefined}
        autoPlay={wantsAutoplay}
        loop={loop}
        muted={muted}
        playsInline
        controls={controls}
        preload="metadata"
        aria-label={ariaLabel}
        onCanPlay={() => setStatus('ready')}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setStatus('error')}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />

      {status === 'loading' && (
        <div style={overlay} role="status" aria-live="polite">
          <Loader2 size={26} color="#fff" style={{ animation: 'cf-spin 0.7s linear infinite' }} aria-hidden="true" />
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading video</span>
        </div>
      )}

      {status === 'error' && (
        <div style={overlay} role="alert">
          <VideoOff size={26} color="#fff" aria-hidden="true" />
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '0 16px' }}>
            Video couldn't load
          </span>
          <button
            type="button"
            onClick={togglePlay}
            style={{ color: '#fff', fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 999, padding: '6px 14px', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Manual play affordance when autoplay isn't available or wanted */}
      {!controls && !wantsAutoplay && status === 'ready' && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause video' : 'Play video'}
          style={playButton}
        >
          {!playing && (
            <span style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Play size={24} fill="#fff" color="#fff" style={{ marginLeft: 3 }} aria-hidden="true" />
            </span>
          )}
        </button>
      )}

      {/* Tap-to-unmute: autoplay is muted for browser policy; user gesture toggles audio */}
      {status === 'ready' && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute video' : 'Mute video'}
          style={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            width: 36,
            height: 36,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            border: 'none',
            cursor: 'pointer',
            color: '#fff',
            zIndex: 3,
          }}
        >
          {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
        </button>
      )}
    </div>
  )
}

export default VideoPlayer

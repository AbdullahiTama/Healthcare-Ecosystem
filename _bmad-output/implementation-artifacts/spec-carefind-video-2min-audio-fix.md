---
title: 'Fix video 2-minute limit and audio playback'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: 'd65ee47c8b2f37e8d9454bd6b60f4799eed193e3'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/modules/social-feed/mediaLimits.js'
  - 'apps/carefind/src/components/VideoPlayer.jsx'
  - 'apps/carefind/src/modules/social-feed/Feed.jsx'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Video limit of ~15s (Feed.jsx 12 MB proxy) blocks healthcare education; posted videos show visuals without audio because `VideoPlayer` is permanently `muted` with no unmute control, and upload validation never checks duration.

**Approach:** Raise limit to 2 min (120s, within existing 180s/100 MB ceiling), wire duration probing + `validateVideoFile` into all upload paths, preserve original audio track through upload/storage, and make player audio audible via tap-to-unmute while keeping autoplay-muted policy.

## Boundaries & Constraints

**Always:** Use existing `live-media` bucket (100 MB `storage.buckets`) and `posts.video_url` column; keep `mediaLimits.js` as single source of truth for caps; preserve `VideoRecorder` audio capture (`audio:true`) and `VideoPlayer` IntersectionObserver autoplay.

**Ask First:** Changing bucket limits beyond 100 MB or `MAX_VIDEO_SECONDS` beyond 180s; adding server-side transcoding/ffmpeg; changing `posts` schema.

**Never:** Strip audio track during upload/processing; allow silent failure where video appears but audio is lost; bypass `validateVideoFile` with stale 12 MB check.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid 30s video with audio | 30s, 20 MB, opus/mp4 | Upload succeeds, `video_url` stored, feed plays with audio after unmute, A/V sync | No error |
| Near-max 110s | 110s, 80 MB | Succeeds | No error |
| Exceeds 120s | 130s video | Rejected before upload with clear message “Video must be ≤ 2 minutes (120s)” | No upload, no post |
| Exceeds size | 120s but 110 MB | Rejected with size message | No upload |
| Corrupt duration probe | duration probe returns 0 | Allow via size check (probe failure pass-through) | No block |
| Autoplay in feed | Scroll into view | Autoplays muted, tap unmute makes audio audible | Play/pause via IntersectionObserver |
| Controls | Tap unmute | Audio toggles, icon reflects state, persists while in view | No silent mute |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/social-feed/mediaLimits.js:15-37` -- `MAX_VIDEO_SECONDS=180`, `MAX_VIDEO_MB=100`, `MAX_VIDEO_BYTES`, `validateVideoFile({size,duration})` and `probeVideoDuration(file)` (video element metadata, 0 on failure) -- single source of truth, already 180s/100 MB + tests.
- `apps/carefind/src/modules/social-feed/Feed.jsx:710-720,1387` -- stale `12*1024*1024` + toast "under 12MB (about 15 seconds)" and label "Up to 12MB (about 15 seconds)"; must replace with `MAX_VIDEO_BYTES`/120s + `probeVideoDuration` + `validateVideoFile` before `supabase.storage.from('live-media').upload`; keep `posts.video_url` insert.
- `apps/carefind/src/components/VideoPlayer.jsx:22-133` -- `muted=true` hardcoded, `controls=false`, `autoPlay=true`, `IntersectionObserver 0.35`, `visibilitychange` pause; `<video muted={muted} controls={controls}>` never exposes unmute; must add `muted` state + tap-to-unmute button with `videoRef.current.muted` toggle.
- `apps/carefind/src/components/VideoUploader.jsx:6-42` -- `MAX_MB=50` divergent; must align to 100 and wire duration check before upload.
- `apps/carefind/src/components/VideoRecorder.jsx:29-100` -- `getUserMedia {audio:true}`, `MediaRecorder videoBitsPerSecond 800000`, `new Blob(chunks,{type})` preserves audio; preview muted ok, uploaded must not mute; optionally auto-stop at 120s.
- `apps/carefind/src/modules/social-feed/PostCard.jsx:397-405` -- renders `VideoPlayer src={post.video_url}` (currently always muted); will benefit from player fix without change.
- `apps/carefind/sql/20260826_post_multi_image.sql:17` -- bucket `live-media` already 100 MB; keep.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/social-feed/mediaLimits.js` -- keep 180s/100 MB (covers 120s requirement); add export `MAX_VIDEO_SECONDS_120 = 120` alias or keep 180 with UI message 120s; ensure `validateVideoFile` duration message mentions 2 minutes.
- [x] `apps/carefind/src/modules/social-feed/Feed.jsx` -- replace stale 12 MB check at `handleCardVideo` with `await probeVideoDuration(file)` + `validateVideoFile({size: file.size, duration})`; update toast "≤ 2 minutes (120s) and ≤ 100 MB" and label "Up to 100 MB, 2 minutes"; apply same to all three `onChange={handleCardVideo}` inputs; keep `live-media` upload path `card-{userId}-{Date.now()}.ext`.
- [x] `apps/carefind/src/components/VideoPlayer.jsx` -- add `const [muted, setMuted] = useState(initialMuted)` + `videoRef`; sync `videoRef.current.muted = muted`; add tap-to-unmute button (Speaker/Muted icon) overlay when `muted` and `wantsAutoplay`; ensure `controls` variant still allows unmute; keep `IntersectionObserver` play/pause and `visibilitychange`; do not strip audio.
- [x] `apps/carefind/src/components/VideoUploader.jsx` -- align `MAX_MB` 50→100, wire `probeVideoDuration` + `validateVideoFile` before upload, show duration error.
- [x] `apps/carefind/src/modules/social-feed/mediaLimits.test.js` + `VideoPlayer.test.jsx` (new) + `Feed.video.test.jsx` (new) -- tests: valid 30s passes, 130s rejected with 120s message, probe failure (0) passes via size, player renders muted then unmute toggles `video.muted`, Feed `handleCardVideo` rejects >120s without upload.

**Acceptance Criteria:**
- Given a 30s video with audio, when uploading and opening in feed, then it plays and unmute makes audio audible and synchronized
- Given a 110s video, when uploading, then it succeeds
- Given a 130s video, when selecting, then it is rejected before upload with clear message mentioning 2 minutes (120s) and no post is created
- Given a video exceeding 100 MB, when selecting, then it is rejected with size message and no upload occurs
- Given a video where duration probe fails (0), when size is within 100 MB, then upload proceeds (probe failure does not block)

## Spec Change Log

## Design Notes

120s is within existing 180s/100 MB ceiling — no bucket migration needed. Keep autoplay-muted for feed policy (browser requires muted for autoplay), but add user-gesture unmute (tap button toggles `video.muted` false). `probeVideoDuration` uses `<video>` metadata; failure returns 0 and `validateVideoFile` allows via size check per existing warning comment.

## Verification

**Commands:**
- `npm test -- src/modules/social-feed/mediaLimits.test.js src/components/VideoPlayer.test.jsx src/modules/social-feed/Feed.video.test.jsx` -- expected: duration/size validation and unmute toggle pass
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**Entry point — duration gate**

- Replace stale 12 MB check with `probeVideoDuration` + `validateVideoFile` 120s/100 MB
  [`Feed.jsx:710`](../../apps/carefind/src/modules/social-feed/Feed.jsx#L710)

- Single source of truth 180s/100 MB with 120s product alias
  [`mediaLimits.js:15`](../../apps/carefind/src/modules/social-feed/mediaLimits.js#L15)

**Player — audio becomes audible**

- `muted` state + `videoRef` sync + tap-to-unmute overlay (keeps autoplay-muted)
  [`VideoPlayer.jsx:22`](../../apps/carefind/src/components/VideoPlayer.jsx#L22)

- `VideoUploader` 50→100 MB and duration wiring
  [`VideoUploader.jsx:6`](../../apps/carefind/src/components/VideoUploader.jsx#L6)

**Preservation**

- `VideoRecorder` preserves `audio:true` and auto-stop at 120s
  [`VideoRecorder.jsx:29`](../../apps/carefind/src/components/VideoRecorder.jsx#L29)

**Tests**

- Valid 30s/110s pass, 130s rejected with 120s message, probe 0 pass-through
  [`Feed.video.test.jsx:1`](../../apps/carefind/src/modules/social-feed/Feed.video.test.jsx#L1)

- Player muted→unmute toggle
  [`VideoPlayer.test.jsx:35`](../../apps/carefind/src/components/VideoPlayer.test.jsx#L35)

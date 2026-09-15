import { Radio, Play, Square, Calendar, Users, Heart, Eye, Share2, Gift, MessageSquare, Send, Image, Mic, Video, Slides, Clock, UserPlus, Trash2 } from 'lucide-react'
import { Card, Button, Empty, Input, Textarea } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'
import { AdminPageHeader, AdminSection } from '../ui'
import VoiceRecorder from '../../../components/VoiceRecorder.jsx'
import SlideUploader from '../../../components/SlideUploader.jsx'
import VideoUploader from '../../../components/VideoUploader.jsx'
import VideoRecorder from '../../../components/VideoRecorder.jsx'

export default function GoLiveTab({
  activeShows, scheduledShows, liveTitle, setLiveTitle,
  scheduledAt, setScheduledAt, trailerFile, setTrailerFile,
  creatingShow, liveGuests, setLiveGuests, guestSearch, setGuestSearch,
  users, startLiveShow, scheduleShow, endLiveShow,
  startScheduledShow, cancelScheduledShow,
  liveDraft, setLiveDraft, liveImage, setLiveImage,
  postingLive, postLiveItem, liveItems, liveStats,
  liveComments, hideLiveComment, loadLiveControl,
  toggleGuest, showToast,
  postLiveVoice, postLiveSlide, postLiveVideo,
}) {
  return (
    <div>
      <AdminPageHeader title="Go Live" subtitle="Manage live shows on CareFind" />

      {activeShows.length > 0 && (
        <AdminSection title="Currently Live" subtitle={`${activeShows.length} active show(s)`} style={{ marginBottom: theme.space[5] }}>
          {activeShows.map(s => (
            <Card key={s.id} style={{ padding: theme.space[5], marginBottom: theme.space[5] }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: theme.space[4] }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', animation: 'pulse 2s infinite' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}>{s.title}</div>
                  <div style={{ fontSize: 11, color: theme.textLight }}>Started {new Date(s.started_at).toLocaleTimeString()}</div>
                </div>
                <a href={`/live-show/${s.id}`} style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, background: theme.tealMist, padding: '6px 10px', borderRadius: theme.radius.full, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Eye size={12} /> Audience
                </a>
                <Button variant="danger" size="sm" onClick={() => endLiveShow(s.id)}>End</Button>
              </div>

              <Button variant="ghost" fullWidth onClick={() => loadLiveControl(s.id)} leftIcon={<Radio size={14} />} style={{ marginBottom: theme.space[3] }}>
                Load Control Room
              </Button>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: `${theme.space[3]}px 0`, marginBottom: theme.space[3], background: theme.navy, borderRadius: theme.radius.md }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}><Heart size={14} fill="#fff" /> {liveStats.likes}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}><Eye size={14} /> {liveStats.views}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}><Share2 size={14} /> {liveStats.shares}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fde68a', display: 'flex', alignItems: 'center', gap: 4 }}><Gift size={14} /> {liveStats.gifts}</span>
              </div>

              <Textarea value={liveDraft} onChange={setLiveDraft} placeholder="Type something to broadcast live..." rows={2} style={{ marginBottom: theme.space[3] }} />
              <VoiceRecorder showId={s.id} onRecorded={(url) => postLiveVoice(s.id, url)} />
              <SlideUploader showId={s.id} onPostSlide={(url, num, total) => postLiveSlide(s.id, url, num, total)} />
              <VideoRecorder showId={s.id} onRecorded={(url) => postLiveVideo(s.id, url)} />
              <VideoUploader showId={s.id} onUploaded={(url) => postLiveVideo(s.id, url)} />

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: theme.space[3] }}>
                <label style={{ fontSize: 12, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Image size={14} /> {liveImage ? liveImage.name.slice(0, 16) : 'Add image'}
                  <input type="file" accept="image/*" onChange={(e) => setLiveImage(e.target.files[0] || null)} style={{ display: 'none' }} />
                </label>
                <Button variant="primary" size="sm" loading={postingLive} onClick={() => postLiveItem(s.id)} leftIcon={<Send size={14} />}>
                  Post Live
                </Button>
              </div>

              {liveItems.length > 0 && (
                <div style={{ marginBottom: theme.space[3] }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: theme.gray400, textTransform: 'uppercase', marginBottom: theme.space[2] }}>Posted ({liveItems.length})</div>
                  {liveItems.map(it => (
                    <div key={it.id} style={{ background: theme.bg, borderRadius: theme.radius.sm, padding: it.kind === 'image' ? 4 : `${theme.space[2]}px ${theme.space[3]}px`, marginBottom: 4 }}>
                      {it.kind === 'text' && <p style={{ margin: 0, fontSize: 12.5, color: theme.textDark }}>{it.content}</p>}
                      {it.kind === 'image' && <img src={it.content} alt="" style={{ maxWidth: 120, borderRadius: 6, display: 'block' }} />}
                      {it.kind === 'voice' && <audio controls src={it.content} style={{ height: 32, maxWidth: 180 }} />}
                      {it.kind === 'video' && <video controls playsInline src={it.content} style={{ maxWidth: 160, borderRadius: 6, display: 'block' }} />}
                      {it.kind === 'slide' && <div><span style={{ fontSize: 9, fontWeight: 800, color: theme.tealDeep }}>Slide {(it.content||'').split('|||')[1]}</span><img src={(it.content||'').split('|||')[0]} alt="slide" style={{ maxWidth: 120, borderRadius: 6, display: 'block', marginTop: 2 }} /></div>}
                    </div>
                  ))}
                </div>
              )}

              {liveComments.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: theme.gray400, textTransform: 'uppercase', marginBottom: theme.space[2] }}>Audience comments</div>
                  {liveComments.map(c => (
                    <div key={c.id} style={{ display: 'flex', gap: 6, marginBottom: 5, opacity: c.hidden ? 0.4 : 1 }}>
                      <span style={{ flex: 1, fontSize: 12, color: theme.textMid }}>
                        <strong style={{ color: theme.navy }}>{c.profiles?.full_name || c.profiles?.display_name || 'User'}:</strong> {c.content}
                      </span>
                      {!c.hidden && <Button variant="ghost" size="sm" onClick={() => hideLiveComment(c.id, s.id)}>Hide</Button>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </AdminSection>
      )}

      {scheduledShows.length > 0 && (
        <AdminSection title="Scheduled Shows" style={{ marginBottom: theme.space[5] }}>
          {scheduledShows.map(s => (
            <Card key={s.id} style={{ padding: theme.space[4], marginBottom: theme.space[4] }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: theme.navy }}>{s.title}</div>
              <div style={{ fontSize: 11, color: theme.tealDeep, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, margin: `${theme.space[2]}px 0` }}>
                <Clock size={12} /> {new Date(s.scheduled_at).toLocaleString()}
              </div>
              {s.trailer_url && <video src={s.trailer_url} controls playsInline style={{ maxWidth: 160, borderRadius: 8, display: 'block', marginBottom: theme.space[3] }} />}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" size="sm" onClick={() => startScheduledShow(s.id)} leftIcon={<Play size={12} />}>Start Now</Button>
                <a href={`/live-show/${s.id}`} style={{ fontSize: 12, fontWeight: 700, color: theme.tealDeep, background: theme.tealMist, padding: '8px 12px', borderRadius: theme.radius.full, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Eye size={12} /> Preview
                </a>
                <Button variant="danger" size="sm" onClick={() => cancelScheduledShow(s.id)}>Cancel</Button>
              </div>
            </Card>
          ))}
        </AdminSection>
      )}

      <AdminSection title="Start a Live Show" subtitle="Go live on CareFind. A red LIVE indicator shows in everyone's stories row.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
          <Input label="Show title" value={liveTitle} onChange={setLiveTitle} placeholder="e.g. Malaria Awareness Live" />

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: theme.navy, marginBottom: theme.space[2] }}>Invite guests to co-host ({liveGuests.length} selected)</div>
            <Input value={guestSearch} onChange={setGuestSearch} placeholder="Search users by name..." style={{ marginBottom: theme.space[3] }} />
            <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: theme.space[3] }}>
              {users.filter(u => {
                const n = (u.full_name || u.display_name || '').toLowerCase()
                return guestSearch.trim() ? n.includes(guestSearch.toLowerCase()) : true
              }).slice(0, 30).map(u => {
                const selected = liveGuests.some(g => g.id === u.id)
                return (
                  <div key={u.id} onClick={() => toggleGuest(u)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `${theme.space[3]}px ${theme.space[4]}px`, borderRadius: theme.radius.md, marginBottom: 4, cursor: 'pointer', background: selected ? theme.tealMist : theme.bg, border: `1px solid ${selected ? theme.tealDeep : 'transparent'}` }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                      {(u.full_name?.[0] || u.display_name?.[0] || '?').toUpperCase()}
                    </div>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: theme.navy }}>{u.full_name || u.display_name || 'User'}</span>
                    {selected && <Check size={14} color={theme.tealDeep} />}
                  </div>
                )
              })}
            </div>
          </div>

          <Button variant="primary" fullWidth loading={creatingShow} onClick={startLiveShow} leftIcon={<Radio size={16} />}>
            {creatingShow ? 'Starting...' : 'Go Live Now'}
          </Button>

          <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: theme.space[5] }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: theme.navy, marginBottom: theme.space[2] }}>Or schedule for later</div>
            <div style={{ fontSize: 11, color: theme.textLight, marginBottom: theme.space[3] }}>Set a time and an optional trailer. A countdown shows in the stories row.</div>
            <Input type="datetime-local" value={scheduledAt} onChange={setScheduledAt} style={{ marginBottom: theme.space[3] }} />
            <label style={{ display: 'block', fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', marginBottom: theme.space[3] }}>
              <Video size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {trailerFile ? trailerFile.name.slice(0, 24) : 'Add trailer video (optional)'}
              <input type="file" accept="video/*" onChange={(e) => setTrailerFile(e.target.files[0] || null)} style={{ display: 'none' }} />
            </label>
            <Button variant="secondary" fullWidth loading={creatingShow} onClick={scheduleShow} leftIcon={<Calendar size={14} />}>
              {creatingShow ? 'Scheduling...' : 'Schedule Show'}
            </Button>
          </div>
        </div>
      </AdminSection>
    </div>
  )
}

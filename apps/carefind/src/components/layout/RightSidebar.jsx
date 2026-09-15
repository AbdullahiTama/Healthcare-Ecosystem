import { Link } from 'react-router-dom'
import { theme } from '../../styles/theme'
import { StickySidebar, SidebarSection } from './SidebarSection.jsx'
import { plainTextFromContent } from '../../lib/openGraph.js'

// Contextual desktop sidebar. Deliberately "dumb": every section is fed by
// data the page already fetches (posts/news/live sessions) — nothing here
// issues its own query or invents content. Sections render only when they
// have real data ("only display relevant content, avoid clutter"); sections
// the brief suggested but that have no real CareFind data source today
// (Recommended Providers, Upcoming Appointments, Health Tips) are omitted
// rather than filled with placeholders.

export default function RightSidebar({ trending = [], news = [], live = [], platformLive = null }) {
  const hasAny = trending.length > 0 || news.length > 0 || live.length > 0 || platformLive

  if (!hasAny) return null

  return (
    <StickySidebar>
      {(live.length > 0 || platformLive) && (
        <SidebarSection title="🔴 Live now">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {platformLive && (
              <Link to={`/live-show/${platformLive.id}`} style={{ textDecoration: 'none' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>CareFind is live</p>
                <p style={{ margin: 0, fontSize: 11.5, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platformLive.title}</p>
              </Link>
            )}
            {live.slice(0, 3).map((s) => (
              <Link key={s.id} to={`/live/${s.id}`} style={{ textDecoration: 'none' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 700, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.topic || 'Live session'}</p>
                <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{s.profiles?.full_name || s.profiles?.display_name}</p>
              </Link>
            ))}
          </div>
        </SidebarSection>
      )}

      {trending.length > 0 && (
        <SidebarSection title="✨ Trending">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* An article's content is a JSON block array, so rendering
                `p.content` raw printed `[{"id":"…","type":"text",…}]` into the
                sidebar. plainTextFromContent is the same reader the link
                previews use, so a trending article reads as prose here too.
                The link goes to the post, not to the author's profile — the
                trending entry is about the post, and for a repost the author
                is the resharer rather than the writer. */}
            {trending.slice(0, 4).map((p) => (
              <Link key={p.id} to={`/post/${p.id}`} style={{ textDecoration: 'none' }}>
                <p style={{ margin: '0 0 3px 0', fontSize: 13, fontWeight: 700, color: theme.navy, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {plainTextFromContent(p.content)}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>
                  {p.posted_as_name || p.authorName || 'CareFind user'}
                </p>
              </Link>
            ))}
          </div>
        </SidebarSection>
      )}

      {news.length > 0 && (
        <SidebarSection title="📰 Suggested articles">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {news.slice(0, 4).map((n) => (
              <Link key={n.id} to={`/news/${n.id}`} style={{ display: 'flex', gap: 10, textDecoration: 'none', alignItems: 'center' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: theme.radius.sm, flexShrink: 0,
                  background: n.hero_image_url ? `url(${n.hero_image_url}) center/cover` : theme.heroGradient,
                }} />
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: theme.navy, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {n.headline}
                </p>
              </Link>
            ))}
            <Link to="/news" style={{ fontSize: 12, fontWeight: 700, color: theme.tealDeep, textDecoration: 'none' }}>See all news →</Link>
          </div>
        </SidebarSection>
      )}
    </StickySidebar>
  )
}

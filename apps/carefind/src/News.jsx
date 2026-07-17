import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'
import ArticleEditor from './ArticleEditor.jsx'

function News() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const [canSubmit, setCanSubmit] = useState(false)

  // Submit form
  const [headline, setHeadline] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [body, setBody] = useState('')
  const [heroFile, setHeroFile] = useState(null)
  const [heroPreview, setHeroPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')
  const [myPending, setMyPending] = useState([])
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    loadNews()
    checkCanSubmit()
    markNewsSeen()
  }, [user])

  async function markNewsSeen() {
    if (!user) return
    await supabase.from('profiles').update({ news_last_seen: new Date().toISOString() }).eq('id', user.id)
  }

  async function checkCanSubmit() {
    if (!user) { setCanSubmit(false); return }
    setCanSubmit(true)
  }

  async function loadNews() {
    setLoading(true)
    const { data } = await supabase
      .from('news')
      .select('id, headline, subtitle, hero_image_url, published_at, created_at, status, author_id, profiles(full_name, display_name)')
      .eq('status', 'approved')
      .order('published_at', { ascending: false })
      .limit(40)
    setArticles(data || [])

    if (user) {
      const { data: mine } = await supabase
        .from('news')
        .select('id, headline, status, created_at')
        .eq('author_id', user.id)
        .neq('status', 'approved')
        .order('created_at', { ascending: false })
      setMyPending(mine || [])
    }
    setLoading(false)
  }

  function handleHeroSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    setHeroFile(file)
    setHeroPreview(URL.createObjectURL(file))
  }

  async function submitNews() {
    if (!headline.trim()) { setSubmitMsg('Please add a headline.'); return }
    if (!body.trim()) { setSubmitMsg('Please write the article body.'); return }
    if (!contactPhone.trim()) { setSubmitMsg('Please add a contact phone number.'); return }
    if (!contactEmail.trim()) { setSubmitMsg('Please add a contact email.'); return }
    setSubmitting(true)
    setSubmitMsg('')

    let heroUrl = null
    if (heroFile) {
      const ext = heroFile.name.split('.').pop()
      const path = `news-${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('news-images').upload(path, heroFile)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('news-images').getPublicUrl(path)
        heroUrl = urlData.publicUrl
      }
    }

    const { error } = await supabase.from('news').insert({
      headline: headline.trim(),
      subtitle: subtitle.trim() || null,
      body: body.trim(),
      hero_image_url: heroUrl,
      author_id: user.id,
      contact_phone: contactPhone.trim(),
      contact_email: contactEmail.trim(),
      status: 'pending',
    })

    if (error) {
      setSubmitMsg('Error: ' + error.message)
    } else {
      setSubmitMsg('✓ Submitted! Your news is under review and will publish once approved.')
      setHeadline(''); setSubtitle(''); setBody(''); setHeroFile(null); setHeroPreview(null)
      setContactPhone(''); setContactEmail(''); setPreviewing(false)
      setTimeout(() => { setComposerOpen(false); setSubmitMsg(''); loadNews() }, 1800)
    }
    setSubmitting(false)
  }

  function timeAgo(dateStr) {
    if (!dateStr) return ''
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  function authorName(a) {
    return a.profiles?.full_name || a.profiles?.display_name || 'CareFind Contributor'
  }

  const lead = articles[0]
  const rest = articles.slice(1)

  return (
    <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90, background: '#fff' }}>
      {/* Masthead */}
      <div style={{ borderBottom: `2px solid ${theme.navy}`, padding: '18px 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p style={{ margin: 0, fontFamily: 'system-ui', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: theme.tealDeep, textTransform: 'uppercase' }}>CareFind</p>
          <h1 style={{ margin: '2px 0 0 0', fontSize: 30, fontWeight: 900, color: theme.navy, letterSpacing: '-0.02em' }}>Health News</h1>
        </div>
        <Link to="/" style={{ fontFamily: 'system-ui', fontSize: 12, fontWeight: 700, color: theme.textLight, textDecoration: 'none' }}>← Feed</Link>
      </div>

      {/* Submit button */}
      {canSubmit && (
        <div style={{ padding: '12px 16px 0' }}>
          <button
            onClick={() => setComposerOpen(true)}
            style={{ width: '100%', padding: 11, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13, fontFamily: 'system-ui' }}
          >
            ✎ Submit a news story
          </button>
        </div>
      )}

      {/* My pending submissions */}
      {myPending.length > 0 && (
        <div style={{ padding: '12px 16px 0', fontFamily: 'system-ui' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: 11, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase' }}>Your submissions</p>
          {myPending.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: theme.bg, borderRadius: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, color: theme.textMid, flex: 1, marginRight: 8 }}>{m.headline}</span>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 12, background: m.status === 'rejected' ? '#fef2f2' : '#fef3c7', color: m.status === 'rejected' ? theme.alert : '#92400e' }}>
                {m.status === 'rejected' ? 'Not approved' : 'Under review'}
              </span>
            </div>
          ))}
        </div>
      )}

      {loading && <p style={{ fontFamily: 'system-ui', color: theme.textLight, fontSize: 13, padding: 16 }}>Loading news…</p>}
      {!loading && articles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 20px', fontFamily: 'system-ui' }}>
          <div style={{ fontSize: 34, marginBottom: 12 }}>📰</div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>No news yet</h3>
          <p style={{ fontSize: 13, color: theme.textLight, margin: 0 }}>Approved stories will appear here.</p>
        </div>
      )}

      {/* Lead story */}
      {lead && (
        <Link to={`/news/${lead.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', padding: '16px 16px 20px' }}>
          {lead.hero_image_url && (
            <div style={{ width: '100%', height: 200, borderRadius: 6, background: `url(${lead.hero_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center', marginBottom: 12 }} />
          )}
          <p style={{ margin: '0 0 6px 0', fontFamily: 'system-ui', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: theme.tealDeep, textTransform: 'uppercase' }}>Lead Story</p>
          <h2 style={{ margin: '0 0 8px 0', fontSize: 25, fontWeight: 900, color: theme.navy, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{lead.headline}</h2>
          {lead.subtitle && <p style={{ margin: '0 0 10px 0', fontSize: 15.5, color: theme.textMid, lineHeight: 1.4, fontStyle: 'italic' }}>{lead.subtitle}</p>}
          <p style={{ margin: 0, fontFamily: 'system-ui', fontSize: 12, color: theme.textLight }}>
            By <strong style={{ color: theme.navy }}>{authorName(lead)}</strong> · {timeAgo(lead.published_at || lead.created_at)}
          </p>
        </Link>
      )}

      {/* Divider */}
      {rest.length > 0 && <div style={{ height: 8, background: theme.bg }} />}

      {/* Rest of stories */}
      <div>
        {rest.map((a) => (
          <Link key={a.id} to={`/news/${a.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: '0 0 5px 0', fontSize: 16.5, fontWeight: 800, color: theme.navy, lineHeight: 1.25 }}>{a.headline}</h3>
              {a.subtitle && <p style={{ margin: '0 0 6px 0', fontSize: 13, color: theme.textMid, lineHeight: 1.4 }}>{a.subtitle.slice(0, 90)}{a.subtitle.length > 90 ? '…' : ''}</p>}
              <p style={{ margin: 0, fontFamily: 'system-ui', fontSize: 11, color: theme.textLight }}>
                By {authorName(a)} · {timeAgo(a.published_at || a.created_at)}
              </p>
            </div>
            {a.hero_image_url && (
              <div style={{ width: 92, height: 92, borderRadius: 6, flexShrink: 0, background: `url(${a.hero_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            )}
          </Link>
        ))}
      </div>

      {/* Submit composer (full-screen) */}
      {composerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: '#fff', overflowY: 'auto', fontFamily: 'system-ui' }}>
          <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, paddingBottom: 40 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: theme.navy }}>{previewing ? 'Preview' : 'Submit News'}</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setPreviewing(!previewing)} style={{ padding: '6px 12px', background: previewing ? theme.navy : '#ecfdf5', color: previewing ? '#fff' : theme.tealDeep, border: 'none', borderRadius: 16, fontWeight: 800, fontSize: 12 }}>
                  {previewing ? '✏️ Back to editing' : '👁️ Preview'}
                </button>
                <button onClick={() => setComposerOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: theme.textLight }}>✕</button>
              </div>
            </div>

            {submitMsg && (
              <p style={{ fontSize: 13, margin: '0 0 12px 0', padding: '10px 12px', borderRadius: 10, background: submitMsg.startsWith('✓') ? '#ecfdf5' : '#fef2f2', color: submitMsg.startsWith('✓') ? theme.success : theme.alert, fontWeight: 600 }}>{submitMsg}</p>
            )}

            {previewing ? (
              /* ---------- PREVIEW (public article look) ---------- */
              <div style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                <p style={{ margin: '0 0 10px 0', fontFamily: 'system-ui', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: theme.tealDeep, textTransform: 'uppercase' }}>Health</p>
                <h1 style={{ margin: '0 0 12px 0', fontSize: 27, fontWeight: 900, color: theme.navy, lineHeight: 1.13 }}>{headline || 'Your headline appears here'}</h1>
                {subtitle && <p style={{ margin: '0 0 16px 0', fontSize: 16, color: theme.textMid, lineHeight: 1.45, fontStyle: 'italic' }}>{subtitle}</p>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`, marginBottom: 18, fontFamily: 'system-ui' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>Y</div>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: theme.navy }}>By You</p>
                    <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>Draft preview</p>
                  </div>
                </div>
                {heroPreview && <img src={heroPreview} alt="hero" style={{ width: '100%', display: 'block', marginBottom: 18, borderRadius: 4 }} />}
                <div style={{ fontSize: 17, lineHeight: 1.7, color: '#1f2937' }}>
                  <ArticleEditor value={body} readOnly />
                </div>
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <span style={{ fontSize: 18, color: theme.tealDeep, fontWeight: 900 }}>■</span>
                </div>
                <button onClick={submitNews} disabled={submitting} style={{ width: '100%', padding: 13, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14, fontFamily: 'system-ui' }}>
                  {submitting ? 'Submitting…' : 'Looks good — Submit for review'}
                </button>
              </div>
            ) : (
              /* ---------- EDIT FORM ---------- */
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Headline</label>
                <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="A clear, strong headline" style={{ width: '100%', padding: 12, fontSize: 15, fontWeight: 700, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box', marginBottom: 12 }} />

                <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Subtitle / summary</label>
                <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="One line that summarizes the story" style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box', marginBottom: 12 }} />

                <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Hero image</label>
                {heroPreview ? (
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <img src={heroPreview} alt="hero" style={{ width: '100%', borderRadius: 10, maxHeight: 180, objectFit: 'cover' }} />
                    <button onClick={() => { setHeroFile(null); setHeroPreview(null) }} style={{ position: 'absolute', top: 8, right: 8, background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: 26, height: 26, fontSize: 13 }}>✕</button>
                  </div>
                ) : (
                  <label style={{ display: 'block', padding: 14, border: `1.5px dashed ${theme.border}`, borderRadius: 10, textAlign: 'center', color: theme.tealDeep, fontWeight: 700, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
                    📷 Add a hero image
                    <input type="file" accept="image/*" onChange={handleHeroSelect} style={{ display: 'none' }} />
                  </label>
                )}

                <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Article body</label>
                <div style={{ marginBottom: 16 }}>
                  <ArticleEditor value={body} onChange={(val) => setBody(val)} />
                </div>

                {/* Contact details (required) */}
                <div style={{ background: theme.bg, borderRadius: 12, padding: 12, marginBottom: 16 }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: 12.5, fontWeight: 800, color: theme.navy }}>📞 Your contact details</p>
                  <p style={{ margin: '0 0 10px 0', fontSize: 11, color: theme.textLight }}>Required — our team may contact you to verify the story before publishing. Not shown publicly.</p>
                  <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Phone number *</label>
                  <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} type="tel" placeholder="e.g. 08012345678" style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box', marginBottom: 10 }} />
                  <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Email address *</label>
                  <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} type="email" placeholder="you@example.com" style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box' }} />
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setPreviewing(true)} style={{ flex: 1, padding: 13, background: '#ecfdf5', color: theme.tealDeep, border: `1px solid ${theme.tealBright}`, borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
                    👁️ Preview
                  </button>
                  <button onClick={submitNews} disabled={submitting} style={{ flex: 1, padding: 13, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
                    {submitting ? 'Submitting…' : 'Submit'}
                  </button>
                </div>
                <p style={{ margin: '8px 0 0 0', fontSize: 11, color: theme.textLight, textAlign: 'center' }}>Your story will be reviewed by our team before publishing.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}

export default News

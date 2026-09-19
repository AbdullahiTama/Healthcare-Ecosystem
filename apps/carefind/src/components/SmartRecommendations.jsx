import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, Sparkles, ShoppingBag } from 'lucide-react'
import { getRecommendations, getTrendingContent } from '../lib/recommendations'
import { theme } from '../styles/theme'

export default function SmartRecommendations({ userId, type = 'all' }) {
  const [recommendations, setRecommendations] = useState(null)
  const [trending, setTrending] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!userId) {
        const trendingData = await getTrendingContent(5)
        setTrending(trendingData)
        setLoading(false)
        return
      }

      const [recs, trendingData] = await Promise.all([
        getRecommendations(userId),
        getTrendingContent(5),
      ])
      setRecommendations(recs)
      setTrending(trendingData)
      setLoading(false)
    }

    load()
  }, [userId])

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: theme.textMid }}>
        Loading recommendations...
      </div>
    )
  }

  const showPosts = type === 'all' || type === 'posts'
  const showNews = type === 'all' || type === 'news'
  const showProducts = type === 'all' || type === 'products'
  const showTrending = type === 'all' || type === 'trending'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Trending Content */}
      {showTrending && trending.length > 0 && (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}>
            <TrendingUp size={18} color={theme.tealDeep} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: theme.textDark }}>
              Trending Now
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {trending.map(post => (
              <Link
                key={post.id}
                to={`/post/${post.id}`}
                style={{
                  padding: 12,
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{
                  fontSize: 13,
                  color: theme.textDark,
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}>
                  {post.content}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 11,
                  color: theme.textMid,
                }}>
                  <span>{post.profiles?.full_name || post.profiles?.username}</span>
                  <span>❤️ {post.like_count || 0}</span>
                  <span>💬 {post.comment_count || 0}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recommended Posts */}
      {showPosts && recommendations?.posts?.length > 0 && (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}>
            <Sparkles size={18} color={theme.tealDeep} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: theme.textDark }}>
              Recommended for You
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recommendations.posts.slice(0, 5).map(post => (
              <Link
                key={post.id}
                to={`/post/${post.id}`}
                style={{
                  padding: 12,
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{
                  fontSize: 13,
                  color: theme.textDark,
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}>
                  {post.content}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 11,
                  color: theme.textMid,
                }}>
                  <span>{post.profiles?.full_name || post.profiles?.username}</span>
                  {post.category && (
                    <span style={{
                      padding: '2px 6px',
                      background: theme.tealMist,
                      borderRadius: theme.radius.sm,
                      color: theme.tealDeep,
                      fontSize: 10,
                      fontWeight: 600,
                    }}>
                      {post.category}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recommended News */}
      {showNews && recommendations?.news?.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 700, color: theme.textDark }}>
            News You Might Like
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recommendations.news.map(article => (
              <Link
                key={article.id}
                to={`/news/${article.id}`}
                style={{
                  padding: 12,
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: theme.textDark,
                  marginBottom: 4,
                }}>
                  {article.title}
                </div>
                <div style={{
                  fontSize: 11,
                  color: theme.textMid,
                }}>
                  {article.profiles?.full_name}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recommended Products */}
      {showProducts && recommendations?.products?.length > 0 && (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}>
            <ShoppingBag size={18} color={theme.tealDeep} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: theme.textDark }}>
              Products You May Like
            </h3>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 12,
          }}>
            {recommendations.products.slice(0, 6).map(product => (
              <Link
                key={product.id}
                to={`/shop/product/${product.id}`}
                style={{
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  overflow: 'hidden',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                {product.image_url && (
                  <div style={{
                    width: '100%',
                    height: 120,
                    background: `url(${product.image_url}) center/cover`,
                  }} />
                )}
                <div style={{ padding: 10 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: theme.textDark,
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {product.name}
                  </div>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: theme.tealDeep,
                  }}>
                    ₦{product.price?.toLocaleString()}
                  </div>
                  {product.rating && (
                    <div style={{
                      fontSize: 11,
                      color: theme.textMid,
                      marginTop: 2,
                    }}>
                      ⭐ {product.rating} ({product.review_count || 0})
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* User Preferences */}
      {userId && recommendations?.preferences?.categories?.length > 0 && (
        <div style={{
          padding: 12,
          background: theme.bg,
          borderRadius: theme.radius.md,
          fontSize: 11,
          color: theme.textMid,
        }}>
          <strong>Your interests:</strong>{' '}
          {recommendations.preferences.categories.join(', ')}
        </div>
      )}
    </div>
  )
}

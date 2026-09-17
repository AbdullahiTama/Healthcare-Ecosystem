import { useState, useRef, useEffect } from 'react'
import { Search, Send, X, Bot, User, Sparkles } from 'lucide-react'
import { supabase } from '../../config/supabaseClient'
import { parseAdminQuery, formatQueryResult } from '../../lib/adminAiQuery'
import { theme } from '../../styles/theme'

export default function AdminAiCopilot({ isOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your admin assistant. Ask me about users, news, orders, revenue, posts, or the moderation queue.",
      suggestions: [
        'How many users do we have?',
        'Show pending news',
        "What's today's revenue?",
        'Show moderation queue',
        'Show audit log',
      ],
    },
  ])
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!query.trim() || loading) return

    const userMessage = { role: 'user', content: query }
    setMessages(prev => [...prev, userMessage])
    setQuery('')
    setLoading(true)

    try {
      const result = await parseAdminQuery(query, supabase)
      const formatted = formatQueryResult(result)
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        ...formatted,
      }])
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        type: 'error',
        message: 'Sorry, something went wrong. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleSuggestionClick = (suggestion) => {
    setQuery(suggestion)
    inputRef.current?.focus()
  }

  const renderMessage = (msg, idx) => {
    const isUser = msg.role === 'user'
    
    return (
      <div key={idx} style={{
        display: 'flex',
        gap: 12,
        marginBottom: 16,
        flexDirection: isUser ? 'row-reverse' : 'row',
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: isUser ? theme.tealDeep : theme.navy,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {isUser ? <User size={16} color="var(--color-surface)" /> : <Bot size={16} color="var(--color-surface)" />}
        </div>
        
        <div style={{
          flex: 1,
          maxWidth: '80%',
        }}>
          {msg.type === 'error' ? (
            <div style={{
              padding: 12,
              background: theme.dangerBg,
              border: `1px solid ${theme.danger}`,
              borderRadius: theme.radius.md,
              color: theme.danger,
              fontSize: 13,
            }}>
              {msg.message}
              {msg.suggestions?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Try asking:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {msg.suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(s)}
                        style={{
                          padding: '6px 10px',
                          background: 'white',
                          border: `1px solid ${theme.border}`,
                          borderRadius: theme.radius.sm,
                          fontSize: 12,
                          color: theme.textDark,
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : msg.type === 'stat' ? (
            <div style={{
              padding: 16,
              background: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius.md,
            }}>
              <div style={{ fontSize: 12, color: theme.textMid, marginBottom: 4 }}>
                {msg.label}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: theme.tealDeep }}>
                {msg.value}
              </div>
            </div>
          ) : msg.type === 'table' ? (
            <div style={{
              background: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius.md,
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '8px 12px',
                background: theme.bg,
                borderBottom: `1px solid ${theme.border}`,
                fontSize: 12,
                fontWeight: 600,
                color: theme.textMid,
              }}>
                {msg.label} ({msg.data?.length || 0})
              </div>
              {msg.data?.length > 0 ? (
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: theme.bg }}>
                        {msg.columns?.map(col => (
                          <th key={col} style={{
                            padding: '6px 8px',
                            textAlign: 'left',
                            fontWeight: 600,
                            color: theme.textMid,
                            borderBottom: `1px solid ${theme.border}`,
                          }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {msg.data?.slice(0, 5).map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}>
                          {msg.columns?.map(col => (
                            <td key={col} style={{
                              padding: '6px 8px',
                              color: theme.textDark,
                            }}>
                              {col === 'created_at' 
                                ? new Date(row[col]).toLocaleDateString()
                                : col === 'total_amount'
                                  ? `₦${row[col]?.toLocaleString()}`
                                  : typeof row[col] === 'string' && row[col].length > 30
                                    ? row[col].substring(0, 30) + '...'
                                    : row[col] || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {msg.data?.length > 5 && (
                    <div style={{
                      padding: '8px 12px',
                      fontSize: 11,
                      color: theme.textMid,
                      textAlign: 'center',
                    }}>
                      Showing 5 of {msg.data.length} results
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: 16, textAlign: 'center', color: theme.textMid, fontSize: 13 }}>
                  No results found
                </div>
              )}
            </div>
          ) : (
            <div style={{
              padding: 12,
              background: isUser ? theme.tealDeep : theme.cardBg,
              color: isUser ? 'var(--color-surface)' : theme.textDark,
              borderRadius: theme.radius.md,
              fontSize: 13,
              lineHeight: 1.5,
            }}>
              {msg.content}
              {msg.suggestions?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, opacity: 0.8 }}>
                    Try asking:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {msg.suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(s)}
                        style={{
                          padding: '6px 10px',
                          background: isUser ? 'rgba(255,255,255,0.2)' : theme.bg,
                          border: `1px solid ${isUser ? 'rgba(255,255,255,0.3)' : theme.border}`,
                          borderRadius: theme.radius.sm,
                          fontSize: 11,
                          color: isUser ? 'var(--color-surface)' : theme.textDark,
                          cursor: 'pointer',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      width: 400,
      height: 600,
      background: theme.cardBg,
      borderRadius: theme.radius.lg,
      boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        background: theme.navy,
        color: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: theme.tealDeep,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-surface)',
          }}>
            <Sparkles size={16} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Admin Assistant</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Ask me anything</div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-surface)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 16,
      }}>
        {messages.map((msg, idx) => renderMessage(msg, idx))}
        {loading && (
          <div style={{
            display: 'flex',
            gap: 12,
            marginBottom: 16,
          }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: theme.navy,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Bot size={16} color="var(--color-surface)" />
            </div>
            <div style={{
              padding: 12,
              background: theme.cardBg,
              borderRadius: theme.radius.md,
              fontSize: 13,
              color: theme.textMid,
            }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <span style={{ animation: 'bounce 1s infinite', animationDelay: '0s' }}>.</span>
                <span style={{ animation: 'bounce 1s infinite', animationDelay: '0.2s' }}>.</span>
                <span style={{ animation: 'bounce 1s infinite', animationDelay: '0.4s' }}>.</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: 16,
          borderTop: `1px solid ${theme.border}`,
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about users, news, orders..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '10px 14px',
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius.md,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          style={{
            padding: '10px 16px',
            background: theme.tealDeep,
            color: 'var(--color-surface)',
            border: 'none',
            borderRadius: theme.radius.md,
            cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !query.trim() ? 0.5 : 1,
          }}
        >
          <Send size={16} />
        </button>
      </form>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  )
}

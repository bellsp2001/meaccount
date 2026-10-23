import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface SourceRef { title: string; source?: string }
interface Message { id?: string; role: 'user' | 'assistant'; content: string; sources?: SourceRef[]; sql_query?: string; pending?: boolean }
interface Conversation { id: string; title?: string; created_at: string; message_count: number }

function MarkdownText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\n)/)
  return <span>{parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} style={{ color: 'var(--color-text)' }}>{part.slice(2, -2)}</strong>
    if (part === '\n') return <br key={i} />
    return <span key={i}>{part}</span>
  })}</span>
}

const SUGGESTIONS = ['VAT ต้องยื่นวันไหน?', 'อัตราหัก ณ ที่จ่ายค่าเช่ากี่%?', 'รายได้ 6 เดือนย้อนหลังเป็นยังไง?', 'ลูกหนี้เกินกำหนดมีใครบ้าง?', 'ลูกค้าที่ซื้อเยอะที่สุดคือใคร?']

export default function AIChatPage() {
  const qc = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'สวัสดีครับ! ผมคือ **มีบัญชี AI 2.0**\n\nตอนนี้ผมมีความสามารถใหม่:\n- 📚 อ้างอิงกฎหมายบัญชี-ภาษีไทยได้แม่นยำขึ้น\n- 📊 ดึงข้อมูลจริงในระบบมาตอบ (รายได้, ลูกหนี้, Top customers)\n- 🧠 จำบทสนทนาของคุณได้ต่อเนื่อง' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ['chat-conversations'],
    queryFn: async () => (await api.get('/api/v1/chat-v2/conversations')).data,
  })

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function loadConversation(convId: string) {
    setConversationId(convId)
    const { data } = await api.get(`/api/v1/chat-v2/conversations/${convId}/messages`)
    setMessages(data.map((m: any) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, sql_query: m.sql_query })))
    setShowSidebar(false)
  }

  function startNew() {
    setConversationId(null)
    setMessages([{ role: 'assistant', content: 'เริ่มการสนทนาใหม่แล้วครับ! มีอะไรให้ช่วยไหม?' }])
    setShowSidebar(false)
  }

  async function sendMessage(text?: string) {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: '', pending: true }])
    setLoading(true)

    try {
      const { data } = await api.post('/api/v1/chat-v2/message', { conversation_id: conversationId, message: msg })
      setConversationId(data.conversation_id)
      setMessages(prev => {
        const copy = [...prev]
        copy[copy.length - 1] = { id: data.message_id, role: 'assistant', content: data.content, sources: data.sources, sql_query: data.sql_query }
        return copy
      })
      qc.invalidateQueries({ queryKey: ['chat-conversations'] })
    } catch {
      setMessages(prev => {
        const copy = [...prev]
        copy[copy.length - 1] = { role: 'assistant', content: '⚠️ ไม่สามารถเชื่อมต่อ AI ได้ กรุณาลองใหม่' }
        return copy
      })
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px - 48px)', background: 'var(--color-bg)', gap: 0, position: 'relative' }}>
      {/* Conversation sidebar (toggle) */}
      {showSidebar && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex' }}>
          <div style={{ width: 260, background: 'var(--color-bg)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 16, borderBottom: '1px solid var(--color-border)' }}>
              <button onClick={startNew} style={{ width: '100%', background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '9px', cursor: 'pointer' }}>+ บทสนทนาใหม่</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {conversations.map(c => (
                <button key={c.id} onClick={() => loadConversation(c.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: c.id === conversationId ? '#F2714E12' : 'transparent', border: 'none', borderRadius: 8, padding: '10px 12px', marginBottom: 2, cursor: 'pointer', color: c.id === conversationId ? '#F2714E' : 'var(--color-text-secondary)', fontSize: 12 }}>
                  <p style={{ margin: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'บทสนทนาใหม่'}</p>
                  <p style={{ margin: 0, fontSize: 10, color: 'var(--color-dim)' }}>{c.message_count} ข้อความ</p>
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowSidebar(false)} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setShowSidebar(true)} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 14 }}>☰</button>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#FF9E80,#F2714E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🤖</div>
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>มีบัญชี AI 2.0</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#43E97B', display: 'inline-block' }} />
              <p style={{ margin: 0, fontSize: 10, color: 'var(--color-muted)' }}>RAG + Text-to-SQL + Memory</p>
            </div>
          </div>
          <button onClick={startNew} style={{ marginLeft: 'auto', background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-tertiary)', borderRadius: 8, padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>เริ่มใหม่</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: msg.role === 'user' ? 'linear-gradient(135deg,#FFB59E,#F2714E)' : 'linear-gradient(135deg,#F2714E,#43E97B)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div style={{ maxWidth: '72%', background: msg.role === 'user' ? 'linear-gradient(135deg,#F2714E18,#FFB59E12)' : 'var(--color-card)', border: `1px solid ${msg.role === 'user' ? '#F2714E30' : 'var(--color-border-strong)'}`, borderRadius: msg.role === 'user' ? '14px 4px 14px 14px' : '4px 14px 14px 14px', padding: '12px 16px' }}>
                {msg.pending ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{[0, 1, 2].map(j => <span key={j} style={{ width: 6, height: 6, borderRadius: '50%', background: '#F2714E', display: 'inline-block', animation: `bounce 1.2s ${j * 0.2}s infinite` }} />)}</div>
                ) : (
                  <>
                    <p style={{ margin: 0, fontSize: 13, color: msg.role === 'user' ? 'var(--color-text)' : 'var(--color-text-secondary)', lineHeight: 1.7 }}><MarkdownText text={msg.content} /></p>
                    {msg.sources && msg.sources.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--color-bg-inset)' }}>
                        <p style={{ margin: '0 0 6px', fontSize: 9, color: '#F2714E', fontWeight: 700, textTransform: 'uppercase' }}>📚 อ้างอิง</p>
                        {msg.sources.map((s, j) => (
                          <p key={j} style={{ margin: '2px 0', fontSize: 10, color: 'var(--color-text-tertiary)' }}>• {s.title}{s.source ? ` (${s.source})` : ''}</p>
                        ))}
                      </div>
                    )}
                    {msg.sql_query && (
                      <div style={{ marginTop: 8 }}>
                        <span style={{ fontSize: 9, color: '#F5A623', background: '#F5A62315', border: '1px solid #F5A62330', padding: '2px 8px', borderRadius: 8, fontFamily: 'monospace' }}>🔍 {msg.sql_query}</span>
                      </div>
                    )}
                    {msg.role === 'assistant' && !msg.pending && i > 0 && (
                      <FeedbackButtons
                        question={messages[i - 1]?.content || ''}
                        answer={msg.content}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        {messages.length <= 1 && (
          <div style={{ padding: '0 24px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => sendMessage(s)} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-tertiary)', borderRadius: 20, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>{s}</button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 14, padding: '10px 14px' }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder="ถามเกี่ยวกับกฎหมายภาษี หรือข้อมูลในระบบ..." rows={1} disabled={loading}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', fontSize: 13, resize: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', fontFamily: 'inherit' }}
              onInput={e => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }} />
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
              style={{ width: 36, height: 36, borderRadius: 10, border: 'none', flexShrink: 0, background: input.trim() && !loading ? 'linear-gradient(135deg,#FF9E80,#F2714E)' : 'var(--color-border)', color: input.trim() && !loading ? 'var(--color-bg)' : 'var(--color-dim)', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', fontSize: 16 }}>
              {loading ? '⏳' : '➤'}
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--color-dim)', textAlign: 'center' }}>AI อ้างอิงกฎหมายจริงและข้อมูลระบบ · ตรวจสอบกับนักบัญชีก่อนตัดสินใจสำคัญ</p>
        </div>
      </div>
      <style>{`@keyframes bounce { 0%,80%,100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-6px); opacity: 1; } }`}</style>
    </div>
  )
}

function FeedbackButtons({ question, answer }: { question: string; answer: string }) {
  const [rated, setRated] = useState<'helpful' | 'not_helpful' | null>(null)

  function rate(rating: 'helpful' | 'not_helpful') {
    if (rated) return
    setRated(rating)
    // Feedback capture (AI Ops) was removed; keep the local acknowledgement UI.
  }

  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-bg-inset)' }}>
      <button onClick={() => rate('helpful')} disabled={!!rated}
        style={{ background: rated === 'helpful' ? '#43E97B18' : 'transparent', border: `1px solid ${rated === 'helpful' ? '#43E97B40' : 'var(--color-border-strong)'}`, borderRadius: 6, padding: '3px 8px', cursor: rated ? 'default' : 'pointer', fontSize: 11, color: rated === 'helpful' ? '#43E97B' : 'var(--color-muted)' }}>
        👍
      </button>
      <button onClick={() => rate('not_helpful')} disabled={!!rated}
        style={{ background: rated === 'not_helpful' ? '#FF6B6B18' : 'transparent', border: `1px solid ${rated === 'not_helpful' ? '#FF6B6B40' : 'var(--color-border-strong)'}`, borderRadius: 6, padding: '3px 8px', cursor: rated ? 'default' : 'pointer', fontSize: 11, color: rated === 'not_helpful' ? '#FF6B6B' : 'var(--color-muted)' }}>
        👎
      </button>
      {rated && <span style={{ fontSize: 10, color: 'var(--color-dim)', alignSelf: 'center' }}>ขอบคุณสำหรับความคิดเห็น</span>}
    </div>
  )
}

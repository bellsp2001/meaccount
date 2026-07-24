import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface SourceRef { title: string; source?: string }
interface Message { id?: string; role: 'user' | 'assistant'; content: string; sources?: SourceRef[]; sql_query?: string; pending?: boolean }
interface Conversation { id: string; title?: string; created_at: string; message_count: number }

function MarkdownText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\n)/)
  return <span>{parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} style={{ color: '#DDE3EE' }}>{part.slice(2, -2)}</strong>
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
    <div style={{ display: 'flex', height: 'calc(100vh - 56px - 48px)', background: '#07090E', gap: 0, position: 'relative' }}>
      {/* Conversation sidebar (toggle) */}
      {showSidebar && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex' }}>
          <div style={{ width: 260, background: '#0A0C12', borderRight: '1px solid #151C28', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 16, borderBottom: '1px solid #151C28' }}>
              <button onClick={startNew} style={{ width: '100%', background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '9px', cursor: 'pointer' }}>+ บทสนทนาใหม่</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {conversations.map(c => (
                <button key={c.id} onClick={() => loadConversation(c.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: c.id === conversationId ? '#00D4AA12' : 'transparent', border: 'none', borderRadius: 8, padding: '10px 12px', marginBottom: 2, cursor: 'pointer', color: c.id === conversationId ? '#00D4AA' : '#8A9BB0', fontSize: 12 }}>
                  <p style={{ margin: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'บทสนทนาใหม่'}</p>
                  <p style={{ margin: 0, fontSize: 10, color: '#3A4A60' }}>{c.message_count} ข้อความ</p>
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowSidebar(false)} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #151C28', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setShowSidebar(true)} style={{ background: '#0D1018', border: '1px solid #1E2A3A', color: '#8A9BB0', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 14 }}>☰</button>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🤖</div>
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>มีบัญชี AI 2.0</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#43E97B', display: 'inline-block' }} />
              <p style={{ margin: 0, fontSize: 10, color: '#4A5A70' }}>RAG + Text-to-SQL + Memory</p>
            </div>
          </div>
          <button onClick={startNew} style={{ marginLeft: 'auto', background: '#0D1018', border: '1px solid #1E2A3A', color: '#6A7A90', borderRadius: 8, padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>เริ่มใหม่</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: msg.role === 'user' ? 'linear-gradient(135deg,#4FACFE,#00D4AA)' : 'linear-gradient(135deg,#00D4AA,#43E97B)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div style={{ maxWidth: '72%', background: msg.role === 'user' ? 'linear-gradient(135deg,#00D4AA18,#4FACFE12)' : '#0D1018', border: `1px solid ${msg.role === 'user' ? '#00D4AA30' : '#1E2A3A'}`, borderRadius: msg.role === 'user' ? '14px 4px 14px 14px' : '4px 14px 14px 14px', padding: '12px 16px' }}>
                {msg.pending ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{[0, 1, 2].map(j => <span key={j} style={{ width: 6, height: 6, borderRadius: '50%', background: '#00D4AA', display: 'inline-block', animation: `bounce 1.2s ${j * 0.2}s infinite` }} />)}</div>
                ) : (
                  <>
                    <p style={{ margin: 0, fontSize: 13, color: msg.role === 'user' ? '#DDE3EE' : '#B0C0D0', lineHeight: 1.7 }}><MarkdownText text={msg.content} /></p>
                    {msg.sources && msg.sources.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1A2230' }}>
                        <p style={{ margin: '0 0 6px', fontSize: 9, color: '#00D4AA', fontWeight: 700, textTransform: 'uppercase' }}>📚 อ้างอิง</p>
                        {msg.sources.map((s, j) => (
                          <p key={j} style={{ margin: '2px 0', fontSize: 10, color: '#5A7A90' }}>• {s.title}{s.source ? ` (${s.source})` : ''}</p>
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
              <button key={s} onClick={() => sendMessage(s)} style={{ background: '#0D1018', border: '1px solid #1E2A3A', color: '#6A8090', borderRadius: 20, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>{s}</button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: '12px 24px 20px', borderTop: '1px solid #151C28', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 14, padding: '10px 14px' }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder="ถามเกี่ยวกับกฎหมายภาษี หรือข้อมูลในระบบ..." rows={1} disabled={loading}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#DDE3EE', fontSize: 13, resize: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', fontFamily: 'inherit' }}
              onInput={e => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }} />
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
              style={{ width: 36, height: 36, borderRadius: 10, border: 'none', flexShrink: 0, background: input.trim() && !loading ? 'linear-gradient(135deg,#00D4AA,#4FACFE)' : '#151C28', color: input.trim() && !loading ? '#07090E' : '#3A4A60', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', fontSize: 16 }}>
              {loading ? '⏳' : '➤'}
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 10, color: '#2A3A50', textAlign: 'center' }}>AI อ้างอิงกฎหมายจริงและข้อมูลระบบ · ตรวจสอบกับนักบัญชีก่อนตัดสินใจสำคัญ</p>
        </div>
      </div>
      <style>{`@keyframes bounce { 0%,80%,100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-6px); opacity: 1; } }`}</style>
    </div>
  )
}

function FeedbackButtons({ question, answer }: { question: string; answer: string }) {
  const [rated, setRated] = useState<'helpful' | 'not_helpful' | null>(null)

  async function rate(rating: 'helpful' | 'not_helpful') {
    if (rated) return
    setRated(rating)
    try {
      await api.post('/api/v1/ai-ops/feedback', { question, answer, rating })
    } catch {
      // Feedback is a nice-to-have signal, not critical path — fail silently
      // rather than showing an error for a background telemetry call.
    }
  }

  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid #1A2230' }}>
      <button onClick={() => rate('helpful')} disabled={!!rated}
        style={{ background: rated === 'helpful' ? '#43E97B18' : 'transparent', border: `1px solid ${rated === 'helpful' ? '#43E97B40' : '#1E2A3A'}`, borderRadius: 6, padding: '3px 8px', cursor: rated ? 'default' : 'pointer', fontSize: 11, color: rated === 'helpful' ? '#43E97B' : '#4A5A70' }}>
        👍
      </button>
      <button onClick={() => rate('not_helpful')} disabled={!!rated}
        style={{ background: rated === 'not_helpful' ? '#FF6B6B18' : 'transparent', border: `1px solid ${rated === 'not_helpful' ? '#FF6B6B40' : '#1E2A3A'}`, borderRadius: 6, padding: '3px 8px', cursor: rated ? 'default' : 'pointer', fontSize: 11, color: rated === 'not_helpful' ? '#FF6B6B' : '#4A5A70' }}>
        👎
      </button>
      {rated && <span style={{ fontSize: 10, color: '#3A4A60', alignSelf: 'center' }}>ขอบคุณสำหรับความคิดเห็น</span>}
    </div>
  )
}

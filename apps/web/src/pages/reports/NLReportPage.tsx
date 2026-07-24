import { useState, useRef, useEffect } from 'react'
import api from '@/lib/api'

interface NLResult { question: string; interpretation: string; answer: string; data?: any; chart_suggestion?: string }

const SUGGESTIONS = ['สรุปรายได้เดือนนี้ให้หน่อย', 'มีลูกหนี้เกินกำหนดกี่ราย?', 'ยอดเงินสดตอนนี้เท่าไหร่?', 'สินทรัพย์รวมมีเท่าไหร่?', 'มี Bills รออนุมัติกี่รายการ?']

export default function NLReportPage() {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<NLResult[]>([])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [history])

  async function ask(q?: string) {
    const query = q || question
    if (!query.trim() || loading) return
    setQuestion(''); setLoading(true)
    try {
      const { data } = await api.post('/api/v1/report-builder/nl-query', { question: query })
      setHistory(prev => [...prev, data])
    } finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: 'calc(100vh - 140px)' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ถามด้วยภาษาพูด (Natural Language Report)</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>พิมพ์คำถามภาษาไทย ระบบจะดึงข้อมูลและสรุปให้อัตโนมัติ</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {history.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, color: '#4A5A70', marginBottom: 6 }}>ลองถามคำถามเหล่านี้:</p>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => ask(s)} style={{ textAlign: 'left', background: '#0D1018', border: '1px solid #151C28', color: '#8A9BB0', borderRadius: 10, padding: '12px 16px', fontSize: 13, cursor: 'pointer' }}>
                💬 {s}
              </button>
            ))}
          </div>
        )}

        {history.map((h, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '75%', background: 'linear-gradient(135deg,#00D4AA18,#4FACFE12)', border: '1px solid #00D4AA30', borderRadius: '14px 4px 14px 14px', padding: '10px 16px' }}>
              <p style={{ margin: 0, fontSize: 13 }}>{h.question}</p>
            </div>
            <div style={{ alignSelf: 'flex-start', maxWidth: '85%', background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: '4px 14px 14px 14px', padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>🤖</span>
                <span style={{ fontSize: 10, color: '#00D4AA', fontWeight: 700 }}>มีบัญชี AI</span>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#DDE3EE', lineHeight: 1.7 }}>{h.answer}</p>
              {h.data && (
                <div style={{ background: '#070A0F', borderRadius: 10, padding: '10px 14px', marginTop: 8 }}>
                  {Object.entries(h.data).filter(([k]) => typeof h.data[k] === 'number' || typeof h.data[k] === 'string').slice(0, 6).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                      <span style={{ color: '#4A5A70', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                      <span style={{ fontFamily: 'monospace', color: '#43E97B' }}>{typeof v === 'number' ? v.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ alignSelf: 'flex-start', background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: '4px 14px 14px 14px', padding: '14px 18px' }}>
            <div style={{ display: 'flex', gap: 4 }}>{[0, 1, 2].map(j => <span key={j} style={{ width: 6, height: 6, borderRadius: '50%', background: '#00D4AA', animation: `bounce 1.2s ${j * 0.2}s infinite` }} />)}</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 10, background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 14, padding: '10px 14px' }}>
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()}
          placeholder="ถามเกี่ยวกับข้อมูลบัญชีของคุณ..." disabled={loading}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#DDE3EE', fontSize: 13 }} />
        <button onClick={() => ask()} disabled={loading || !question.trim()}
          style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: question.trim() && !loading ? 'linear-gradient(135deg,#00D4AA,#4FACFE)' : '#151C28', color: question.trim() && !loading ? '#07090E' : '#3A4A60', cursor: question.trim() ? 'pointer' : 'not-allowed', fontSize: 16 }}>
          {loading ? '⏳' : '➤'}
        </button>
      </div>
      <style>{`@keyframes bounce { 0%,80%,100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-6px); opacity: 1; } }`}</style>
    </div>
  )
}

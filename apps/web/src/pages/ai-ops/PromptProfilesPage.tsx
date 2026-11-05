import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Example { id: string; question: string; answer: string }
interface Profile { id: string; name: string; industry: string; system_prompt: string; model_string: string; is_active: boolean; examples: Example[] }

const INDUSTRY_META: Record<string, { label: string; icon: string; color: string }> = {
  general: { label: 'ทั่วไป', icon: '🏢', color: '#4FACFE' },
  retail: { label: 'ค้าปลีก', icon: '🛒', color: '#43E97B' },
  service: { label: 'บริการ', icon: '💼', color: '#F5A623' },
  manufacturing: { label: 'การผลิต', icon: '🏭', color: '#F093FB' },
}

const inp: React.CSSProperties = { width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', marginBottom: 6 }

export default function PromptProfilesPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [detail, setDetail] = useState<Profile | null>(null)
  const [form, setForm] = useState({ name: '', industry: 'general', system_prompt: '', examples: [{ question: '', answer: '' }] })

  const { data: profiles = [], isLoading } = useQuery<Profile[]>({
    queryKey: ['prompt-profiles'],
    queryFn: async () => (await api.get('/api/v1/ai-ops/profiles')).data,
  })

  const createM = useMutation({
    mutationFn: () => api.post('/api/v1/ai-ops/profiles', { ...form, examples: form.examples.filter(e => e.question && e.answer) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prompt-profiles'] }); setShowCreate(false); setForm({ name: '', industry: 'general', system_prompt: '', examples: [{ question: '', answer: '' }] }) },
  })

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Prompt Profiles</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>ปรับพฤติกรรม AI ตามประเภทธุรกิจ — ไม่ต้อง train model</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + สร้าง Profile
        </button>
      </div>

      <div style={{ background: '#4FACFE08', border: '1px solid #4FACFE25', borderRadius: 10, padding: '12px 16px' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#4FACFE' }}>ℹ️ Profile คือ system prompt + ตัวอย่างที่ดี (few-shot) ไม่ใช่การ train model ใหม่ — ปรับพฤติกรรม AI ได้ทันทีโดยไม่ต้องรอ</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
        {isLoading ? <p style={{ color: '#3A4A60' }}>กำลังโหลด...</p>
        : profiles.map(p => {
          const im = INDUSTRY_META[p.industry] || INDUSTRY_META.general
          return (
            <div key={p.id} onClick={() => setDetail(p)} style={{ background: '#0D1018', border: `1px solid ${im.color}25`, borderRadius: 14, padding: '18px 20px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 22 }}>{im.icon}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: im.color, background: im.color + '18', padding: '2px 8px', borderRadius: 10 }}>{im.label}</span>
              </div>
              <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700 }}>{p.name}</p>
              <p style={{ margin: 0, fontSize: 11, color: '#4A5A70' }}>{p.examples.length} ตัวอย่าง · {p.model_string.split('-').slice(0, 2).join(' ')}</p>
            </div>
          )
        })}
      </div>

      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>สร้าง Prompt Profile ใหม่</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <div><label style={lbl}>ชื่อ Profile</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="เช่น ร้านค้าปลีก" style={inp} /></div>
                <div>
                  <label style={lbl}>ประเภทธุรกิจ</label>
                  <select value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                    {Object.entries(INDUSTRY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div><label style={lbl}>System Prompt</label><textarea value={form.system_prompt} onChange={e => setForm({ ...form, system_prompt: e.target.value })} rows={4} placeholder="คุณเป็นผู้เชี่ยวชาญบัญชีสำหรับธุรกิจ..." style={{ ...inp, resize: 'vertical' }} /></div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={lbl}>ตัวอย่างคำถาม-คำตอบ (Few-shot)</label>
                  <button onClick={() => setForm({ ...form, examples: [...form.examples, { question: '', answer: '' }] })} style={{ fontSize: 10, background: '#151C28', border: '1px solid #1E2A3A', color: '#8A9BB0', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>+ เพิ่ม</button>
                </div>
                {form.examples.map((ex, i) => (
                  <div key={i} style={{ background: '#070A0F', borderRadius: 8, padding: '10px', marginBottom: 8 }}>
                    <input value={ex.question} onChange={e => { const ne = [...form.examples]; ne[i].question = e.target.value; setForm({ ...form, examples: ne }) }} placeholder="คำถามตัวอย่าง" style={{ ...inp, marginBottom: 6 }} />
                    <textarea value={ex.answer} onChange={e => { const ne = [...form.examples]; ne[i].answer = e.target.value; setForm({ ...form, examples: ne }) }} placeholder="คำตอบที่ดี" rows={2} style={{ ...inp, resize: 'vertical' }} />
                  </div>
                ))}
              </div>

              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด</p></div>}
              <button onClick={() => createM.mutate()} disabled={!form.name || !form.system_prompt || createM.isPending}
                style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer' }}>
                {createM.isPending ? 'กำลังสร้าง...' : 'สร้าง Profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div style={overlay} onClick={() => setDetail(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{detail.name}</h3>
              <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: '#4A5A70', textTransform: 'uppercase' }}>System Prompt</p>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: '#8A9BB0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{detail.system_prompt}</p>
              {detail.examples.length > 0 && (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: '#4A5A70', textTransform: 'uppercase' }}>ตัวอย่าง ({detail.examples.length})</p>
                  {detail.examples.map(ex => (
                    <div key={ex.id} style={{ background: '#070A0F', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                      <p style={{ margin: '0 0 4px', fontSize: 11, color: '#4FACFE', fontWeight: 600 }}>Q: {ex.question}</p>
                      <p style={{ margin: 0, fontSize: 11, color: '#8A9BB0' }}>A: {ex.answer}</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

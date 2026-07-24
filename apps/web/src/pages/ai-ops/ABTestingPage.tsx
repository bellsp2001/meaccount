import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Profile { id: string; name: string }
interface ABTest { id: string; name: string; profile_a_id: string; profile_b_id: string; traffic_split_pct: number; is_active: boolean }
interface ABResults { arm_a: { profile_name: string; assignment_count: number; total_feedback: number; helpful_rate_pct?: number }; arm_b: { profile_name: string; assignment_count: number; total_feedback: number; helpful_rate_pct?: number }; leading_arm?: string; sample_size_note: string }

const inp: React.CSSProperties = { width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', boxSizing: 'border-box' }

export default function ABTestingPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTest, setSelectedTest] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', profile_a_id: '', profile_b_id: '', traffic_split_pct: 50 })

  const { data: profiles = [] } = useQuery<Profile[]>({ queryKey: ['prompt-profiles'], queryFn: async () => (await api.get('/api/v1/ai-ops/profiles')).data })
  const { data: tests = [] } = useQuery<ABTest[]>({ queryKey: ['ab-tests'], queryFn: async () => (await api.get('/api/v1/ai-ops/ab-tests')).data })
  const { data: results } = useQuery<ABResults>({
    queryKey: ['ab-results', selectedTest], enabled: !!selectedTest,
    queryFn: async () => (await api.get(`/api/v1/ai-ops/ab-tests/${selectedTest}/results`)).data,
  })

  const createM = useMutation({
    mutationFn: () => api.post('/api/v1/ai-ops/ab-tests', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ab-tests'] }); setShowCreate(false) },
  })

  const profileName = (id: string) => profiles.find(p => p.id === id)?.name || '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>A/B Testing</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>เปรียบเทียบ Prompt Profile 2 แบบด้วยข้อมูล Feedback จริง</p>
        </div>
        <button onClick={() => setShowCreate(true)} disabled={profiles.length < 2}
          style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer', opacity: profiles.length < 2 ? 0.5 : 1 }}>
          + สร้าง A/B Test
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tests.map(t => (
            <button key={t.id} onClick={() => setSelectedTest(t.id)}
              style={{ textAlign: 'left', background: selectedTest === t.id ? '#00D4AA12' : '#0D1018', border: `1px solid ${selectedTest === t.id ? '#00D4AA40' : '#151C28'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700 }}>{t.name}</p>
              <p style={{ margin: 0, fontSize: 10, color: '#4A5A70' }}>{profileName(t.profile_a_id)} vs {profileName(t.profile_b_id)}</p>
              <p style={{ margin: '4px 0 0', fontSize: 10, color: '#4FACFE' }}>Split {100 - t.traffic_split_pct}% / {t.traffic_split_pct}%</p>
            </button>
          ))}
          {tests.length === 0 && <p style={{ color: '#3A4A60', fontSize: 12 }}>ยังไม่มี A/B Test</p>}
        </div>

        <div>
          {!selectedTest ? (
            <div style={{ padding: 60, textAlign: 'center', background: '#0D1018', border: '1px solid #151C28', borderRadius: 14 }}>
              <p style={{ color: '#3A4A60', fontSize: 13 }}>เลือก A/B Test เพื่อดูผลลัพธ์</p>
            </div>
          ) : results && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[['A', results.arm_a], ['B', results.arm_b]].map(([label, arm]: any) => {
                  const isLeading = results.leading_arm === label
                  return (
                    <div key={label} style={{ background: '#0D1018', border: `1px solid ${isLeading ? '#43E97B50' : '#151C28'}`, borderRadius: 14, padding: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#8A9BB0' }}>Arm {label}: {arm.profile_name}</span>
                        {isLeading && <span style={{ fontSize: 9, fontWeight: 700, color: '#43E97B', background: '#43E97B18', padding: '2px 8px', borderRadius: 10 }}>🏆 นำ</span>}
                      </div>
                      <p style={{ margin: '0 0 4px', fontSize: 28, fontWeight: 800, color: isLeading ? '#43E97B' : '#DDE3EE' }}>
                        {arm.helpful_rate_pct != null ? `${arm.helpful_rate_pct}%` : '—'}
                      </p>
                      <p style={{ margin: '0 0 10px', fontSize: 10, color: '#4A5A70' }}>Helpful Rate</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4A5A70', borderTop: '1px solid #151C28', paddingTop: 8 }}>
                        <span>Requests: {arm.assignment_count}</span>
                        <span>Feedback: {arm.total_feedback}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ background: '#F5A62308', border: '1px solid #F5A62325', borderRadius: 10, padding: '12px 16px' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#F5A623' }}>{results.sample_size_note}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={() => setShowCreate(false)}>
          <div style={{ background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28' }}><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>สร้าง A/B Test</h3></div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ชื่อการทดสอบ" style={inp} />
              <select value={form.profile_a_id} onChange={e => setForm({ ...form, profile_a_id: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                <option value="">-- Profile A --</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={form.profile_b_id} onChange={e => setForm({ ...form, profile_b_id: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                <option value="">-- Profile B --</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div>
                <label style={{ fontSize: 10, color: '#6A7A90', display: 'block', marginBottom: 6 }}>Traffic Split (% ไปยัง B): {form.traffic_split_pct}%</label>
                <input type="range" min="0" max="100" value={form.traffic_split_pct} onChange={e => setForm({ ...form, traffic_split_pct: Number(e.target.value) })} style={{ width: '100%' }} />
              </div>
              {createM.isError && <p style={{ color: '#FF6B6B', fontSize: 11 }}>เกิดข้อผิดพลาด — ตรวจสอบว่าเลือก Profile A/B ต่างกัน</p>}
              <button onClick={() => createM.mutate()} disabled={!form.name || !form.profile_a_id || !form.profile_b_id}
                style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer' }}>
                สร้าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

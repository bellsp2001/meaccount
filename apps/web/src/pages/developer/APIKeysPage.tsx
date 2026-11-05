import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface APIKey { id: string; name: string; key_prefix: string; status: string; rate_limit_per_min: number; request_count: number; last_used_at?: string; created_at: string }

const inp: React.CSSProperties = { width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', boxSizing: 'border-box' }

export default function APIKeysPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [rateLimit, setRateLimit] = useState(60)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: keys = [], isLoading } = useQuery<APIKey[]>({
    queryKey: ['api-keys'],
    queryFn: async () => (await api.get('/api/v1/platform/api-keys')).data,
  })

  const createM = useMutation({
    mutationFn: () => api.post('/api/v1/platform/api-keys', { name, rate_limit_per_min: rateLimit }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['api-keys'] }); setNewKey(res.data.plaintext_key); setName('') },
  })
  const revokeM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/platform/api-keys/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })

  function copyKey() {
    if (newKey) { navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 480 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>API Keys</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>สำหรับเชื่อมต่อ MeAccount API จากภายนอก</p>
        </div>
        <button onClick={() => { setShowCreate(true); setNewKey(null) }} style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + สร้าง API Key
        </button>
      </div>

      <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <p style={{ padding: 40, color: '#3A4A60' }}>กำลังโหลด...</p>
        : keys.length === 0 ? <p style={{ padding: 40, textAlign: 'center', color: '#3A4A60' }}>ยังไม่มี API Key</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['ชื่อ', 'Key', 'สถานะ', 'Rate Limit', 'ใช้งานแล้ว', ''].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', borderBottom: '1px solid #151C28' }}>{h}</th>)}</tr></thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id}>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 13, fontWeight: 600 }}>{k.name}</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, fontFamily: 'monospace', color: '#4FACFE' }}>{k.key_prefix}•••••</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: k.status === 'active' ? '#43E97B' : '#FF6B6B', background: k.status === 'active' ? '#43E97B18' : '#FF6B6B18', padding: '2px 8px', borderRadius: 10 }}>{k.status === 'active' ? 'Active' : 'Revoked'}</span>
                  </td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#6A7A90' }}>{k.rate_limit_per_min}/min</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#6A7A90' }}>{k.request_count.toLocaleString()} ครั้ง</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520' }}>
                    {k.status === 'active' && <button onClick={() => revokeM.mutate(k.id)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid #FF6B6B40', background: '#FF6B6B12', color: '#FF6B6B', cursor: 'pointer', fontWeight: 700 }}>เพิกถอน</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{newKey ? '✓ สร้าง API Key สำเร็จ' : 'สร้าง API Key ใหม่'}</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24 }}>
              {!newKey ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div><label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', marginBottom: 6 }}>ชื่อ Key</label><input value={name} onChange={e => setName(e.target.value)} placeholder="เช่น Production Server" style={inp} /></div>
                  <div><label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', marginBottom: 6 }}>Rate Limit (ครั้ง/นาที)</label><input type="number" value={rateLimit} onChange={e => setRateLimit(Number(e.target.value))} style={inp} /></div>
                  <button onClick={() => createM.mutate()} disabled={!name || createM.isPending}
                    style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer' }}>
                    {createM.isPending ? 'กำลังสร้าง...' : 'สร้าง Key'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ background: '#FF6B6B10', border: '1px solid #FF6B6B30', borderRadius: 10, padding: '12px 16px' }}>
                    <p style={{ margin: 0, fontSize: 11, color: '#FF6B6B', fontWeight: 700 }}>⚠️ บันทึก Key นี้ทันที — จะไม่แสดงอีกครั้ง</p>
                  </div>
                  <div style={{ background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <code style={{ flex: 1, fontSize: 11, color: '#43E97B', wordBreak: 'break-all' }}>{newKey}</code>
                    <button onClick={copyKey} style={{ background: '#151C28', border: '1px solid #1E2A3A', borderRadius: 6, padding: '6px 10px', fontSize: 10, color: '#8A9BB0', cursor: 'pointer', flexShrink: 0 }}>{copied ? '✓ คัดลอกแล้ว' : 'คัดลอก'}</button>
                  </div>
                  <button onClick={() => { setShowCreate(false); setNewKey(null) }} style={{ background: '#151C28', color: '#8A9BB0', fontWeight: 700, fontSize: 12, border: 'none', borderRadius: 9, padding: '10px', cursor: 'pointer' }}>ปิด</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

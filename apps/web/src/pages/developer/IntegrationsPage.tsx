import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Integration { id: string; provider: string; status: string; last_sync_at?: string; last_error?: string }

const PROVIDERS = [
  { value: 'bank_scb', label: 'ธนาคารไทยพาณิชย์ (SCB)', icon: '🏦', configField: 'account_number', configLabel: 'เลขบัญชี' },
  { value: 'bank_kbank', label: 'ธนาคารกสิกรไทย', icon: '🏦', configField: 'account_number', configLabel: 'เลขบัญชี' },
  { value: 'etax_rd', label: 'e-Tax Invoice กรมสรรพากร', icon: '🧾', configField: '', configLabel: '' },
  { value: 'ecommerce_lazada', label: 'Lazada Seller Center', icon: '🛒', configField: '', configLabel: '' },
  { value: 'ecommerce_shopee', label: 'Shopee Open Platform', icon: '🛍️', configField: '', configLabel: '' },
]

export default function IntegrationsPage() {
  const qc = useQueryClient()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [configValue, setConfigValue] = useState('')

  const { data: integrations = [] } = useQuery<Integration[]>({
    queryKey: ['integrations'],
    queryFn: async () => (await api.get('/api/v1/platform/integrations')).data,
  })

  const connectM = useMutation({
    mutationFn: ({ provider, config }: { provider: string; config: any }) =>
      api.post('/api/v1/platform/integrations/connect', { provider, config }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); setConnecting(null); setConfigValue('') },
  })
  const syncM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/platform/integrations/${id}/sync`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  })

  function getStatus(provider: string) {
    return integrations.find(i => i.provider === provider)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Integration Hub</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>เชื่อมต่อบริการภายนอก</p>
      </div>

      <div style={{ background: '#F5A62308', border: '1px solid #F5A62325', borderRadius: 10, padding: '12px 16px' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#F5A623' }}>
          ⚠️ Integration ธนาคารในหน้านี้เป็น <strong>Mock Adapter สำหรับทดสอบ flow</strong> ยังไม่เชื่อมต่อธนาคารจริง ส่วน e-Tax/Lazada/Shopee ต้องรอ credential จริงจากผู้ให้บริการ
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
        {PROVIDERS.map(p => {
          const status = getStatus(p.value)
          const isConnected = status?.status === 'connected'
          const isError = status?.status === 'error'
          return (
            <div key={p.value} style={{ background: '#0D1018', border: `1px solid ${isConnected ? '#43E97B30' : isError ? '#FF6B6B30' : '#151C28'}`, borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>{p.icon}</span>
                {status && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: isConnected ? '#43E97B' : isError ? '#FF6B6B' : '#8A9BB0', background: (isConnected ? '#43E97B' : isError ? '#FF6B6B' : '#8A9BB0') + '18', padding: '2px 8px', borderRadius: 10 }}>
                    {isConnected ? 'เชื่อมต่อแล้ว' : isError ? 'ผิดพลาด' : 'ยังไม่เชื่อมต่อ'}
                  </span>
                )}
              </div>
              <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>{p.label}</p>
              {status?.last_error && <p style={{ margin: '6px 0 0', fontSize: 10, color: '#FF6B6B' }}>{status.last_error}</p>}
              {status?.last_sync_at && <p style={{ margin: '6px 0 0', fontSize: 10, color: '#4A5A70' }}>Sync ล่าสุด: {new Date(status.last_sync_at).toLocaleString('th-TH')}</p>}

              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                {!isConnected && (
                  <button onClick={() => setConnecting(p.value)} style={{ flex: 1, background: '#4FACFE15', border: '1px solid #4FACFE40', color: '#4FACFE', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '8px', cursor: 'pointer' }}>เชื่อมต่อ</button>
                )}
                {isConnected && (
                  <button onClick={() => syncM.mutate(status!.id)} disabled={syncM.isPending} style={{ flex: 1, background: '#43E97B15', border: '1px solid #43E97B40', color: '#43E97B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '8px', cursor: 'pointer' }}>{syncM.isPending ? '⏳' : '🔄'} Sync</button>
                )}
              </div>

              {connecting === p.value && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #151C28' }}>
                  {p.configField && (
                    <input value={configValue} onChange={e => setConfigValue(e.target.value)} placeholder={p.configLabel}
                      style={{ width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: '#DDE3EE', marginBottom: 8, boxSizing: 'border-box' }} />
                  )}
                  <button onClick={() => connectM.mutate({ provider: p.value, config: p.configField ? { [p.configField]: configValue } : {} })}
                    style={{ width: '100%', background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 11, border: 'none', borderRadius: 8, padding: '9px', cursor: 'pointer' }}>
                    ยืนยันการเชื่อมต่อ
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

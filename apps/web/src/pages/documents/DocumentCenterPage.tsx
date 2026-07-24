import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Doc {
  id: string; filename: string; mime_type?: string; document_type: string
  classification_confidence?: number; status: string
  extracted_data?: Record<string, any>; ocr_confidence?: number
  reference_type?: string; created_at: string
}

const TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  invoice: { label: 'ใบแจ้งหนี้', icon: '📄', color: '#4FACFE' },
  receipt: { label: 'ใบเสร็จ', icon: '🧾', color: '#43E97B' },
  purchase_order: { label: 'ใบสั่งซื้อ', icon: '📋', color: '#F5A623' },
  contract: { label: 'สัญญา', icon: '📑', color: '#F093FB' },
  other: { label: 'อื่นๆ', icon: '📎', color: '#8A9BB0' },
  unknown: { label: 'ยังไม่จำแนก', icon: '❓', color: '#3A4A60' },
}
const STATUS_META: Record<string, { label: string; color: string }> = {
  uploaded: { label: 'อัปโหลดแล้ว', color: '#4FACFE' }, classified: { label: 'จำแนกแล้ว', color: '#F5A623' },
  extracted: { label: 'สกัดข้อมูลแล้ว', color: '#43E97B' }, matched: { label: 'เชื่อมโยงแล้ว', color: '#00D4AA' },
  reviewed: { label: 'ตรวจสอบแล้ว', color: '#43E97B' }, failed: { label: 'ล้มเหลว', color: '#FF6B6B' },
}

export default function DocumentCenterPage() {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState<Doc | null>(null)

  const { data: documents = [], isLoading } = useQuery<Doc[]>({
    queryKey: ['documents'],
    queryFn: async () => (await api.get('/api/v1/documents/')).data,
  })

  const uploadM = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post('/api/v1/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); setUploading(false) },
  })
  const classifyM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/documents/${id}/classify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })
  const extractM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/documents/${id}/extract`),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['documents'] }); if (selected) setSelected({ ...selected, extracted_data: res.data.extracted_fields }) },
  })

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    uploadM.mutate(file)
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Document Center</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>AI จำแนกและสกัดข้อมูลเอกสารอัตโนมัติ · {documents.length} เอกสาร</p>
        </div>
        <label style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + อัปโหลดเอกสาร
          <input type="file" accept="image/*,.pdf" onChange={handleFileSelect} style={{ display: 'none' }} disabled={uploading} />
        </label>
      </div>

      {uploading && (
        <div style={{ background: '#00D4AA08', border: '1px solid #00D4AA25', borderRadius: 10, padding: '12px 16px' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#00D4AA' }}>⏳ กำลังอัปโหลด...</p>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14 }}>
        {isLoading ? <p style={{ color: '#3A4A60' }}>กำลังโหลด...</p>
        : documents.length === 0 ? (
          <div style={{ gridColumn: '1/-1', padding: 56, textAlign: 'center', background: '#0D1018', border: '1px solid #151C28', borderRadius: 14 }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>📁</p>
            <p style={{ color: '#3A4A60', fontSize: 13 }}>ยังไม่มีเอกสาร — อัปโหลดเพื่อเริ่มต้น</p>
          </div>
        ) : documents.map(doc => {
          const tm = TYPE_META[doc.document_type] || TYPE_META.unknown
          const sm = STATUS_META[doc.status] || STATUS_META.uploaded
          return (
            <div key={doc.id} onClick={() => setSelected(doc)} style={{ background: '#0D1018', border: `1px solid ${tm.color}25`, borderRadius: 14, padding: '16px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 24 }}>{tm.icon}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: sm.color, background: sm.color + '18', padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
              </div>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.filename}</p>
              <p style={{ margin: 0, fontSize: 10, color: tm.color, fontWeight: 700 }}>{tm.label}</p>
              {doc.classification_confidence != null && (
                <p style={{ margin: '4px 0 0', fontSize: 10, color: '#4A5A70' }}>ความมั่นใจ {Math.round(doc.classification_confidence * 100)}%</p>
              )}
            </div>
          )
        })}
      </div>

      {/* DETAIL MODAL */}
      {selected && (
        <div style={overlay} onClick={() => setSelected(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{selected.filename}</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => classifyM.mutate(selected.id)} disabled={classifyM.isPending}
                  style={{ flex: 1, background: '#4FACFE15', border: '1px solid #4FACFE40', color: '#4FACFE', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '10px', cursor: 'pointer' }}>
                  {classifyM.isPending ? '⏳' : '🏷️'} จำแนกประเภท
                </button>
                <button onClick={() => extractM.mutate(selected.id)} disabled={extractM.isPending}
                  style={{ flex: 1, background: '#43E97B15', border: '1px solid #43E97B40', color: '#43E97B', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '10px', cursor: 'pointer' }}>
                  {extractM.isPending ? '⏳' : '🔍'} สกัดข้อมูล
                </button>
              </div>

              {selected.extracted_data && Object.keys(selected.extracted_data).length > 0 && (
                <div style={{ background: '#070A0F', borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#43E97B' }}>ข้อมูลที่สกัดได้</p>
                  {Object.entries(selected.extracted_data).map(([k, v]) => (
                    Array.isArray(v) ? (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <p style={{ margin: '0 0 4px', fontSize: 10, color: '#4A5A70', textTransform: 'capitalize' }}>{k}</p>
                        {v.map((item: any, i: number) => (
                          <p key={i} style={{ margin: '2px 0', fontSize: 11, color: '#8A9BB0' }}>• {typeof item === 'object' ? JSON.stringify(item) : item}</p>
                        ))}
                      </div>
                    ) : (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
                        <span style={{ color: '#4A5A70', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                        <span style={{ color: '#DDE3EE', fontWeight: 600 }}>{String(v)}</span>
                      </div>
                    )
                  ))}
                </div>
              )}

              <div style={{ background: '#00D4AA08', border: '1px solid #00D4AA20', borderRadius: 10, padding: '12px 16px' }}>
                <p style={{ margin: 0, fontSize: 10, color: '#00D4AA' }}>สถานะ: {STATUS_META[selected.status]?.label || selected.status}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

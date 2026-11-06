import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface DocTemplate {
  id: string; name: string; document_kind: string; is_default: boolean; layout_style: string
  logo_path?: string; primary_color: string; accent_color: string; font_family: string
  company_display_name?: string; company_address?: string; company_tax_id?: string; footer_text?: string
  show_item_discount: boolean; show_vat_breakdown: boolean; show_due_date: boolean; show_signature_block: boolean
}
interface Invoice { id: string; number: string; customer?: { name: string } }

// Page layouts supported by the PDF renderer (services/doctemplate.py).
const LAYOUTS: { value: string; label: string }[] = [
  { value: 'classic', label: 'คลาสสิก — หัวซ้าย ตารางสีทึบ' },
  { value: 'modern',  label: 'โมเดิร์น — แถบหัวสี กล่องยอดรวม' },
  { value: 'minimal', label: 'มินิมอล — เส้นบางๆ โปร่งสะอาด' },
  { value: 'bold',    label: 'เข้ม — แถบหัวใหญ่ แถวสลับสี' },
]
// Thai-capable fonts registered by the PDF renderer (services/doctemplate.py).
const FONTS: { value: string; label: string }[] = [
  { value: 'Tahoma',       label: 'Tahoma (เรียบ อ่านง่าย)' },
  { value: 'TahomaBold',   label: 'Tahoma Bold (หนา)' },
  { value: 'LeelawadeeUI', label: 'Leelawadee UI (โมเดิร์น)' },
  { value: 'Leelawadee',   label: 'Leelawadee (โค้งมน)' },
  { value: 'Angsana',      label: 'Angsana (ทางการ/ราชการ)' },
  { value: 'Cordia',       label: 'Cordia (คลาสสิก)' },
]
const inp: React.CSSProperties = { width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }

export default function DocTemplateEditorPage() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [previewInvoiceId, setPreviewInvoiceId] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState('invoice')
  const [newLayout, setNewLayout] = useState('classic')

  const { data: templates = [] } = useQuery<DocTemplate[]>({
    queryKey: ['doc-templates'], queryFn: async () => (await api.get('/api/v1/doc-templates/')).data,
  })
  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['invoices-for-preview'], queryFn: async () => (await api.get('/api/v1/ar/invoices')).data,
  })
  const selected = templates.find(t => t.id === selectedId) || null

  const createM = useMutation({
    mutationFn: () => api.post('/api/v1/doc-templates/', { name: newName, document_kind: newKind, layout_style: newLayout }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['doc-templates'] }); setSelectedId(res.data.id); setShowCreate(false); setNewName('') },
  })
  const updateM = useMutation({
    mutationFn: (patch: Partial<DocTemplate>) => api.patch(`/api/v1/doc-templates/${selectedId}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-templates'] }),
  })
  const setDefaultM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/doc-templates/${id}/set-default`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-templates'] }),
  })
  const uploadLogoM = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData(); fd.append('file', file)
      return api.post(`/api/v1/doc-templates/${selectedId}/logo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-templates'] }),
  })

  function field<K extends keyof DocTemplate>(key: K, value: DocTemplate[K]) {
    updateM.mutate({ [key]: value } as any)
  }

  async function handlePreview() {
    if (!selectedId || !previewInvoiceId) return
    const res = await api.get(`/api/v1/doc-templates/preview/invoice/${previewInvoiceId}?template_id=${selectedId}`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    setPreviewUrl(url)
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 400 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Document Template Editor</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>ปรับแต่งฟอร์มใบกำกับภาษี/ใบเสนอราคา</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + สร้างเทมเพลต
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 340px', gap: 16 }}>
        {/* Template list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map(t => (
            <button key={t.id} onClick={() => setSelectedId(t.id)}
              style={{ textAlign: 'left', background: selectedId === t.id ? '#F2714E12' : 'var(--color-card)', border: `1px solid ${selectedId === t.id ? '#F2714E40' : 'var(--color-border)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700 }}>{t.name}</p>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: t.primary_color, display: 'inline-block' }} />
                <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>{t.layout_style}</span>
                {t.is_default && <span style={{ fontSize: 8, color: '#43E97B', fontWeight: 700 }}>DEFAULT</span>}
              </div>
            </button>
          ))}
          {templates.length === 0 && <p style={{ color: 'var(--color-dim)', fontSize: 12 }}>ยังไม่มีเทมเพลต</p>}
        </div>

        {/* Editor panel */}
        {!selected ? (
          <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, padding: 60, textAlign: 'center' }}>
            <p style={{ color: 'var(--color-dim)', fontSize: 13 }}>เลือกเทมเพลตเพื่อแก้ไข</p>
          </div>
        ) : (
          <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{selected.name}</p>
              {!selected.is_default && (
                <button onClick={() => setDefaultM.mutate(selected.id)} style={{ fontSize: 10, background: '#FFB59E15', border: '1px solid #FFB59E40', color: 'var(--color-accent-light)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>ตั้งเป็นค่าเริ่มต้น</button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>สีหลัก</label>
                <input type="color" value={selected.primary_color} onChange={e => field('primary_color', e.target.value)} style={{ width: '100%', height: 36, border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} />
              </div>
              <div>
                <label style={lbl}>สีรอง</label>
                <input type="color" value={selected.accent_color} onChange={e => field('accent_color', e.target.value)} style={{ width: '100%', height: 36, border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} />
              </div>
            </div>

            <div>
              <label style={lbl}>รูปแบบเลย์เอาต์</label>
              <select value={selected.layout_style} onChange={e => field('layout_style', e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                {LAYOUTS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>

            <div>
              <label style={lbl}>ฟอนต์</label>
              <select value={selected.font_family} onChange={e => field('font_family', e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            <div>
              <label style={lbl}>โลโก้บริษัท</label>
              <label style={{ display: 'block', background: 'var(--color-bg-inset)', border: '1px dashed var(--color-border-strong)', borderRadius: 8, padding: '12px', textAlign: 'center', fontSize: 11, color: 'var(--color-text-tertiary)', cursor: 'pointer' }}>
                {uploadLogoM.isPending ? 'กำลังอัปโหลด...' : selected.logo_path ? '✓ มีโลโก้แล้ว — คลิกเพื่อเปลี่ยน' : 'คลิกเพื่ออัปโหลดโลโก้ (.png/.jpg)'}
                <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogoM.mutate(f) }} />
              </label>
            </div>

            <div><label style={lbl}>ชื่อบริษัท (แสดงบนเอกสาร)</label><input defaultValue={selected.company_display_name || ''} onBlur={e => field('company_display_name', e.target.value)} style={inp} /></div>
            <div><label style={lbl}>ที่อยู่บริษัท</label><textarea defaultValue={selected.company_address || ''} onBlur={e => field('company_address', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} /></div>
            <div><label style={lbl}>เลขผู้เสียภาษี</label><input defaultValue={selected.company_tax_id || ''} onBlur={e => field('company_tax_id', e.target.value)} style={inp} /></div>
            <div><label style={lbl}>ข้อความท้ายเอกสาร</label><textarea defaultValue={selected.footer_text || ''} onBlur={e => field('footer_text', e.target.value)} rows={2} placeholder="เช่น เลขบัญชีธนาคาร, เงื่อนไขการชำระเงิน" style={{ ...inp, resize: 'vertical' }} /></div>

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
              <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>แสดงส่วนต่างๆ</p>
              {[
                ['show_item_discount', 'คอลัมน์ส่วนลด'], ['show_vat_breakdown', 'รายละเอียด VAT'],
                ['show_due_date', 'วันครบกำหนดชำระ'], ['show_signature_block', 'ช่องเซ็นชื่อ'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={(selected as any)[key]} onChange={e => field(key as keyof DocTemplate, e.target.checked as any)} style={{ cursor: 'pointer' }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Preview panel */}
        <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>ดูตัวอย่าง</p>
          <select value={previewInvoiceId} onChange={e => setPreviewInvoiceId(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
            <option value="">-- เลือก Invoice --</option>
            {invoices.map(inv => <option key={inv.id} value={inv.id}>{inv.number} — {inv.customer?.name}</option>)}
          </select>
          <button onClick={handlePreview} disabled={!selected || !previewInvoiceId}
            style={{ background: '#FFB59E15', border: '1px solid #FFB59E40', color: 'var(--color-accent-light)', fontWeight: 700, fontSize: 12, borderRadius: 8, padding: '9px', cursor: 'pointer', opacity: !selected || !previewInvoiceId ? 0.5 : 1 }}>
            🔍 สร้าง Preview PDF
          </button>
          {previewUrl && (
            <iframe src={previewUrl} style={{ width: '100%', height: 400, border: '1px solid var(--color-border)', borderRadius: 8, background: '#fff' }} title="Invoice Preview" />
          )}
        </div>
      </div>

      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>สร้างเทมเพลตใหม่</h3></div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={lbl}>ชื่อเทมเพลต</label><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="เช่น แบบมาตรฐาน" style={inp} /></div>
              <div>
                <label style={lbl}>ประเภทเอกสาร</label>
                <select value={newKind} onChange={e => setNewKind(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="invoice">ใบแจ้งหนี้</option><option value="quotation">ใบเสนอราคา</option><option value="receipt">ใบเสร็จ</option>
                </select>
              </div>
              <div>
                <label style={lbl}>รูปแบบเลย์เอาต์</label>
                <select value={newLayout} onChange={e => setNewLayout(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  {LAYOUTS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <button onClick={() => createM.mutate()} disabled={!newName || createM.isPending}
                style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer' }}>
                สร้าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

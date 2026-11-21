import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import PanelBack from '@/components/doc/PanelBack'

// กลุ่มประเภทลูกค้า — groups (wholesale, retail, VIP…) a contact can be filed under.
export interface ContactGroup {
  id: string; code: string; name: string; description?: string; is_active: boolean; contact_count: number
}

interface Form { code: string; name: string; description: string; is_active: boolean }

const inp: React.CSSProperties = { width:'100%', background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'9px 12px', fontSize:12, color:'var(--color-text)', outline:'none', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }
const errText = (e: unknown) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof d === 'string' ? d : 'บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูล'
}

export default function ContactGroupsPage() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<ContactGroup | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [tried, setTried] = useState(false)

  const { data: groups = [], isLoading } = useQuery<ContactGroup[]>({
    queryKey: ['contact-groups'],
    queryFn: async () => (await api.get('/api/v1/contact-groups/')).data,
  })

  const refresh = () => { for (const k of ['contact-groups', 'contacts']) qc.invalidateQueries({ queryKey: [k] }) }
  const saveM = useMutation({
    mutationFn: (f: Form) => {
      const body = { code: f.code.trim() || undefined, name: f.name.trim(), description: f.description.trim() || undefined }
      return editing
        ? api.patch(`/api/v1/contact-groups/${editing.id}`, { ...body, is_active: f.is_active })
        : api.post('/api/v1/contact-groups/', body)
    },
    onSuccess: () => { refresh(); close() },
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/contact-groups/${id}`),
    onSuccess: () => { refresh(); close() },
  })

  const open = (g?: ContactGroup) => {
    setEditing(g ?? null); setTried(false); saveM.reset(); deleteM.reset()
    setForm({ code: g?.code ?? '', name: g?.name ?? '', description: g?.description ?? '', is_active: g?.is_active ?? true })
  }
  const close = () => { setEditing(null); setForm(null) }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => f && { ...f, [k]: v })
  const formError = form && !form.name.trim() ? 'ระบุชื่อกลุ่ม' : null
  const mutError = saveM.error ?? deleteM.error

  const th: React.CSSProperties = { padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)', whiteSpace:'nowrap' }
  const td: React.CSSProperties = { padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>กลุ่มประเภทลูกค้า</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>จัดผู้ติดต่อเป็นกลุ่ม เช่น ขายส่ง ขายปลีก VIP เพื่อค้นหาและกรองรายชื่อ</p>
        </div>
        <button onClick={()=>open()} style={{ background:'linear-gradient(135deg,var(--color-accent),var(--color-accent-strong))', color:'#fff', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>+ เพิ่มกลุ่ม</button>
      </div>

      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : groups.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีกลุ่ม — กด “+ เพิ่มกลุ่ม” เพื่อเริ่ม</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:560 }}>
            <thead><tr>{['รหัส','ชื่อกลุ่ม','คำอธิบาย','ผู้ติดต่อ','สถานะ',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id} onClick={()=>open(g)} style={{ cursor:'pointer', opacity: g.is_active ? 1 : 0.55 }}>
                  <td style={{ ...td, fontFamily:'monospace', fontSize:11, color:'var(--color-accent-light)' }}>{g.code}</td>
                  <td style={{ ...td, fontWeight:600 }}>{g.name}</td>
                  <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)' }}>{g.description || '—'}</td>
                  <td style={td}>
                    <Link to={`/contacts?group=${g.id}`} onClick={e=>e.stopPropagation()} style={{ color:'var(--color-accent-light)', fontWeight:700, textDecoration:'none' }}>{g.contact_count} ราย</Link>
                  </td>
                  <td style={td}>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, color: g.is_active ? '#30D158' : 'var(--color-dim)', background: g.is_active ? '#30D15818' : 'var(--color-bg-inset)' }}>{g.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>
                  </td>
                  <td style={td}><span aria-hidden style={{ color:'var(--color-dim)' }}>✎</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="doc-panel">
          <PanelBack onClick={close} label="กลับไปที่กลุ่มประเภทลูกค้า" />
          <div className="doc-panel-card" aria-label={editing ? 'แก้ไขกลุ่ม' : 'เพิ่มกลุ่ม'}>
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>{editing ? `แก้ไขกลุ่ม ${editing.code}` : 'เพิ่มกลุ่มประเภทลูกค้า'}</h3>
              <button onClick={close} aria-label="ปิด" style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); setTried(true); if (!formError) saveM.mutate(form) }} style={{ padding:24, display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'120px 1fr', gap:12 }}>
                <div><label style={lbl}>รหัส</label><input value={form.code} onChange={e=>set('code', e.target.value.toUpperCase().slice(0,20))} style={{ ...inp, fontFamily:'monospace' }} placeholder="อัตโนมัติ" /></div>
                <div><label style={lbl}>ชื่อกลุ่ม *</label><input value={form.name} onChange={e=>set('name', e.target.value)} style={inp} placeholder="เช่น ขายส่ง" autoFocus /></div>
              </div>
              <div><label style={lbl}>คำอธิบาย</label><textarea value={form.description} onChange={e=>set('description', e.target.value)} rows={2} style={{ ...inp, resize:'vertical' }} /></div>
              {editing && (
                <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, cursor:'pointer' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e=>set('is_active', e.target.checked)} style={{ width:15, height:15 }} />
                  ใช้งาน <span style={{ color:'var(--color-text-tertiary)', fontSize:11 }}>(ปิดแล้วจะไม่แสดงให้เลือกในฟอร์มผู้ติดต่อ)</span>
                </label>
              )}

              {((tried && formError) || mutError) && <div role="alert" style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>{(tried && formError) || errText(mutError)}</p></div>}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end', alignItems:'center' }}>
                {editing && (
                  <button type="button" disabled={deleteM.isPending || editing.contact_count > 0}
                    title={editing.contact_count > 0 ? 'ยังมีผู้ติดต่อในกลุ่มนี้ — ย้ายออกก่อน หรือปิดใช้งานแทน' : undefined}
                    onClick={()=>{ if (window.confirm(`ลบกลุ่ม ${editing.name}?`)) deleteM.mutate(editing.id) }}
                    style={{ marginRight:'auto', padding:'9px 16px', borderRadius:9, border:'1px solid #FF6B6B50', background:'transparent', color:'#FF6B6B', cursor: editing.contact_count > 0 ? 'not-allowed' : 'pointer', fontWeight:600, fontSize:12, opacity: editing.contact_count > 0 ? 0.45 : 1 }}>ลบกลุ่ม</button>
                )}
                <button type="button" onClick={close} style={{ padding:'9px 20px', borderRadius:9, border:'1px solid var(--color-border-strong)', background:'transparent', color:'var(--color-text-tertiary)', cursor:'pointer', fontWeight:600, fontSize:13 }}>ยกเลิก</button>
                <button type="submit" disabled={saveM.isPending} style={{ background:'linear-gradient(135deg,var(--color-accent),var(--color-accent-strong))', color:'#fff', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 24px', cursor:'pointer', opacity: saveM.isPending ? 0.6 : 1 }}>{saveM.isPending ? 'กำลังบันทึก...' : '✓ บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

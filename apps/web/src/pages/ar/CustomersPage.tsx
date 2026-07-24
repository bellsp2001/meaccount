import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'

interface Customer {
  id: string; code: string; name: string; name_en?: string; tax_id?: string
  address?: string; phone?: string; email?: string; contact_name?: string
  credit_days: number; credit_limit: number; is_active: boolean
}

const schema = z.object({
  code:         z.string().min(1, 'ระบุรหัสลูกค้า'),
  name:         z.string().min(2, 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'),
  name_en:      z.string().optional(),
  tax_id:       z.string().optional(),
  branch_code:  z.string().optional(),
  address:      z.string().optional(),
  phone:        z.string().optional(),
  email:        z.string().email('อีเมลไม่ถูกต้อง').optional().or(z.literal('')),
  contact_name: z.string().optional(),
  credit_days:  z.number().min(0).max(365),
  credit_limit: z.number().min(0),
})
type CForm = z.infer<typeof schema>

const inp: React.CSSProperties = { width:'100%', background:'#070A0F', border:'1px solid #151C28', borderRadius:8, padding:'9px 12px', fontSize:12, color:'#DDE3EE', outline:'none', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'#6A7A90', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }

export default function CustomersPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<Customer|null>(null)
  const [search, setSearch] = useState('')

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/api/v1/ar/customers')).data,
  })

  const createM = useMutation({
    mutationFn: (d: CForm) => api.post('/api/v1/ar/customers', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setShowCreate(false); reset() },
  })

  const { register, handleSubmit, reset, formState:{ errors } } = useForm<CForm>({
    resolver: zodResolver(schema),
    defaultValues: { credit_days: 30, credit_limit: 0, branch_code: '00000' },
  })

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase()) ||
    (c.tax_id || '').includes(search)
  )

  const overlay: React.CSSProperties = { position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, padding:16 }
  const modal: React.CSSProperties  = { background:'#0D1018', border:'1px solid #1E2A3A', borderRadius:16, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>รายชื่อลูกค้า</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'#4A5A70' }}>ทั้งหมด {customers.length} ราย</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background:'linear-gradient(135deg,#00D4AA,#4FACFE)', color:'#07090E', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>
          + เพิ่มลูกค้าใหม่
        </button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12 }}>
        {[
          { label:'ลูกค้าทั้งหมด', value: customers.length, color:'#4FACFE' },
          { label:'Active', value: customers.filter(c=>c.is_active).length, color:'#43E97B' },
          { label:'เครดิตเฉลี่ย', value: customers.length ? Math.round(customers.reduce((s,c)=>s+c.credit_days,0)/customers.length) + ' วัน' : '-', color:'#F5A623' },
        ].map(s => (
          <div key={s.label} style={{ background:'#0D1018', border:`1px solid ${s.color}20`, borderTop:`2px solid ${s.color}`, borderRadius:12, padding:'14px 16px' }}>
            <p style={{ margin:'0 0 4px', fontSize:10, color:'#4A5A70' }}>{s.label}</p>
            <p style={{ margin:0, fontSize:22, fontWeight:800, color:s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍  ค้นหาชื่อ, รหัส, เลขผู้เสียภาษี..."
        style={{ background:'#0D1018', border:'1px solid #151C28', borderRadius:9, padding:'9px 14px', fontSize:13, color:'#DDE3EE', outline:'none', width:'100%', boxSizing:'border-box' }} />

      {/* Selected customer detail */}
      {selected && (
        <div style={{ background:'#4FACFE10', border:'1px solid #4FACFE30', borderRadius:12, padding:'16px 20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
            <div>
              <p style={{ margin:'0 0 4px', fontSize:15, fontWeight:800 }}>{selected.name}</p>
              <p style={{ margin:0, fontSize:12, color:'#5A6A80' }}>รหัส: {selected.code} {selected.tax_id ? `· เลขภาษี: ${selected.tax_id}` : ''}</p>
            </div>
            <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
              {[
                { l:'เครดิต', v:`${selected.credit_days} วัน` },
                { l:'วงเงิน', v: selected.credit_limit > 0 ? `฿${Number(selected.credit_limit).toLocaleString('th-TH')}` : 'ไม่จำกัด' },
                { l:'สถานะ', v: selected.is_active ? 'Active' : 'Inactive', color: selected.is_active ? '#43E97B' : '#FF6B6B' },
              ].map(item => (
                <div key={item.l} style={{ textAlign:'center' }}>
                  <p style={{ margin:'0 0 2px', fontSize:10, color:'#4A5A70' }}>{item.l}</p>
                  <p style={{ margin:0, fontSize:13, fontWeight:700, color: item.color || '#DDE3EE' }}>{item.v}</p>
                </div>
              ))}
            </div>
            <button onClick={()=>setSelected(null)} style={{ background:'none', border:'none', color:'#4A5A70', cursor:'pointer', fontSize:16 }}>✕</button>
          </div>
          {selected.address && <p style={{ margin:'12px 0 0', fontSize:12, color:'#5A6A80' }}>📍 {selected.address}</p>}
        </div>
      )}

      {/* Table */}
      <div style={{ background:'#0D1018', border:'1px solid #151C28', borderRadius:14, overflow:'hidden' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'#3A4A60' }}>กำลังโหลด...</div>
        : filtered.length === 0 ? <div style={{ padding:52, textAlign:'center', color:'#3A4A60' }}>ไม่พบลูกค้า</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['รหัส','ชื่อลูกค้า','เลขผู้เสียภาษี','ติดต่อ','เครดิต','สถานะ'].map(h=>(
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:9, fontWeight:700, color:'#3A4A60', textTransform:'uppercase', letterSpacing:'0.1em', borderBottom:'1px solid #151C28' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} onClick={()=>setSelected(c)} style={{ cursor:'pointer' }}>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid #0F1520', fontFamily:'monospace', fontSize:12, color:'#4FACFE' }}>{c.code}</td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid #0F1520' }}>
                    <p style={{ margin:0, fontSize:13, fontWeight:600 }}>{c.name}</p>
                    {c.name_en && <p style={{ margin:0, fontSize:11, color:'#4A5A70' }}>{c.name_en}</p>}
                  </td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid #0F1520', fontSize:12, color:'#6A7A90', fontFamily:'monospace' }}>{c.tax_id || '—'}</td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid #0F1520', fontSize:11, color:'#6A7A90' }}>
                    {c.contact_name && <p style={{ margin:0 }}>{c.contact_name}</p>}
                    {c.phone && <p style={{ margin:0 }}>{c.phone}</p>}
                  </td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid #0F1520', fontSize:12, color:'#F5A623' }}>{c.credit_days} วัน</td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid #0F1520' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:c.is_active?'#43E97B':'#FF6B6B', display:'inline-block' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={overlay} onClick={()=>setShowCreate(false)}>
          <div style={modal} onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 24px', borderBottom:'1px solid #151C28' }}>
              <h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>เพิ่มลูกค้าใหม่</h3>
              <button onClick={()=>setShowCreate(false)} style={{ background:'none', border:'none', color:'#4A5A70', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d=>createM.mutate(d))} style={{ padding:24, display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:12 }}>
                <div><label style={lbl}>รหัสลูกค้า *</label><input {...register('code')} placeholder="C001" style={inp}/>{errors.code&&<p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.code.message}</p>}</div>
                <div><label style={lbl}>ชื่อ (ไทย) *</label><input {...register('name')} placeholder="บริษัท ตัวอย่าง จำกัด" style={inp}/>{errors.name&&<p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.name.message}</p>}</div>
              </div>
              <div><label style={lbl}>ชื่อ (อังกฤษ)</label><input {...register('name_en')} placeholder="Example Co., Ltd." style={inp}/></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div><label style={lbl}>เลขประจำตัวผู้เสียภาษี</label><input {...register('tax_id')} placeholder="0105555000001" style={inp}/></div>
                <div><label style={lbl}>รหัสสาขา</label><input {...register('branch_code')} placeholder="00000" style={inp}/></div>
              </div>
              <div><label style={lbl}>ที่อยู่</label><textarea {...register('address')} rows={2} style={{ ...inp, resize:'vertical' }} placeholder="เลขที่ ถนน แขวง เขต จังหวัด รหัสไปรษณีย์" /></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div><label style={lbl}>โทรศัพท์</label><input {...register('phone')} placeholder="02-XXX-XXXX" style={inp}/></div>
                <div><label style={lbl}>อีเมล</label><input {...register('email')} type="email" placeholder="billing@example.com" style={inp}/>{errors.email&&<p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.email.message}</p>}</div>
              </div>
              <div><label style={lbl}>ชื่อผู้ติดต่อ</label><input {...register('contact_name')} placeholder="คุณสมชาย" style={inp}/></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div><label style={lbl}>เครดิต (วัน)</label><input {...register('credit_days', {valueAsNumber:true})} type="number" min="0" placeholder="30" style={inp}/></div>
                <div><label style={lbl}>วงเงินเครดิต (บาท)</label><input {...register('credit_limit', {valueAsNumber:true})} type="number" min="0" placeholder="0 = ไม่จำกัด" style={inp}/></div>
              </div>
              {createM.isError && <div style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>เกิดข้อผิดพลาด — รหัสลูกค้าอาจซ้ำ</p></div>}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end', paddingTop:4 }}>
                <button type="button" onClick={()=>setShowCreate(false)} style={{ padding:'9px 20px', borderRadius:9, border:'1px solid #1E2A3A', background:'transparent', color:'#6A7A90', cursor:'pointer', fontWeight:600, fontSize:13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ background:'linear-gradient(135deg,#00D4AA,#4FACFE)', color:'#07090E', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'9px 20px', cursor:'pointer', opacity:createM.isPending?0.7:1 }}>{createM.isPending?'กำลังบันทึก...':'บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import type { User, UserRole } from '@/types'

const ROLES = [
  { value: 'admin' as UserRole,      label: 'Admin',      color: '#00D4AA' },
  { value: 'accountant' as UserRole, label: 'Accountant', color: '#4FACFE' },
  { value: 'cashier' as UserRole,    label: 'Cashier',    color: '#F093FB' },
  { value: 'inventory' as UserRole,  label: 'Inventory',  color: '#43E97B' },
  { value: 'manager' as UserRole,    label: 'Manager',    color: '#F5A623' },
  { value: 'auditor' as UserRole,    label: 'Auditor',    color: '#667EEA' },
]

const createSchema = z.object({
  email:     z.string().email('อีเมลไม่ถูกต้อง'),
  full_name: z.string().min(2, 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'),
  password:  z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
  role:      z.enum(['admin','accountant','cashier','inventory','manager','auditor']),
})
type CForm = z.infer<typeof createSchema>

function RoleBadge({ role }: { role: UserRole }) {
  const r = ROLES.find(o => o.value === role)!
  return <span style={{ fontSize: 10, fontWeight: 700, color: r.color, background: r.color+'18', border:`1px solid ${r.color}35`, padding:'2px 9px', borderRadius:20 }}>{r.label}</span>
}

const inp: React.CSSProperties = { width:'100%', background:'#070A0F', border:'1px solid #151C28', borderRadius:8, padding:'10px 13px', fontSize:13, color:'#DDE3EE', outline:'none', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:11, fontWeight:700, color:'#6A7A90', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }
const overlay: React.CSSProperties = { position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, padding:16 }
const modal: React.CSSProperties  = { background:'#0D1018', border:'1px solid #1E2A3A', borderRadius:16, width:'100%', maxWidth:480, boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }
const btnPrimary: React.CSSProperties = { background:'linear-gradient(135deg,#00D4AA,#4FACFE)', color:'#07090E', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }

export default function UsersPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<UserRole|'all'>('all')
  const [deleteTarget, setDeleteTarget] = useState<User|null>(null)

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/v1/users/')).data,
  })
  const createM  = useMutation({ mutationFn: (d: CForm) => api.post('/api/v1/users/', d), onSuccess: () => { qc.invalidateQueries({ queryKey:['users'] }); setShowCreate(false); reset() } })
  const toggleM  = useMutation({ mutationFn: ({ id, is_active }:{ id:string; is_active:boolean }) => api.patch(`/api/v1/users/${id}`, { is_active }), onSuccess: () => qc.invalidateQueries({ queryKey:['users'] }) })
  const deleteM  = useMutation({ mutationFn: (id:string) => api.delete(`/api/v1/users/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey:['users'] }); setDeleteTarget(null) } })

  const { register, handleSubmit, reset, formState:{ errors } } = useForm<CForm>({ resolver:zodResolver(createSchema), defaultValues:{ role:'accountant' } })

  const filtered = users.filter(u =>
    (u.full_name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())) &&
    (filterRole === 'all' || u.role === filterRole)
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>จัดการผู้ใช้งาน</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'#4A5A70' }}>ทั้งหมด {users.length} คน · แสดง {filtered.length} คน</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={btnPrimary}>+ เพิ่มผู้ใช้ใหม่</button>
      </div>

      {/* Role stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:10 }}>
        {ROLES.map(r => (
          <div key={r.value} onClick={() => setFilterRole(filterRole===r.value?'all':r.value)} style={{ background: filterRole===r.value ? r.color+'12':'#0D1018', border:`1px solid ${filterRole===r.value?r.color+'50':'#151C28'}`, borderRadius:12, padding:'12px 14px', cursor:'pointer', transition:'all 0.15s' }}>
            <p style={{ margin:'0 0 3px', fontSize:20, fontWeight:800, color:r.color }}>{users.filter(u=>u.role===r.value).length}</p>
            <p style={{ margin:0, fontSize:11, color:'#5A6A80' }}>{r.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍  ค้นหาชื่อหรืออีเมล..."
          style={{ flex:1, minWidth:200, background:'#0D1018', border:'1px solid #151C28', borderRadius:9, padding:'9px 14px', fontSize:13, color:'#DDE3EE', outline:'none' }} />
        <select value={filterRole} onChange={e=>setFilterRole(e.target.value as UserRole|'all')}
          style={{ background:'#0D1018', border:'1px solid #151C28', borderRadius:9, padding:'9px 12px', fontSize:13, color:'#DDE3EE', outline:'none', cursor:'pointer' }}>
          <option value="all">ทุก Role</option>
          {ROLES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ background:'#0D1018', border:'1px solid #151C28', borderRadius:14, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              {['ผู้ใช้งาน','Role','สถานะ','วันที่สมัคร','จัดการ'].map(h=>(
                <th key={h} style={{ padding:'11px 16px', textAlign:'left', fontSize:10, fontWeight:700, color:'#3A4A60', textTransform:'uppercase', letterSpacing:'0.1em', borderBottom:'1px solid #151C28' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} style={{ padding:40, textAlign:'center', color:'#3A4A60' }}>กำลังโหลด...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding:40, textAlign:'center', color:'#3A4A60', fontSize:13 }}>ไม่พบผู้ใช้งาน</td></tr>
            ) : filtered.map(user=>(
              <tr key={user.id}>
                <td style={{ padding:'13px 16px', borderBottom:'1px solid #0F1520' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:34,height:34,borderRadius:'50%',background:'linear-gradient(135deg,#00D4AA,#4FACFE)',display:'flex',alignItems:'center',justifyContent:'center',color:'#07090E',fontWeight:700,fontSize:13,flexShrink:0 }}>
                      {user.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p style={{ margin:0,fontSize:13,fontWeight:600,color:'#DDE3EE' }}>{user.full_name}</p>
                      <p style={{ margin:0,fontSize:11,color:'#4A5A70' }}>{user.email}</p>
                    </div>
                  </div>
                </td>
                <td style={{ padding:'13px 16px', borderBottom:'1px solid #0F1520' }}><RoleBadge role={user.role as UserRole} /></td>
                <td style={{ padding:'13px 16px', borderBottom:'1px solid #0F1520' }}>
                  <span style={{ display:'inline-flex',alignItems:'center',gap:5,fontSize:11 }}>
                    <span style={{ width:6,height:6,borderRadius:'50%',background:user.is_active?'#43E97B':'#FF6B6B',display:'inline-block' }} />
                    <span style={{ color:user.is_active?'#43E97B':'#FF6B6B' }}>{user.is_active?'Active':'Inactive'}</span>
                  </span>
                </td>
                <td style={{ padding:'13px 16px', borderBottom:'1px solid #0F1520', color:'#4A5A70', fontSize:12 }}>
                  {new Date(user.created_at).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'})}
                </td>
                <td style={{ padding:'13px 16px', borderBottom:'1px solid #0F1520' }}>
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={()=>toggleM.mutate({id:user.id,is_active:!user.is_active})}
                      style={{ fontSize:11,padding:'5px 10px',borderRadius:7,border:`1px solid ${user.is_active?'#FF6B6B40':'#43E97B40'}`,background:user.is_active?'#FF6B6B12':'#43E97B12',color:user.is_active?'#FF6B6B':'#43E97B',cursor:'pointer',fontWeight:600 }}>
                      {user.is_active?'ปิดใช้':'เปิดใช้'}
                    </button>
                    <button onClick={()=>setDeleteTarget(user)}
                      style={{ fontSize:11,padding:'5px 10px',borderRadius:7,border:'1px solid #FF6B6B30',background:'#FF6B6B08',color:'#FF6B6B',cursor:'pointer' }}>
                      ลบ
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={overlay} onClick={()=>setShowCreate(false)}>
          <div style={modal} onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'18px 24px',borderBottom:'1px solid #151C28' }}>
              <h3 style={{ margin:0,fontSize:16,fontWeight:800 }}>เพิ่มผู้ใช้ใหม่</h3>
              <button onClick={()=>setShowCreate(false)} style={{ background:'none',border:'none',color:'#4A5A70',cursor:'pointer',fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d=>createM.mutate(d))} style={{ padding:24,display:'flex',flexDirection:'column',gap:16 }}>
              <div><label style={lbl}>ชื่อ-นามสกุล</label><input {...register('full_name')} placeholder="สมชาย ใจดี" style={inp}/>{errors.full_name&&<p style={{ margin:'4px 0 0',fontSize:11,color:'#FF6B6B' }}>{errors.full_name.message}</p>}</div>
              <div><label style={lbl}>อีเมล</label><input {...register('email')} type="email" placeholder="user@company.com" style={inp}/>{errors.email&&<p style={{ margin:'4px 0 0',fontSize:11,color:'#FF6B6B' }}>{errors.email.message}</p>}</div>
              <div><label style={lbl}>รหัสผ่าน</label><input {...register('password')} type="password" placeholder="อย่างน้อย 8 ตัวอักษร" style={inp}/>{errors.password&&<p style={{ margin:'4px 0 0',fontSize:11,color:'#FF6B6B' }}>{errors.password.message}</p>}</div>
              <div>
                <label style={lbl}>Role / สิทธิ์</label>
                <select {...register('role')} style={{ ...inp,cursor:'pointer' }}>{ROLES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select>
              </div>
              {createM.isError&&<div style={{ background:'#FF6B6B12',border:'1px solid #FF6B6B35',borderRadius:8,padding:'10px 14px' }}><p style={{ margin:0,fontSize:12,color:'#FF6B6B' }}>เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง</p></div>}
              <div style={{ display:'flex',gap:10,justifyContent:'flex-end',paddingTop:4 }}>
                <button type="button" onClick={()=>setShowCreate(false)} style={{ padding:'10px 20px',borderRadius:9,border:'1px solid #1E2A3A',background:'transparent',color:'#6A7A90',cursor:'pointer',fontWeight:600,fontSize:13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ ...btnPrimary,opacity:createM.isPending?0.7:1 }}>{createM.isPending?'กำลังสร้าง...':'สร้างผู้ใช้'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE MODAL */}
      {deleteTarget && (
        <div style={overlay} onClick={()=>setDeleteTarget(null)}>
          <div style={{ ...modal,maxWidth:380 }} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:'32px 28px',textAlign:'center' }}>
              <div style={{ fontSize:44,marginBottom:14 }}>⚠️</div>
              <h3 style={{ margin:'0 0 8px',fontSize:16,fontWeight:800 }}>ยืนยันการลบผู้ใช้</h3>
              <p style={{ margin:'0 0 4px',fontSize:13,color:'#6A7A90' }}>คุณต้องการลบ</p>
              <p style={{ margin:'0 0 20px',fontSize:15,fontWeight:700 }}>{deleteTarget.full_name}</p>
              <p style={{ margin:'0 0 24px',fontSize:12,color:'#4A5A70' }}>การกระทำนี้ไม่สามารถย้อนกลับได้</p>
              <div style={{ display:'flex',gap:10,justifyContent:'center' }}>
                <button onClick={()=>setDeleteTarget(null)} style={{ padding:'10px 24px',borderRadius:9,border:'1px solid #1E2A3A',background:'transparent',color:'#6A7A90',cursor:'pointer',fontWeight:600,fontSize:13 }}>ยกเลิก</button>
                <button onClick={()=>deleteM.mutate(deleteTarget.id)} disabled={deleteM.isPending} style={{ padding:'10px 24px',borderRadius:9,border:'none',background:'#FF6B6B',color:'#fff',cursor:'pointer',fontWeight:700,fontSize:13 }}>{deleteM.isPending?'กำลังลบ...':'ลบผู้ใช้'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

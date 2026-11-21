import { useState } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import PanelBack from '@/components/doc/PanelBack'
import type { ContactGroup } from './ContactGroupsPage'
import SearchSelect from '@/components/ui/SearchSelect'

// ผู้ติดต่อ — one record per business partner, with customer and supplier as roles.
// The same page serves the full list and the customer-only / supplier-only views.
export type ContactRole = 'customer' | 'supplier'

interface CustomerRole { id: string; code: string; credit_days: number; credit_limit: number }
interface SupplierRole { id: string; code: string; payment_terms: number; bank_name?: string; bank_account?: string; bank_branch?: string; wht_type?: string }
interface Contact {
  id: string; code: string; name: string; name_en?: string; tax_id?: string; branch_code?: string
  address?: string; phone?: string; email?: string; contact_name?: string; is_active: boolean
  group_id?: string; group?: { id: string; code: string; name: string }
  roles: ContactRole[]; customer?: CustomerRole; supplier?: SupplierRole
  receivable: number; payable: number
}

interface Form {
  group_id: string   // '' = no group
  name: string; name_en: string; tax_id: string; branch_code: string; address: string
  phone: string; email: string; contact_name: string
  isCustomer: boolean; credit_days: number; credit_limit: number
  isSupplier: boolean; payment_terms: number; bank_name: string; bank_account: string; bank_branch: string; wht_type: string
}

const ROLE_META: Record<ContactRole, { label: string; color: string }> = {
  customer: { label: 'ลูกค้า', color: '#0A84FF' },
  supplier: { label: 'ผู้จำหน่าย', color: '#FF9F0A' },
}
const VIEWS: { to: string; label: string; role?: ContactRole }[] = [
  { to: '/contacts', label: 'ทั้งหมด' },
  { to: '/contacts/customers', label: 'ลูกค้า', role: 'customer' },
  { to: '/contacts/suppliers', label: 'ผู้จำหน่าย', role: 'supplier' },
]

const inp: React.CSSProperties = { width:'100%', background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'9px 12px', fontSize:12, color:'var(--color-text)', outline:'none', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }
const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH',{minimumFractionDigits:2})}`
const errText = (e: unknown) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof d === 'string' ? d : 'บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูล'
}

function toForm(c?: Contact, role?: ContactRole): Form {
  return {
    group_id: c?.group_id ?? '',
    name: c?.name ?? '', name_en: c?.name_en ?? '', tax_id: c?.tax_id ?? '', branch_code: c?.branch_code ?? '00000',
    address: c?.address ?? '', phone: c?.phone ?? '', email: c?.email ?? '', contact_name: c?.contact_name ?? '',
    isCustomer: c ? c.roles.includes('customer') : role !== 'supplier',
    credit_days: c?.customer?.credit_days ?? 30, credit_limit: Number(c?.customer?.credit_limit ?? 0),
    isSupplier: c ? c.roles.includes('supplier') : role === 'supplier',
    payment_terms: c?.supplier?.payment_terms ?? 30, bank_name: c?.supplier?.bank_name ?? '',
    bank_account: c?.supplier?.bank_account ?? '', bank_branch: c?.supplier?.bank_branch ?? '', wht_type: c?.supplier?.wht_type ?? '',
  }
}

function toPayload(f: Form, editing: boolean) {
  const opt = (s: string) => s.trim() || undefined
  const customer = f.isCustomer ? { credit_days: f.credit_days, credit_limit: f.credit_limit } : undefined
  const supplier = f.isSupplier ? {
    payment_terms: f.payment_terms, bank_name: opt(f.bank_name), bank_account: opt(f.bank_account),
    bank_branch: opt(f.bank_branch), wht_type: opt(f.wht_type),
  } : undefined
  return {
    group_id: f.group_id || null,
    name: f.name.trim(), name_en: opt(f.name_en), tax_id: opt(f.tax_id), branch_code: opt(f.branch_code) ?? '00000',
    address: opt(f.address), phone: opt(f.phone), email: opt(f.email), contact_name: opt(f.contact_name),
    customer, supplier,
    ...(editing ? { remove_customer: !f.isCustomer, remove_supplier: !f.isSupplier } : {}),
  }
}

export default function ContactsPage({ role }: { role?: ContactRole }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Contact | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [tried, setTried] = useState(false)   // show form errors only after a save attempt
  const [params, setParams] = useSearchParams()
  const groupFilter = params.get('group') ?? ''

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ['contacts', role ?? 'all', groupFilter],
    queryFn: async () => (await api.get('/api/v1/contacts/', { params: { role, group_id: groupFilter || undefined } })).data,
  })
  const { data: groups = [] } = useQuery<ContactGroup[]>({
    queryKey: ['contact-groups'],
    queryFn: async () => (await api.get('/api/v1/contact-groups/')).data,
  })
  const activeGroups = groups.filter(g => g.is_active)
  const setGroupFilter = (id: string) => setParams(p => { if (id) p.set('group', id); else p.delete('group'); return p }, { replace: true })

  // Duplicate warning: another contact with this tax ID + branch.
  const taxId = form?.tax_id.trim() ?? ''
  const { data: dup } = useQuery<{ duplicate: boolean; contact?: Contact }>({
    queryKey: ['contact-dup', taxId, form?.branch_code, editing?.id],
    queryFn: async () => (await api.get('/api/v1/contacts/check-duplicate', { params: { tax_id: taxId, branch_code: form?.branch_code || undefined, exclude_id: editing?.id } })).data,
    enabled: taxId.length === 13,
  })

  const saveM = useMutation({
    mutationFn: (f: Form) => editing
      ? api.patch(`/api/v1/contacts/${editing.id}`, toPayload(f, true))
      : api.post('/api/v1/contacts/', toPayload(f, false)),
    onSuccess: () => {
      // Documents pick customers/suppliers from these lists; groups show their counts.
      for (const k of ['contacts', 'customers', 'suppliers', 'contact-groups']) qc.invalidateQueries({ queryKey: [k] })
      close()
    },
  })

  const open = (c?: Contact) => { setEditing(c ?? null); setForm(toForm(c, role)); setTried(false); saveM.reset() }
  const close = () => { setEditing(null); setForm(null) }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => f && { ...f, [k]: v })

  const q = search.trim().toLowerCase()
  const shown = contacts.filter(c => !q || [c.name, c.code, c.tax_id, c.name_en, c.customer?.code, c.supplier?.code]
    .some(v => (v || '').toLowerCase().includes(q)))
  const both = contacts.filter(c => c.roles.length === 2).length
  const sum = (k: 'receivable' | 'payable') => contacts.reduce((s, c) => s + Number(c[k]), 0)
  const formError = form && !form.name.trim() ? 'ระบุชื่อ' : form && !form.isCustomer && !form.isSupplier ? 'เลือกอย่างน้อย 1 บทบาท' : null
  const title = role ? `ผู้ติดต่อ — ${ROLE_META[role].label}` : 'ผู้ติดต่อ'

  const th: React.CSSProperties = { padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)', whiteSpace:'nowrap' }
  const td: React.CSSProperties = { padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>{title}</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>ลูกค้าและผู้จำหน่ายในที่เดียว — รายชื่อเดียวเป็นได้ทั้งสองบทบาท</p>
        </div>
        <button onClick={()=>open()} style={{ background:'linear-gradient(135deg,var(--color-accent),var(--color-accent-strong))', color:'#fff', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>+ เพิ่มผู้ติดต่อ</button>
      </div>

      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <div className="seg" role="tablist" style={{ display:'flex', gap:4, background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:10, padding:3 }}>
          {VIEWS.map(v => (
            <NavLink key={v.to} to={v.to} end role="tab" style={({ isActive }) => ({
              padding:'6px 14px', borderRadius:7, fontSize:12, fontWeight:700, textDecoration:'none',
              background: isActive ? 'var(--color-card)' : 'transparent',
              color: isActive ? 'var(--color-text)' : 'var(--color-text-tertiary)',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
            })}>{v.label}</NavLink>
          ))}
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหาชื่อ รหัส หรือเลขผู้เสียภาษี" aria-label="ค้นหาผู้ติดต่อ" style={{ ...inp, maxWidth:300 }} />
        <SearchSelect value={groupFilter} onChange={e=>setGroupFilter(e.target.value)} aria-label="กรองตามกลุ่มประเภทลูกค้า" style={{ ...inp, width:'auto', minWidth:160, cursor:'pointer' }}>
          <option value="">ทุกกลุ่ม</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}{g.is_active ? '' : ' (ปิดใช้งาน)'}</option>)}
        </SearchSelect>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))', gap:12 }}>
        {[
          { l:'ผู้ติดต่อ', v: contacts.length, color:'var(--color-accent-light)' },
          ...(!role ? [{ l:'เป็นทั้งลูกค้าและผู้จำหน่าย', v: both, color:'#BF5AF2' }] : []),
          ...(role !== 'supplier' ? [{ l:'ลูกหนี้คงค้าง', v: baht(sum('receivable')), color: ROLE_META.customer.color }] : []),
          ...(role !== 'customer' ? [{ l:'เจ้าหนี้คงค้าง', v: baht(sum('payable')), color: ROLE_META.supplier.color }] : []),
        ].map(k=>(
          <div key={k.l} style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderTop:`2px solid ${k.color}`, borderRadius:12, padding:'14px 16px' }}>
            <p style={{ margin:'0 0 4px', fontSize:10, color:'var(--color-muted)' }}>{k.l}</p>
            <p style={{ margin:0, fontSize:20, fontWeight:800, color:k.color }}>{k.v}</p>
          </div>
        ))}
      </div>

      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : shown.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>{q ? 'ไม่พบผู้ติดต่อที่ค้นหา' : 'ยังไม่มีผู้ติดต่อ — กด “+ เพิ่มผู้ติดต่อ” เพื่อเริ่ม'}</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:900 }}>
            <thead><tr>{['รหัส','ชื่อ','กลุ่ม','บทบาท','เลขผู้เสียภาษี / สาขา','ติดต่อ','ลูกหนี้คงค้าง','เจ้าหนี้คงค้าง',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} onClick={()=>open(c)} style={{ cursor:'pointer' }}>
                  <td style={{ ...td, fontFamily:'monospace', fontSize:11, color:'var(--color-accent-light)' }}>{c.code}</td>
                  <td style={td}>
                    <div style={{ fontWeight:600 }}>{c.name}</div>
                    {c.name_en && <div style={{ fontSize:10, color:'var(--color-dim)' }}>{c.name_en}</div>}
                  </td>
                  <td style={{ ...td, fontSize:11, color: c.group ? 'var(--color-text-secondary)' : 'var(--color-dim)', whiteSpace:'nowrap' }}>{c.group?.name ?? '—'}</td>
                  <td style={td}>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {c.roles.map(r => {
                        const m = ROLE_META[r]; const code = r === 'customer' ? c.customer?.code : c.supplier?.code
                        return <span key={r} title={code} style={{ fontSize:10, fontWeight:700, color:m.color, background:m.color+'18', border:`1px solid ${m.color}40`, padding:'2px 8px', borderRadius:10, whiteSpace:'nowrap' }}>{m.label} · {code}</span>
                      })}
                    </div>
                  </td>
                  <td style={{ ...td, fontFamily:'monospace', fontSize:11, color:'var(--color-text-tertiary)' }}>{c.tax_id ? `${c.tax_id} / ${c.branch_code || '00000'}` : '—'}</td>
                  <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)' }}>{[c.contact_name, c.phone, c.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ ...td, fontFamily:'monospace', color: Number(c.receivable) ? ROLE_META.customer.color : 'var(--color-dim)' }}>{c.roles.includes('customer') || Number(c.receivable) ? baht(c.receivable) : '—'}</td>
                  <td style={{ ...td, fontFamily:'monospace', color: Number(c.payable) ? ROLE_META.supplier.color : 'var(--color-dim)' }}>{c.roles.includes('supplier') || Number(c.payable) ? baht(c.payable) : '—'}</td>
                  <td style={td}><span aria-hidden style={{ color:'var(--color-dim)' }}>✎</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="doc-panel">
          <PanelBack onClick={close} label="กลับไปที่รายชื่อผู้ติดต่อ" />
          <div className="doc-panel-card" aria-label={editing ? 'แก้ไขผู้ติดต่อ' : 'เพิ่มผู้ติดต่อ'}>
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>{editing ? `แก้ไข ${editing.code}` : 'เพิ่มผู้ติดต่อ'}</h3>
                {editing && <p style={{ margin:0, fontSize:11, color:'var(--color-muted)' }}>แก้ข้อมูลที่นี่ครั้งเดียว ใช้ทั้งฝั่งลูกค้าและผู้จำหน่าย</p>}
              </div>
              <button onClick={close} aria-label="ปิด" style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); setTried(true); if (!formError) saveM.mutate(form) }} style={{ padding:24, display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:12 }}>
                <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>ชื่อ *</label><input value={form.name} onChange={e=>set('name', e.target.value)} style={inp} placeholder="บริษัท / ร้าน / บุคคล" /></div>
                <div>
                  <label style={lbl}>กลุ่มประเภทลูกค้า</label>
                  <SearchSelect value={form.group_id} onChange={e=>set('group_id', e.target.value)} style={{ ...inp, cursor:'pointer' }}>
                    <option value="">— ไม่ระบุ —</option>
                    {activeGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    {editing?.group && !activeGroups.some(g => g.id === editing.group!.id) && <option value={editing.group.id}>{editing.group.name} (ปิดใช้งาน)</option>}
                  </SearchSelect>
                </div>
                <div><label style={lbl}>ชื่อภาษาอังกฤษ</label><input value={form.name_en} onChange={e=>set('name_en', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>เลขประจำตัวผู้เสียภาษี</label><input value={form.tax_id} onChange={e=>set('tax_id', e.target.value.replace(/\D/g,'').slice(0,13))} inputMode="numeric" style={{ ...inp, fontFamily:'monospace' }} placeholder="13 หลัก" /></div>
                <div><label style={lbl}>สาขา</label><input value={form.branch_code} onChange={e=>set('branch_code', e.target.value.replace(/\D/g,'').slice(0,5))} inputMode="numeric" style={{ ...inp, fontFamily:'monospace' }} placeholder="00000 = สำนักงานใหญ่" /></div>
                <div><label style={lbl}>ผู้ติดต่อ</label><input value={form.contact_name} onChange={e=>set('contact_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>โทรศัพท์</label><input value={form.phone} onChange={e=>set('phone', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>อีเมล</label><input type="email" value={form.email} onChange={e=>set('email', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>ที่อยู่</label><textarea value={form.address} onChange={e=>set('address', e.target.value)} rows={2} style={{ ...inp, resize:'vertical' }} /></div>
              </div>

              {dup?.duplicate && dup.contact && (
                <div role="alert" style={{ background:'#FF9F0A12', border:'1px solid #FF9F0A40', borderRadius:10, padding:'10px 14px', fontSize:12, color:'#C77700', display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                  <span>⚠ เลขผู้เสียภาษีและสาขานี้มีอยู่แล้ว: <b>{dup.contact.code} {dup.contact.name}</b> ({dup.contact.roles.map(r=>ROLE_META[r].label).join(', ')})</span>
                  <button type="button" onClick={()=>open(dup.contact)} style={{ fontSize:11, fontWeight:700, border:'1px solid #FF9F0A60', background:'transparent', color:'#C77700', borderRadius:7, padding:'4px 10px', cursor:'pointer' }}>เปิดรายการนั้นแทน</button>
                </div>
              )}

              {/* Roles */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:12 }}>
                <RoleBox role="customer" checked={form.isCustomer} onToggle={v=>set('isCustomer', v)} code={editing?.customer?.code}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div><label style={lbl}>เครดิต (วัน)</label><input type="number" min={0} max={365} value={form.credit_days} onChange={e=>set('credit_days', Number(e.target.value)||0)} style={inp} /></div>
                    <div><label style={lbl}>วงเงินเครดิต</label><input type="number" min={0} step="0.01" value={form.credit_limit} onChange={e=>set('credit_limit', Number(e.target.value)||0)} style={inp} /></div>
                  </div>
                </RoleBox>
                <RoleBox role="supplier" checked={form.isSupplier} onToggle={v=>set('isSupplier', v)} code={editing?.supplier?.code}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div><label style={lbl}>เงื่อนไขจ่าย (วัน)</label><input type="number" min={0} max={365} value={form.payment_terms} onChange={e=>set('payment_terms', Number(e.target.value)||0)} style={inp} /></div>
                    <div>
                      <label style={lbl}>หัก ณ ที่จ่าย</label>
                      <SearchSelect value={form.wht_type} onChange={e=>set('wht_type', e.target.value)} style={{ ...inp, cursor:'pointer' }}>
                        <option value="">ไม่หัก</option><option value="1%">1% (ขนส่ง)</option>
                        <option value="3%">3% (บริการ)</option><option value="5%">5% (ค่าเช่า)</option>
                      </SearchSelect>
                    </div>
                    <div><label style={lbl}>ธนาคาร</label><input value={form.bank_name} onChange={e=>set('bank_name', e.target.value)} style={inp} /></div>
                    <div><label style={lbl}>เลขที่บัญชี</label><input value={form.bank_account} onChange={e=>set('bank_account', e.target.value)} style={{ ...inp, fontFamily:'monospace' }} /></div>
                  </div>
                </RoleBox>
              </div>
              {editing && ((editing.roles.includes('customer') && !form.isCustomer) || (editing.roles.includes('supplier') && !form.isSupplier)) && (
                <p style={{ margin:0, fontSize:11, color:'var(--color-text-tertiary)' }}>บทบาทที่เอาออกจะถูกปิดใช้งาน เอกสารเดิมยังอ้างอิงได้ และเปิดกลับได้ภายหลัง</p>
              )}

              {(saveM.isError || (tried && formError)) && <div role="alert" style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>{(tried && formError) || errText(saveM.error)}</p></div>}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
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

function RoleBox({ role, checked, onToggle, code, children }: { role: ContactRole; checked: boolean; onToggle: (v: boolean) => void; code?: string; children: React.ReactNode }) {
  const m = ROLE_META[role]
  return (
    <div style={{ border:`1px solid ${checked ? m.color + '60' : 'var(--color-border)'}`, background: checked ? m.color + '0A' : 'transparent', borderRadius:12, padding:14, display:'flex', flexDirection:'column', gap:12 }}>
      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:800, color: checked ? m.color : 'var(--color-text-secondary)' }}>
        <input type="checkbox" checked={checked} onChange={e=>onToggle(e.target.checked)} style={{ width:16, height:16, accentColor: m.color }} />
        เป็น{m.label}
        {code && <span style={{ marginLeft:'auto', fontFamily:'monospace', fontSize:11, fontWeight:600, color:'var(--color-text-tertiary)' }}>{code}</span>}
      </label>
      {checked && children}
    </div>
  )
}

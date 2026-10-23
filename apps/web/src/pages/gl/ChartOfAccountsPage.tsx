import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────
type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'
type NormalBalance = 'debit' | 'credit'

interface Account {
  id: string; code: string; name: string; name_en: string | null
  account_type: AccountType; normal_balance: NormalBalance
  level: number; is_active: boolean; balance: number
  parent_id: string | null; children: Account[]
}

const TYPE_META: Record<AccountType, { label: string; color: string; icon: string }> = {
  asset:     { label: 'สินทรัพย์',        color: 'var(--color-accent-light)', icon: '🏦' },
  liability: { label: 'หนี้สิน',           color: '#FF6B6B', icon: '💳' },
  equity:    { label: 'ส่วนของผู้ถือหุ้น', color: '#F5A623', icon: '💼' },
  income:    { label: 'รายได้',            color: '#43E97B', icon: '⬆' },
  expense:   { label: 'ค่าใช้จ่าย',       color: '#F093FB', icon: '⬇' },
}

const createSchema = z.object({
  code:           z.string().min(1).regex(/^\d+$/, 'รหัสต้องเป็นตัวเลข'),
  name:           z.string().min(2, 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'),
  name_en:        z.string().optional(),
  account_type:   z.enum(['asset','liability','equity','income','expense']),
  normal_balance: z.enum(['debit','credit']),
  level:          z.number().min(1).max(4),
  description:    z.string().optional(),
})
type CForm = z.infer<typeof createSchema>

// ── Account Row (recursive tree) ──────────────────────────────
function AccountRow({ acc, depth, onSelect }: { acc: Account; depth: number; onSelect: (a: Account) => void }) {
  const [open, setOpen] = useState(depth < 1)
  const meta = TYPE_META[acc.account_type]
  const hasChildren = acc.children?.length > 0
  const balance = Number(acc.balance)

  return (
    <>
      <tr onClick={() => onSelect(acc)} style={{ cursor: 'pointer', background: depth === 0 ? 'var(--color-bg-inset)' : 'transparent' }}>
        <td style={{ padding: '10px 16px', paddingLeft: 16 + depth * 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {hasChildren && (
              <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
                style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 12, width: 16, textAlign: 'center', padding: 0 }}>
                {open ? '▾' : '▸'}
              </button>
            )}
            {!hasChildren && <span style={{ width: 16 }} />}
            <span style={{ fontSize: 13, fontWeight: depth === 0 ? 700 : 400, color: 'var(--color-text)' }}>
              <span style={{ color: 'var(--color-dim)', marginRight: 8, fontFamily: 'monospace' }}>{acc.code}</span>
              {acc.name}
            </span>
          </div>
        </td>
        <td style={{ padding: '10px 16px', fontSize: 11 }}>
          <span style={{ color: meta.color, background: meta.color + '15', border: `1px solid ${meta.color}30`, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
            {meta.icon} {meta.label}
          </span>
        </td>
        <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>
          {acc.normal_balance === 'debit' ? 'Dr' : 'Cr'}
        </td>
        <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', fontFamily: 'monospace', fontWeight: balance !== 0 ? 600 : 400, color: balance > 0 ? '#43E97B' : balance < 0 ? '#FF6B6B' : 'var(--color-dim)' }}>
          {balance !== 0 ? balance.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '—'}
        </td>
        <td style={{ padding: '10px 16px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: acc.is_active ? '#43E97B' : '#FF6B6B', display: 'inline-block' }} />
        </td>
      </tr>
      {open && hasChildren && acc.children.map(child => (
        <AccountRow key={child.id} acc={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────
const inp: React.CSSProperties = { width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 13px', fontSize: 13, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }

export default function ChartOfAccountsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<Account | null>(null)
  const [search, setSearch] = useState('')

  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ['accounts', 'tree'],
    queryFn: async () => (await api.get('/api/v1/accounts/?tree=true')).data,
  })

  const createM = useMutation({
    mutationFn: (d: CForm) => api.post('/api/v1/accounts/', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); setShowCreate(false); reset() },
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<CForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { account_type: 'asset', normal_balance: 'debit', level: 3 },
  })

  // Auto-set normal balance based on type
  const watchType = watch('account_type')

  const flatSearch = (accs: Account[], q: string): Account[] => {
    const result: Account[] = []
    const walk = (list: Account[]) => list.forEach(a => {
      if (a.name.includes(q) || a.code.includes(q) || (a.name_en?.toLowerCase().includes(q.toLowerCase()))) result.push(a)
      if (a.children) walk(a.children)
    })
    walk(accs)
    return result
  }

  const stats = (['asset','liability','equity','income','expense'] as AccountType[]).map(t => {
    const count = flatSearch(accounts, '').filter(a => a.account_type === t).length
    return { type: t, count }
  })

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ผังบัญชี</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>Chart of Accounts — มาตรฐานบัญชีไทย</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + เพิ่มบัญชี
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10 }}>
        {stats.map(s => {
          const meta = TYPE_META[s.type]
          return (
            <div key={s.type} style={{ background: 'var(--color-card)', border: `1px solid ${meta.color}20`, borderTop: `2px solid ${meta.color}`, borderRadius: 12, padding: '12px 14px' }}>
              <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--color-muted)', fontWeight: 600 }}>{meta.label}</p>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: meta.color }}>{s.count}</p>
            </div>
          )
        })}
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  ค้นหารหัสบัญชีหรือชื่อบัญชี..."
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 9, padding: '9px 14px', fontSize: 13, color: 'var(--color-text)', outline: 'none', width: '100%', boxSizing: 'border-box' }} />

      {/* Selected Account Detail */}
      {selected && (
        <div style={{ background: `${TYPE_META[selected.account_type].color}10`, border: `1px solid ${TYPE_META[selected.account_type].color}30`, borderRadius: 12, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 800 }}>{selected.code} — {selected.name}</p>
            {selected.name_en && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)' }}>{selected.name_en}</p>}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}><p style={{ margin: '0 0 2px', fontSize: 10, color: 'var(--color-muted)' }}>ประเภท</p><p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: TYPE_META[selected.account_type].color }}>{TYPE_META[selected.account_type].label}</p></div>
            <div style={{ textAlign: 'center' }}><p style={{ margin: '0 0 2px', fontSize: 10, color: 'var(--color-muted)' }}>Normal Balance</p><p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{selected.normal_balance === 'debit' ? 'Debit (Dr)' : 'Credit (Cr)'}</p></div>
            <div style={{ textAlign: 'center' }}><p style={{ margin: '0 0 2px', fontSize: 10, color: 'var(--color-muted)' }}>ยอดคงเหลือ</p><p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#F2714E' }}>฿ {Number(selected.balance).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p></div>
          </div>
          <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)' }}>กำลังโหลดผังบัญชี...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['รหัส / ชื่อบัญชี', 'ประเภท', 'Normal Balance', 'ยอดคงเหลือ', 'สถานะ'].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: h === 'ยอดคงเหลือ' ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {search
                ? flatSearch(accounts, search).map(a => <AccountRow key={a.id} acc={a} depth={0} onSelect={setSelected} />)
                : accounts.map(a => <AccountRow key={a.id} acc={a} depth={0} onSelect={setSelected} />)
              }
            </tbody>
          </table>
        )}
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>เพิ่มบัญชีใหม่</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d => createM.mutate(d))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div>
                  <label style={lbl}>รหัสบัญชี</label>
                  <input {...register('code')} placeholder="1101" style={inp} />
                  {errors.code && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.code.message}</p>}
                </div>
                <div>
                  <label style={lbl}>ชื่อบัญชี (ไทย)</label>
                  <input {...register('name')} placeholder="เงินสด" style={inp} />
                  {errors.name && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.name.message}</p>}
                </div>
              </div>
              <div>
                <label style={lbl}>ชื่อบัญชี (อังกฤษ)</label>
                <input {...register('name_en')} placeholder="Cash" style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>ประเภทบัญชี</label>
                  <select {...register('account_type')} style={{ ...inp, cursor: 'pointer' }}
                    onChange={e => {
                      const t = e.target.value as AccountType
                      setValue('account_type', t)
                      setValue('normal_balance', ['asset','expense'].includes(t) ? 'debit' : 'credit')
                    }}>
                    {(['asset','liability','equity','income','expense'] as AccountType[]).map(t => (
                      <option key={t} value={t}>{TYPE_META[t].label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Normal Balance</label>
                  <select {...register('normal_balance')} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="debit">Debit (Dr)</option>
                    <option value="credit">Credit (Cr)</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>ระดับบัญชี (1=หมวด, 2=ประเภท, 3=บัญชีย่อย)</label>
                <select {...register('level', { valueAsNumber: true })} style={{ ...inp, cursor: 'pointer' }}>
                  <option value={1}>1 — หมวดใหญ่</option>
                  <option value={2}>2 — ประเภท</option>
                  <option value={3}>3 — บัญชีย่อย</option>
                </select>
              </div>
              <div>
                <label style={lbl}>หมายเหตุ</label>
                <textarea {...register('description')} rows={2} placeholder="คำอธิบายบัญชีเพิ่มเติม (ไม่บังคับ)"
                  style={{ ...inp, resize: 'vertical' }} />
              </div>
              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด — รหัสบัญชีอาจซ้ำกัน</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '10px 20px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer', opacity: createM.isPending ? 0.7 : 1 }}>
                  {createM.isPending ? 'กำลังบันทึก...' : 'สร้างบัญชี'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

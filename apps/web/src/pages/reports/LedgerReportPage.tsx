import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import api from '@/lib/api'
import { JournalTypeBadge } from '@/components/ui/JournalTypeBadge'
import { isJournalType } from '@/config/journals'

// รายงานทางบัญชี: งบทดลอง (trial balance) and บัญชีแยกประเภท (general ledger).
// Both come from posted journal entries. A trial-balance row links into the ledger.

interface TBRow { account_id: string; code: string; name: string; account_type: string; opening: number; debit: number; credit: number; closing_debit: number; closing_credit: number }
interface TrialBalance { rows: TBRow[]; totals: Record<'debit'|'credit'|'closing_debit'|'closing_credit', number>; balanced: boolean }
interface LedgerLine { date: string; journal_number: string; journal_type?: string; reference?: string; description: string; debit: number; credit: number; balance: number }
interface Ledger { account: { id: string; code: string; name: string }; opening: number; closing: number; total_debit: number; total_credit: number; lines: LedgerLine[] }
interface Account { id: string; code: string; name: string; is_active: boolean }

const TYPE_LABEL: Record<string, string> = { asset: 'สินทรัพย์', liability: 'หนี้สิน', equity: 'ส่วนของเจ้าของ', income: 'รายได้', expense: 'ค่าใช้จ่าย' }
const money = (n: number) => Number(n) === 0 ? '—' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 })
const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'7px 10px', fontSize:12, color:'var(--color-text)', outline:'none' }
const th: React.CSSProperties = { padding:'10px 12px', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)', textAlign:'left', whiteSpace:'nowrap' }
const td: React.CSSProperties = { padding:'9px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }
const num: React.CSSProperties = { ...td, fontFamily:'monospace', textAlign:'right', whiteSpace:'nowrap' }
const card: React.CSSProperties = { background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }

// Local calendar date — toISOString() would shift to UTC and land on the previous day in Thailand.
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function usePeriod() {
  const [params, setParams] = useSearchParams()
  const today = new Date()
  const from = params.get('from') || localDate(new Date(today.getFullYear(), 0, 1))
  const to = params.get('to') || localDate(today)
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }) }
  return { from, to, setFrom: (v: string) => set('from', v), setTo: (v: string) => set('to', v), params, set }
}

function PeriodPicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
      <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={inp} aria-label="ตั้งแต่วันที่" />
      <span style={{ color:'var(--color-dim)' }}>—</span>
      <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={inp} aria-label="ถึงวันที่" />
    </div>
  )
}

export function TrialBalancePage() {
  const { from, to, setFrom, setTo } = usePeriod()
  const { data, isLoading, isError } = useQuery<TrialBalance>({
    queryKey: ['trial-balance', from, to],
    queryFn: async () => (await api.get('/api/v1/reports/trial-balance', { params: { period_from: from, period_to: to } })).data,
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>งบทดลอง</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>Trial Balance — ยอดยกมา ยอดเคลื่อนไหว และยอดคงเหลือทุกบัญชี จากรายการที่ลงบัญชีแล้ว</p>
        </div>
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>

      {data && (
        <div role="status" style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color: data.balanced ? '#43E97B' : '#FF6B6B' }}>
          {data.balanced ? '✓ งบทดลองสมดุล — ยอดคงเหลือเดบิตเท่ากับเครดิต' : '⚠ งบทดลองไม่สมดุล — ตรวจสอบรายการบัญชี'}
        </div>
      )}

      <div style={card}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : isError ? <div style={{ padding:48, textAlign:'center', color:'#FF6B6B', fontSize:13 }}>โหลดงบทดลองไม่สำเร็จ — ตรวจสอบช่วงวันที่</div>
        : !data?.rows.length ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ไม่มีรายการที่ลงบัญชีในช่วงนี้</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:760 }}>
            <thead>
              <tr>
                <th style={th}>รหัส</th><th style={th}>ชื่อบัญชี</th><th style={th}>ประเภท</th>
                <th style={{ ...th, textAlign:'right' }}>ยอดยกมา</th>
                <th style={{ ...th, textAlign:'right' }}>เดบิต</th><th style={{ ...th, textAlign:'right' }}>เครดิต</th>
                <th style={{ ...th, textAlign:'right' }}>คงเหลือ เดบิต</th><th style={{ ...th, textAlign:'right' }}>คงเหลือ เครดิต</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.account_id}>
                  <td style={{ ...td, fontFamily:'monospace' }}>
                    <Link to={`/reports/ledger?account=${r.account_id}&from=${from}&to=${to}`} style={{ color:'var(--color-accent-light)', textDecoration:'none' }}>{r.code}</Link>
                  </td>
                  <td style={td}>{r.name}</td>
                  <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)', whiteSpace:'nowrap' }}>{TYPE_LABEL[r.account_type] || r.account_type}</td>
                  <td style={{ ...num, color:'var(--color-text-tertiary)' }}>{money(r.opening)}</td>
                  <td style={num}>{money(r.debit)}</td>
                  <td style={num}>{money(r.credit)}</td>
                  <td style={{ ...num, fontWeight:700 }}>{money(r.closing_debit)}</td>
                  <td style={{ ...num, fontWeight:700 }}>{money(r.closing_credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ ...td, fontWeight:800, borderBottom:'none' }}>รวม</td>
                {(['debit','credit','closing_debit','closing_credit'] as const).map(k => (
                  <td key={k} style={{ ...num, fontWeight:800, borderBottom:'none', borderTop:'2px solid var(--color-border-strong)' }}>{money(data.totals[k])}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

export function GeneralLedgerPage() {
  const { from, to, setFrom, setTo, params, set } = usePeriod()
  const accountId = params.get('account') || ''
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts-flat'],
    queryFn: async () => (await api.get('/api/v1/accounts/')).data,
  })
  const { data, isLoading, isError } = useQuery<Ledger>({
    queryKey: ['general-ledger', accountId, from, to],
    queryFn: async () => (await api.get('/api/v1/reports/general-ledger', { params: { account_id: accountId, period_from: from, period_to: to } })).data,
    enabled: !!accountId,
  })
  const [q, setQ] = useState('')
  const options = accounts.filter(a => !q || `${a.code} ${a.name}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>บัญชีแยกประเภท</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>General Ledger — รายการเคลื่อนไหวและยอดคงเหลือสะสมของแต่ละบัญชี</p>
        </div>
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหารหัส/ชื่อบัญชี" style={{ ...inp, width:200 }} aria-label="ค้นหาบัญชี" />
        <select value={accountId} onChange={e=>set('account', e.target.value)} style={{ ...inp, minWidth:280, cursor:'pointer' }} aria-label="เลือกบัญชี">
          <option value="">-- เลือกบัญชี --</option>
          {options.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
      </div>

      {!accountId ? (
        <div style={{ ...card, padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>เลือกบัญชีเพื่อดูรายการเคลื่อนไหว</div>
      ) : isError ? (
        <div style={{ ...card, padding:48, textAlign:'center', color:'#FF6B6B', fontSize:13 }}>โหลดบัญชีแยกประเภทไม่สำเร็จ — ตรวจสอบช่วงวันที่</div>
      ) : isLoading || !data ? (
        <div style={{ ...card, padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
      ) : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))', gap:12 }}>
            {[
              { l:'ยอดยกมา', v: data.opening, color:'var(--color-text-tertiary)' },
              { l:'รวมเดบิต', v: data.total_debit, color:'var(--color-accent-light)' },
              { l:'รวมเครดิต', v: data.total_credit, color:'#F5A623' },
              { l:'ยอดคงเหลือ', v: data.closing, color:'#43E97B' },
            ].map(k=>(
              <div key={k.l} style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderTop:`2px solid ${k.color}`, borderRadius:12, padding:'14px 16px' }}>
                <p style={{ margin:'0 0 4px', fontSize:10, color:'var(--color-muted)' }}>{k.l}</p>
                <p style={{ margin:0, fontSize:18, fontWeight:800, fontFamily:'monospace', color:k.color }}>฿{Number(k.v).toLocaleString('th-TH',{minimumFractionDigits:2})}</p>
              </div>
            ))}
          </div>

          <div style={card}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:760 }}>
              <thead>
                <tr>
                  <th style={th}>วันที่</th><th style={th}>เลขที่รายการ</th><th style={th}>สมุด</th><th style={th}>อ้างอิง</th><th style={th}>คำอธิบาย</th>
                  <th style={{ ...th, textAlign:'right' }}>เดบิต</th><th style={{ ...th, textAlign:'right' }}>เครดิต</th><th style={{ ...th, textAlign:'right' }}>คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={7} style={{ ...td, fontStyle:'italic', color:'var(--color-text-tertiary)' }}>ยอดยกมา</td>
                  <td style={{ ...num, fontWeight:700 }}>{Number(data.opening).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                </tr>
                {data.lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontSize:11, whiteSpace:'nowrap', color:'var(--color-text-tertiary)' }}>{new Date(l.date).toLocaleDateString('th-TH')}</td>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:11 }}>{l.journal_number}</td>
                    <td style={td}>{l.journal_type && isJournalType(l.journal_type) ? <JournalTypeBadge type={l.journal_type} /> : '—'}</td>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:11, color:'var(--color-text-tertiary)' }}>{l.reference || '—'}</td>
                    <td style={{ ...td, fontSize:11 }}>{l.description}</td>
                    <td style={num}>{money(l.debit)}</td>
                    <td style={num}>{money(l.credit)}</td>
                    <td style={{ ...num, fontWeight:700 }}>{Number(l.balance).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                  </tr>
                ))}
                {data.lines.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign:'center', color:'var(--color-dim)', padding:28 }}>ไม่มีรายการเคลื่อนไหวในช่วงนี้</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import PanelBack from '@/components/doc/PanelBack'
import SearchSelect from '@/components/ui/SearchSelect'

// ── Types ──────────────────────────────────────────────────────
type TaxKind = 'vat' | 'wht'

interface TaxCode {
  id: string; code: string; name: string; kind: TaxKind
  rate: number; description: string | null; is_active: boolean
}

const KIND_META: Record<TaxKind, { label: string; en: string; color: string }> = {
  vat: { label: 'ภาษีมูลค่าเพิ่ม',   en: 'VAT',             color: '#4CA5FF' },
  wht: { label: 'ภาษีหัก ณ ที่จ่าย', en: 'Withholding Tax', color: '#F5A623' },
}

const formSchema = z.object({
  code:        z.string().trim().min(1, 'ระบุรหัส').max(20, 'ไม่เกิน 20 ตัวอักษร'),
  name:        z.string().trim().min(2, 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'),
  kind:        z.enum(['vat', 'wht']),
  rate:        z.number({ invalid_type_error: 'ระบุอัตรา' }).min(0, 'ต้องไม่ติดลบ').max(100, 'ไม่เกิน 100%'),
  description: z.string().optional(),
  is_active:   z.boolean(),
})
type TForm = z.infer<typeof formSchema>

const inp: React.CSSProperties = { width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 13px', fontSize: 13, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }
const th: React.CSSProperties  = { padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties  = { padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13 }

const fmtRate = (r: number) => `${Number(r).toLocaleString('th-TH', { maximumFractionDigits: 2 })}%`

// ── Main Page ─────────────────────────────────────────────────
export default function TaxTypesPage() {
  const qc = useQueryClient()
  // null = closed, 'new' = create, otherwise the code being edited
  const [editing, setEditing] = useState<TaxCode | 'new' | null>(null)

  const { data: codes = [], isLoading } = useQuery<TaxCode[]>({
    queryKey: ['tax-codes'],
    queryFn: async () => (await api.get('/api/v1/tax/codes')).data,
  })

  const form = useForm<TForm>({ resolver: zodResolver(formSchema) })
  const { register, handleSubmit, reset, formState: { errors } } = form

  const openNew = (kind: TaxKind) => {
    reset({ code: '', name: '', kind, rate: kind === 'vat' ? 7 : 3, description: '', is_active: true })
    saveM.reset()
    setEditing('new')
  }
  const openEdit = (t: TaxCode) => {
    reset({ code: t.code, name: t.name, kind: t.kind, rate: Number(t.rate), description: t.description ?? '', is_active: t.is_active })
    saveM.reset()
    setEditing(t)
  }

  const saveM = useMutation({
    // Code and kind identify the tax once used on documents, so an edit only sends what PATCH accepts.
    mutationFn: (d: TForm): Promise<unknown> => editing === 'new'
      ? api.post('/api/v1/tax/codes', { code: d.code, name: d.name, kind: d.kind, rate: d.rate, description: d.description || null })
      : api.patch(`/api/v1/tax/codes/${(editing as TaxCode).id}`, { name: d.name, rate: d.rate, description: d.description ?? '', is_active: d.is_active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tax-codes'] }); setEditing(null) },
  })
  const saveError = (saveM.error as any)?.response?.data?.detail
  const isNew = editing === 'new'


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ประเภทภาษี</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>Tax Codes — อัตราภาษีที่ใช้ในเอกสารขาย ซื้อ และการจ่ายเงิน</p>
      </div>

      {isLoading ? (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)', borderRadius: 14 }}>กำลังโหลดประเภทภาษี...</div>
      ) : (['vat', 'wht'] as TaxKind[]).map(kind => {
        const meta = KIND_META[kind]
        const rows = codes.filter(c => c.kind === kind)
        return (
          <section key={kind} style={{ background: 'var(--color-card)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ width: 4, height: 28, borderRadius: 4, background: meta.color, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{meta.label}</h3>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-muted)' }}>{meta.en} · {rows.length} รายการ</p>
                </div>
              </div>
              <button onClick={() => openNew(kind)} style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: 'var(--color-bg-inset)', color: 'var(--color-text)', cursor: 'pointer', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>+ เพิ่ม{kind === 'vat' ? ' VAT' : ' หัก ณ ที่จ่าย'}</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>รหัส</th>
                    <th style={th}>ชื่อ</th>
                    <th style={{ ...th, textAlign: 'right' }}>อัตรา</th>
                    <th style={th}>สถานะ</th>
                    <th style={{ ...th, width: 1 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--color-dim)', padding: 28 }}>ยังไม่มีรายการ</td></tr>
                  )}
                  {rows.map(t => (
                    <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                      <td style={{ ...td, fontFamily: 'monospace', color: 'var(--color-dim)', whiteSpace: 'nowrap' }}>{t.code}</td>
                      <td style={td}>
                        <span style={{ display: 'block' }}>{t.name}</span>
                        {t.description && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{t.description}</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: meta.color, whiteSpace: 'nowrap' }}>{fmtRate(t.rate)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.is_active ? '#43E97B' : '#FF6B6B' }} />
                          {t.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      <td style={td}>
                        <button onClick={() => openEdit(t)} title="แก้ไข" aria-label={`แก้ไข ${t.code}`}
                          style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--color-bg-inset)', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {/* CREATE / EDIT MODAL */}
      {editing && (
        <div className="doc-panel">
          <PanelBack onClick={() => setEditing(null)} label="กลับไปที่ประเภทภาษี" />
          <div className="doc-panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                {isNew ? 'เพิ่มประเภทภาษี' : <>แก้ไขประเภทภาษี <span style={{ fontFamily: 'monospace', color: 'var(--color-muted)' }}>{(editing as TaxCode).code}</span></>}
              </h3>
              <button onClick={() => setEditing(null)} aria-label="ปิด" style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d => saveM.mutate(d))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>รหัส</label>
                  {/* readOnly, not disabled: react-hook-form leaves disabled fields out of the submitted values */}
                  <input {...register('code')} placeholder="WHT3" readOnly={!isNew} style={{ ...inp, textTransform: 'uppercase', opacity: isNew ? 1 : 0.6 }} />
                  {errors.code && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.code.message}</p>}
                </div>
                <div>
                  <label style={lbl}>ประเภท</label>
                  {isNew ? (
                    <SearchSelect {...register('kind')} style={{ ...inp, cursor: 'pointer' }}>
                      <option value="vat">ภาษีมูลค่าเพิ่ม</option>
                      <option value="wht">หัก ณ ที่จ่าย</option>
                    </SearchSelect>
                  ) : (
                    <input readOnly value={KIND_META[(editing as TaxCode).kind].label} style={{ ...inp, opacity: 0.6 }} />
                  )}
                </div>
              </div>
              {!isNew && <p style={{ margin: '-8px 0 0', fontSize: 11, color: 'var(--color-dim)' }}>รหัสและประเภทแก้ไขไม่ได้ เพราะเอกสารที่ใช้ภาษีนี้อ้างอิงอยู่</p>}
              <div>
                <label style={lbl}>ชื่อ</label>
                <input {...register('name')} placeholder="หัก ณ ที่จ่าย 3% — ค่าบริการ" style={inp} />
                {errors.name && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.name.message}</p>}
              </div>
              <div>
                <label style={lbl}>อัตรา (%)</label>
                <input {...register('rate', { valueAsNumber: true })} type="number" min="0" max="100" step="0.01" style={inp} />
                {errors.rate && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.rate.message}</p>}
              </div>
              <div>
                <label style={lbl}>หมายเหตุ</label>
                <textarea {...register('description')} rows={2} placeholder="ใช้กับรายการใด (ไม่บังคับ)" style={{ ...inp, resize: 'vertical' }} />
              </div>
              {!isNew && (
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--color-bg-inset)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                  <span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>เปิดใช้งาน</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-muted)' }}>ปิดเพื่อไม่ให้เลือกในเอกสารใหม่ เอกสารเดิมไม่เปลี่ยน</span>
                  </span>
                  <input type="checkbox" {...register('is_active')} style={{ width: 18, height: 18, accentColor: '#F2714E', cursor: 'pointer', flexShrink: 0 }} />
                </label>
              )}
              {saveM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>{typeof saveError === 'string' ? saveError : 'บันทึกไม่สำเร็จ กรุณาลองใหม่'}</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setEditing(null)} style={{ padding: '10px 20px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button type="submit" disabled={saveM.isPending} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer', opacity: saveM.isPending ? 0.7 : 1 }}>
                  {saveM.isPending ? 'กำลังบันทึก...' : isNew ? 'เพิ่มประเภทภาษี' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

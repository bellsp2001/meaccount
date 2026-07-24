import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import api from '@/lib/api'

interface FieldMeta { key: string; label: string; type: string }
interface CustomReportResult { columns: string[]; rows: Record<string, any>[]; total_rows: number }

const SOURCES = [
  { value: 'invoice', label: '📄 ใบแจ้งหนี้ (AR)' }, { value: 'bill', label: '📋 บิล (AP)' },
  { value: 'product', label: '📦 สินค้า' }, { value: 'employee', label: '👤 พนักงาน' },
  { value: 'account', label: '⚖ บัญชี (GL)' }, { value: 'journal', label: '📒 สมุดรายวัน' },
]

const inp: React.CSSProperties = { background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#DDE3EE', outline: 'none' }

export default function ReportBuilderPage() {
  const [source, setSource] = useState('invoice')
  const [selectedCols, setSelectedCols] = useState<string[]>([])
  const [filters, setFilters] = useState<{ field: string; operator: string; value: string }[]>([])
  const [result, setResult] = useState<CustomReportResult | null>(null)

  const { data: fieldsData } = useQuery<{ fields: FieldMeta[] }>({
    queryKey: ['fields', source],
    queryFn: async () => (await api.get(`/api/v1/report-builder/fields/${source}`)).data,
  })
  const fields = fieldsData?.fields || []

  const runM = useMutation({
    mutationFn: () => api.post('/api/v1/report-builder/run', { source_type: source, columns: selectedCols, filters: filters.filter(f => f.value) }),
    onSuccess: (res) => setResult(res.data),
  })

  function toggleCol(key: string) {
    setSelectedCols(prev => prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key])
  }

  async function handleExport(format: 'excel' | 'pdf') {
    const response = await api.post(`/api/v1/report-builder/run/export-${format}`,
      { source_type: source, columns: selectedCols, filters: filters.filter(f => f.value) },
      { responseType: 'blob' })
    const blob = new Blob([response.data])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `report_${source}.${format === 'excel' ? 'xlsx' : 'pdf'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const labelMap = Object.fromEntries(fields.map(f => [f.key, f.label]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Custom Report Builder</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>สร้างรายงานเอง — เลือกแหล่งข้อมูล, คอลัมน์, ตัวกรอง</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        {/* Builder panel */}
        <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '20px' }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#4A5A70', textTransform: 'uppercase' }}>1. แหล่งข้อมูล</p>
          <select value={source} onChange={e => { setSource(e.target.value); setSelectedCols([]); setResult(null) }} style={{ ...inp, width: '100%', cursor: 'pointer', marginBottom: 20 }}>
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#4A5A70', textTransform: 'uppercase' }}>2. เลือกคอลัมน์</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {fields.map(f => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8A9BB0', cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedCols.includes(f.key)} onChange={() => toggleCol(f.key)} style={{ cursor: 'pointer' }} />
                {f.label}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#4A5A70', textTransform: 'uppercase' }}>3. ตัวกรอง (ไม่บังคับ)</p>
            <button onClick={() => setFilters([...filters, { field: fields[0]?.key || '', operator: 'eq', value: '' }])}
              style={{ fontSize: 10, background: '#151C28', border: '1px solid #1E2A3A', color: '#8A9BB0', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>+ เพิ่ม</button>
          </div>
          {filters.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <select value={f.field} onChange={e => { const nf = [...filters]; nf[i].field = e.target.value; setFilters(nf) }} style={{ ...inp, fontSize: 10, flex: 1 }}>
                {fields.map(fl => <option key={fl.key} value={fl.key}>{fl.label}</option>)}
              </select>
              <select value={f.operator} onChange={e => { const nf = [...filters]; nf[i].operator = e.target.value; setFilters(nf) }} style={{ ...inp, fontSize: 10, width: 60 }}>
                <option value="eq">=</option><option value="gte">≥</option><option value="lte">≤</option><option value="contains">มี</option>
              </select>
              <input value={f.value} onChange={e => { const nf = [...filters]; nf[i].value = e.target.value; setFilters(nf) }} style={{ ...inp, fontSize: 10, flex: 1 }} />
              <button onClick={() => setFilters(filters.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#FF6B6B', cursor: 'pointer' }}>✕</button>
            </div>
          ))}

          <button onClick={() => runM.mutate()} disabled={selectedCols.length === 0 || runM.isPending}
            style={{ width: '100%', marginTop: 14, background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer', opacity: selectedCols.length === 0 ? 0.5 : 1 }}>
            {runM.isPending ? '⏳ กำลังรัน...' : '▶ รันรายงาน'}
          </button>
        </div>

        {/* Result panel */}
        <div>
          {!result ? (
            <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: 60, textAlign: 'center' }}>
              <p style={{ fontSize: 36, marginBottom: 12 }}>📊</p>
              <p style={{ color: '#3A4A60', fontSize: 13 }}>เลือกคอลัมน์แล้วกด "รันรายงาน" เพื่อดูผลลัพธ์</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: 12, color: '#4A5A70' }}>พบ {result.total_rows} รายการ</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleExport('excel')} style={{ background: '#43E97B15', border: '1px solid #43E97B40', color: '#43E97B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>📥 Excel</button>
                  <button onClick={() => handleExport('pdf')} style={{ background: '#FF6B6B15', border: '1px solid #FF6B6B40', color: '#FF6B6B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>📥 PDF</button>
                </div>
              </div>
              <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, overflow: 'auto', maxHeight: 480 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{result.columns.map(c => <th key={c} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', borderBottom: '1px solid #151C28', position: 'sticky', top: 0, background: '#0D1018' }}>{labelMap[c] || c}</th>)}</tr></thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {result.columns.map(c => (
                          <td key={c} style={{ padding: '8px 12px', borderBottom: '1px solid #0F1520', fontSize: 12, fontFamily: typeof row[c] === 'number' ? 'monospace' : 'inherit' }}>
                            {typeof row[c] === 'number' ? row[c].toLocaleString('th-TH', { minimumFractionDigits: 2 }) : (row[c] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

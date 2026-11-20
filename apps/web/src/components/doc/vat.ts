import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

// Per-line VAT on document item tables: each line picks a ประเภทภาษี (VAT) from
// การบัญชี › ประเภทภาษี; the document's VAT is the sum of the lines (the API works it the same way).
export interface VatCode { id: string; code: string; name: string; kind: 'vat' | 'wht'; rate: number; is_active: boolean }

/** All VAT tax codes (inactive ones too, so a saved line still shows its code). */
export function useVatCodes() {
  return useQuery<VatCode[], Error, VatCode[]>({
    queryKey: ['tax-codes'],
    queryFn: async () => (await api.get('/api/v1/tax/codes')).data,
    select: codes => codes.filter(c => c.kind === 'vat'),
  })
}

/** The code a new line starts with: the active 7% VAT if there is one, else the first active VAT. */
export function defaultVatCodeId(codes: VatCode[]): string {
  const active = codes.filter(c => c.is_active)
  return (active.find(c => Number(c.rate) === 7) ?? active[0])?.id ?? ''
}

/** A line's VAT %: its code's rate; no code = no VAT. */
export function vatRateOf(codes: VatCode[], codeId?: string | null): number {
  return Number(codes.find(c => c.id === codeId)?.rate ?? 0)
}

/** The code to show for a saved line: its own code, else the active code matching its rate. */
export function vatCodeForLine(codes: VatCode[], codeId: string | null | undefined, rate: number | null | undefined): string {
  if (codeId) return codeId
  if (rate === null || rate === undefined) return ''
  return codes.find(c => c.is_active && Number(c.rate) === Number(rate))?.id ?? ''
}

/** VAT of a set of lines given each line's amount and code. `inclusive` = amounts already include VAT. */
export function sumLineVat(codes: VatCode[], lines: { amount: number; codeId?: string | null }[], inclusive = false): number {
  return lines.reduce((s, l) => {
    const rate = vatRateOf(codes, l.codeId)
    return s + l.amount * rate / (inclusive ? 100 + rate : 100)
  }, 0)
}

/** How line prices are entered: VAT on top (แยก VAT) or already in the price (รวม VAT). */
export type VatMode = 'exclusive' | 'inclusive'

/** How the bill discount (ส่วนลดท้ายบิล) is entered: baht or % of the lines. */
export type DiscountType = 'amount' | 'pct'

/** When the bill discount applies: off the lines before VAT, or off the total after VAT. */
export type DiscountTiming = 'before' | 'after'

/** A document's totals in the given VAT mode, after a bill discount — the API works it the same way.
 *  Before VAT: the discount comes off the lines, shared across them pro rata.
 *  After VAT: VAT is on the full lines and the discount (a % of the total with VAT) comes off the total.
 *  `base` is what the discount comes off (รวมเป็นเงิน). */
export function documentTotals(codes: VatCode[], lines: { amount: number; codeId?: string | null }[], mode: VatMode,
                               discountValue = 0, discountType: DiscountType = 'amount', timing: DiscountTiming = 'before') {
  const sum = lines.reduce((s, l) => s + l.amount, 0)
  const value = Number.isFinite(discountValue) ? Math.max(discountValue, 0) : 0
  const discountOf = (base: number) =>
    Math.min(Math.round((discountType === 'pct' ? base * Math.min(value, 100) / 100 : value) * 100) / 100, base)
  if (timing === 'after') {
    const vat = sumLineVat(codes, lines, mode === 'inclusive')
    const [subtotal, gross] = mode === 'inclusive' ? [sum - vat, sum] : [sum, sum + vat]
    const discount = discountOf(gross)
    return { lines: sum, base: gross, discount, subtotal, vat, total: gross - discount }
  }
  const discount = discountOf(sum)
  const factor = sum ? (sum - discount) / sum : 0
  const vat = sumLineVat(codes, lines.map(l => ({ ...l, amount: l.amount * factor })), mode === 'inclusive')
  const net = sum - discount
  return mode === 'inclusive'
    ? { lines: sum, base: sum, discount, subtotal: net - vat, vat, total: net }
    : { lines: sum, base: sum, discount, subtotal: net, vat, total: net + vat }
}

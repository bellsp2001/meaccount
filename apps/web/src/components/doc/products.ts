import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

// Document lines can pick an item from สินค้า/บริการ (inventory products): picking one fills the
// line's description, unit and price. The description stays free text, so any line can still be typed.
export interface ProductOption {
  id: string; sku: string; name: string; unit: string
  sale_price: number; avg_cost: number; is_active: boolean; track_stock: boolean
}

/** Active products and services (same query as the สินค้า/บริการ page with no filter). */
export function useProducts() {
  return useQuery<ProductOption[], Error, ProductOption[]>({
    queryKey: ['products', '', false],
    queryFn: async () => (await api.get('/api/v1/inventory/products?low_stock_only=false')).data,
    select: ps => ps.filter(p => p.is_active),
  })
}

/** The product a typed or picked description names — by exact name or SKU. */
export function findProduct(products: ProductOption[], text: string): ProductOption | undefined {
  const t = text.trim()
  return t ? products.find(p => p.name === t || p.sku === t) : undefined
}

/** The price a picked product puts on a line: selling price on sales documents, average cost on purchases. */
export const productPrice = (p: ProductOption, side: 'sales' | 'purchase') =>
  Number(side === 'sales' ? p.sale_price : p.avg_cost) || 0

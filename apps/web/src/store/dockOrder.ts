import { create } from 'zustand'

// Persisted custom ordering of dock apps, stored as an array of nav `to` keys.
const STORAGE_KEY = 'dock_order'

interface DockOrderState {
  order: string[]
  setOrder: (order: string[]) => void
  reset: () => void
}

function getStored(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export const useDockOrder = create<DockOrderState>((set) => ({
  order: getStored(),
  setOrder: (order) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
    set({ order })
  },
  reset: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ order: [] })
  },
}))

/**
 * Reorder `items` to follow the stored key order. Keys present in `order` come
 * first (in that order); anything not yet in `order` keeps its original position
 * at the end, so newly added apps still appear.
 */
export function applyOrder<T extends { to: string }>(items: T[], order: string[]): T[] {
  const byTo = new Map(items.map((i) => [i.to, i]))
  const result: T[] = []
  for (const to of order) {
    const it = byTo.get(to)
    if (it) {
      result.push(it)
      byTo.delete(to)
    }
  }
  for (const it of items) if (byTo.has(it.to)) result.push(it)
  return result
}

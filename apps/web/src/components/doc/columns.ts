import { useState } from 'react'

// Which columns a document list shows. The choice is a per-browser convenience, kept in
// localStorage per list ("cols:<key>"); without storage the defaults are used.
export interface ColumnDef {
  id: string
  label: string
  required?: boolean        // always shown (e.g. the document number)
  defaultHidden?: boolean   // off until the user turns it on
}

export interface Columns {
  defs: ColumnDef[]
  on: (id: string) => boolean
  toggle: (id: string) => void
  reset: () => void
  visible: ColumnDef[]      // the shown columns, in table order
}

export function useColumns(storageKey: string, defs: ColumnDef[]): Columns {
  const key = `cols:${storageKey}`
  const defaults = defs.filter(d => !d.defaultHidden).map(d => d.id)
  const [shown, setShown] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (Array.isArray(saved)) return saved.filter((x): x is string => typeof x === 'string')
    } catch { /* no storage or bad value: use the defaults */ }
    return defaults
  })
  const save = (next: string[]) => {
    setShown(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* not persisted; still applies */ }
  }
  const on = (id: string) => !!defs.find(d => d.id === id)?.required || shown.includes(id)
  return {
    defs, on,
    toggle: id => save(on(id) ? shown.filter(x => x !== id) : [...shown, id]),
    reset: () => save(defaults),
    visible: defs.filter(d => on(d.id)),
  }
}

import { create } from 'zustand'

export interface Company {
  id: string; code: string; name: string; name_en?: string
  tax_id?: string; is_active: boolean; parent_company_id?: string
}

interface CompanyState {
  currentId: string | null
  setCurrent: (id: string) => void
}

const KEY = 'current_company'

export const useCompanyStore = create<CompanyState>(() => ({
  currentId: localStorage.getItem(KEY),
  setCurrent: (id) => {
    localStorage.setItem(KEY, id)
    useCompanyStore.setState({ currentId: id })
  },
}))

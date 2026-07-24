import { useEffect } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: number
}

export function Modal({ open, onClose, title, children, width = 480 }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-[#0D1018] border border-[#1E2A3A] rounded-2xl shadow-2xl"
        style={{ width: '100%', maxWidth: width }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#151C28]">
          <h3 className="font-bold text-base text-[#DDE3EE]">{title}</h3>
          <button onClick={onClose} className="text-[#4A5A70] hover:text-[#DDE3EE] text-xl leading-none cursor-pointer bg-transparent border-none">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

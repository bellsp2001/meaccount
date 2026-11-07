import type { CSSProperties } from 'react'

// Shared pieces of the document card (DocCard): status badges in its header and the
// buttons in its footer, so every document type looks the same.

export function docBadge(color: string): CSSProperties {
  return { fontSize:11, fontWeight:700, color, background:`${color}18`, border:`1px solid ${color}35`, padding:'3px 10px', borderRadius:10, whiteSpace:'nowrap' }
}

// Secondary action in the footer (post, send, print, cancel…).
export function docActionBtn(color: string): CSSProperties {
  return { fontSize:12, padding:'9px 14px', borderRadius:9, border:`1px solid ${color}50`, background:`${color}12`, color, cursor:'pointer', fontWeight:700, whiteSpace:'nowrap' }
}

// Main action in the footer (save, edit).
export function docPrimaryBtn(from: string, to: string = from): CSSProperties {
  return { background:`linear-gradient(135deg,${from},${to})`, color:'#fff', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 22px', cursor:'pointer', whiteSpace:'nowrap' }
}

export const docCancelBtn: CSSProperties = {
  padding:'9px 20px', borderRadius:9, border:'1px solid var(--color-border-strong)', background:'transparent',
  color:'var(--color-text-tertiary)', cursor:'pointer', fontWeight:600, fontSize:13,
}

// The footer row under the form: actions on the right, a note pushed to the left.
export const docFooter: CSSProperties = {
  display:'flex', gap:8, justifyContent:'flex-end', alignItems:'center', flexWrap:'wrap', paddingTop:16, borderTop:'1px solid var(--color-border)',
}

export const docLockedNote: CSSProperties = { marginRight:'auto', fontSize:11, color:'var(--color-dim)' }

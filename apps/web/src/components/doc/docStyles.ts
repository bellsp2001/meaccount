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

// "← กลับ" above a document card or form panel — a real button, not a bare text link.
export const docBackBtn: CSSProperties = {
  alignSelf:'flex-start', display:'inline-flex', alignItems:'center', gap:6,
  background:'color-mix(in srgb, var(--color-accent) 12%, var(--color-card))',
  border:'1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)', borderRadius:9,
  padding:'8px 16px', fontSize:13, fontWeight:700, color:'var(--color-accent)', cursor:'pointer',
  boxShadow:'0 1px 3px rgba(0,0,0,.08)', transition:'background .15s, color .15s',
}

export const docLockedNote: CSSProperties = { marginRight:'auto', fontSize:11, color:'var(--color-dim)' }

// A footer button that can't be used yet (e.g. confirm before a สมุดบันทึก is chosen).
export const docDisabled: CSSProperties = { opacity:0.45, cursor:'not-allowed' }

// Shown in the footer when a document needs a สมุดบันทึก before it can be confirmed.
export const docNeedsBookNote: CSSProperties = { marginRight:'auto', fontSize:11, color:'#C77700' }

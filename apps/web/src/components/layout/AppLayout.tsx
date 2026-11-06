import { Outlet } from 'react-router-dom'
import { TopBar } from './TopBar'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  return (
    // isolation: both panels' shadow layers (.chrome-panel) share this one stacking context.
    // The content column must not clip, or the top bar's shadow is cut off beside the sidebar.
    <div style={{ display: 'flex', gap: 14, height: '100vh', overflow: 'hidden', padding: 14, background: 'transparent', isolation: 'isolate' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TopBar />
        {/* The scroller clips at its own edge, so it extends into the surrounding gaps to give card
            shadows room to fade; the top is masked so content fades out instead of being cut. */}
        <main className="content-scroll" style={{
          flex: 1, minHeight: 0, overflowY: 'auto', margin: -14, padding: '14px 18px 40px 14px',
        }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

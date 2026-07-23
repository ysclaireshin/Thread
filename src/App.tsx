import { useEffect } from 'react'
import { Topbar } from './components/Topbar'
import { SolarSystem } from './components/SolarSystem'
import { SidePanel } from './components/SidePanel'
import { LinearView } from './components/LinearView'
import { MapView } from './components/MapView'
import { useStore, hydrateFromCloud } from './store'

export default function App() {
  const viewMode = useStore(s => s.viewMode)
  const projectId = useStore(s => s.projectId)
  const activateFlow = useStore(s => s.activateFlow)
  const fadeFlowGlow = useStore(s => s.fadeFlowGlow)
  const hideFlowIndicator = useStore(s => s.hideFlowIndicator)

  // ─── Cloud hydration ────────────────────────────────────────────────────
  // Once on mount: sign in anonymously and pull this user's projects, merging
  // newest-wins with local state. No-op when Supabase isn't configured, so the
  // app still runs fully local-only.
  useEffect(() => {
    void hydrateFromCloud()
  }, [])

  // ─── Flow activation ────────────────────────────────────────────────────
  // Runs automatically whenever a project loads (initial mount + project switch).
  // Glow greets for 8s then fades; the ▶ Flow indicator lingers for 10s.
  useEffect(() => {
    activateFlow()
    const glowTimer = setTimeout(fadeFlowGlow, 8000)
    const indicatorTimer = setTimeout(hideFlowIndicator, 10000)
    return () => { clearTimeout(glowTimer); clearTimeout(indicatorTimer) }
  }, [projectId, activateFlow, fadeFlowGlow, hideFlowIndicator])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--canvas)', color: 'var(--text-primary)', overflow: 'hidden' }}>
      <Topbar onAddNode={() => {}} />
      <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {viewMode === 'system' ? (
          <>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <SolarSystem />
              <SidePanel />
            </div>
            <div style={{ position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--text-10)', color: 'var(--text-tertiary)', pointerEvents: 'none', fontFamily: 'var(--font-mono)', letterSpacing: '0.03em' }}>
              scroll to zoom · click object to inspect · click planet to focus
            </div>
          </>
        ) : viewMode === 'linear' ? (
          <LinearView />
        ) : (
          <MapView />
        )}
      </div>
    </div>
  )
}

import { SolarSystem } from './SolarSystem'
import { SidePanel } from './SidePanel'

// ─── System view ──────────────────────────────────────────────────────────────
// Extracted verbatim from App.tsx's former inline System branch (structural
// refactor only - Step 1 of the workspace/view-slot redesign, no behavior or
// visual change). The solar-system canvas and its SidePanel are still rendered
// inside the SAME position:relative wrapper App.tsx already provides around
// this whole branch, so SidePanel's absolute positioning resolves against the
// identical ancestor it always has.
export function SystemView() {
  return (
    <>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <SolarSystem />
        <SidePanel />
      </div>
      <div style={{ position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--text-10)', color: 'var(--text-tertiary)', pointerEvents: 'none', fontFamily: 'var(--font-mono)', letterSpacing: '0.03em' }}>
        scroll to zoom · click object to inspect · click planet to focus
      </div>
    </>
  )
}

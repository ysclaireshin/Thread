import { SolarSystem } from './SolarSystem'

// ─── System view ──────────────────────────────────────────────────────────────
// The solar-system canvas + its usage hint. SidePanel is no longer mounted
// here (Step 3 of the workspace/view-slot redesign) - it's consolidated to a
// single Workspace-level mount so arbitrary two-view combinations can't end
// up with more than one SidePanel active at once. The hint text is
// positioned absolutely against ViewSlot's own position:relative wrapper, so
// it stays centered within THIS view's own pane rather than the whole
// workspace once two slots are on screen.
export function SystemView() {
  return (
    <>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <SolarSystem />
      </div>
      <div style={{ position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--text-10)', color: 'var(--text-tertiary)', pointerEvents: 'none', fontFamily: 'var(--font-mono)', letterSpacing: '0.03em' }}>
        scroll to zoom · click object to inspect · click planet to focus
      </div>
    </>
  )
}

import { useRef, useState, type ComponentType } from 'react'
import { useStore, type ViewKind } from '../store'
import { MapView } from './MapView'
import { SystemView } from './SystemView'
import { TextView } from './TextView'
import { NodesView } from './NodesView'
import { SidePanel } from './SidePanel'
import { ViewSlot } from './ViewSlot'
import { SplitDivider } from './SplitDivider'

// TextView/NodesView read/write highlightedNodeId from the store directly
// (see store.ts), so - unlike Step 2's StandaloneTextView/StandaloneNodesView
// wrappers - they need no props at all and can go straight into the registry.
const VIEW_REGISTRY: Record<ViewKind, ComponentType> = {
  system: SystemView,
  map: MapView,
  text: TextView,
  nodes: NodesView,
}

// ─── Workspace ────────────────────────────────────────────────────────────────
// Registry-driven renderer that replaces App.tsx's old ternary. Supports
// exactly 1 or 2 active slots (store.setWorkspaceSlots enforces this via
// normalizeSlots), each independently holding any ViewKind - Text and Nodes
// are now genuinely independent slots, not a hardcoded pairing. Step 3 of the
// workspace/view-slot redesign; the view picker/drag-and-drop UI for freely
// assigning views to slots is a later step - today only Topbar's
// System/Linear/Map toggle can change what's active, and it can only ever
// produce ['system'], ['map'], or ['text','nodes'].
//
// SidePanel mounts exactly once here, EXCEPT when Map is one of the active
// slots. Map's own internal layout already toggles between its
// AnalyticsPanel and a SidePanel (with the Connect-to-node picker wired to
// its own edge-mutation callbacks) in its own right column, in-flow rather
// than floating - that behavior and its connect/edge functionality are left
// completely untouched. Mounting a second, generic SidePanel here whenever
// Map is active would either duplicate it or fight over the same
// store.selectedId, so Workspace defers to Map's own copy in that case and
// only supplies the floating one for combinations that don't already own one.
export function Workspace() {
  const slots = useStore(s => s.workspace.slots)
  const storedRatio = useStore(s => s.workspace.splitRatio)
  const setSplitRatio = useStore(s => s.setSplitRatio)
  const containerRef = useRef<HTMLDivElement>(null)
  // Live drag position, kept out of the store until the gesture ends so every
  // pixel of movement doesn't trigger a localStorage/cloud-sync write (see
  // SplitDivider).
  const [liveRatio, setLiveRatio] = useState<number | null>(null)
  const ratio = liveRatio ?? storedRatio

  const showGenericSidePanel = !slots.includes('map')

  if (slots.length === 1) {
    const Component = VIEW_REGISTRY[slots[0]]
    return (
      <>
        <ViewSlot><Component /></ViewSlot>
        {showGenericSidePanel && <SidePanel />}
      </>
    )
  }

  const [firstKind, secondKind] = slots
  const First = VIEW_REGISTRY[firstKind]
  const Second = VIEW_REGISTRY[secondKind]

  return (
    <>
      <div ref={containerRef} style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ViewSlot width={`${ratio * 100}%`}><First /></ViewSlot>
        <SplitDivider
          containerRef={containerRef}
          onDrag={setLiveRatio}
          onDragEnd={r => { setLiveRatio(null); setSplitRatio(r) }}
        />
        <ViewSlot width={`${(1 - ratio) * 100}%`}><Second /></ViewSlot>
      </div>
      {showGenericSidePanel && <SidePanel />}
    </>
  )
}

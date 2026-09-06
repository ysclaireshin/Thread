import { useState, type ComponentType } from 'react'
import { useStore, type ViewKind } from '../store'
import { LinearView } from './LinearView'
import { MapView } from './MapView'
import { SystemView } from './SystemView'
import { TextView } from './TextView'
import { NodesView } from './NodesView'
import { ViewSlot } from './ViewSlot'

// ─── Standalone wrappers ────────────────────────────────────────────────────
// TextView/NodesView normally receive a highlightedNodeId lifted by LinearView
// (see LinearView.tsx) so an anchor click in one highlights/scrolls to a row
// in the other. Mounted alone in a single-view slot there is no sibling to
// sync with, so each just manages its own throwaway local copy. Nothing in
// the app reaches these yet - the only two-view configuration in use today
// (Topbar's "Linear" button) still renders through LinearView, unchanged, via
// the special case below - but they make VIEW_REGISTRY honestly total over
// ViewKind, ready for when Text/Nodes become independently placeable slots.
function StandaloneTextView() {
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  return <TextView highlightedNodeId={highlightedNodeId} onHighlight={setHighlightedNodeId} />
}

function StandaloneNodesView() {
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  return <NodesView highlightedNodeId={highlightedNodeId} onHighlight={setHighlightedNodeId} />
}

const VIEW_REGISTRY: Record<ViewKind, ComponentType> = {
  system: SystemView,
  map: MapView,
  text: StandaloneTextView,
  nodes: StandaloneNodesView,
}

// ─── Workspace ────────────────────────────────────────────────────────────────
// Replaces App.tsx's old ternary on viewMode. Registry-driven: each active
// slot's ViewKind is looked up in VIEW_REGISTRY and rendered. Step 2 of the
// workspace/view-slot redesign - the workspace still only ever holds ONE
// active configuration at a time (no draggable divider, no view picker, no
// user-composable slots yet), so this is a like-for-like replacement of the
// old 3-way viewMode switch, not a new multi-pane feature.
//
// The one existing configuration that already contains two ViewKinds -
// Topbar's "Linear" button, which sets slots to ['text', 'nodes'] - still
// renders through the pre-existing LinearView composition (unchanged from
// the prior extraction step) rather than mounting TextView/NodesView
// independently here, since LinearView already owns the cross-view highlight
// state and the single SidePanel mount that behavior must be preserved
// exactly. Splitting that pairing into two truly independent slots (with a
// resizable divider) is a later step.
export function Workspace() {
  const slots = useStore(s => s.workspace.slots)

  if (slots.length === 2 && slots.includes('text') && slots.includes('nodes')) {
    return <LinearView />
  }

  return (
    <>
      {slots.map(kind => {
        const Component = VIEW_REGISTRY[kind]
        return (
          <ViewSlot key={kind}>
            <Component />
          </ViewSlot>
        )
      })}
    </>
  )
}

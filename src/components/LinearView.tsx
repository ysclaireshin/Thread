import { useState } from 'react'
import { TextView } from './TextView'
import { NodesView } from './NodesView'
import { SidePanel } from './SidePanel'

// ─── LinearView ───────────────────────────────────────────────────────────────
// Composes TextView (draft editor) + NodesView (outline) side by side, exactly
// as the single monolithic LinearView used to render its two halves inline.
// This is Step 1 of the workspace/view-slot redesign - a structural extraction
// only. highlightedNodeId is the one piece of state genuinely shared between
// the two halves (an anchor click in Text highlights + scrolls to a row in
// Nodes, and vice versa), so it stays lifted here rather than moving into
// either view.
export function LinearView() {
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TextView highlightedNodeId={highlightedNodeId} onHighlight={setHighlightedNodeId} />
      <NodesView highlightedNodeId={highlightedNodeId} onHighlight={setHighlightedNodeId} />
      <SidePanel />
    </div>
  )
}

import { runTraceScan, type TraceConnection, type TraceScanResult } from './trace'
import { runProbe } from './probe'
import type { ThreadNode, ThreadEdge } from '../types'

export type IntelligenceInput = {
  context: 'linear_editor_selection' | 'map_node_selection' | 'map_pattern_scan'
  nodes?: ThreadNode[]
  edges?: ThreadEdge[]
  selectedText?: string
  nodeLabel?: string
  nodeDescription?: string
  nodeOrganizer?: string
  dismissedPairs?: string[]
  deep?: boolean
  strict?: boolean
}

// Discriminated on `kind` so callers that branch on it (MapView) get
// `connections` narrowed to a real array in the results branch, while callers
// that only read `probe` (SidePanel) still see it on both variants.
export type IntelligenceOutput =
  | { kind: 'empty'; connections?: undefined; probe: string | null; response: string }
  | { kind: 'results'; connections: TraceConnection[]; probe: string | null; response: string }

export async function runIntelligence(
  input: IntelligenceInput
): Promise<IntelligenceOutput> {
  let traceResult: TraceScanResult | null = null
  let probeResult: string | null = null

  // TODO:
  // Add AI routing logic here:
  // "Should Thread use Trace, Probe, or both?"

  if (input.nodes && input.edges) {
    traceResult = await runTraceScan({
      nodes: input.nodes,
      edges: input.edges,
      dismissedPairs: input.dismissedPairs ?? [],
      deep: input.deep ?? false,
      strict: input.strict ?? false,
    })
  }

  if (input.context === 'linear_editor_selection' && input.selectedText) {
    probeResult = await runProbe({
      context: 'linear_editor_selection',
      selectedText: input.selectedText,
    })
  } else if (input.context === 'map_node_selection' && input.nodeLabel) {
    probeResult = await runProbe({
      context: 'map_node_selection',
      nodeLabel: input.nodeLabel,
      nodeDescription: input.nodeDescription ?? '',
      nodeOrganizer: input.nodeOrganizer ?? '',
    })
  }

  const response = 'Thread intelligence completed analysis.'
  if (traceResult && traceResult.kind === 'results') {
    return { kind: 'results', connections: traceResult.connections, probe: probeResult, response }
  }
  return { kind: 'empty', probe: probeResult, response }
}

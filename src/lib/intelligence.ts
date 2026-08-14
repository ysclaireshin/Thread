import { runTraceScan, type TraceConnection, type TraceScanResult } from './trace'
import { runProbe } from './probe'
import { aiFetch } from './aiFetch'
import type { ThreadNode, ThreadEdge } from '../types'

export type IntelligenceMode = 'trace' | 'probe' | 'both' | 'none'

export type IntelligenceInput = {
  context: 'linear_editor_selection' | 'map_node_selection' | 'map_pattern_scan'
  mode?: IntelligenceMode
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

// Ask Thread's own AI which analysis is worth running for this input, rather
// than always running trace whenever nodes/edges are present. Falls back to
// the caller-supplied `mode` (or 'both' when trace-capable input is present,
// 'probe' when only a selection/node is) if the routing call fails or
// returns something unparseable - callers must still get a result.
async function decideMode(input: IntelligenceInput): Promise<IntelligenceMode> {
  const fallback: IntelligenceMode =
    input.mode ?? (input.nodes && input.edges ? 'both' : 'probe')

  try {
    const res = await aiFetch('/api/chat', {
      system: [{
        type: 'text',
        text: `You are Thread's overall intelligence.

Your job is to decide what kind of analysis Thread should perform based on the current context.

Choose exactly one:
- "trace" — find meaningful connections between nodes
- "probe" — identify an assumption, tension, or question
- "both" — when both types of analysis are useful
- "none" — when neither is appropriate

Return ONLY valid JSON:
{"mode":"trace"}
{"mode":"probe"}
{"mode":"both"}
{"mode":"none"}`,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    })
    const data = await res.json()
    const text = ((data?.content ?? []) as { type: string; text?: string }[])
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('')
      .trim()
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim())
    if (parsed?.mode === 'trace' || parsed?.mode === 'probe' || parsed?.mode === 'both' || parsed?.mode === 'none') {
      return parsed.mode
    }
  } catch (err) {
    console.warn('Intelligence: failed to parse AI routing decision', err)
  }
  return fallback
}

export async function runIntelligence(
  input: IntelligenceInput
): Promise<IntelligenceOutput> {
  let traceResult: TraceScanResult | null = null
  let probeResult: string | null = null

  const mode = await decideMode(input)

  if ((mode === 'trace' || mode === 'both') && input.nodes && input.edges) {
    traceResult = await runTraceScan({
      nodes: input.nodes,
      edges: input.edges,
      dismissedPairs: input.dismissedPairs ?? [],
      deep: input.deep ?? false,
      strict: input.strict ?? false,
    })
  }

  if (mode === 'probe' || mode === 'both') {
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
  }

  const response = 'Thread intelligence completed analysis.'
  if (traceResult && traceResult.kind === 'results') {
    return { kind: 'results', connections: traceResult.connections, probe: probeResult, response }
  }
  return { kind: 'empty', probe: probeResult, response }
}

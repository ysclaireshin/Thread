import { runTraceScan } from './trace'
import { runProbe } from './probe'

export type IntelligenceInput = {
  context: string
  nodes?: unknown[]
  edges?: unknown[]
  selectedText?: string
  nodeLabel?: string
  nodeDescription?: string
  nodeOrganizer?: string
}

export type IntelligenceOutput = {
  trace?: unknown
  probe?: unknown
  response: string
}

export async function runIntelligence(
  input: IntelligenceInput
): Promise<IntelligenceOutput> {
  let traceResult = null
  let probeResult = null

  // TODO:
  // Add AI routing logic here:
  // "Should Thread use Trace, Probe, or both?"

  if (input.nodes && input.edges) {
    traceResult = await runTraceScan({
      nodes: input.nodes,
      edges: input.edges,
      dismissedPairs: [],
      deep: false,
      strict: false,
    })
  }

if (input.selectedText || input.nodeLabel) {
  probeResult = await runProbe({
    context: input.context,
    selectedText: input.selectedText,
    nodeLabel: input.nodeLabel,
    nodeDescription: input.nodeDescription,
    nodeOrganizer: input.nodeOrganizer,
  })
}

  return {
    trace: traceResult,
    probe: probeResult,
    response:
      "Thread intelligence completed analysis.",
  }
}

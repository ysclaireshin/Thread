import { runTraceScan } from './trace'
import { runProbe } from './probe'

export type IntelligenceMode =
  | 'trace'
  | 'probe'
  | 'both'

export type IntelligenceInput = {
  context: string
  mode?: IntelligenceMode
  nodes?: unknown[]
  edges?: unknown[]
  selectedText?: string
  nodeLabel?: string
  nodeDescription?: string
  nodeOrganizer?: string
  dismissedPairs?: unknown[]
  deep?: boolean
  strict?: boolean
}

export type IntelligenceOutput = {
  kind?: 'empty' | 'results'
  connections?: unknown[]
  probe?: unknown
  response: string
}

export async function runIntelligence(
  input: IntelligenceInput
): Promise<IntelligenceOutput> {
  let traceResult = null
  let probeResult = null

  const decisionResponse = await aiFetch('/api/chat', {
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
  messages: [{
    role: 'user',
    content: JSON.stringify(input),
  }],
})

  const decisionData = await decisionResponse.json()

const decisionText = ((decisionData?.content ?? []) as { type: string; text?: string }[])
  .filter(block => block.type === 'text')
  .map(block => block.text ?? '')
  .join('')
  .trim()

  let aiMode: IntelligenceMode = input.mode ?? 'none'

try {
  const parsed = JSON.parse(decisionText)
  if (
    parsed?.mode === 'trace' ||
    parsed?.mode === 'probe' ||
    parsed?.mode === 'both' ||
    parsed?.mode === 'none'
  ) {
    aiMode = parsed.mode
  }
} catch (err) {
  console.warn('Intelligence: failed to parse AI routing decision', err)
}
  

  if ((input.mode === 'trace' || input.mode === 'both') && input.nodes && input.edges) {
  traceResult = await runTraceScan({
  nodes: input.nodes,
  edges: input.edges,
  dismissedPairs: input.dismissedPairs ?? [],
  deep: input.deep ?? false,
  strict: input.strict ?? false,
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
  ...(traceResult ?? {}),
  probe: probeResult,
  response: "Thread intelligence completed analysis.",
}

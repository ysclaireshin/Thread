// Production serverless equivalent of the `groqChatProxy` Vite middleware in
// vite.config.ts. That middleware only exists in `vite dev` / `vite preview` —
// a deployed static build has no Vite server, so without this function every
// Probe and Trace call would 404 in production.
//
// Behaviour is byte-for-byte the same contract as the dev middleware:
//   - POST only
//   - GROQ_API_KEY read SERVER-SIDE only (never VITE_-prefixed, never shipped
//     to the browser)
//   - accepts Anthropic-shaped { system, messages, max_tokens, temperature }
//   - translates Anthropic -> OpenAI/Groq on the way in
//   - reshapes Groq -> Anthropic { content: [{ type:'text', text }] } on the way
//     out, so lib/probe.ts and lib/trace.ts read data.content[0].text unchanged
//
// Set GROQ_API_KEY in the Vercel project's Environment Variables (all
// environments). Missing key -> 503, which the UI already degrades on gracefully.

import {
  type Req, type Res, send, bodyTooLarge, clampMaxTokens, authorizeAndMeter,
  resolveLlmProvider,
} from './_shared.js'

// The client sends `system` in Anthropic block-array form
//   [{ type: 'text', text: '...', cache_control: {...} }]
// (it also accepts a plain string). OpenAI/Groq wants a single string.
function systemToText(system: unknown): string {
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text?: string }).text ?? '') : ''))
      .join('')
  }
  return ''
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  // Key presence is independent of which agent — check it up front to fail fast.
  if (!resolveLlmProvider().apiKey) {
    send(res, 503, { error: 'no_api_key' })
    return
  }

  // Cheapest check first: drop oversized payloads before any network call.
  if (bodyTooLarge(req)) {
    send(res, 413, { error: 'payload_too_large' })
    return
  }

  // Session + server-side daily budget. Without this the endpoint is an open
  // relay to a metered API for anyone who finds the URL.
  const gate = await authorizeAndMeter(req)
  if (!gate.ok) {
    send(res, gate.status, { error: gate.error })
    return
  }

  // Vercel parses a JSON body automatically; tolerate a raw string too.
  let parsed: { system?: unknown; messages?: unknown; max_tokens?: number; temperature?: number; agent?: 'trace' | 'probe' | 'replay' }
  try {
    parsed = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : ((req.body ?? {}) as typeof parsed)
  } catch {
    send(res, 400, { error: 'bad_json' })
    return
  }

  // Per-task model routing: `agent` (sent by the client) picks Trace's stronger
  // model vs the clean model for Probe. `agent` is used only for selection — it
  // is never forwarded upstream.
  const provider = resolveLlmProvider(parsed.agent)

  // Anthropic -> OpenAI/Groq message array.
  const groqMessages: { role: string; content: string }[] = []
  const systemText = systemToText(parsed.system)
  if (systemText) groqMessages.push({ role: 'system', content: systemText })
  if (Array.isArray(parsed.messages)) {
    groqMessages.push(...(parsed.messages as { role: string; content: string }[]))
  }

  try {
    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
        ...provider.headers,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: groqMessages,
        // Clamped server-side: the client is untrusted and max_tokens is a
        // direct cost multiplier.
        max_tokens: clampMaxTokens(parsed.max_tokens, 1000),
        temperature: parsed.temperature ?? 0,
      }),
    })

    if (!upstream.ok) {
      const errText = await upstream.text()
      send(res, upstream.status, { error: errText })
      return
    }

    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content ?? ''

    // Groq -> Anthropic-shaped response (no client changes needed).
    send(res, 200, { content: [{ type: 'text', text }] })
  } catch {
    // No error detail to the client — internal messages can disclose
    // infrastructure. Log server-side if you need to debug.
    send(res, 502, { error: 'upstream_unreachable' })
  }
}

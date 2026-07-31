// Production serverless handler for Flow's Replay AI summary.
//
// REPOINTED FROM ANTHROPIC TO GROQ (July 2026) so the whole app runs on the
// single free Groq key — no paid Anthropic account is needed for the MVP.
// Same contract as api/chat.ts: it accepts an Anthropic-shaped request
// { system, messages, max_tokens }, translates it to OpenAI/Groq on the way in,
// and reshapes the reply back to Anthropic { content: [{ type:'text', text }] }
// on the way out, so lib/ReentryCard.tsx reads data.content[0].text unchanged.
//
// To upgrade Replay to Claude Haiku's higher-quality summaries later, revert
// this file to the Anthropic path (git history) and set ANTHROPIC_API_KEY.

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

  const provider = resolveLlmProvider()
  if (!provider.apiKey) {
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

  let parsed: { system?: unknown; messages?: unknown; max_tokens?: unknown }
  try {
    parsed = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : ((req.body ?? {}) as typeof parsed)
  } catch {
    send(res, 400, { error: 'bad_json' })
    return
  }
  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
    send(res, 400, { error: 'messages_required' })
    return
  }

  // Anthropic -> OpenAI/Groq message array.
  const groqMessages: { role: string; content: string }[] = []
  const systemText = systemToText(parsed.system)
  if (systemText) groqMessages.push({ role: 'system', content: systemText })
  groqMessages.push(...(parsed.messages as { role: string; content: string }[]))

  try {
    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
        ...provider.headers,
      },
      // Rebuilt from validated parts rather than forwarding the client body
      // verbatim, so model choice and token ceiling stay server-controlled.
      body: JSON.stringify({
        model: provider.model,
        messages: groqMessages,
        max_tokens: clampMaxTokens(parsed.max_tokens, 200, 1000),
        temperature: 0,
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
    send(res, 502, { error: 'upstream_unreachable' })
  }
}

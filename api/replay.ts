// Production serverless equivalent of the `anthropicReplayProxy` Vite middleware
// in vite.config.ts (Flow's Replay AI summary). Same reason as api/chat.ts: the
// dev middleware does not exist in a deployed build.
//
// NOTE ON KEYS: this path talks to Anthropic and needs a valid ANTHROPIC_API_KEY
// in the Vercel environment. If the key is absent (or invalid) this returns 503,
// which is the behaviour the Replay card already degrades on gracefully — Flow
// still works, it just shows no AI summary. If you'd rather Replay run on the
// free Groq tier like Probe/Trace, say so and this file can point at the Groq
// path instead; it is deliberately NOT switched silently, because that would
// change which model writes the user's session summary.

import {
  type Req, type Res, send, bodyTooLarge, clampMaxTokens, authorizeAndMeter,
} from './_shared'

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
// Pinned server-side. The client sends a `model` field, but it is IGNORED:
// forwarding it would let a caller select an expensive model on our account.
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey) {
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

  try {
    const upstream = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      // Rebuilt from validated parts rather than forwarding the client body
      // verbatim, so model choice and token ceiling stay server-controlled.
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: clampMaxTokens(parsed.max_tokens, 200, 1000),
        system: parsed.system,
        messages: parsed.messages,
      }),
    })
    const text = await upstream.text()
    res.statusCode = upstream.status
    res.setHeader('content-type', 'application/json')
    res.end(text)
  } catch {
    send(res, 502, { error: 'upstream_unreachable' })
  }
}

import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { ServerResponse } from 'node:http'
import type { IncomingMessage } from 'node:http'

// ─── LLM provider resolution (dev) ──────────────────────────────────────────
// Both dev proxies call one OpenAI-compatible upstream. Provider is chosen by
// which key is present, so switching is a .env.local change with no code edit:
//   * OPENROUTER_API_KEY set → OpenRouter (openrouter.ai) — routing, fallbacks,
//     model choice via OPENROUTER_MODEL (default: llama-3.3-70b-instruct).
//   * else GROQ_API_KEY → Groq's free llama-3.3-70b-versatile (previous default).
// Keeps the prod api/ functions in sync — mirror this there. Keys are read
// server-side only (never VITE_-prefixed).
// `model` is the clean model for Probe/Replay; `traceModel` is the stronger
// reasoning model for Trace (reasoning models leak chain-of-thought into Probe's
// terse output, so they can't be shared). The chat proxy picks per request from
// the client's `agent` field.
interface LlmProvider { name: string; apiKey: string; baseUrl: string; model: string; traceModel: string; headers: Record<string, string> }
function resolveLlmProvider(env: Record<string, string>): LlmProvider {
  const orKey = env.OPENROUTER_API_KEY
  if (orKey) {
    const base = env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free'
    return {
      name: 'openrouter',
      apiKey: orKey,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: base,
      traceModel: env.OPENROUTER_TRACE_MODEL || base,
      // OpenRouter asks for these for attribution/ranking; harmless elsewhere.
      headers: { 'HTTP-Referer': env.PUBLIC_APP_URL || 'http://localhost:5181', 'X-Title': 'Thread' },
    }
  }
  return {
    name: 'groq',
    apiKey: env.GROQ_API_KEY ?? '',
    baseUrl: 'https://api.groq.com/openai/v1',
    // llama-3.3-70b-versatile was decommissioned by Groq (returns model_not_found)
    model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
    traceModel: env.GROQ_TRACE_MODEL || env.GROQ_MODEL || 'openai/gpt-oss-120b',
    headers: {},
  }
}

// ─── Shared proxy hardening ─────────────────────────────────────────────────
// Both AI proxies below relay to a PAID upstream API, so an unbounded request
// body is a denial-of-wallet / memory-exhaustion vector: `body += chunk` with
// no cap lets one request buffer megabytes in the dev server and forward them
// upstream. 128KB is far above any legitimate Probe/Trace/Replay payload.
const MAX_BODY_BYTES = 128 * 1024

// Collect a request body with a hard size cap. Resolves null once the cap is
// exceeded (the caller has already responded 413 and the socket is destroyed).
function readCappedBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  return new Promise(resolve => {
    let body = ''
    let bytes = 0
    let aborted = false
    req.on('data', (chunk: Buffer | string) => {
      if (aborted) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_BODY_BYTES) {
        aborted = true
        res.statusCode = 413
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'payload_too_large' }))
        req.destroy()
        resolve(null)
        return
      }
      body += chunk
    })
    req.on('end', () => { if (!aborted) resolve(body) })
    req.on('error', () => { if (!aborted) { aborted = true; resolve(null) } })
  })
}

// ─── Replay AI proxy (Groq) ─────────────────────────────────────────────────
// REPOINTED FROM ANTHROPIC TO GROQ (July 2026) so local dev matches the
// deployed api/replay.ts and the whole app runs on the single free Groq key —
// no paid Anthropic key needed. Speaks Anthropic on both ends (accepts
// { system, messages, max_tokens }, returns data.content[0].text), translating
// Anthropic → Groq in and Groq → Anthropic out, so ReentryCard is unchanged.
//
// Set GROQ_API_KEY in .env.local (not VITE_-prefixed). Missing key → 503 → the
// Replay card falls back gracefully. To restore Claude-quality summaries, see
// git history for the Anthropic version and set ANTHROPIC_API_KEY.
function groqReplayProxy(): Plugin {
  let apiKey = ''
  let extraHeaders: Record<string, string> = {}
  let baseUrl = 'https://api.groq.com/openai/v1'
  let model = 'openai/gpt-oss-120b'

  const systemToText = (system: unknown): string => {
    if (typeof system === 'string') return system
    if (Array.isArray(system)) {
      return system
        .map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text?: string }).text ?? '') : ''))
        .join('')
    }
    return ''
  }

  const handler: Connect.NextHandleFunction = (req, res: ServerResponse) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
    if (!apiKey) {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'no_api_key' }))
      return
    }
    void (async () => {
      const body = await readCappedBody(req, res)
      if (body === null) return   // 413 already sent
      let parsed: { system?: unknown; messages?: unknown; max_tokens?: number; temperature?: number; agent?: 'trace' | 'probe' | 'replay' }
      try {
        parsed = JSON.parse(body || '{}')
      } catch {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'bad_json' }))
        return
      }

      // Anthropic → OpenAI/Groq message array.
      const groqMessages: { role: string; content: string }[] = []
      const systemText = systemToText(parsed.system)
      if (systemText) groqMessages.push({ role: 'system', content: systemText })
      if (Array.isArray(parsed.messages)) {
        groqMessages.push(...(parsed.messages as { role: string; content: string }[]))
      }

      try {
        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${apiKey}`,
            ...extraHeaders,
          },
          body: JSON.stringify({
            model,
            messages: groqMessages,
            max_tokens: Math.min(Math.max(1, Number(parsed.max_tokens) || 1000), 2000),
            // Groq's gpt-oss models are REASONING models: reasoning tokens count
            // against max_tokens and at the default effort consume the whole
            // budget, returning an EMPTY content string. 'low' keeps the reply
            // inside budget; harmless no-op on non-reasoning models.
            ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
            temperature: parsed.temperature ?? 0,
          }),
        })

        if (!upstream.ok) {
          const errText = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: errText }))
          return
        }

        const data = await upstream.json() as { choices?: { message?: { content?: string } }[] }
        const text = data.choices?.[0]?.message?.content ?? ''

        // Groq → Anthropic-shaped response so ReentryCard reads
        // data.content[0].text unchanged.
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ content: [{ type: 'text', text }] }))
      } catch {
        res.statusCode = 502
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'upstream_unreachable' }))
      }
    })()
  }

  return {
    name: 'groq-replay-proxy',
    config(_, { mode }) {
      const _p = resolveLlmProvider(loadEnv(mode, process.cwd(), '') as Record<string, string>)
      apiKey = _p.apiKey; baseUrl = _p.baseUrl; model = _p.model; extraHeaders = _p.headers
    },
    configureServer(server) {
      server.middlewares.use('/api/replay', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/replay', handler)
    },
  }
}

// ─── Probe / Trace proxy (Groq) ─────────────────────────────────────────────
// Groq's API is OpenAI-compatible: same endpoint/request shape, different base
// URL + key, and it's free — so Probe (scoped selection interrogation) and
// Trace (pattern scan) work without a paid Anthropic key. The key stays
// server-side; the browser only ever talks to same-origin /api/chat.
//
// Set GROQ_API_KEY in .env.local (not VITE_-prefixed). Missing key → 503.
//
// The client (probe.ts / trace.ts / the eval harness) speaks Anthropic on both
// ends: it sends { system, messages, max_tokens } and reads data.content[0].text.
// This middleware translates Anthropic → Groq on the way in and Groq → Anthropic
// on the way out, so NO client code changes are needed.
function groqChatProxy(): Plugin {
  let apiKey = ''
  let extraHeaders: Record<string, string> = {}
  let baseUrl = 'https://api.groq.com/openai/v1'
  // `model` serves Probe (clean model); `traceModel` serves Trace (stronger
  // reasoning model). Picked per request from the client's `agent` field. The
  // model the client sends in the request body is ignored on purpose.
  let model = 'openai/gpt-oss-120b'
  let traceModel = 'openai/gpt-oss-120b'

  // The client sends `system` in Anthropic block-array form
  //   [{ type: 'text', text: '...', cache_control: {...} }]
  // (it also accepts a plain string). OpenAI/Groq wants a single string, so
  // flatten either shape down to text.
  const systemToText = (system: unknown): string => {
    if (typeof system === 'string') return system
    if (Array.isArray(system)) {
      return system
        .map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text?: string }).text ?? '') : ''))
        .join('')
    }
    return ''
  }

  const handler: Connect.NextHandleFunction = (req, res: ServerResponse) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
    if (!apiKey) {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'no_api_key' }))
      return
    }
    void (async () => {
      const body = await readCappedBody(req, res)
      if (body === null) return   // 413 already sent
      let parsed: { system?: unknown; messages?: unknown; max_tokens?: number; temperature?: number; agent?: 'trace' | 'probe' | 'replay' }
      try {
        parsed = JSON.parse(body || '{}')
      } catch {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'bad_json' }))
        return
      }

      // Anthropic → OpenAI/Groq message array.
      const groqMessages: { role: string; content: string }[] = []
      const systemText = systemToText(parsed.system)
      if (systemText) groqMessages.push({ role: 'system', content: systemText })
      if (Array.isArray(parsed.messages)) {
        groqMessages.push(...(parsed.messages as { role: string; content: string }[]))
      }

      // Per-task routing: Trace gets the stronger reasoning model; everything
      // else gets the clean model. `agent` is used only here, never forwarded.
      const chosenModel = parsed.agent === 'trace' ? traceModel : model

      try {
        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${apiKey}`,
            ...extraHeaders,
          },
          body: JSON.stringify({
            model: chosenModel,
            messages: groqMessages,
            // Clamped server-side: the client is untrusted, and an unbounded
            // max_tokens is a cost-amplification lever on a relayed API.
            max_tokens: Math.min(Math.max(1, Number(parsed.max_tokens) || 1000), 2000),
            // Groq's gpt-oss models are REASONING models: reasoning tokens count
            // against max_tokens and at the default effort consume the whole
            // budget, returning an EMPTY content string. 'low' keeps the reply
            // inside budget; harmless no-op on non-reasoning models.
            ...(chosenModel.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
            temperature: parsed.temperature ?? 0,
          }),
        })

        if (!upstream.ok) {
          const errText = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: errText }))
          return
        }

        const data = await upstream.json() as { choices?: { message?: { content?: string } }[] }
        const text = data.choices?.[0]?.message?.content ?? ''

        // Groq → Anthropic-shaped response so probe.ts / trace.ts / the eval
        // harness can keep reading data.content[0].text unchanged.
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ content: [{ type: 'text', text }] }))
      } catch (err) {
        res.statusCode = 502
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'upstream_unreachable', detail: (err as Error).message }))
      }
    })()
  }

  return {
    name: 'groq-chat-proxy',
    config(_, { mode }) {
      const _p = resolveLlmProvider(loadEnv(mode, process.cwd(), '') as Record<string, string>)
      apiKey = _p.apiKey; baseUrl = _p.baseUrl; model = _p.model; traceModel = _p.traceModel; extraHeaders = _p.headers
    },
    configureServer(server) {
      server.middlewares.use('/api/chat', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/chat', handler)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), groqReplayProxy(), groqChatProxy()],
  server: { allowedHosts: true, port: 5181 },
})

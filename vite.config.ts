import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { ServerResponse } from 'node:http'

// ─── Replay AI proxy (Anthropic) ────────────────────────────────────────────
// Keeps the Anthropic key server-side. The browser POSTs to same-origin
// /api/replay (no key, no dangerous-direct-browser header); this middleware
// injects auth and forwards to the Messages API. Runs in `vite dev` and
// `vite preview`. For a production static deploy, replicate this endpoint in
// whatever backend serves the built app.
//
// Set ANTHROPIC_API_KEY in .env.local (not VITE_-prefixed, so it never reaches
// the client bundle). Missing key → 503 → the card falls back gracefully.
//
// NOTE: Probe and Trace no longer ride this handler — they were moved to the
// Groq-backed /api/chat proxy below (Anthropic requires a paid key; Groq's
// free tier keeps Probe/Trace working). Replay/Flow is untouched.
function anthropicReplayProxy(): Plugin {
  let apiKey = ''
  // Base URL is fixed to the public API on purpose — we deliberately do NOT
  // read ANTHROPIC_BASE_URL, so an ambient gateway from the surrounding shell
  // can't silently redirect the app's requests.
  const baseUrl = 'https://api.anthropic.com'

  const handler: Connect.NextHandleFunction = (req, res: ServerResponse) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
    if (!apiKey) {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'no_api_key' }))
      return
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      try {
        const upstream = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body,
        })
        const text = await upstream.text()
        res.statusCode = upstream.status
        res.setHeader('content-type', 'application/json')
        res.end(text)
      } catch {
        res.statusCode = 502
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'upstream_unreachable' }))
      }
    })
  }

  return {
    name: 'anthropic-replay-proxy',
    config(_, { mode }) {
      // loadEnv reads .env / .env.local (and matching process.env). We only pull
      // the key here — never the base URL.
      apiKey = loadEnv(mode, process.cwd(), '').ANTHROPIC_API_KEY ?? ''
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
  const baseUrl = 'https://api.groq.com/openai/v1'
  // Groq's strongest free model — comparable to Claude Haiku in speed, and the
  // best free option for the structured-JSON reasoning Trace requires. The
  // model the client sends in the request body is ignored on purpose.
  const model = 'llama-3.3-70b-versatile'

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
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      let parsed: { system?: unknown; messages?: unknown; max_tokens?: number; temperature?: number }
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
          },
          body: JSON.stringify({
            model,
            messages: groqMessages,
            max_tokens: parsed.max_tokens ?? 1000,
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
    })
  }

  return {
    name: 'groq-chat-proxy',
    config(_, { mode }) {
      apiKey = loadEnv(mode, process.cwd(), '').GROQ_API_KEY ?? ''
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
  plugins: [react(), tailwindcss(), anthropicReplayProxy(), groqChatProxy()],
  server: { allowedHosts: true, port: 5181 },
})

// ─── AI failure → human explanation ─────────────────────────────────────────
// Every AI surface used to show one generic line ("Couldn't reach the model")
// for every failure, which made a dead key, a blocked region, a missing session
// and a spent budget all look identical — undiagnosable for the user and for
// us. runProbe/runTrace throw `http-<status>`; this maps that to the actual
// cause and the actual next step.

export function explainAiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const status = /^http-(\d+)$/.exec(msg)?.[1]

  switch (status) {
    case '401':
      // Production endpoints require a Supabase session (anonymous sign-in is
      // enough). This is the guard working, not a network fault.
      return 'Not signed in. Reload the page — if it persists, anonymous sign-in may be turned off for this project.'
    case '403':
      // Groq answers 403 "Access denied. Please check your network settings."
      // for unsupported regions, VPNs, and datacenter IP ranges.
      return 'The AI provider refused the request (403). This usually means the API key is invalid, or Groq is not available on your current network or region — try disabling any VPN.'
    case '413':
      return 'That selection is too long. Try probing a shorter passage.'
    case '429':
      return "You've hit today's AI limit. Try again tomorrow."
    case '503':
      return 'AI is not configured on the server — GROQ_API_KEY is missing.'
    case '502':
      return "Couldn't reach the AI provider. Check your connection and try again."
  }
  if (msg === 'empty') return 'The model returned an empty response. Try again.'
  return "Couldn't reach the model. Try again."
}

import { useState } from 'react'
import { useStore } from '../store'
import { ORGANIZER_META } from '../types'
import { TextShimmerWave } from './core/text-shimmer-wave'
import { tryConsumeAiCall, AI_LIMIT_MESSAGE } from '../lib/aiLimit'
import { aiFetch } from '../lib/aiFetch'

// ─── Flow · Part 3/4 — the re-entry card ──────────────────────────────────────
// Sits at the top of the outline panel, above the "// current session" divider.
// Shows the user's own commitment sentence verbatim (no AI), and — only on an
// explicit ▶ Replay click — a single plain-language AI summary of the last
// session. Nothing here calls the AI automatically.

type CardMode = 'commitment' | 'loading' | 'ai'

const AI_MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You are helping a writer re-enter their work. Based on their notes and the state of their draft, write one sentence telling them what they were doing and one sentence telling them what they were stuck on or what comes next.

Rules:
- Two sentences maximum. Never more.
- Plain language only. No jargon, no productivity-speak, no motivational tone.
- Write as if finishing their own thought, not advising them from outside.
- Do not mention Thread, AI, nodes, or any tool or system.
- Do not repeat their commitment sentence back to them.
- If you cannot determine what they were stuck on from the context, say so plainly rather than inventing something.`

export function ReentryCard() {
  const { focusCommitment, focusCommitmentSession, focusDraftSnapshot, currentSession, nodes } = useStore()
  const [mode, setMode] = useState<CardMode>('commitment')
  const [aiSummary, setAiSummary] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const card: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderLeft: '3px solid var(--open)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 12px',
    margin: '8px 8px 12px 8px',
  }

  // ── Empty state: nothing saved from last time ────────────────────────────
  if (!focusCommitment) {
    return (
      <div style={card}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-disabled)', lineHeight: 1.5 }}>
          Nothing saved from last time — use Save My Place at the end of this session.
        </span>
      </div>
    )
  }

  async function runReplay() {
    setErrorMsg(null)
    // Shared daily AI cap — surfaced inline via the existing error line, no
    // API call made once the cap is hit.
    if (!tryConsumeAiCall()) {
      setErrorMsg(AI_LIMIT_MESSAGE)
      setMode('commitment')
      return
    }
    setMode('loading')

    // Nodes tagged in the session that ended with the last Save My Place.
    const prevSession = focusCommitmentSession ?? currentSession - 1
    const sessionNodes = nodes
      .filter(n => (n.session_id ?? 0) === prevSession && !n.superseded_by)
      .map(n => `- ${n.label} (${ORGANIZER_META[n.organizer].short})`)
      .join('\n') || '(none tagged)'

    const userPrompt = `Commitment from last session: ${focusCommitment}\n\n`
      + `Ideas tagged last session:\n${sessionNodes}\n\n`
      + `Last 200 words of draft at session end:\n${focusDraftSnapshot?.trim() || '(draft was empty)'}\n\n`
      + `What were they doing and what comes next?`

    try {
      // Same-origin proxy (see vite.config.ts) holds the key server-side. A
      // missing key comes back as 503 and lands in the catch below.
      // aiFetch attaches the Supabase session token; the production endpoint
      // requires it and meters the call against a server-side daily budget.
      const res = await aiFetch('/api/replay', {
        model: AI_MODEL,
        max_tokens: 200,
        // Static system prompt (identical every call) marked for prompt
        // caching; only the user message varies. Same inertness caveat as
        // Probe — see the summary note (prompt is below the cache minimum).
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
      })
      if (!res.ok) throw new Error(`http-${res.status}`)
      const data = await res.json()
      const text = (data?.content ?? [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('')
        .trim()
      if (!text) throw new Error('empty')
      setAiSummary(text)
      setMode('ai')
    } catch {
      // Never surface an error code or stack trace — just fall back to the
      // saved sentence with a plain note.
      setErrorMsg("Couldn't reach AI — your saved sentence is above.")
      setMode('commitment')
    }
  }

  function dismissAi() {
    setAiSummary('')
    setMode('commitment')
  }

  return (
    <div style={card}>
      {/* Row 1 — ▶ Last session */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: 'var(--open)', fontSize: '12px', lineHeight: 1 }}>▶</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '10px',
          color: 'var(--text-tertiary)', letterSpacing: '0.04em',
        }}>
          Last session
        </span>
      </div>

      {mode === 'loading' ? (
        <div style={{ marginTop: '6px' }}>
          <TextShimmerWave
            duration={1.2}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}
          >
            Reading your session...
          </TextShimmerWave>
        </div>
      ) : mode === 'ai' ? (
        <>
          {/* AI summary — clearly labelled so it is never mistaken for the
              user's own words, and styled distinctly (not italic). */}
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '10px',
            color: 'var(--text-tertiary)', letterSpacing: '0.04em',
            marginTop: '8px',
          }}>
            AI summary
          </span>
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: '13px',
            color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '4px',
          }}>
            {aiSummary}
          </p>
          <button
            onClick={dismissAi}
            style={{
              alignSelf: 'flex-start', marginTop: '8px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)',
              padding: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
          >
            ✕ dismiss
          </button>
        </>
      ) : (
        <>
          {/* Row 2 — the user's exact sentence, verbatim */}
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: '13px',
            color: 'var(--text-primary)', lineHeight: 1.5,
            fontStyle: 'italic', marginTop: '6px',
          }}>
            {focusCommitment}
          </p>

          {errorMsg && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              color: 'var(--tension)', marginTop: '6px',
            }}>
              {errorMsg}
            </span>
          )}

          {/* Row 3 — ▶ Replay */}
          <button
            onClick={runReplay}
            style={{
              alignSelf: 'flex-start', marginTop: '8px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 8px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              color: 'var(--text-tertiary)',
              transition: 'color var(--transition-fast), border-color var(--transition-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--open)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            ▶ Replay
          </button>
        </>
      )}
    </div>
  )
}

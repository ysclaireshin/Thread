import { useState } from 'react'
import PlayCircle from '@untitled-ui/icons-react/build/esm/PlayCircle'
import { useStore } from '../store'
import { greetingFromFocus, organizerLabel } from '../types'
import { TextShimmerWave } from './core/text-shimmer-wave'
import { tryConsumeAiCall, AI_LIMIT_MESSAGE } from '../lib/aiLimit'
import { aiFetch } from '../lib/aiFetch'

// ─── Flow · Part 3/4 - the re-entry card ──────────────────────────────────────
// Sits at the top of the outline panel, above the "// current session" divider.
// Step 5 (visual redesign): this is now the SINGLE consolidated re-entry
// surface - it absorbs what used to be a separate "// where you left off"
// line + Q/A toggle + session counter in Topbar's old greeting band. The
// headline reuses greetingFromFocus (same function, same Q/A framing that
// band used) so that toggle's behavior isn't lost, just relocated here
// alongside the rest of the re-entry UI instead of living on its own row.
// Shows the user's own commitment sentence verbatim (no AI) as the card body,
// and - only on an explicit ▶ Replay click - a single plain-language AI
// summary of the last session. Nothing here calls the AI automatically.

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
  const { focusCommitment, focusCommitmentSession, focusDraftSnapshot, currentSession, nodes, organizerLabels, greetingStyle, setGreetingStyle } = useStore()
  const [mode, setMode] = useState<CardMode>('commitment')
  const [aiSummary, setAiSummary] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const focusNode = nodes.find(n => n.current_focus)

  const card: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: '20px',
    padding: 'var(--sp-3) var(--sp-4)',
    margin: 'var(--sp-2) var(--sp-2) var(--sp-3) var(--sp-2)',
  }

  // ── Empty state: nothing saved from last time ────────────────────────────
  if (!focusCommitment) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <PlayCircle width={15} height={15} style={{ color: 'var(--text-primary)', flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 400, lineHeight: 1.2, color: 'var(--text-primary)' }}>
            where you left off
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-12)', color: 'var(--text-disabled)', lineHeight: 1.5, marginTop: '6px' }}>
          Nothing saved from last time - use Save my place at the end of this session.
        </span>
      </div>
    )
  }

  async function runReplay() {
    setErrorMsg(null)
    // Shared daily AI cap - surfaced inline via the existing error line, no
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
      .map(n => `- ${n.label} (${organizerLabel(n.organizer, { organizerLabels })})`)
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
        // Probe - see the summary note (prompt is below the cache minimum).
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
      // Never surface an error code or stack trace - just fall back to the
      // saved sentence with a plain note.
      setErrorMsg("Couldn't reach AI - your saved sentence is above.")
      setMode('commitment')
    }
  }

  function dismissAi() {
    setAiSummary('')
    setMode('commitment')
  }

  // Headline reuses the same greetingFromFocus framing the old topbar band
  // used - the Q/A toggle below still switches between its two phrasings.
  const headline = focusNode ? greetingFromFocus(focusNode, greetingStyle) : 'where you left off'

  return (
    <div style={card}>
      {/* Row 1 - ▶ where you left off: <headline> */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <PlayCircle width={15} height={15} style={{ color: 'var(--text-primary)', flexShrink: 0 }} />
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 400, lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{ color: 'var(--text-primary)' }}>where you left off: </span>
          <span style={{ color: 'var(--text-secondary)' }}>{headline}</span>
        </span>

        {/* Q / A toggle - relocated from the old topbar greeting band, now
            living alongside the one card that uses its output. */}
        {focusNode && (
          <div style={{
            display: 'flex', alignItems: 'center', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0, marginLeft: 'auto',
          }}>
            <button
              onClick={() => setGreetingStyle('question')}
              title="Phrase as a question"
              style={{
                padding: '1px 6px', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)',
                background: greetingStyle === 'question' ? 'var(--open-dim)' : 'transparent',
                color: greetingStyle === 'question' ? 'var(--open)' : 'var(--text-secondary)',
                border: 'none', cursor: 'pointer', transition: 'all var(--transition-fast)',
              }}
            >Q</button>
            <button
              onClick={() => setGreetingStyle('action')}
              title="Phrase as an action"
              style={{
                padding: '1px 6px', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)',
                background: greetingStyle === 'action' ? 'var(--core-dim)' : 'transparent',
                color: greetingStyle === 'action' ? 'var(--core)' : 'var(--text-secondary)',
                border: 'none', cursor: 'pointer', transition: 'all var(--transition-fast)',
              }}
            >A</button>
          </div>
        )}
      </div>

      {mode === 'loading' ? (
        <div style={{ marginTop: '8px' }}>
          <TextShimmerWave
            duration={1.2}
            style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-12)', color: 'var(--text-secondary)' }}
          >
            Reading your session...
          </TextShimmerWave>
        </div>
      ) : mode === 'ai' ? (
        <>
          {/* AI summary - clearly labelled so it is never mistaken for the
              user's own words, and styled distinctly (not italic). */}
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)',
            color: 'var(--text-secondary)', letterSpacing: '0.04em',
            marginTop: '8px',
          }}>
            AI summary
          </span>
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)',
            color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '4px',
          }}>
            {aiSummary}
          </p>
          <button
            onClick={dismissAi}
            style={{
              alignSelf: 'flex-start', marginTop: '8px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: 'var(--text-secondary)',
              padding: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            ✕ dismiss
          </button>
        </>
      ) : (
        <>
          {/* Row 2 - the user's exact sentence, verbatim */}
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 400,
            color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '6px',
          }}>
            {focusCommitment}
          </p>

          {errorMsg && (
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)',
              color: 'var(--tension)', marginTop: '6px',
            }}>
              {errorMsg}
            </span>
          )}

          {/* Row 3 - ▶ Replay */}
          <button
            onClick={runReplay}
            style={{
              alignSelf: 'flex-start', marginTop: '8px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 8px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)',
              color: 'var(--text-secondary)',
              transition: 'color var(--transition-fast), border-color var(--transition-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--open)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            ▶ Replay
          </button>
        </>
      )}
    </div>
  )
}

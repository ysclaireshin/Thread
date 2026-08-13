import { useEffect, useRef, useState } from 'react'
import { TextShimmerWave } from './core/text-shimmer-wave'

// Probe returned NONE: it correctly declined to invent a critique. The quiet
// line reads for 3 seconds, then fades out (300ms) and unmounts. Per Probe's
// consolidated-rules spec: this is not an error state — it is Probe being
// trustworthy about staying silent when there is no core assumption to challenge.
const NONE_VISIBLE_MS = 3000
const NONE_FADE_MS = 300

// ─── ProbeCard ───────────────────────────────────────────────────────────────
// The inline result surface for a single Probe. Not a modal - it never blocks
// other interaction; the user can ignore it and keep working until they Spawn or
// dismiss. Shared by both trigger surfaces (text selection + node selection) so
// the styling stays identical. Styling follows Probe Part 3 verbatim.

export type ProbeStatus = 'loading' | 'done' | 'error' | 'none'

// tension coral (#E06B5A) at 40% opacity for borders.
const TENSION_40 = 'rgba(224, 107, 90, 0.4)'
const TENSION_100 = 'var(--tension)'

interface ProbeCardProps {
  status: ProbeStatus
  question: string
  errorMsg?: string | null
  onSpawn: () => void
  onDismiss: () => void
}

export function ProbeCard({ status, question, errorMsg, onSpawn, onDismiss }: ProbeCardProps) {
  // Keep the latest onDismiss without making it a timer dependency - otherwise an
  // unrelated parent re-render during the window would restart the countdown.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  // The neutral NONE state is informational only - fade it out once the user has
  // had time to read it, so it never lingers over the draft. (Loading/done/error
  // states are user-driven and stay until acted on.) Fade at 3s, unmount at 3.3s.
  const [noneFading, setNoneFading] = useState(false)
  useEffect(() => {
    if (status !== 'none') { setNoneFading(false); return }
    setNoneFading(false)
    const fade = setTimeout(() => setNoneFading(true), NONE_VISIBLE_MS)
    const gone = setTimeout(() => dismissRef.current(), NONE_VISIBLE_MS + NONE_FADE_MS)
    return () => { clearTimeout(fade); clearTimeout(gone) }
  }, [status])

  if (status === 'loading') {
    // Shimmer sits in the exact spot the result will appear (inline, not modal).
    return (
      <div style={{ marginTop: '8px' }}>
        <TextShimmerWave
          duration={1.2}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--tension)' }}
        >
          Probing...
        </TextShimmerWave>
      </div>
    )
  }

  if (status === 'none') {
    // The model judged the selection sound/trivial and returned NONE. Show a
    // brief neutral line - deliberately NOT the coral result card - so an empty
    // finding reads as a correct outcome, not a failure or a false positive. It
    // fades on its own; no dismiss control, because it is not asking for a decision.
    return (
      <div
        style={{
          marginTop: '8px',
          fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)',
          opacity: noneFading ? 0 : 1,
          transition: `opacity ${NONE_FADE_MS}ms ease`,
        }}
      >
        No core assumption to challenge here.
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--tension-dim)',
        border: `1px solid ${TENSION_40}`,
        borderLeft: `2px solid ${TENSION_100}`,
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
        marginTop: '8px',
      }}
    >
      {/* Row 1 - label */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        letterSpacing: '0.04em',
        color: 'var(--tension)',
      }}>
        Probe
      </div>

      {status === 'error' ? (
        <>
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            marginTop: '4px',
          }}>
            {errorMsg || "Couldn't reach the model. Try again."}
          </p>
          <button
            onClick={onDismiss}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-tertiary)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              marginTop: '8px',
              padding: 0,
            }}
          >
            ✕ dismiss
          </button>
        </>
      ) : (
        <>
          {/* Row 2 - the AI-returned question, verbatim */}
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            color: 'var(--text-primary)',
            lineHeight: 1.5,
            marginTop: '4px',
          }}>
            {question}
          </p>

          {/* Row 3 - action */}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: '8px' }}>
            <button
              onClick={onSpawn}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--tension)',
                background: 'transparent',
                border: `1px solid ${TENSION_40}`,
                borderRadius: 'var(--radius-sm)',
                padding: '3px 10px',
                cursor: 'pointer',
                transition: 'border-color var(--transition-fast), background var(--transition-fast)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = TENSION_100; e.currentTarget.style.background = 'var(--tension-dim)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = TENSION_40; e.currentTarget.style.background = 'transparent' }}
            >
              Spawn Tension Node
            </button>
            <button
              onClick={onDismiss}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-tertiary)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                marginLeft: '10px',
                padding: 0,
              }}
            >
              ✕ dismiss
            </button>
          </div>
        </>
      )}
    </div>
  )
}

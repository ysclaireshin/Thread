import { useEffect, useRef } from 'react'
import { TextShimmerWave } from './core/text-shimmer-wave'

// How long the neutral "No significant assumption found" line stays before it
// auto-dismisses. Long enough to read, short enough not to linger over the draft.
const NONE_AUTO_DISMISS_MS = 2800

// ─── ProbeCard ───────────────────────────────────────────────────────────────
// The inline result surface for a single Probe. Not a modal — it never blocks
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
  // Keep the latest onDismiss without making it a timer dependency — otherwise an
  // unrelated parent re-render during the window would restart the countdown.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  // The neutral NONE state is informational only — auto-dismiss it once the user
  // has had time to read it, so it never lingers over the draft. (Loading/done/
  // error states are user-driven and stay until acted on.)
  useEffect(() => {
    if (status !== 'none') return
    const t = setTimeout(() => dismissRef.current(), NONE_AUTO_DISMISS_MS)
    return () => clearTimeout(t)
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
    // brief neutral line — deliberately NOT the coral result card — so an empty
    // finding reads as a correct outcome, not a failure or a false positive.
    return (
      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
          No significant assumption found
        </span>
        <button
          onClick={onDismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-disabled)', padding: 0,
          }}
        >
          ✕
        </button>
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
      {/* Row 1 — label */}
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
          {/* Row 2 — the AI-returned question, verbatim */}
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            color: 'var(--text-primary)',
            lineHeight: 1.5,
            marginTop: '4px',
          }}>
            {question}
          </p>

          {/* Row 3 — action */}
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

import { useEffect, useId, useRef, useState } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { submitFeedback } from '../lib/supabaseSync'
import { useStore } from '../store'

// Open-ended nudges shown under the "Any feedback?" label - never separate
// fields, just a rotating hint so the one textarea doesn't stare back blank.
// One is picked per time the panel opens (not per keystroke).
const PROMPTS = [
  'What almost made you close the tab?',
  "What's confusing, missing, or just annoying?",
  'What would make you come back to this tomorrow?',
  "What did you expect to happen that didn't?",
  "What's one thing you'd change right now if you could?",
]

type Status = 'idle' | 'sending' | 'sent' | 'error'

// Optional: mirrors every submission to Formspree (in addition to Supabase) so
// replies can go out from an inbox instead of the Supabase dashboard. Formspree
// treats a field literally named "email" as the reply-to address. Unset -> the
// Formspree POST is skipped and only Supabase receives the submission, same
// graceful-fallback pattern as VITE_SUPABASE_URL in lib/supabase.ts.
const FORMSPREE_ENDPOINT = import.meta.env?.VITE_FORMSPREE_ENDPOINT as string | undefined

async function submitToFormspree(message: string, email: string, context: Record<string, unknown>): Promise<boolean> {
  if (!FORMSPREE_ENDPOINT) return true   // not configured - not a failure
  try {
    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: email || undefined, message, ...context }),
    })
    return res.ok
  } catch (err) {
    console.warn('[formspree] feedback submit failed:', err)
    return false
  }
}

// A persistent edge tab (bottom-right, vertical label) that opens an accessible
// feedback dialog. Global - mounted once in App, visible from every view.
export function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [prompt, setPrompt] = useState(PROMPTS[0])

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const headingId = useId()
  const hintId = useId()
  const statusId = useId()
  const emailId = useId()

  const viewMode = useStore(s => s.viewMode)
  const projectId = useStore(s => s.projectId)

  function openPanel() {
    setPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)])
    setStatus('idle')
    setOpen(true)
  }

  function closePanel() {
    setOpen(false)
    // Return focus to the trigger - standard dialog-close behavior for
    // keyboard and screen-reader users.
    triggerRef.current?.focus()
  }

  // Focus the textarea on open; trap Tab inside the panel; Escape closes.
  useEffect(() => {
    if (!open) return
    textareaRef.current?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePanel()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, textarea, [href], input, select, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = message.trim()
    const trimmedEmail = email.trim()
    if (!trimmed || status === 'sending') return
    setStatus('sending')
    const context = { prompt, viewMode, projectId, url: window.location.href, email: trimmedEmail || null }
    // Supabase is the source of truth (source of "did this submission land");
    // Formspree is a best-effort mirror for the reply-by-email workflow, so its
    // failure alone doesn't fail the user-facing submit.
    const [supaOk] = await Promise.all([
      submitFeedback(trimmed, context),
      submitToFormspree(trimmed, trimmedEmail, { prompt, viewMode, url: window.location.href }),
    ])
    if (supaOk) {
      setStatus('sent')
      setMessage('')
      setEmail('')
      // Give the confirmation a moment to register before auto-closing.
      window.setTimeout(() => { setOpen(false) }, 1400)
    } else {
      setStatus('error')
    }
  }

  return (
    <>
      {/* Trigger - fixed edge tab, mid-right so it never collides with the
          Save-my-place / Scan-for-Patterns controls anchored to the corners. */}
      <button
        ref={triggerRef}
        onClick={openPanel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? headingId : undefined}
        style={{
          position: 'fixed',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%) rotate(180deg)',
          writingMode: 'vertical-rl',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRight: 'none',
          borderRadius: 'var(--radius-md) 0 0 var(--radius-md)',
          padding: '12px 7px',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-12)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          zIndex: 70,
        }}
      >
        <MessageSquare size={13} style={{ transform: 'rotate(180deg)' }} />
        Feedback
      </button>

      {open && (
        <>
          {/* Backdrop - click to dismiss */}
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 79 }}
            onClick={closePanel}
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            style={{
              position: 'fixed',
              right: '20px',
              bottom: '20px',
              width: 'min(360px, calc(100vw - 40px))',
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '16px',
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              zIndex: 80,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' }}>
              <label
                id={headingId}
                htmlFor={`${headingId}-textarea`}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-15)',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                }}
              >
                Any feedback?
              </label>
              <button
                onClick={closePanel}
                aria-label="Close feedback form"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: '2px',
                  flexShrink: 0,
                }}
              >
                <X size={15} />
              </button>
            </div>

            <p
              id={hintId}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-12)',
                color: 'var(--text-tertiary)',
                lineHeight: 1.5,
                margin: '0 0 10px',
                fontStyle: 'italic',
              }}
            >
              {prompt}
            </p>

            <form onSubmit={handleSubmit}>
              <label
                htmlFor={emailId}
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-11)',
                  color: 'var(--text-tertiary)',
                  marginBottom: '4px',
                }}
              >
                Email <span style={{ color: 'var(--text-disabled)' }}>(optional - only if you want a reply)</span>
              </label>
              <input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-13)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 10px',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  marginBottom: '10px',
                }}
              />

              <textarea
                id={`${headingId}-textarea`}
                ref={textareaRef}
                value={message}
                onChange={e => setMessage(e.target.value)}
                aria-describedby={hintId}
                placeholder="Write anything - a bug, a thought, a complaint..."
                rows={5}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-13)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  resize: 'vertical',
                  marginBottom: '12px',
                }}
              />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  id={statusId}
                  role="status"
                  aria-live="polite"
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-12)',
                    color: status === 'error' ? 'var(--tension)' : 'var(--core)',
                  }}
                >
                  {status === 'sent' ? 'Thanks - got it.' : status === 'error' ? "Couldn't send - try again." : ''}
                </span>

                <button
                  type="submit"
                  disabled={!message.trim() || status === 'sending'}
                  style={{
                    background: message.trim() ? 'var(--core-mid)' : 'var(--surface-2)',
                    border: `1px solid ${message.trim() ? 'var(--core)' : 'var(--border)'}`,
                    color: message.trim() ? 'var(--core)' : 'var(--text-disabled)',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-13)',
                    padding: '6px 14px',
                    cursor: message.trim() && status !== 'sending' ? 'pointer' : 'default',
                  }}
                >
                  {status === 'sending' ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  )
}

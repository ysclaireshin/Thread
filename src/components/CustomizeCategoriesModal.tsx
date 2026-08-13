import { useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { ORGANIZER_META, type Organizer, type ThreadProject } from '../types'

interface Props { onClose: () => void }

// The three structural roles, in display order, paired with the CSS var for
// their fixed swatch color. Colors are bound to the role and never editable -
// only the shown text changes.
const ROWS: { organizer: Organizer; swatch: string }[] = [
  { organizer: 'core_idea', swatch: 'var(--core)' },
  { organizer: 'point_of_tension', swatch: 'var(--tension)' },
  { organizer: 'open_thought', swatch: 'var(--open)' },
]

export function CustomizeCategoriesModal({ onClose }: Props) {
  const { organizerLabels, setOrganizerLabels } = useStore()

  // Each input is pre-filled with the current effective label (custom, else the
  // default). Clearing an input falls that role back to its default on save.
  const [drafts, setDrafts] = useState<Record<Organizer, string>>({
    core_idea: organizerLabels?.core_idea?.short ?? ORGANIZER_META.core_idea.short,
    point_of_tension: organizerLabels?.point_of_tension?.short ?? ORGANIZER_META.point_of_tension.short,
    open_thought: organizerLabels?.open_thought?.short ?? ORGANIZER_META.open_thought.short,
  })

  function save() {
    const next: NonNullable<ThreadProject['organizerLabels']> = {}
    for (const { organizer } of ROWS) {
      const value = drafts[organizer].trim()
      // Only store a role as custom when it actually differs from the default,
      // so saving untouched inputs leaves the project on defaults (and keeps the
      // Add modal's default descriptions showing).
      if (value && value !== ORGANIZER_META[organizer].short) {
        // One name per role, used everywhere - stored as both label and short.
        next[organizer] = { label: value, short: value }
      }
    }
    setOrganizerLabels(Object.keys(next).length > 0 ? next : undefined)
    onClose()
  }

  function resetToDefaults() {
    setOrganizerLabels(undefined)
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--sp-2) var(--sp-3)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-13)',
    color: 'var(--text-primary)',
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(8,9,10,0.75)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--sp-5)',
          width: '420px',
          maxWidth: '90vw',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)', fontWeight: 500, color: 'var(--text-primary)' }}>
            Customize categories
          </span>
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: 'var(--sp-4)' }}>
          Rename these to fit your project. The colors and how they work stay the same.
        </p>

        {/* Rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {ROWS.map(({ organizer, swatch }) => (
            <div key={organizer}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: swatch, flexShrink: 0 }} />
                <input
                  style={inputStyle}
                  value={drafts[organizer]}
                  onChange={e => setDrafts(d => ({ ...d, [organizer]: e.target.value }))}
                  placeholder={ORGANIZER_META[organizer].short}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--core)'}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
                />
              </div>
              <span style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: '10px', color: 'var(--text-disabled)', marginTop: '4px', marginLeft: '14px' }}>
                default: {ORGANIZER_META[organizer].short}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--sp-5)' }}>
          <button
            onClick={resetToDefaults}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)',
              cursor: 'pointer', padding: 'var(--sp-2) 0',
            }}
          >
            Reset to defaults
          </button>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)',
                cursor: 'pointer', padding: 'var(--sp-2) var(--sp-3)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              style={{
                background: 'var(--core-mid)',
                border: '1px solid var(--core)',
                color: 'var(--core)',
                borderRadius: 'var(--radius-md)',
                fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', fontWeight: 500,
                padding: 'var(--sp-2) var(--sp-3)',
                cursor: 'pointer',
                letterSpacing: '0.03em',
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

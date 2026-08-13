import { useState, useRef } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { ORGANIZER_META, organizerLabel, type Organizer } from '../types'
import { OrganizerIcon } from './organizerIcon'

interface Props { onClose: () => void; prefillDescription?: string }

export function AddNodeModal({ onClose, prefillDescription }: Props) {
  const { nodes, addNode, organizerLabels } = useStore()
  const [organizer, setOrganizer] = useState<Organizer>('core_idea')
  // The selected passage is CONTEXT and goes into Notes only. Label starts
  // empty (autofocused below) so the user writes their own concise claim -
  // deriving it from the same text made Label and Notes identical for short
  // selections, which read as "the notes showed up as the label".
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState(prefillDescription ?? '')
  const [centrality, setCentrality] = useState(0.6)
  const [confidence, setConfidence] = useState<1 | 2 | 3>(2)
  const [parentId, setParentId] = useState('')
  // Shows the "Label is required" hint after a submit attempt with an empty label.
  const [showLabelHint, setShowLabelHint] = useState(false)
  const labelRef = useRef<HTMLInputElement>(null)

  const planets = nodes.filter(n => n.organizer === 'core_idea' && n.centrality >= 0.3)

  // Default descriptions assume argument-writing. Once a category is renamed
  // they may no longer fit, so a customized role shows no description rather than
  // a mismatched one (e.g. "Most important" → "A settled claim, premise…").
  const orgDescriptions: Record<Organizer, string> = {
    core_idea: 'A settled claim, premise, or argument in your draft.',
    point_of_tension: 'An unresolved objection or complication attached to an idea.',
    open_thought: 'An active question or unsettled area still being worked out.',
  }
  const descriptionFor = (o: Organizer): string =>
    organizerLabels?.[o] ? '' : orgDescriptions[o]

  // Progress levels (1 → 3): Raw, Refined, Done.
  const progressLabels: Record<1 | 2 | 3, string> = { 1: 'Raw', 2: 'Refined', 3: 'Done' }
  const progressHints: Record<1 | 2 | 3, string> = {
    1: 'Just captured, still rough',
    2: 'Worked on, not final',
    3: 'Settled - I trust this',
  }

  function submit() {
    // Label is required (kept distinct from Notes on purpose). Instead of a
    // silently dead button, guide the user: reveal the hint and focus the field.
    if (!label.trim()) {
      setShowLabelHint(true)
      labelRef.current?.focus()
      return
    }
    const meta = ORGANIZER_META[organizer]
    addNode({
      id: `n-${Date.now()}`,
      label: label.trim(),
      description: description.trim(),
      organizer,
      centrality,
      confidence,
      parent_id: organizer === 'point_of_tension' ? (parentId || null) : null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: meta.color,
    })
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
    boxSizing: 'border-box' as const,
  }

  const sectionLabel: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-12)',
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    display: 'block',
    marginBottom: 'var(--sp-1)',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 40,
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
          width: '440px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.03em' }}>
            Add to system
          </span>
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {/* Type */}
          <div>
            <span style={sectionLabel}>Type</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
              {(Object.entries(ORGANIZER_META) as [Organizer, typeof ORGANIZER_META[Organizer]][]).map(([o, m]) => (
                <button
                  key={o}
                  onClick={() => setOrganizer(o)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)',
                    padding: 'var(--sp-2) var(--sp-3)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${organizer === o ? m.color : 'var(--border)'}`,
                    background: organizer === o ? m.colorDim : 'var(--surface-2)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-11)',
                    fontWeight: 500,
                    color: organizer === o ? m.cssVar : 'var(--text-tertiary)',
                    whiteSpace: 'nowrap',
                    marginTop: '1px',
                    flexShrink: 0,
                    minWidth: '78px',
                  }}>
                    <OrganizerIcon organizer={o} size={14} color={organizer === o ? m.color : '#5C5B58'} />
                    {organizerLabel(o, { organizerLabels })}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-12)',
                    color: organizer === o ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                    lineHeight: 1.4,
                  }}>
                    {descriptionFor(o)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Label */}
          <div>
            <span style={sectionLabel}>Label <span style={{ color: 'var(--text-disabled)' }}>· required</span></span>
            <input
              ref={labelRef}
              style={{ ...inputStyle, borderColor: showLabelHint ? 'var(--tension)' : 'var(--border)' }}
              value={label}
              onChange={e => { setLabel(e.target.value); if (showLabelHint) setShowLabelHint(false) }}
              placeholder="Short claim or question…"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
              onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--core)'}
              onBlur={e => (e.target as HTMLInputElement).style.borderColor = showLabelHint ? 'var(--tension)' : 'var(--border)'}
            />
            {showLabelHint && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--tension)', marginTop: 'var(--sp-1)' }}>
                Give it a short label to add - your Notes stay separate.
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <span style={sectionLabel}>Notes</span>
            <textarea
              style={{ ...inputStyle, resize: 'none', lineHeight: 1.6 }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Context, evidence, source…"
              onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = 'var(--core)'}
              onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border)'}
            />
          </div>

          {/* Progress */}
          <div>
            <span style={sectionLabel}>Progress</span>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              {([1, 2, 3] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setConfidence(v)}
                  style={{
                    flex: 1, padding: 'var(--sp-2)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${confidence === v ? 'var(--core)' : 'var(--border-subtle)'}`,
                    background: confidence === v ? 'var(--core-dim)' : 'var(--surface-2)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-12)',
                    fontWeight: 500,
                    color: confidence === v ? 'var(--core)' : 'var(--text-disabled)',
                    transition: 'all var(--transition-fast)',
                  }}
                  title={progressHints[v]}
                >
                  {progressLabels[v]}
                </button>
              ))}
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', marginTop: 'var(--sp-1)' }}>
              {progressHints[confidence]}
            </p>
          </div>

          {/* Priority (not for open_thought) */}
          {organizer !== 'open_thought' && (
            <div>
              <span style={sectionLabel}>
                Priority - {(centrality * 100).toFixed(0)}%
                {centrality < 0.3 && <span style={{ color: 'var(--open)', marginLeft: '8px' }}>(minor - small on the map)</span>}
              </span>
              <input
                type="range" min="0.05" max="1" step="0.05"
                value={centrality}
                onChange={e => setCentrality(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--core)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)' }}>minor</span>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)' }}>main</span>
              </div>
            </div>
          )}

          {/* Parent (Problems only) */}
          {organizer === 'point_of_tension' && planets.length > 0 && (
            <div>
              <span style={sectionLabel}>Complicates (parent)</span>
              <select
                style={{ ...inputStyle }}
                value={parentId}
                onChange={e => setParentId(e.target.value)}
              >
                <option value="">- select an idea -</option>
                {planets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', marginTop: 'var(--sp-5)' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-11)',
              cursor: 'pointer', padding: 'var(--sp-2) var(--sp-3)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            style={{
              background: label.trim() ? 'var(--core-mid)' : 'var(--surface-2)',
              border: `1px solid ${label.trim() ? 'var(--core)' : 'var(--border)'}`,
              color: label.trim() ? 'var(--core)' : 'var(--text-secondary)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-11)', fontWeight: 500,
              padding: 'var(--sp-2) var(--sp-3)',
              cursor: 'pointer',
              letterSpacing: '0.03em',
              transition: 'all var(--transition-fast)',
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { ORGANIZER_META, type Organizer } from '../types'

interface Props { onClose: () => void; prefillDescription?: string }

export function AddNodeModal({ onClose, prefillDescription }: Props) {
  const { nodes, addNode } = useStore()
  const [organizer, setOrganizer] = useState<Organizer>('core_idea')
  // The selected passage is CONTEXT and goes into Notes only. Label starts
  // empty (autofocused below) so the user writes their own concise claim —
  // deriving it from the same text made Label and Notes identical for short
  // selections, which read as "the notes showed up as the label".
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState(prefillDescription ?? '')
  const [centrality, setCentrality] = useState(0.6)
  const [confidence, setConfidence] = useState<1 | 2 | 3>(2)
  const [parentId, setParentId] = useState('')

  const planets = nodes.filter(n => n.organizer === 'core_idea' && n.centrality >= 0.3)

  const orgDescriptions: Record<Organizer, string> = {
    core_idea: 'A settled claim, premise, or argument in your draft.',
    point_of_tension: 'An unresolved objection or complication attached to a core idea.',
    open_thought: 'An active question or unsettled area still being worked out.',
  }

  const confidenceLabels: Record<1 | 2 | 3, string> = {
    1: 'Rough — might not capture this right',
    2: 'Fine — haven\'t revisited',
    3: 'Confirmed — I trust this',
  }

  function submit() {
    if (!label.trim()) return
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
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-11)',
                    fontWeight: 500,
                    color: organizer === o ? m.cssVar : 'var(--text-tertiary)',
                    whiteSpace: 'nowrap',
                    marginTop: '1px',
                    flexShrink: 0,
                  }}>
                    {m.short}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-12)',
                    color: organizer === o ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                    lineHeight: 1.4,
                  }}>
                    {orgDescriptions[o]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Label */}
          <div>
            <span style={sectionLabel}>Label</span>
            <input
              style={inputStyle}
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Short claim or question…"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
              onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--core)'}
              onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
            />
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

          {/* Confidence */}
          <div>
            <span style={sectionLabel}>Confidence</span>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              {([1, 2, 3] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setConfidence(v)}
                  style={{
                    flex: 1, padding: 'var(--sp-2)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${confidence === v ? 'var(--border)' : 'var(--border-subtle)'}`,
                    background: confidence === v ? 'var(--surface-3)' : 'var(--surface-2)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-12)',
                    color: confidence === v ? 'var(--text-secondary)' : 'var(--text-disabled)',
                    transition: 'all var(--transition-fast)',
                  }}
                  title={confidenceLabels[v]}
                >
                  {v}
                </button>
              ))}
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', marginTop: 'var(--sp-1)' }}>
              {confidenceLabels[confidence]}
            </p>
          </div>

          {/* Centrality (not for open_thought) */}
          {organizer !== 'open_thought' && (
            <div>
              <span style={sectionLabel}>
                Centrality — {(centrality * 100).toFixed(0)}%
                {centrality < 0.3 && <span style={{ color: 'var(--open)', marginLeft: '8px' }}>(renders as background star)</span>}
              </span>
              <input
                type="range" min="0.05" max="1" step="0.05"
                value={centrality}
                onChange={e => setCentrality(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--core)' }}
              />
            </div>
          )}

          {/* Parent (tensions only) */}
          {organizer === 'point_of_tension' && planets.length > 0 && (
            <div>
              <span style={sectionLabel}>Complicates (parent)</span>
              <select
                style={{ ...inputStyle }}
                value={parentId}
                onChange={e => setParentId(e.target.value)}
              >
                <option value="">— select core idea —</option>
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
            disabled={!label.trim()}
            style={{
              background: label.trim() ? 'var(--core-mid)' : 'var(--surface-2)',
              border: `1px solid ${label.trim() ? 'var(--core)' : 'var(--border)'}`,
              color: label.trim() ? 'var(--core)' : 'var(--text-disabled)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-11)', fontWeight: 500,
              padding: 'var(--sp-2) var(--sp-3)',
              cursor: label.trim() ? 'pointer' : 'default',
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

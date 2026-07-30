import { useState } from 'react'
import { X, MapPin } from 'lucide-react'
import { useStore } from '../store'

interface Props { onClose: () => void }

export function SavePlaceModal({ onClose }: Props) {
  const { nodes, addNode, setFocus, updateNode, commitSession, saveFocusCommitment } = useStore()
  const [input, setInput] = useState('')
  const [step, setStep] = useState<'ask' | 'pick'>('ask')
  const [matches, setMatches] = useState<typeof nodes>([])

  function finish() {
    // Store the user's exact sentence as the Flow commitment before the session
    // counter advances - Flow reads it back verbatim on next load.
    saveFocusCommitment(input)
    commitSession()
    onClose()
  }

  function handleAsk() {
    if (!input.trim()) return
    const q = input.toLowerCase()
    const found = nodes.filter(n =>
      !n.resolved && !n.superseded_by &&
      (n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))
    )
    if (found.length > 0) { setMatches(found.slice(0, 5)); setStep('pick') }
    else createNew()
  }

  function createNew() {
    const id = `focus-${Date.now()}`
    addNode({ id, label: input.trim(), description: input.trim(), organizer: 'open_thought', centrality: 0.7, confidence: 2, parent_id: null, current_focus: true, last_reinforced_at: new Date().toISOString(), provenance: 'human' })
    setFocus(id); finish()
  }

  function pickExisting(nodeId: string) {
    const existing = nodes.find(n => n.id === nodeId)
    updateNode(nodeId, { description: existing?.description ? existing.description + '\n\n→ ' + input.trim() : input.trim(), last_reinforced_at: new Date().toISOString() })
    setFocus(nodeId); finish()
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-2) var(--sp-3)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,9,10,0.75)' }} onClick={onClose}>
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '420px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <MapPin size={13} style={{ color: 'var(--open)' }} />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-secondary)', letterSpacing: '0.03em' }}>Save my place</span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={14} /></button>
        </div>

        {step === 'ask' && (
          <div style={{ padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              What's the next thing to figure out or write?
            </p>
            <input autoFocus style={inp} value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. Figure out the opening argument structure" onKeyDown={e => e.key === 'Enter' && handleAsk()} onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--open)'} onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
              <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', cursor: 'pointer', padding: 'var(--sp-2) var(--sp-3)' }}>Cancel</button>
              <button onClick={handleAsk} disabled={!input.trim()} style={{ background: input.trim() ? 'var(--open-dim)' : 'var(--surface-2)', border: `1px solid ${input.trim() ? 'var(--open)' : 'var(--border)'}`, color: input.trim() ? 'var(--open)' : 'var(--text-disabled)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', fontWeight: 500, padding: 'var(--sp-2) var(--sp-3)', cursor: input.trim() ? 'pointer' : 'default', letterSpacing: '0.03em' }}>Save</button>
            </div>
          </div>
        )}

        {step === 'pick' && (
          <div style={{ padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-12)', color: 'var(--text-tertiary)' }}>This might already exist - link to one, or create new:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
              {matches.map(n => (
                <button key={n.id} onClick={() => pickExisting(n.id)} style={{ textAlign: 'left', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer' }}>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)', color: 'var(--text-primary)' }}>{n.label}</div>
                  {n.description && <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.description.slice(0, 80)}</div>}
                </button>
              ))}
              <button onClick={createNew} style={{ textAlign: 'left', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--open-mid)', background: 'var(--open-dim)', cursor: 'pointer' }}>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--open)', letterSpacing: '0.03em' }}>+ Create new open thought</div>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-12)', color: 'var(--text-tertiary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{input.trim()}"</div>
              </button>
            </div>
            <button onClick={() => setStep('ask')} style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.03em', alignSelf: 'flex-start' }}>← Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

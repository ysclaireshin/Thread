import { useState } from 'react'
import { X, MapPin } from 'lucide-react'
import { useStore } from '../store'
import { ORGANIZER_META, type Organizer } from '../types'
import { runExtraction, type ProposedNode } from '../lib/extract'
import { recordExtractionMetric } from '../lib/extractionMetrics'
import { tryConsumeAiCall } from '../lib/aiLimit'

interface Props { onClose: () => void }

// The three organizer types, in legend order, for the per-row type selector.
const TYPE_ORDER: Organizer[] = ['core_idea', 'point_of_tension', 'open_thought']

// One reviewable extraction proposal. `keep` defaults to true (Stage B spec:
// default-to-keep). `origLabel`/`origType` capture the model's proposal so we can
// measure the edit rate (whether the user changed the wording or type).
interface Row extends ProposedNode {
  keep: boolean
  origLabel: string
  origType: Organizer
}

export function SavePlaceModal({ onClose }: Props) {
  const { nodes, addNode, addTextAnchor, setFocus, updateNode, commitSession, saveFocusCommitment, draftText, currentSession } = useStore()
  const [input, setInput] = useState('')
  const [step, setStep] = useState<'ask' | 'pick' | 'extract'>('ask')
  const [matches, setMatches] = useState<typeof nodes>([])
  const [extractLoading, setExtractLoading] = useState(false)
  const [rows, setRows] = useState<Row[]>([])

  // The real completion of Save My Place — writes the commitment sentence and
  // bumps the session counter, then closes. Called only after any extraction
  // review is done (or immediately when there is nothing to review).
  function finish() {
    saveFocusCommitment(input)
    commitSession()
    onClose()
  }

  // Stage B: after the user's commitment/focus is set, read this session's writing
  // and propose nodes BEFORE the modal closes. Extraction must never BLOCK Save My
  // Place: if it is rate-capped, errors, or finds nothing, we just finish() and the
  // save completes exactly as before.
  async function beginExtraction() {
    // TODO(diff-tracking): this sends the tail of the current draft as a proxy for
    // "the session's new writing". A true since-last-save diff is a follow-up
    // (would need a per-session draft baseline persisted in the store).
    const section = draftText.slice(-6000)
    if (section.trim().length < 40 || !tryConsumeAiCall()) { finish(); return }
    setStep('extract')
    setExtractLoading(true)
    try {
      const proposals = await runExtraction(section)
      if (proposals.length === 0) { finish(); return }
      setRows(proposals.map(p => ({ ...p, keep: true, origLabel: p.label, origType: p.type })))
      setExtractLoading(false)
    } catch (err) {
      // Extraction failed — do not trap the user. Complete the save silently.
      console.warn('Extract: run failed, completing Save My Place without proposals:', err)
      finish()
    }
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
    setFocus(id); beginExtraction()
  }

  function pickExisting(nodeId: string) {
    const existing = nodes.find(n => n.id === nodeId)
    updateNode(nodeId, { description: existing?.description ? existing.description + '\n\n→ ' + input.trim() : input.trim(), last_reinforced_at: new Date().toISOString() })
    setFocus(nodeId); beginExtraction()
  }

  // Confirm the review: create a node (+ text anchor) for every KEPT row, reusing
  // the exact addNode + addTextAnchor path Probe and Tab-to-tag use. Confirmed
  // nodes get provenance 'ai_proposed_confirmed'. Then record the honest
  // acceptance numbers and complete the save.
  function confirmReview() {
    const kept = rows.filter(r => r.keep)
    let edited = 0
    for (const r of kept) {
      if (r.label !== r.origLabel || r.type !== r.origType) edited++
      const id = `extract-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      addNode({
        id,
        label: r.label.trim(),
        description: '',
        organizer: r.type,
        centrality: 0.5,
        parent_id: null,
        current_focus: false,
        last_reinforced_at: new Date().toISOString(),
        provenance: 'ai_proposed_confirmed',
        confidence: 2,
      })
      // Text anchor to the source_quote span in the draft, reusing the TextAnchor
      // shape Tab-to-tag uses. If the quote can't be located verbatim (model
      // paraphrased), the node is still created — just without the visual tether.
      const start = r.source_quote ? draftText.indexOf(r.source_quote) : -1
      if (start >= 0) {
        addTextAnchor({ id: `ta-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, node_id: id, start, end: start + r.source_quote.length, text: r.source_quote })
      }
    }
    recordExtractionMetric({
      session_id: currentSession,
      nodes_proposed: rows.length,
      nodes_kept: kept.length,
      nodes_edited_before_keeping: edited,
      nodes_skipped: rows.length - kept.length,
    })
    finish()
  }

  // "Skip all" — record a zero-kept extraction (still a real data point for the
  // acceptance rate) and complete the save without creating anything.
  function skipAll() {
    recordExtractionMetric({
      session_id: currentSession,
      nodes_proposed: rows.length,
      nodes_kept: 0,
      nodes_edited_before_keeping: 0,
      nodes_skipped: rows.length,
    })
    finish()
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-2) var(--sp-3)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }
  const keptCount = rows.filter(r => r.keep).length

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,9,10,0.75)' }} onClick={onClose}>
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: step === 'extract' ? '460px' : '420px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>

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

        {step === 'extract' && (
          <div style={{ padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {extractLoading ? (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-12)', color: 'var(--text-tertiary)', padding: 'var(--sp-3) 0' }}>Reading this session for distinct ideas…</p>
            ) : (
              <>
                <div>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)', color: 'var(--text-secondary)' }}>Found {rows.length} idea{rows.length === 1 ? '' : 's'} in this session</p>
                  <p style={{ fontFamily: 'var(--font-mono, var(--font-sans))', fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Keep the ones that matter. Skip the rest.</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', maxHeight: '46vh', overflowY: 'auto' }}>
                  {rows.map((r, i) => {
                    const meta = ORGANIZER_META[r.type]
                    return (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: r.keep ? 'var(--surface-2)' : 'transparent', opacity: r.keep ? 1 : 0.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.cssVar, flexShrink: 0 }} />
                          <input
                            value={r.label}
                            onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid transparent', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)', color: 'var(--text-primary)', outline: 'none', padding: '1px 0' }}
                            onFocus={e => (e.target as HTMLInputElement).style.borderBottomColor = 'var(--border)'}
                            onBlur={e => (e.target as HTMLInputElement).style.borderBottomColor = 'transparent'}
                          />
                          <button
                            onClick={() => setRows(rs => rs.map((x, j) => j === i ? { ...x, keep: !x.keep } : x))}
                            style={{ flexShrink: 0, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', letterSpacing: '0.03em', padding: '2px 8px', borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer', border: `1px solid ${r.keep ? meta.cssMid : 'var(--border)'}`, background: r.keep ? meta.cssDim : 'transparent', color: r.keep ? meta.cssVar : 'var(--text-tertiary)' }}
                          >{r.keep ? 'Keep' : 'Skip'}</button>
                        </div>

                        {/* Type selector — three dots to fix a mis-classification before keeping. */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', paddingLeft: 16 }}>
                          {TYPE_ORDER.map(t => {
                            const tm = ORGANIZER_META[t]
                            const active = r.type === t
                            return (
                              <button
                                key={t}
                                title={tm.label}
                                onClick={() => setRows(rs => rs.map((x, j) => j === i ? { ...x, type: t } : x))}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer', border: `1px solid ${active ? tm.cssMid : 'transparent'}`, background: active ? tm.cssDim : 'transparent' }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: tm.cssVar }} />
                                <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', letterSpacing: '0.02em', color: active ? tm.cssVar : 'var(--text-tertiary)' }}>{tm.short}</span>
                              </button>
                            )
                          })}
                        </div>

                        {r.source_quote && (
                          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', lineHeight: 1.5, paddingLeft: 16, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>“{r.source_quote}”</p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', marginTop: '2px' }}>
                  <button onClick={skipAll} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', cursor: 'pointer', padding: 'var(--sp-2) var(--sp-3)', letterSpacing: '0.03em' }}>Skip all</button>
                  <button onClick={confirmReview} disabled={keptCount === 0} style={{ background: keptCount ? 'var(--open-dim)' : 'var(--surface-2)', border: `1px solid ${keptCount ? 'var(--open)' : 'var(--border)'}`, color: keptCount ? 'var(--open)' : 'var(--text-disabled)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', fontWeight: 500, padding: 'var(--sp-2) var(--sp-3)', cursor: keptCount ? 'pointer' : 'default', letterSpacing: '0.03em' }}>Add {keptCount} selected</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

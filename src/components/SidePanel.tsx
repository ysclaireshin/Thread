import { useState, useEffect } from 'react'
import { X, Target, CheckCircle, Link2, Crosshair } from 'lucide-react'
import { useStore } from '../store'
import { ORGANIZER_META, type ThreadNode } from '../types'
import { ProbeCard, type ProbeStatus } from './ProbeCard'
import { runProbe, isNoneResponse } from '../lib/probe'
import { explainAiError } from '../lib/aiError'
import { tryConsumeAiCall, AI_LIMIT_MESSAGE } from '../lib/aiLimit'

interface SidePanelProps {
  showConnect?: boolean
  allNodes?: ThreadNode[]
  onCreateEdge?: (fromId: string, toId: string) => void
  onRemoveEdge?: (id: string) => void
}

export function SidePanel({ showConnect, allNodes, onCreateEdge, onRemoveEdge }: SidePanelProps) {
  const { selectedId, nodes, edges, setSelected, updateNode, setFocus, addNode } = useStore()
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [connectSearch, setConnectSearch] = useState('')

  // ─── Probe (node-selection trigger) ───────────────────────────────────────
  const [probe, setProbe] = useState<{ status: ProbeStatus; question: string; errorMsg: string | null } | null>(null)
  // Reset the Probe surface whenever the selected node changes.
  useEffect(() => { setProbe(null) }, [selectedId])

  async function startNodeProbe() {
    const target = useStore.getState().nodes.find(n => n.id === useStore.getState().selectedId)
    if (!target) return
    if (probe?.status === 'loading') return
    // Shared daily AI cap — surface the plain message inline, no API call.
    if (!tryConsumeAiCall()) {
      setProbe({ status: 'error', question: '', errorMsg: AI_LIMIT_MESSAGE })
      return
    }
    setProbe({ status: 'loading', question: '', errorMsg: null })
    try {
      const question = await runProbe({
        context: 'map_node_selection',
        nodeLabel: target.label,
        nodeDescription: target.description,
        nodeOrganizer: target.organizer,
      })
      // Guard against a selection change during the request.
      if (useStore.getState().selectedId !== target.id) return
      // NONE → neutral "no assumption found" state, not a manufactured question.
      setProbe({ status: isNoneResponse(question) ? 'none' : 'done', question, errorMsg: null })
    } catch (err) {
      if (useStore.getState().selectedId !== target.id) return
      setProbe({ status: 'error', question: '', errorMsg: explainAiError(err) })
    }
  }

  function handleSpawnFromProbe() {
    if (!probe || probe.status !== 'done') return
    const id = `probe-${Date.now()}`
    // Node context: no tether, no automatic edge (Probe Part 4 — in Map view the
    // spawned node enters the simulation and the user decides what to connect it
    // to). provenance is ai_proposed_confirmed, NOT 'human'.
    addNode({
      id,
      label: probe.question,
      description: '',
      organizer: 'point_of_tension',
      centrality: 0.5,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'ai_proposed_confirmed',
      confidence: 2,
    })
    setProbe(null)
  }

  // Cmd+Shift+A fires the node Probe while a node is selected — but yields to an
  // active text selection (the LinearView text surface owns that case).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        if (!useStore.getState().selectedId) return
        const activeText = window.getSelection()?.toString().trim() ?? ''
        if (activeText.length >= 20) return
        e.preventDefault()
        startNodeProbe()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!selectedId) return null
  const node = nodes.find(n => n.id === selectedId)
  if (!node) return null

  const meta = ORGANIZER_META[node.organizer]

  const connections = edges
    .filter(e => e.from_id === selectedId || e.to_id === selectedId)
    .map(e => {
      const otherId = e.from_id === selectedId ? e.to_id : e.from_id
      const other = nodes.find(n => n.id === otherId)
      return { edge: e, other }
    })
    .filter(c => c.other)

  const parentNode = node.parent_id ? nodes.find(n => n.id === node.parent_id) : null

  // Nodes available to connect to (not already connected, not self)
  const connectedIds = new Set(connections.map(c => c.other!.id))
  const connectableNodes = (allNodes ?? nodes).filter(n =>
    n.id !== selectedId && !connectedIds.has(n.id) && !n.resolved && !n.superseded_by
  )
  const filteredConnectable = connectSearch.trim()
    ? connectableNodes.filter(n => n.label.toLowerCase().includes(connectSearch.toLowerCase()))
    : connectableNodes

  function saveNotes() {
    if (notesDraft !== null) {
      updateNode(node!.id, { description: notesDraft, last_reinforced_at: new Date().toISOString() })
      setNotesDraft(null)
    }
  }

  function handleResolve() {
    updateNode(node!.id, { resolved: true, last_reinforced_at: new Date().toISOString() })
    setSelected(null)
  }

  function handleRestore() {
    updateNode(node!.id, { resolved: false, superseded_by: null })
  }

  function handleConnect(targetId: string) {
    // node is guaranteed non-null past the guard above (node.id === selectedId).
    onCreateEdge?.(node!.id, targetId)
    setConnectSearch('')
    setConnectOpen(false)
  }

  const isArchived = node.resolved || !!node.superseded_by

  const sectionLabel: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-12)',
    color: 'var(--text-tertiary)',
    display: 'block',
    marginBottom: 'var(--sp-2)',
  }

  const sectionDivider: React.CSSProperties = {
    padding: 'var(--sp-3) var(--sp-4)',
    borderBottom: '1px solid var(--border-subtle)',
  }

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0,
      height: '100%', width: '320px',
      background: 'var(--surface-1)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 30, overflow: 'hidden',
    }}>
      {/* ── Header ────────────────────────────────────────────────── */}
      <div style={{ padding: 'var(--sp-4)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
          <span style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-11)',
            fontWeight: 500,
            color: meta.cssVar,
            background: meta.cssDim,
            padding: '2px var(--sp-1)',
            borderRadius: 'var(--radius-sm)',
          }}>
            {meta.short}
          </span>
          {parentNode && (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)' }}>
              → {parentNode.label.slice(0, 24)}{parentNode.label.length > 24 ? '…' : ''}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setFocus(node.id)}
            title={node.current_focus ? 'Current focus' : 'Set as focus'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--sp-1)', color: node.current_focus ? 'var(--open)' : 'var(--text-tertiary)' }}
          >
            <Target size={13} />
          </button>
          <button
            onClick={() => setSelected(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--sp-1)', color: 'var(--text-tertiary)' }}
          >
            <X size={13} />
          </button>
        </div>

        <h2 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-16)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          lineHeight: 1.3,
          letterSpacing: '-0.01em',
        }}>
          {node.label}
        </h2>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Notes ─────────────────────────────────────────────── */}
        <div style={sectionDivider}>
          <span style={sectionLabel}>notes</span>
          <textarea
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-13)',
              color: 'var(--text-secondary)',
              lineHeight: 1.65,
              boxSizing: 'border-box',
            }}
            value={notesDraft ?? node.description}
            onChange={e => setNotesDraft(e.target.value)}
            onBlur={saveNotes}
            rows={5}
            placeholder="Add notes…"
          />
        </div>

        {/* ── Probe ─────────────────────────────────────────────── */}
        {/* One targeted question about this node's core assumption. Fires only on
            an explicit click (or Cmd+Shift+A) — never automatically. */}
        <div style={sectionDivider}>
          {!probe ? (
            <button
              onClick={startNodeProbe}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'none',
                border: '1px solid var(--tension-mid)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 10px',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-11)',
                color: 'var(--tension)',
                transition: 'all var(--transition-fast)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--tension)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--tension-mid)' }}
            >
              <Crosshair size={11} />
              Probe
            </button>
          ) : (
            <ProbeCard
              status={probe.status}
              question={probe.question}
              errorMsg={probe.errorMsg}
              onSpawn={handleSpawnFromProbe}
              onDismiss={() => setProbe(null)}
            />
          )}
        </div>

        {/* ── Connections ───────────────────────────────────────── */}
        <div style={sectionDivider}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: connections.length > 0 ? 'var(--sp-2)' : 0 }}>
            <span style={{ ...sectionLabel, marginBottom: 0 }}>
              connections{connections.length > 0 ? ` (${connections.length})` : ''}
            </span>
            {showConnect && (
              <button
                onClick={() => { setConnectOpen(v => !v); setConnectSearch('') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  background: connectOpen ? 'var(--surface-2)' : 'none',
                  border: `1px solid ${connectOpen ? 'var(--border)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-11)',
                  color: connectOpen ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  transition: 'all 150ms',
                }}
              >
                <Link2 size={10} />
                Connect to…
              </button>
            )}
          </div>

          {/* Connect-to picker */}
          {connectOpen && showConnect && (
            <div style={{ marginBottom: 'var(--sp-2)' }}>
              <input
                autoFocus
                value={connectSearch}
                onChange={e => setConnectSearch(e.target.value)}
                placeholder="Search nodes…"
                style={{
                  width: '100%',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 8px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-12)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: 'var(--sp-1)',
                }}
              />
              <div style={{
                maxHeight: '160px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '1px',
              }}>
                {filteredConnectable.length === 0 ? (
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-disabled)', padding: '4px 2px' }}>
                    {connectableNodes.length === 0 ? 'All nodes already connected.' : 'No matches.'}
                  </div>
                ) : (
                  filteredConnectable.map(n => {
                    const m = ORGANIZER_META[n.organizer]
                    return (
                      <button
                        key={n.id}
                        onClick={() => handleConnect(n.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                          background: 'none',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          padding: '5px 6px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                          transition: 'background 100ms',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        <span style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: m.color, flexShrink: 0,
                        }} />
                        <span style={{
                          fontFamily: 'var(--font-sans)',
                          fontSize: 'var(--text-12)',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {n.label}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* Existing connections list */}
          {connections.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {connections.map(({ edge, other }) => (
                <div
                  key={edge.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '2px 0' }}
                >
                  <button
                    onClick={() => setSelected(other!.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                      flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                      padding: 0, textAlign: 'left', minWidth: 0,
                    }}
                  >
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                      background: ORGANIZER_META[other!.organizer].color,
                    }} />
                    <span style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-12)',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {other!.label}
                    </span>
                  </button>
                  {onRemoveEdge && (
                    <button
                      onClick={() => onRemoveEdge(edge.id)}
                      title="Remove connection"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '2px', color: 'var(--text-disabled)', flexShrink: 0,
                        opacity: 0,
                        transition: 'opacity 150ms',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {connections.length === 0 && !connectOpen && (
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-12)', color: 'var(--text-disabled)' }}>
              No connections yet.
            </div>
          )}
        </div>

        {/* ── Resolve / Restore ─────────────────────────────────── */}
        <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
          {!isArchived ? (
            <button
              onClick={handleResolve}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--sp-2) var(--sp-3)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-11)',
                color: 'var(--text-tertiary)',
                letterSpacing: '0.03em',
                transition: 'all var(--transition-fast)',
                width: '100%',
              }}
              onMouseEnter={e => {
                const b = e.currentTarget
                b.style.borderColor = 'var(--core-mid)'
                b.style.color = 'var(--core)'
              }}
              onMouseLeave={e => {
                const b = e.currentTarget
                b.style.borderColor = 'var(--border)'
                b.style.color = 'var(--text-tertiary)'
              }}
            >
              <CheckCircle size={11} />
              Resolve — move to archive
            </button>
          ) : (
            <div>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-12)', color: 'var(--text-tertiary)', marginBottom: 'var(--sp-2)' }}>
                {node.resolved ? 'Resolved.' : 'Superseded.'}
                {node.resolution_note ? ` ${node.resolution_note}` : ''}
              </p>
              <button
                onClick={handleRestore}
                style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.03em' }}
              >
                Restore
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

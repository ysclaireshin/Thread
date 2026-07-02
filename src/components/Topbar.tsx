import { useRef, useState, useEffect } from 'react'
import { Plus, Download, Upload, Pencil, ArrowLeft } from 'lucide-react'
import { useStore } from '../store'
import { computeRenderStates } from '../canvas/renderState'
import { greetingFromFocus } from '../types'
import { ORGANIZER_META, type Organizer } from '../types'
import { motion, AnimatePresence } from 'motion/react'
import { AnimatedNumber } from './core/animated-number'
import { TextShimmerWave } from './core/text-shimmer-wave'

interface Props { onAddNode: () => void; reentryLoading?: boolean }

// ─── Thread logo — design E: liquid hue wave ─────────────────────────────────

function ThreadLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <svg className="logo-sun" width="18" height="18" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="ts-logo-fill" cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#ffe070" />
            <stop offset="50%" stopColor="#f08818" />
            <stop offset="100%" stopColor="#7a3a00" />
          </radialGradient>
          <radialGradient id="ts-logo-spec" cx="35%" cy="30%" r="42%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.8)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        <path fill="url(#ts-logo-fill)">
          <animate
            attributeName="d"
            dur="4s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"
            values="M11,3 C15.5,3 19,6.5 19,11 C19,15.5 15.5,19 11,19 C6.5,19 3,15.5 3,11 C3,6.5 6.5,3 11,3 Z;
                    M11,3.5 C15,2 19.5,7 18,12 C16.5,17 13,20 9,18.5 C5,17 2,13 3.5,9 C5,5 7,5 11,3.5 Z;
                    M11,3 C16,3 19.5,7 19,12 C18.5,17 14,20 10,18.5 C6,17 2.5,14 3,9.5 C3.5,5 6,3 11,3 Z;
                    M11,3.5 C15,2.5 19.5,7.5 18.5,12 C17.5,16.5 14,19.5 9.5,18.5 C5,17.5 2.5,13 3,9 C3.5,5 7,5 11,3.5 Z;
                    M11,3 C15.5,3 19,6.5 19,11 C19,15.5 15.5,19 11,19 C6.5,19 3,15.5 3,11 C3,6.5 6.5,3 11,3 Z"
          />
        </path>
        <ellipse cx="8.5" cy="8" rx="3.5" ry="2.2" fill="url(#ts-logo-spec)" />
      </svg>
      <span style={{
        fontFamily: "'Geist', sans-serif",
        fontSize: '13px',
        fontWeight: 600,
        color: '#ffffff',
        letterSpacing: '-0.02em',
      }}>thread</span>
    </div>
  )
}

// ─── Project switcher ─────────────────────────────────────────────────────────

function ProjectSwitcher() {
  const { projectId, projectName, allProjectsMeta, switchProject, newProject, loadExampleProject, renameProject } = useStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(projectName)
  const projects = allProjectsMeta()

  function commitRename() {
    if (nameInput.trim()) renameProject(nameInput.trim())
    setEditing(false)
  }

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    minWidth: '220px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '6px',
    zIndex: 100,
  }

  const menuItemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    background: 'none',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-13)',
    cursor: 'pointer',
    transition: 'background var(--transition-fast)',
  }

  const dividerStyle: React.CSSProperties = {
    height: '1px',
    background: 'var(--border)',
    margin: '4px 2px',
  }

  return (
    <div style={{ position: 'relative' }}>
      {editing ? (
        <input
          autoFocus
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false) }}
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--core)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 8px',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-12)',
            color: 'var(--text-primary)',
            outline: 'none',
            width: '160px',
          }}
        />
      ) : (
        <button
          onClick={() => setOpen(v => !v)}
          title="Click to switch projects · Double-click to rename"
          style={{
            background: 'none',
            border: 'none',
            padding: '2px 4px',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-12)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            letterSpacing: '0.03em',
          }}
        >
          {projectName}
          <span style={{ color: 'var(--text-tertiary)', fontSize: '9px' }}>▾</span>
        </button>
      )}

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div style={dropdownStyle}>
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => { switchProject(p.id); setOpen(false) }}
                style={{
                  ...menuItemStyle,
                  color: p.id === projectId ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: p.id === projectId ? 'var(--surface-3)' : 'none',
                }}
              >
                {p.name}
                {p.id === projectId && (
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--core)', marginLeft: '8px' }}>
                    active
                  </span>
                )}
              </button>
            ))}
            <div style={dividerStyle} />
            <button
              onClick={() => { setNameInput(projectName); setEditing(true); setOpen(false) }}
              style={{ ...menuItemStyle, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Pencil size={10} />
              Rename project
            </button>
            <div style={dividerStyle} />
            <button
              onClick={() => { newProject(); setOpen(false) }}
              style={{ ...menuItemStyle, color: 'var(--text-tertiary)' }}
            >
              + New project
            </button>
            <button
              onClick={() => { loadExampleProject(); setOpen(false) }}
              style={{ ...menuItemStyle, color: 'var(--open)' }}
            >
              Example project
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Add Node Popover ─────────────────────────────────────────────────────────

function AddPopover() {
  const { addNode } = useStore()
  const [organizer, setOrganizer] = useState<Organizer>('core_idea')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)

  function reset() {
    setOrganizer('core_idea')
    setLabel('')
    setNotes('')
    setNotesOpen(false)
  }

  function submit() {
    if (!label.trim()) return
    const meta = ORGANIZER_META[organizer]
    addNode({
      id: `n-${Date.now()}`,
      label: label.trim(),
      description: notes.trim(),
      organizer,
      centrality: 0.6,
      confidence: 2,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: meta.color,
    })
    setPopoverOpen(false)
    reset()
  }

  const organizerShort: Record<Organizer, string> = {
    core_idea: 'Core idea',
    point_of_tension: 'Tension',
    open_thought: 'Open thought',
  }

  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!popoverOpen) return
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPopoverOpen(false)
        reset()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [popoverOpen])

  useEffect(() => {
    if (!popoverOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setPopoverOpen(false); reset() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [popoverOpen])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setPopoverOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--sp-1)',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--sp-1) var(--sp-2)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-13)',
          fontWeight: 500,
          color: 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        <Plus size={11} />
        Add
      </button>

      {/* Popover panel */}
      <AnimatePresence>
        {popoverOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.25 }}
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              width: '320px',
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '12px',
              zIndex: 50,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              transformOrigin: 'top right',
            }}
          >
            {/* Organizer buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
              {(Object.keys(ORGANIZER_META) as Organizer[]).map((o) => {
                const meta = ORGANIZER_META[o]
                return (
                  <button
                    key={o}
                    onClick={() => setOrganizer(o)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${organizer === o ? meta.color : 'var(--border)'}`,
                      background: organizer === o ? meta.colorDim : 'var(--surface-2)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: '12px',
                      color: organizer === o ? meta.cssVar : 'var(--text-tertiary)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 150ms',
                    }}
                  >
                    {organizerShort[o]}
                  </button>
                )
              })}
            </div>

            {/* Label input */}
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Name this idea..."
              style={{
                width: '100%',
                fontFamily: 'var(--font-sans)',
                fontSize: '13px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                padding: '8px 0',
                color: 'var(--text-primary)',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: '8px',
              }}
            />

            {/* Notes toggle */}
            {!notesOpen ? (
              <button
                onClick={() => setNotesOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '11px',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: '12px',
                  display: 'block',
                }}
              >
                Add notes +
              </button>
            ) : (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes..."
                rows={3}
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '13px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  padding: '8px 0',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  resize: 'none',
                  boxSizing: 'border-box',
                  marginBottom: '12px',
                }}
              />
            )}

            {/* Bottom row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                onClick={() => { setPopoverOpen(false); reset() }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px',
                }}
              >
                <ArrowLeft size={14} />
              </button>
              <button
                onClick={submit}
                disabled={!label.trim()}
                style={{
                  background: label.trim() ? 'var(--core-mid)' : 'var(--surface-2)',
                  border: `1px solid ${label.trim() ? 'var(--core)' : 'var(--border)'}`,
                  color: label.trim() ? 'var(--core)' : 'var(--text-disabled)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '11px',
                  padding: '4px 12px',
                  cursor: label.trim() ? 'pointer' : 'default',
                  transition: 'all 150ms',
                }}
              >
                Add
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main Topbar ──────────────────────────────────────────────────────────────

export function Topbar({ onAddNode, reentryLoading = false }: Props) {
  const {
    nodes, edges, focusMode, setFocusMode, viewMode, setViewMode,
    greetingStyle, setGreetingStyle, currentSession, exportJSON, importJSON,
  } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const renderStates = computeRenderStates(nodes, edges)
  const activeNodes = nodes.filter(n => !n.resolved && !n.superseded_by)
  const counts = {
    core:    activeNodes.filter(n => n.organizer === 'core_idea' && renderStates[n.id] !== 'star').length,
    tension: activeNodes.filter(n => n.organizer === 'point_of_tension' && renderStates[n.id] !== 'star').length,
    open:    activeNodes.filter(n => n.organizer === 'open_thought').length,
  }

  const focusNode = nodes.find(n => n.current_focus)

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    const r = new FileReader()
    r.onload = ev => importJSON(ev.target?.result as string)
    r.readAsText(f); e.target.value = ''
  }

  const topbarStyle: React.CSSProperties = {
    height: 'var(--topbar-height)',
    background: 'var(--canvas)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--sp-3)',
    padding: '0 var(--sp-4)',
    flexShrink: 0,
    zIndex: 20,
  }

  const viewToggleBtn = (mode: 'system' | 'linear' | 'map', _label: string): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-13)',
    letterSpacing: '0.03em',
    color: viewMode === mode ? 'var(--text-primary)' : 'var(--text-tertiary)',
    fontWeight: viewMode === mode ? 500 : 400,
    cursor: 'pointer',
    padding: '2px 4px',
  })

  return (
    <div style={{ flexShrink: 0, zIndex: 20 }}>
      {/* ── Main bar ─────────────────────────────────────────────── */}
      <div style={topbarStyle}>
        {/* Brand */}
        <div className="topbar-brand-glow" style={{ flexShrink: 0, position: 'relative' }}>
          <ThreadLogo />
        </div>

        <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-12)' }}>·</span>

        <ProjectSwitcher />

        <div style={{ flex: 1 }} />

        {/* Counts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
          {counts.core > 0 && (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', display: 'flex', gap: '4px' }}>
              <AnimatedNumber value={counts.core} style={{ color: 'var(--core)' }} />
              <span style={{ color: 'var(--text-tertiary)' }}>core</span>
            </span>
          )}
          {counts.tension > 0 && (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', display: 'flex', gap: '4px' }}>
              <AnimatedNumber value={counts.tension} style={{ color: 'var(--tension)' }} />
              <span style={{ color: 'var(--text-tertiary)' }}>tension</span>
            </span>
          )}
          {counts.open > 0 && (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', display: 'flex', gap: '4px' }}>
              <AnimatedNumber value={counts.open} style={{ color: 'var(--open)' }} />
              <span style={{ color: 'var(--text-tertiary)' }}>open</span>
            </span>
          )}
        </div>

        {/* System / Linear / Map toggle */}
        <div style={{ display: 'flex', alignItems: 'center', position: 'relative', padding: '2px', borderRadius: '6px', background: 'var(--surface-2)' }}>
          {(['system', 'linear', 'map'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                position: 'relative',
                background: 'none',
                border: 'none',
                fontFamily: 'var(--font-sans)',
                fontSize: '11px',
                color: viewMode === mode ? 'var(--text-primary)' : 'var(--text-tertiary)',
                cursor: 'pointer',
                padding: '4px 10px',
                borderRadius: '4px',
                zIndex: 1,
                transition: 'color 150ms',
              }}
            >
              {viewMode === mode && (
                <motion.div
                  layoutId='tab-highlight'
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '4px',
                    background: 'var(--surface-4)',
                    zIndex: -1,
                  }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.25 }}
                />
              )}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Focus toggle (system view only) */}
        {viewMode === 'system' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', borderLeft: '1px solid var(--border)', paddingLeft: 'var(--sp-3)', marginLeft: 'var(--sp-1)' }}>
            <button
              onClick={() => setFocusMode(true)}
              style={{ ...viewToggleBtn('system', ''), color: focusMode ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: focusMode ? 500 : 400 }}
            >
              Focus
            </button>
            <span style={{ color: 'var(--text-disabled)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)' }}>/</span>
            <button
              onClick={() => setFocusMode(false)}
              style={{ ...viewToggleBtn('system', ''), color: !focusMode ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: !focusMode ? 500 : 400 }}
            >
              Full
            </button>
          </div>
        )}

        {/* ADD button → MorphingPopover */}
        <AddPopover />

        <button onClick={exportJSON} title="Export" style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
          <Download size={13} />
        </button>
        <button onClick={() => fileRef.current?.click()} title="Import" style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
          <Upload size={13} />
        </button>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
      </div>

      {/* ── Greeting band ───────────────────────────────────────── */}
      <div style={{
        height: 'var(--greeting-height)',
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-4)',
        padding: '0 var(--sp-4)',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-11)',
          color: 'var(--text-tertiary)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}>
          // where you left off
        </span>

        {reentryLoading ? (
          <TextShimmerWave
            className='font-sans text-xs'
            duration={1.2}
            style={{ color: 'var(--text-tertiary)', flex: 1 }}
          >
            Reading your thinking...
          </TextShimmerWave>
        ) : focusNode ? (
          <p style={{
            flex: 1,
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-14)',
            fontWeight: 400,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {greetingFromFocus(focusNode, greetingStyle)}
          </p>
        ) : (
          <p style={{
            flex: 1,
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-13)',
            color: 'var(--text-disabled)',
            fontStyle: 'italic',
          }}>
            No focus set. Save your place to set a re-entry point.
          </p>
        )}

        {/* Q / A toggle */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <button
            onClick={() => setGreetingStyle('question')}
            style={{
              padding: '2px 8px',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-12)',
              background: greetingStyle === 'question' ? 'var(--open-dim)' : 'transparent',
              color: greetingStyle === 'question' ? 'var(--open)' : 'var(--text-tertiary)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >Q</button>
          <button
            onClick={() => setGreetingStyle('action')}
            style={{
              padding: '2px 8px',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-12)',
              background: greetingStyle === 'action' ? 'var(--core-dim)' : 'transparent',
              color: greetingStyle === 'action' ? 'var(--core)' : 'var(--text-tertiary)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >A</button>
        </div>

        {/* Session counter */}
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-12)',
          color: 'var(--text-tertiary)',
          flexShrink: 0,
        }}>
          Session {currentSession}
        </span>
      </div>
    </div>
  )
}

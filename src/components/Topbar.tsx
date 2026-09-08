import { useRef, useState, useEffect } from 'react'
import { Pencil, X, Plus } from 'lucide-react'
import SwitchHorizontal01 from '@untitled-ui/icons-react/build/esm/SwitchHorizontal01'
import { useStore, type ViewKind } from '../store'
import { CustomizeCategoriesModal } from './CustomizeCategoriesModal'

// ─── Thread logo ──────────────────────────────────────────────────────────────
// Step 5 redesign: exact spec pulled from Penpot's inspector - two ellipses,
// identical fill/border, layered so the back one (larger, blurred) reads as
// a soft glow behind the front one (smaller, crisp edge):
//   back:  13x13, left 11 top 10, #ffa000 fill, 1px #d48624 border, blur(3px)
//   front: 11x11, left 12 top 11, #ffa000 fill, 1px #d48624 border
// Both positioned within a 24x24 box to match those coordinates exactly.

function ThreadLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {/* Container tightly wraps the back (larger) circle's own bounds - not
          an arbitrary box - so flexbox centers the visible glyph itself
          against the "thread" text, not empty space around it. */}
      <div style={{ position: 'relative', width: '13px', height: '13px', flexShrink: 0 }}>
        <span style={{
          position: 'absolute', inset: 0,
          borderRadius: '50%', background: '#ffa000', border: '1px solid #d48624',
          filter: 'blur(3px)',
        }} />
        <span style={{
          position: 'absolute', left: '1px', top: '1px', width: '11px', height: '11px',
          borderRadius: '50%', background: '#ffa000', border: '1px solid #d48624',
        }} />
      </div>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: '14px',
        fontWeight: 400,
        lineHeight: 1.2,
        color: 'var(--text-primary)',
        letterSpacing: 0,
        WebkitTextStroke: '0.28px var(--text-primary)',
      }}>thread</span>
    </div>
  )
}

// ─── Project switcher ─────────────────────────────────────────────────────────

function ProjectSwitcher() {
  const { projectId, projectName, allProjectsMeta, switchProject, newProject, loadExampleProject, renameProject } = useStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
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
            fontFamily: 'var(--font-display)',
            fontSize: '14px',
            lineHeight: 1.2,
            color: 'var(--text-secondary)',
            WebkitTextStroke: '0.28px var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {projectName}
          <span style={{
            display: 'inline-block', width: 0, height: 0,
            borderLeft: '2px solid transparent', borderRight: '2px solid transparent',
            borderTop: '2px solid var(--text-secondary)', flexShrink: 0,
          }} />
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
            <button
              onClick={() => { setCustomizeOpen(true); setOpen(false) }}
              style={{ ...menuItemStyle, color: 'var(--text-tertiary)' }}
            >
              Customize categories
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

      {customizeOpen && <CustomizeCategoriesModal onClose={() => setCustomizeOpen(false)} />}
    </div>
  )
}

// ─── Main Topbar ──────────────────────────────────────────────────────────────

// Fixed display order for every view-kind picker below.
const VIEW_KIND_ORDER: ViewKind[] = ['text', 'nodes', 'map', 'system']
const VIEW_LABELS: Record<ViewKind, string> = {
  text: 'Text', nodes: 'Outline', map: 'Map', system: 'System',
}

// ─── Slot picker ──────────────────────────────────────────────────────────────
// One workspace slot's view-picker: a small dropdown listing all four
// ViewKinds, with whichever kind the OTHER slot already holds disabled so the
// unique-view constraint can't even be attempted through this control (the
// store's own normalizeSlots still enforces it defensively either way).
function SlotPicker({ value, disabledKind, onSelect }: {
  value: ViewKind
  disabledKind: ViewKind | null
  onSelect: (kind: ViewKind) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Choose which view this pane shows"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
          height: '18px', boxSizing: 'border-box',
          background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '20px',
          padding: '0 10px', fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 400, lineHeight: 1.2,
          color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {VIEW_LABELS[value]}
        <span style={{
          display: 'inline-block', width: 0, height: 0,
          borderLeft: '2px solid transparent', borderRight: '2px solid transparent',
          borderTop: '2px solid var(--text-secondary)', flexShrink: 0,
        }} />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 100,
            minWidth: '120px', background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '6px',
          }}>
            {VIEW_KIND_ORDER.map(kind => {
              const disabled = kind === disabledKind
              return (
                <button
                  key={kind}
                  disabled={disabled}
                  onClick={() => { onSelect(kind); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                    width: '100%', textAlign: 'left', padding: '6px 10px',
                    background: kind === value ? 'var(--surface-3)' : 'none', border: 'none',
                    borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)',
                    color: disabled ? 'var(--text-disabled)' : kind === value ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: disabled ? 'default' : 'pointer',
                  }}
                >
                  {VIEW_LABELS[kind]}
                  {kind === value && <span style={{ color: 'var(--core)', fontSize: 'var(--text-11)' }}>active</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Workspace picker ─────────────────────────────────────────────────────────
// Replaces the old System/Linear/Map segmented toggle. One or two SlotPickers
// (one per active workspace slot) plus explicit controls to add/remove the
// second slot and swap the two views. No drag-and-drop yet - explicit
// picker/menu controls only (a later step adds drag-and-drop on top of this).
function WorkspacePicker() {
  const slots = useStore(s => s.workspace.slots)
  const setWorkspaceSlots = useStore(s => s.setWorkspaceSlots)

  const iconBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '24px', height: '24px', flexShrink: 0,
    background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    color: 'var(--text-secondary)', cursor: 'pointer',
  }

  if (slots.length === 1) {
    const [current] = slots
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <SlotPicker value={current} disabledKind={null} onSelect={kind => setWorkspaceSlots([kind])} />
        <button
          onClick={() => {
            // First ViewKind not already showing - a sensible, predictable
            // default for the new second pane until the user picks otherwise.
            const other = VIEW_KIND_ORDER.find(k => k !== current) ?? 'nodes'
            setWorkspaceSlots([current, other])
          }}
          title="Add a second view"
          style={iconBtnStyle}
        >
          <Plus size={12} />
        </button>
      </div>
    )
  }

  const [first, second] = slots
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <SlotPicker value={first} disabledKind={second} onSelect={kind => setWorkspaceSlots([kind, second])} />
      <button onClick={() => setWorkspaceSlots([second, first])} title="Swap the two views" style={iconBtnStyle}>
        <SwitchHorizontal01 width={11} height={11} />
      </button>
      <SlotPicker value={second} disabledKind={first} onSelect={kind => setWorkspaceSlots([first, kind])} />
      <button onClick={() => setWorkspaceSlots([first])} title="Remove second view" style={iconBtnStyle}>
        <X size={12} />
      </button>
    </div>
  )
}

// Step 5 visual redesign: the topbar is trimmed to exactly what the Penpot
// design shows - logo/thread, project switcher, and the workspace picker.
// Counts, the manual Add-node popover, Export, and Import were dropped from
// this bar per direct design feedback (Import already has a Penpot-side
// replacement elsewhere; Export wasn't wanted). Their store actions
// (exportJSON, importJSON, addNode) are untouched - only this bar's UI
// entry points to them are gone. Focus/Full (System-only) is intentionally
// left out too - System hasn't been redesigned yet, so it isn't part of
// this pass; it comes back when System's own design arrives.
export function Topbar() {
  const topbarStyle: React.CSSProperties = {
    height: 'var(--topbar-height)',
    background: 'var(--surface-1)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--sp-3)',
    padding: '0 var(--sp-4)',
    flexShrink: 0,
    zIndex: 20,
  }

  return (
    <div style={{ flexShrink: 0, zIndex: 20 }}>
      <div style={topbarStyle}>
        {/* Brand */}
        <div className="topbar-brand-glow" style={{ flexShrink: 0, position: 'relative' }}>
          <ThreadLogo />
        </div>

        <span style={{ display: 'inline-block', width: '1px', height: '17px', background: 'var(--border)', flexShrink: 0 }} />

        <ProjectSwitcher />

        <div style={{ flex: 1 }} />

        {/* Workspace view-picker - replaces the old System/Linear/Map toggle. */}
        <WorkspacePicker />
      </div>
    </div>
  )
}

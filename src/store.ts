import { create } from 'zustand'
import type { ThreadNode, ThreadEdge, ThreadProject, TextAnchor, Provenance } from './types'
import { SEED } from './data/seed'
import { saveProject } from './lib/supabaseSync'

console.log("NEW STORE VERSION LOADED")

const V3_KEY = 'thread_v3'

// ─── Migration helpers ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateNode(n: any): ThreadNode {
  return {
    ...n,
    confidence: (n.confidence ?? 2) as 1 | 2 | 3,
    session_id: (n.session_id ?? 1) as number,
    // Backfill lastEditedAt from last_reinforced_at for pre-Flow data so glow
    // selection has something to sort on.
    lastEditedAt: (n.lastEditedAt ?? n.last_reinforced_at) as string | undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateEdge(e: any): ThreadEdge {
  return {
    ...e,
    // 'manual' was removed from the relationship union — it was standing in for
    // provenance, which now has its own field. Old persisted edges carrying it
    // become unclassified (null) rather than throwing or getting dropped.
    relationship: (e.relationship === 'manual' ? null : e.relationship ?? null) as ThreadEdge['relationship'],
    provenance: (e.provenance ?? 'human') as Provenance,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateProject(p: any): ThreadProject {
  return {
    id: (p.id as string) ?? crypto.randomUUID(),
    name: (p.name as string) ?? 'My project',
    thesis: (p.thesis as string) ?? '',
    nodes: ((p.nodes ?? []) as unknown[]).map(n => migrateNode(n)),
    edges: ((p.edges ?? []) as unknown[]).map(e => migrateEdge(e)),
    textAnchors: (p.textAnchors as TextAnchor[]) ?? [],
    draftText: (p.draftText as string) ?? '',
    greetingStyle: (p.greetingStyle as 'action' | 'question') ?? 'action',
    currentSession: (p.currentSession as number) ?? 1,
    savedAt: p.savedAt as string | undefined,
    focusCommitment: p.focusCommitment as string | undefined,
    focusCommitmentSession: p.focusCommitmentSession as number | undefined,
    focusDraftSnapshot: p.focusDraftSnapshot as string | undefined,
    lastCursorLine: (p.lastCursorLine ?? null) as number | null,
    lastCursorOffset: (p.lastCursorOffset ?? null) as number | null,
    dismissedPairs: (p.dismissedPairs as string[]) ?? [],
  }
}

function blankProject(name: string): ThreadProject {
  return {
    id: crypto.randomUUID(),
    name,
    thesis: '',
    nodes: [],
    edges: [],
    textAnchors: [],
    draftText: '',
    greetingStyle: 'action',
    currentSession: 1,
    lastCursorLine: null,
    lastCursorOffset: null,
    dismissedPairs: [],
  }
}

interface StoredV3 {
  activeProjectId: string
  projects: ThreadProject[]
}

function loadAll(): { active: ThreadProject; all: ThreadProject[] } {
  try {
    const raw = localStorage.getItem(V3_KEY)
    if (raw) {
      const data = JSON.parse(raw) as StoredV3
      const projects = data.projects.map(p => migrateProject(p))
      const active = projects.find(p => p.id === data.activeProjectId) ?? projects[0]
      return { active, all: projects }
    }
  } catch {}

  // Check for old v2 single-project data to migrate
  try {
    const oldRaw = localStorage.getItem('thread_solar_v2')
    if (oldRaw) {
      const old = JSON.parse(oldRaw)
      const migrated = migrateProject({ id: 'migrated-v2', name: 'My project', ...old })
      return { active: migrated, all: [migrated] }
    }
  } catch {}

  // Brand new install: start with a blank project
  const blank = blankProject('My project')
  return { active: blank, all: [blank] }
}

function saveAll(state: Store) {
  const currentProj: ThreadProject = {
    id: state.projectId,
    name: state.projectName,
    thesis: state.thesis,
    nodes: state.nodes,
    edges: state.edges,
    textAnchors: state.textAnchors,
    draftText: state.draftText,
    greetingStyle: state.greetingStyle,
    currentSession: state.currentSession,
    savedAt: new Date().toISOString(),
    focusCommitment: state.focusCommitment,
    focusCommitmentSession: state.focusCommitmentSession,
    focusDraftSnapshot: state.focusDraftSnapshot,
    lastCursorLine: state.lastCursorLine,
    lastCursorOffset: state.lastCursorOffset,
    dismissedPairs: state.dismissedPairs,
  }
  const updated = state._allProjects
    .map(p => p.id === state.projectId ? currentProj : p)
  if (!updated.some(p => p.id === state.projectId)) updated.push(currentProj)

  localStorage.setItem(V3_KEY, JSON.stringify({
    activeProjectId: state.projectId,
    projects: updated,
  }))
}

// ─── Store interface ──────────────────────────────────────────────────────────

type ViewMode = 'system' | 'linear' | 'map'

export interface ProjectMeta { id: string; name: string }

interface Store {
  // Current project identity
  projectId: string
  projectName: string
  // Current project data
  thesis: string
  nodes: ThreadNode[]
  edges: ThreadEdge[]
  textAnchors: TextAnchor[]
  draftText: string
  greetingStyle: 'action' | 'question'
  currentSession: number
  // Flow (re-entry) persisted data
  focusCommitment?: string
  focusCommitmentSession?: number
  focusDraftSnapshot?: string
  lastCursorLine: number | null
  lastCursorOffset: number | null
  // Trace: node-id pairs the user dismissed (both orderings stored). Persisted.
  dismissedPairs: string[]
  // All projects (for switcher)
  _allProjects: ThreadProject[]
  // UI state
  selectedId: string | null
  focusMode: boolean
  viewMode: ViewMode
  // ─── Flow (ephemeral, never persisted) ──────────────────────────────────
  flowGlowIds: string[]        // 2–3 most-recently-edited nodes from last session
  flowGlowVisible: boolean     // true during the 8s glow window, then fades out
  flowActive: boolean          // Flow ran on this load (drives ▶ Flow indicator mount)
  flowIndicatorVisible: boolean // true during the 10s indicator window, then fades

  // Project management
  newProject: (name?: string) => void
  switchProject: (id: string) => void
  loadExampleProject: () => void
  renameProject: (name: string) => void
  allProjectsMeta: () => ProjectMeta[]

  // Data actions
  setSelected: (id: string | null) => void
  setFocusMode: (v: boolean) => void
  setViewMode: (v: ViewMode) => void
  setThesis: (t: string) => void
  setFocus: (id: string) => void
  setDraftText: (t: string) => void
  setGreetingStyle: (s: 'action' | 'question') => void
  // Flow: persist cursor position on keystroke; write commitment on Save My Place
  setCursorPos: (line: number, offset: number) => void
  saveFocusCommitment: (sentence: string) => void
  // Flow: ephemeral activation lifecycle (driven by an effect on project load)
  activateFlow: () => void
  fadeFlowGlow: () => void
  hideFlowIndicator: () => void
  // addNode auto-stamps session_id and createdWithFocus
  addNode: (n: Omit<ThreadNode, 'session_id' | 'createdWithFocus'>) => void
  updateNode: (id: string, patch: Partial<ThreadNode>) => void
  addEdge: (e: ThreadEdge) => void
  removeEdge: (id: string) => void
  // Trace: record a dismissed Ghost Edge pair (stores both orderings).
  addDismissedPair: (aId: string, bId: string) => void
  addTextAnchor: (a: TextAnchor) => void
  removeTextAnchor: (id: string) => void
  // Commit the current session (called by SavePlaceModal at end of session)
  commitSession: () => void

  exportJSON: () => void
  importJSON: (json: string) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<Store>((set, get) => {
  const { active, all } = loadAll()

  return {
    projectId: active.id,
    projectName: active.name,
    thesis: active.thesis,
    nodes: active.nodes,
    edges: active.edges,
    textAnchors: active.textAnchors,
    draftText: active.draftText,
    greetingStyle: active.greetingStyle,
    currentSession: active.currentSession,
    focusCommitment: active.focusCommitment,
    focusCommitmentSession: active.focusCommitmentSession,
    focusDraftSnapshot: active.focusDraftSnapshot,
    lastCursorLine: active.lastCursorLine ?? null,
    lastCursorOffset: active.lastCursorOffset ?? null,
    dismissedPairs: active.dismissedPairs ?? [],
    _allProjects: all,
    selectedId: null,
    focusMode: true,
    viewMode: 'linear',
    flowGlowIds: [],
    flowGlowVisible: false,
    flowActive: false,
    flowIndicatorVisible: false,

    // ── Project management ──────────────────────────────────────────────

    allProjectsMeta: () => get()._allProjects.map(p => ({ id: p.id, name: p.name })),

    newProject: (name = 'Untitled') => {
      const proj = blankProject(name)
      set(s => {
        const currentProj = extractProject(s)
        const updated = s._allProjects.map(p => p.id === s.projectId ? currentProj : p)
        if (!updated.some(p => p.id === s.projectId)) updated.push(currentProj)
        return {
          projectId: proj.id,
          projectName: proj.name,
          thesis: proj.thesis,
          nodes: proj.nodes,
          edges: proj.edges,
          textAnchors: proj.textAnchors,
          draftText: proj.draftText,
          greetingStyle: proj.greetingStyle,
          currentSession: proj.currentSession,
          focusCommitment: proj.focusCommitment,
          focusCommitmentSession: proj.focusCommitmentSession,
          focusDraftSnapshot: proj.focusDraftSnapshot,
          lastCursorLine: proj.lastCursorLine ?? null,
          lastCursorOffset: proj.lastCursorOffset ?? null,
          dismissedPairs: proj.dismissedPairs ?? [],
          _allProjects: [...updated, proj],
          selectedId: null,
        }
      })
    },

    switchProject: (id) => {
      const target = get()._allProjects.find(p => p.id === id)
      if (!target || target.id === get().projectId) return
      set(s => {
        const currentProj = extractProject(s)
        const updated = s._allProjects.map(p => p.id === s.projectId ? currentProj : p)
        return {
          projectId: target.id,
          projectName: target.name,
          thesis: target.thesis,
          nodes: target.nodes,
          edges: target.edges,
          textAnchors: target.textAnchors,
          draftText: target.draftText,
          greetingStyle: target.greetingStyle,
          currentSession: target.currentSession,
          focusCommitment: target.focusCommitment,
          focusCommitmentSession: target.focusCommitmentSession,
          focusDraftSnapshot: target.focusDraftSnapshot,
          lastCursorLine: target.lastCursorLine ?? null,
          lastCursorOffset: target.lastCursorOffset ?? null,
          dismissedPairs: target.dismissedPairs ?? [],
          _allProjects: updated,
          selectedId: null,
        }
      })
    },

    loadExampleProject: () => {
      const example = migrateProject({ ...SEED, id: `example-${Date.now()}`, name: 'Example project' } as Record<string, unknown>)
      set(s => {
        const currentProj = extractProject(s)
        const updated = s._allProjects.map(p => p.id === s.projectId ? currentProj : p)
        if (!updated.some(p => p.id === s.projectId)) updated.push(currentProj)
        return {
          projectId: example.id,
          projectName: example.name,
          thesis: example.thesis,
          nodes: example.nodes,
          edges: example.edges,
          textAnchors: example.textAnchors,
          draftText: example.draftText,
          greetingStyle: example.greetingStyle,
          currentSession: example.currentSession,
          focusCommitment: example.focusCommitment,
          focusCommitmentSession: example.focusCommitmentSession,
          focusDraftSnapshot: example.focusDraftSnapshot,
          lastCursorLine: example.lastCursorLine ?? null,
          lastCursorOffset: example.lastCursorOffset ?? null,
          dismissedPairs: example.dismissedPairs ?? [],
          _allProjects: [...updated, example],
          selectedId: null,
        }
      })
    },

    renameProject: (name) => set({ projectName: name }),

    // ── Data actions ────────────────────────────────────────────────────

    setSelected: (id) => set({ selectedId: id }),
    setFocusMode: (v) => set({ focusMode: v }),
    setViewMode: (v) => set({ viewMode: v }),
    setThesis: (t) => set({ thesis: t }),
    setDraftText: (t) => set({ draftText: t }),
    setGreetingStyle: (s) => set({ greetingStyle: s }),

    // ── Flow ────────────────────────────────────────────────────────────
    setCursorPos: (line, offset) => set({ lastCursorLine: line, lastCursorOffset: offset }),

    saveFocusCommitment: (sentence) => set(s => ({
      focusCommitment: sentence.trim() || undefined,
      focusCommitmentSession: s.currentSession,
      // Snapshot the draft as it stood at Save My Place — last ~200 words only.
      focusDraftSnapshot: s.draftText.split(/\s+/).filter(Boolean).slice(-200).join(' '),
    })),

    // Runs once per project load (effect keyed on projectId). Glows the 2–3
    // most-recently-edited nodes from the previous session and lights the
    // ▶ Flow indicator — only when a previous session actually exists.
    activateFlow: () => set(s => {
      const hasPrevious = s.currentSession > 1
      if (!hasPrevious) {
        return { flowGlowIds: [], flowGlowVisible: false, flowActive: false, flowIndicatorVisible: false }
      }
      const glowIds = s.nodes
        .filter(n => !n.resolved && !n.superseded_by)
        .map(n => ({ id: n.id, t: new Date(n.lastEditedAt ?? n.last_reinforced_at).getTime() }))
        .sort((a, b) => b.t - a.t)
        .slice(0, 3)
        .map(n => n.id)
      return {
        flowGlowIds: glowIds,
        flowGlowVisible: glowIds.length > 0,
        flowActive: true,
        flowIndicatorVisible: true,
      }
    }),

    fadeFlowGlow: () => set({ flowGlowVisible: false }),
    hideFlowIndicator: () => set({ flowIndicatorVisible: false }),

    setFocus: (id) =>
      set(s => ({ nodes: s.nodes.map(n => ({ ...n, current_focus: n.id === id })) })),

    // Auto-stamps session_id and createdWithFocus
    addNode: (n) => set(s => {
      const focusNode = s.nodes.find(node => node.current_focus)
      const newNode: ThreadNode = {
        ...n,
        session_id: s.currentSession,
        createdWithFocus: focusNode?.id ?? null,
        lastEditedAt: n.last_reinforced_at ?? new Date().toISOString(),
      }
      console.log('Node created:', {
        id: newNode.id,
        sessionId: newNode.session_id,
        createdAt: newNode.last_reinforced_at,
        createdWithFocus: newNode.createdWithFocus,
      })
      const updatedNodes = [...s.nodes, newNode]

saveProject({
  id: s.projectId,
  name: s.projectName,
  thesis: s.thesis,
  nodes: updatedNodes,
  edges: s.edges,
  textAnchors: s.textAnchors,
  currentSession: s.currentSession,
})

return { nodes: updatedNodes }
    }),

    updateNode: (id, patch) =>
      set(s => {
        // Flow: an edit to label / description / organizer bumps lastEditedAt so
        // the node surfaces in re-entry glow. Other patches (focus, resolve, …) don't.
        const isContentEdit = 'label' in patch || 'description' in patch || 'organizer' in patch
        const stamped = isContentEdit && patch.lastEditedAt === undefined
          ? { ...patch, lastEditedAt: new Date().toISOString() }
          : patch
        return { nodes: s.nodes.map(n => n.id === id ? { ...n, ...stamped } : n) }
      }),

    addEdge: (e) => set(s => ({ edges: [...s.edges, e] })),
    removeEdge: (id) => set(s => ({ edges: s.edges.filter(e => e.id !== id) })),

    // Trace: persist a dismissed pair in both orderings so future scans exclude
    // it regardless of which direction the pair is generated in. Idempotent.
    addDismissedPair: (aId, bId) => set(s => {
      const keys = [`${aId}|${bId}`, `${bId}|${aId}`]
      const next = [...s.dismissedPairs]
      for (const k of keys) if (!next.includes(k)) next.push(k)
      return { dismissedPairs: next }
    }),

    addTextAnchor: (a) => set(s => ({ textAnchors: [...s.textAnchors, a] })),
    removeTextAnchor: (id) => set(s => ({ textAnchors: s.textAnchors.filter(a => a.id !== id) })),

    // Increment the session counter — called at end of "Save my place"
    commitSession: () => set(s => ({ currentSession: s.currentSession + 1 })),

    exportJSON: () => {
      const s = get()
      const proj = extractProject(s)
      const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${s.projectName.replace(/\s+/g, '-').toLowerCase()}.json`; a.click()
      URL.revokeObjectURL(url)
    },

    importJSON: (json) => {
      try {
        const p = migrateProject(JSON.parse(json) as Record<string, unknown>)
        set(s => {
          const updated = s._allProjects.map(pr => pr.id === s.projectId ? extractProject(s) : pr)
          const newProj = { ...p, id: `import-${Date.now()}`, name: p.name || 'Imported' }
          return {
            projectId: newProj.id,
            projectName: newProj.name,
            thesis: newProj.thesis,
            nodes: newProj.nodes,
            edges: newProj.edges,
            textAnchors: newProj.textAnchors,
            draftText: newProj.draftText,
            greetingStyle: newProj.greetingStyle,
            currentSession: newProj.currentSession,
            focusCommitment: newProj.focusCommitment,
            focusCommitmentSession: newProj.focusCommitmentSession,
            focusDraftSnapshot: newProj.focusDraftSnapshot,
            lastCursorLine: newProj.lastCursorLine ?? null,
            lastCursorOffset: newProj.lastCursorOffset ?? null,
            dismissedPairs: newProj.dismissedPairs ?? [],
            _allProjects: [...updated, newProj],
            selectedId: null,
          }
        })
      } catch { alert('Invalid JSON') }
    },
  }
})

function extractProject(s: Store): ThreadProject {
  return {
    id: s.projectId,
    name: s.projectName,
    thesis: s.thesis,
    nodes: s.nodes,
    edges: s.edges,
    textAnchors: s.textAnchors,
    draftText: s.draftText,
    greetingStyle: s.greetingStyle,
    currentSession: s.currentSession,
    savedAt: new Date().toISOString(),
    focusCommitment: s.focusCommitment,
    focusCommitmentSession: s.focusCommitmentSession,
    focusDraftSnapshot: s.focusDraftSnapshot,
    lastCursorLine: s.lastCursorLine,
    lastCursorOffset: s.lastCursorOffset,
    dismissedPairs: s.dismissedPairs,
  }
}

console.log("STORE FILE LOADED")

useStore.subscribe((s) => {
  console.log("SUBSCRIBE FIRED", s.nodes.length)

  saveAll(s)

  saveProject({
    id: s.projectId,
    name: s.projectName,
    thesis: s.thesis,
    nodes: s.nodes,
    edges: s.edges,
    textAnchors: s.textAnchors,
    currentSession: s.currentSession,
  })
})

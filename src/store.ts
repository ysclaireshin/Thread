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
    id: (p.id as string) ?? `proj-${Date.now()}`,
    name: (p.name as string) ?? 'My project',
    thesis: (p.thesis as string) ?? '',
    nodes: ((p.nodes ?? []) as unknown[]).map(n => migrateNode(n)),
    edges: ((p.edges ?? []) as unknown[]).map(e => migrateEdge(e)),
    textAnchors: (p.textAnchors as TextAnchor[]) ?? [],
    draftText: (p.draftText as string) ?? '',
    greetingStyle: (p.greetingStyle as 'action' | 'question') ?? 'action',
    currentSession: (p.currentSession as number) ?? 1,
    savedAt: p.savedAt as string | undefined,
  }
}

function blankProject(name: string): ThreadProject {
  return {
    id: `proj-${Date.now()}`,
    name,
    thesis: '',
    nodes: [],
    edges: [],
    textAnchors: [],
    draftText: '',
    greetingStyle: 'action',
    currentSession: 1,
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
  // All projects (for switcher)
  _allProjects: ThreadProject[]
  // UI state
  selectedId: string | null
  focusMode: boolean
  viewMode: ViewMode

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
  // addNode auto-stamps session_id and createdWithFocus
  addNode: (n: Omit<ThreadNode, 'session_id' | 'createdWithFocus'>) => void
  updateNode: (id: string, patch: Partial<ThreadNode>) => void
  addEdge: (e: ThreadEdge) => void
  removeEdge: (id: string) => void
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
    _allProjects: all,
    selectedId: null,
    focusMode: true,
    viewMode: 'linear',

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

    setFocus: (id) =>
      set(s => ({ nodes: s.nodes.map(n => ({ ...n, current_focus: n.id === id })) })),

    // Auto-stamps session_id and createdWithFocus
    addNode: (n) => set(s => {
      const focusNode = s.nodes.find(node => node.current_focus)
      const newNode: ThreadNode = {
        ...n,
        session_id: s.currentSession,
        createdWithFocus: focusNode?.id ?? null,
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
      set(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, ...patch } : n) })),

    addEdge: (e) => set(s => ({ edges: [...s.edges, e] })),
    removeEdge: (id) => set(s => ({ edges: s.edges.filter(e => e.id !== id) })),

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

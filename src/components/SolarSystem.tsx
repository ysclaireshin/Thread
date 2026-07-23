import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { drawFrame, makeInitialAnimState, type AnimState } from '../canvas/draw'
import { initAnimState, tickAnimState, getFocusWorldPos } from '../canvas/update'

import { computeRenderStates } from '../canvas/renderState'
import { generateStarfield } from '../canvas/draw'
import { getPlanetPos } from '../canvas/draw'

const DPR = window.devicePixelRatio || 1

export function SolarSystem() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<AnimState>(makeInitialAnimState())
  const starfieldRef = useRef(generateStarfield(280))
  const rafRef = useRef(0)

  const nodes = useStore(s => s.nodes)
  const edges = useStore(s => s.edges)
  const focusMode = useStore(s => s.focusMode)
  const selectedId = useStore(s => s.selectedId)
  const setSelected = useStore(s => s.setSelected)
  const setFocusMode = useStore(s => s.setFocusMode)

  // Refs so the animation loop always reads current values
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const edgesRef = useRef(edges); edgesRef.current = edges
  const focusModeRef = useRef(focusMode); focusModeRef.current = focusMode
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId
  const renderStatesRef = useRef(computeRenderStates(nodes, edges))

  // Recompute render states whenever nodes/edges change
  useEffect(() => {
    const rs = computeRenderStates(nodes, edges)
    renderStatesRef.current = rs
    initAnimState(nodes, edges, rs, animRef.current)
  }, [nodes, edges])

  // Camera: snap to focus node on first load
  useEffect(() => {
    const rs = computeRenderStates(nodes, edges)
    setTimeout(() => {
      const pos = getFocusWorldPos(nodes, edges, rs, animRef.current)
      if (pos) {
        animRef.current.camera.tx = pos.x
        animRef.current.camera.ty = pos.y
        animRef.current.camera.tzoom = 1.35
        animRef.current.camera.x = pos.x
        animRef.current.camera.y = pos.y
        animRef.current.camera.zoom = 1.35
      }
    }, 60)
  }, []) // eslint-disable-line

  // Resize
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const resize = () => { canvas.width = canvas.offsetWidth * DPR; canvas.height = canvas.offsetHeight * DPR }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const loop = (ts: number) => {
      const anim = animRef.current
      const dt = anim.lastFrameTime ? Math.min(ts - anim.lastFrameTime, 100) : 16
      anim.lastFrameTime = ts
      tickAnimState(nodesRef.current, edgesRef.current, renderStatesRef.current, anim, dt)
      const ctx = canvas.getContext('2d')!
      const w = canvas.width / DPR, h = canvas.height / DPR
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      drawFrame(ctx, w, h, nodesRef.current, edgesRef.current, anim, starfieldRef.current, renderStatesRef.current, focusModeRef.current, selectedRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top
    const anim = animRef.current
    let hit: string | null = null, hitR = Infinity
    for (const sp of anim.screenPositions) {
      const screenX = (sp.x - anim.camera.x) * anim.camera.zoom + canvas.offsetWidth / 2
      const screenY = (sp.y - anim.camera.y) * anim.camera.zoom + canvas.offsetHeight / 2
      const dist = Math.hypot(sx - screenX, sy - screenY)
      const threshold = Math.max(sp.r * anim.camera.zoom, 12)
      if (dist < threshold && dist < hitR) { hit = sp.nodeId; hitR = dist }
    }
    if (hit) {
      setSelected(hit === selectedRef.current ? null : hit)
      const clicked = nodesRef.current.find(n => n.id === hit)
      if (clicked && renderStatesRef.current[hit] === 'planet') {
        const pos = getPlanetPos(clicked, anim)
        anim.camera.tx = pos.x; anim.camera.ty = pos.y; anim.camera.tzoom = 2.2
        setFocusMode(false)
      }
    } else {
      setSelected(null)
    }
  }, [setSelected, setFocusMode])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const anim = animRef.current
    const factor = e.deltaY > 0 ? 0.92 : 1.09
    const newZoom = Math.max(0.3, Math.min(4, anim.camera.tzoom * factor))
    anim.camera.tzoom = newZoom
    // Zooming out far enough always recenters on the sun, so the whole
    // system frames itself instead of drifting off wherever focus left it
    if (newZoom < 0.75) {
      if (focusModeRef.current) setFocusMode(false)
      anim.camera.tx = 0; anim.camera.ty = 0
    }
  }, [setFocusMode])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-crosshair"
      onClick={handleClick}
      onWheel={handleWheel}
      style={{ display: 'block' }}
    />
  )
}

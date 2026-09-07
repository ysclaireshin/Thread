import { useCallback, useRef } from 'react'
import { MIN_SLOT_WIDTH_PX } from './ViewSlot'

interface SplitDividerProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  onDrag: (ratio: number) => void
  onDragEnd: (ratio: number) => void
}

// ─── SplitDivider ─────────────────────────────────────────────────────────────
// Draggable handle between two active slots. Reads the container's own width
// once, at drag start (it doesn't change mid-drag), and clamps so neither
// slot can be dragged below MIN_SLOT_WIDTH_PX. Reports the live ratio via
// onDrag for smooth visual feedback while dragging - kept out of the store
// until the gesture ends (onDragEnd) so every pixel of movement doesn't
// trigger a localStorage/cloud-sync write.
export function SplitDivider({ containerRef, onDrag, onDragEnd }: SplitDividerProps) {
  const draggingRef = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0) return
    draggingRef.current = true

    const ratioFromClientX = (clientX: number) => {
      const minRatio = MIN_SLOT_WIDTH_PX / rect.width
      const maxRatio = 1 - minRatio
      const raw = (clientX - rect.left) / rect.width
      return Math.min(maxRatio, Math.max(minRatio, raw))
    }

    const handleMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      onDrag(ratioFromClientX(ev.clientX))
    }
    const handleMouseUp = (ev: MouseEvent) => {
      draggingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      onDragEnd(ratioFromClientX(ev.clientX))
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [containerRef, onDrag, onDragEnd])

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: '1px',
        flexShrink: 0,
        background: 'var(--border)',
        cursor: 'col-resize',
        position: 'relative',
      }}
    >
      {/* Wider invisible hit area - a 1px visual line is hard to grab precisely. */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '-4px', right: '-4px' }} />
    </div>
  )
}

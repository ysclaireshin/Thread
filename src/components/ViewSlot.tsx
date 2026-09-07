import type { ReactNode } from 'react'

// Sensible floor so neither pane collapses to uselessness - shared with
// SplitDivider's drag clamp so a plain window resize and a divider drag
// enforce the identical minimum.
export const MIN_SLOT_WIDTH_PX = 260

interface ViewSlotProps {
  children: ReactNode
  // CSS width for this slot when it's one of two (e.g. '55%'). Omitted when
  // this is the only active slot, in which case it just fills all available
  // space (flex: 1) - the single-slot case needs zero footprint here so
  // wrapping System/Map's own layout changes nothing visually.
  width?: string
}

// ─── ViewSlot ─────────────────────────────────────────────────────────────────
// A sizing + positioning wrapper around one active view. flexDirection:
// column so a view's own `flex: 1` root (MapView, SystemView) fills its full
// height inside the slot; position: relative so an absolutely-positioned
// child scopes to ITS OWN slot instead of bubbling up to the workspace root
// (matters once two slots are on screen at once - e.g. SystemView's usage
// hint should center within System's own pane, not across the whole window).
export function ViewSlot({ children, width }: ViewSlotProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      minWidth: `${MIN_SLOT_WIDTH_PX}px`,
      position: 'relative',
      ...(width ? { flex: `0 0 ${width}` } : { flex: 1 }),
    }}>
      {children}
    </div>
  )
}

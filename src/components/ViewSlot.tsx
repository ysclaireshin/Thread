import type { ReactNode } from 'react'

// ─── ViewSlot ─────────────────────────────────────────────────────────────────
// Intentionally a no-op passthrough for now (a Fragment - zero DOM footprint,
// so wrapping a view in a slot changes nothing visually). This is Step 2's
// scaffolding seam: once slots become independently swappable/resizable
// (a later step), this is where per-slot chrome (a header, a swap-view
// control) and the draggable divider will attach.
export function ViewSlot({ children }: { children: ReactNode }) {
  return <>{children}</>
}

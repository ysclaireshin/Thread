import { Lightbulb, AlertTriangle, HelpCircle, type LucideIcon } from 'lucide-react'
import type { Organizer } from '../types'

// Icon per organizer type, matching the Idea / Problem / Question naming.
// Stored organizer values are unchanged - this is display only.
export const ORGANIZER_ICON: Record<Organizer, LucideIcon> = {
  core_idea: Lightbulb,      // Idea
  point_of_tension: AlertTriangle, // Problem
  open_thought: HelpCircle,  // Question
}

/** Small helper: renders the icon for an organizer at a given size/color. */
export function OrganizerIcon({ organizer, size = 14, color = 'currentColor' }: {
  organizer: Organizer
  size?: number
  color?: string
}) {
  const Icon = ORGANIZER_ICON[organizer]
  return <Icon size={size} color={color} strokeWidth={2} style={{ flexShrink: 0 }} />
}

import Lightbulb02 from '@untitled-ui/icons-react/build/esm/Lightbulb02'
import AlertHexagon from '@untitled-ui/icons-react/build/esm/AlertHexagon'
import MessageQuestionCircle from '@untitled-ui/icons-react/build/esm/MessageQuestionCircle'
import type { Organizer } from '../types'

// Icon per organizer type - the exact Penpot components, matched by their
// literal component names ("lightbulb-02", "alert-hexagon",
// "message-question-circle") via the @untitled-ui/icons-react package (the
// same icon set the Penpot design draws from), not a lookalike substitute.
// Stored organizer values are unchanged - this is display only.
type IconComponent = (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element

export const ORGANIZER_ICON: Record<Organizer, IconComponent> = {
  core_idea: Lightbulb02,          // Idea - "lightbulb-02"
  point_of_tension: AlertHexagon,  // Problem - "alert-hexagon"
  open_thought: MessageQuestionCircle, // Question - "message-question-circle"
}

// Small helper: renders the icon for an organizer at a given size/color.
// These components are fixed-stroke (stroke="currentColor", strokeWidth
// baked into a 24x24 viewBox) rather than lucide's size/strokeWidth props -
// width/height scale the whole vector (stroke included) uniformly, and
// `color` drives the CSS currentColor the paths already use.
export function OrganizerIcon({ organizer, size = 14, color = 'currentColor' }: {
  organizer: Organizer
  size?: number
  color?: string
}) {
  const Icon = ORGANIZER_ICON[organizer]
  return <Icon width={size} height={size} style={{ color, flexShrink: 0 }} />
}

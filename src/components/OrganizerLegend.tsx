import { ORGANIZER_META, organizerLabel, type Organizer } from '../types'
import { useStore } from '../store'

// Persistent, always-visible key to the three fixed organizer categories. The
// colors are fixed structural roles and never renamed, but the TEXT must track
// the project's "Customize categories" renames (organizerLabel) - otherwise
// this legend, whose whole job is being the reference key to the category
// system, is the one place left showing a stale default name.
const LEGEND_ORDER: Organizer[] = ['core_idea', 'point_of_tension', 'open_thought']

// `pill` = Map-view variant: a subtle surface-1 pill so the strip stays legible
// floating over the graph. Default (Linear) sits inline with a bottom border.
export function OrganizerLegend({ pill = false }: { pill?: boolean }) {
  const organizerLabels = useStore(s => s.organizerLabels)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-4)',
        fontFamily: 'var(--font-sans)',
        fontSize: '10px',
        lineHeight: 1.2,
        color: 'var(--text-secondary)',
        ...(pill
          ? { padding: 'var(--sp-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-md)' }
          : {}),
      }}
    >
      {LEGEND_ORDER.map(org => {
        const meta = ORGANIZER_META[org]
        return (
          <span key={org} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.cssVar, flexShrink: 0 }} />
            {organizerLabel(org, { organizerLabels })}
          </span>
        )
      })}
    </div>
  )
}

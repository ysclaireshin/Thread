import { ORGANIZER_META, type Organizer } from '../types'

// Persistent, always-visible key to the three fixed organizer categories. The
// colors and short labels come straight from ORGANIZER_META (the fixed schema -
// never renamed here), so this reads as the same system everywhere it appears.
const LEGEND_ORDER: Organizer[] = ['core_idea', 'point_of_tension', 'open_thought']

// `pill` = Map-view variant: a subtle surface-1 pill so the strip stays legible
// floating over the graph. Default (Linear) sits inline with a bottom border.
export function OrganizerLegend({ pill = false }: { pill?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-4)',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--text-tertiary)',
        letterSpacing: '0.03em',
        ...(pill
          ? { padding: 'var(--sp-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-md)' }
          : { padding: 'var(--sp-2) var(--sp-4)', borderBottom: '1px solid var(--border-subtle)' }),
      }}
    >
      {LEGEND_ORDER.map(org => {
        const meta = ORGANIZER_META[org]
        return (
          <span key={org} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.cssVar, flexShrink: 0 }} />
            {meta.short}
          </span>
        )
      })}
    </div>
  )
}

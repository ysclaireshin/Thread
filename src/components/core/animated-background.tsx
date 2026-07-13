import { AnimatePresence, motion } from 'motion/react'
import type { Transition } from 'framer-motion'
import { Children, cloneElement, type ReactElement, useEffect, useState, useId } from 'react'

export type AnimatedBackgroundProps = {
  children: ReactElement<{ 'data-id': string }>[] | ReactElement<{ 'data-id': string }>
  defaultValue?: string
  onValueChange?: (newActiveId: string | null) => void
  className?: string
  style?: React.CSSProperties
  transition?: Transition
  enableHover?: boolean
}

export function AnimatedBackground({
  children,
  defaultValue,
  onValueChange,
  style,
  transition,
  enableHover = false,
}: AnimatedBackgroundProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const uniqueId = useId()

  const handleSetActiveId = (id: string | null) => {
    setActiveId(id)
    if (onValueChange) onValueChange(id)
  }

  useEffect(() => {
    if (defaultValue !== undefined) setActiveId(defaultValue)
  }, [defaultValue])

  return Children.map(children, (child: any, index) => {
    const id = child.props['data-id']

    const interactionProps = enableHover
      ? { onMouseEnter: () => handleSetActiveId(id), onMouseLeave: () => handleSetActiveId(null) }
      : { onClick: () => handleSetActiveId(id) }

    return cloneElement(
      child,
      {
        key: index,
        style: { ...child.props.style, position: 'relative' as const },
        'data-checked': activeId === id ? 'true' : 'false',
        ...interactionProps,
      },
      <>
        <AnimatePresence initial={false}>
          {activeId === id && (
            <motion.div
              layoutId={`background-${uniqueId}`}
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-3)',
                ...style,
              }}
              transition={transition}
              initial={{ opacity: defaultValue ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
        <span style={{ position: 'relative', zIndex: 1 }}>{child.props.children}</span>
      </>
    )
  })
}

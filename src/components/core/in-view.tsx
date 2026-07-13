import { type ReactNode, useRef, useState } from 'react'
import { motion, useInView } from 'motion/react'
import type { Transition, Variant } from 'framer-motion'
import type { UseInViewOptions } from 'motion/react'

export type InViewProps = {
  children: ReactNode
  variants?: { hidden: Variant; visible: Variant }
  transition?: Transition
  viewOptions?: UseInViewOptions
  as?: keyof typeof motion
  once?: boolean
}

const defaultVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

export function InView({
  children,
  variants = defaultVariants,
  transition,
  viewOptions,
  as = 'div',
  once = true,
}: InViewProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, viewOptions)
  const [isViewed, setIsViewed] = useState(false)
  const MotionComponent = motion[as] as any

  return (
    <MotionComponent
      ref={ref}
      initial='hidden'
      animate={isInView || isViewed ? 'visible' : 'hidden'}
      onAnimationComplete={() => { if (once) setIsViewed(true) }}
      variants={variants}
      transition={transition}
    >
      {children}
    </MotionComponent>
  )
}

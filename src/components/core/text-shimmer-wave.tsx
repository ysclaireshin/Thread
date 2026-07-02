'use client'
import { type JSX } from 'react'
import { motion } from 'motion/react'
import type { Transition } from 'framer-motion'
import { cn } from '../../lib/utils'

export type TextShimmerWaveProps = {
  children: string
  as?: React.ElementType
  className?: string
  duration?: number
  zDistance?: number
  xDistance?: number
  yDistance?: number
  spread?: number
  scaleDistance?: number
  rotateYDistance?: number
  transition?: Transition
  style?: React.CSSProperties
}

export function TextShimmerWave({
  children,
  as: Component = 'p',
  className,
  duration = 1,
  zDistance = 10,
  xDistance = 2,
  yDistance = -2,
  spread = 1,
  scaleDistance = 1.1,
  rotateYDistance = 10,
  transition,
  style,
}: TextShimmerWaveProps) {
  const MotionComponent = motion.create(Component as keyof JSX.IntrinsicElements)

  return (
    <MotionComponent
      className={cn('relative inline-block [perspective:500px]', className)}
      style={style}
    >
      {children.split('').map((char, i) => {
        const delay = (i * duration * (1 / spread)) / children.length

        return (
          <motion.span
            key={i}
            className='inline-block whitespace-pre [transform-style:preserve-3d]'
            initial={{ translateZ: 0, scale: 1, rotateY: 0 }}
            animate={{
              translateZ: [0, zDistance, 0],
              translateX: [0, xDistance, 0],
              translateY: [0, yDistance, 0],
              scale: [1, scaleDistance, 1],
              rotateY: [0, rotateYDistance, 0],
            }}
            transition={{
              duration,
              repeat: Infinity,
              repeatDelay: (children.length * 0.05) / spread,
              delay,
              ease: 'easeInOut',
              ...transition,
            }}
          >
            {char}
          </motion.span>
        )
      })}
    </MotionComponent>
  )
}

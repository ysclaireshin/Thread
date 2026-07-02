import { motion, useSpring, useTransform } from 'motion/react'
import { useEffect } from 'react'

type SpringOptions = Parameters<typeof useSpring>[1]

export type AnimatedNumberProps = {
  value: number
  style?: React.CSSProperties
  springOptions?: SpringOptions
  as?: keyof typeof motion
}

export function AnimatedNumber({
  value,
  style,
  springOptions,
  as = 'span',
}: AnimatedNumberProps) {
  const MotionComponent = motion[as] as any
  const spring = useSpring(value, springOptions ?? { stiffness: 200, damping: 20 })
  const display = useTransform(spring, (current) => Math.round(current).toString())

  useEffect(() => {
    spring.set(value)
  }, [spring, value])

  return (
    <MotionComponent style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {display}
    </MotionComponent>
  )
}

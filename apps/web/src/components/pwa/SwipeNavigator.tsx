"use client"

import { type ReactNode, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { motion, useMotionValue, animate, type PanInfo } from "motion/react"

const NAV_ORDER = ["/menu", "/shopping", "/recipes", "/advisor", "/profile"]

interface Props {
  children: ReactNode
}

export function SwipeNavigator({ children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const x = useMotionValue(0)

  // Find current tab index. If pathname doesn't start with any NAV path, swipe is disabled.
  const currentIndex = NAV_ORDER.findIndex((p) => pathname.startsWith(p))

  // Reset x to 0 whenever the pathname changes (after a swipe-induced navigation)
  useEffect(() => {
    animate(x, 0, { duration: 0 })
  }, [pathname, x])

  function handlePan(_e: PointerEvent, info: PanInfo) {
    if (currentIndex < 0) return
    const dx = info.offset.x
    const dy = info.offset.y
    // In-pan: bail out if vertical-dominant
    if (Math.abs(dx) <= Math.abs(dy) * 1.5) {
      x.set(0)
      return
    }
    // Edge resistance
    const isFirst = currentIndex === 0
    const isLast = currentIndex === NAV_ORDER.length - 1
    if (isFirst && dx > 0) {
      x.set(Math.pow(dx, 0.7))
    } else if (isLast && dx < 0) {
      x.set(-Math.pow(Math.abs(dx), 0.7))
    } else {
      x.set(dx)
    }
  }

  function handlePanEnd(_e: PointerEvent, info: PanInfo) {
    if (currentIndex < 0) return
    const dx = info.offset.x
    const dy = info.offset.y
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 430
    const threshold = viewportWidth * 0.3

    const horizontalDominant = Math.abs(dx) > Math.abs(dy) * 1.5
    const isFirst = currentIndex === 0
    const isLast = currentIndex === NAV_ORDER.length - 1

    if (horizontalDominant && Math.abs(dx) > threshold) {
      if (dx < 0 && !isLast) {
        animate(x, -viewportWidth, { duration: 0.3, ease: [0.19, 1, 0.22, 1] }).then(() => {
          x.set(0)
          router.push(NAV_ORDER[currentIndex + 1])
        })
        return
      }
      if (dx > 0 && !isFirst) {
        animate(x, viewportWidth, { duration: 0.3, ease: [0.19, 1, 0.22, 1] }).then(() => {
          x.set(0)
          router.push(NAV_ORDER[currentIndex - 1])
        })
        return
      }
    }
    // Spring back
    animate(x, 0, { duration: 0.3, ease: [0.19, 1, 0.22, 1] })
  }

  if (currentIndex < 0) {
    // Not on a swipeable tab route — render without gesture handling
    return <>{children}</>
  }

  return (
    <motion.div
      style={{ x, touchAction: "pan-y" }}
      onPan={handlePan}
      onPanEnd={handlePanEnd}
    >
      {children}
    </motion.div>
  )
}

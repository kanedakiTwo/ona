"use client"

import { type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"

interface PageTransitionProps {
  children: ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25, ease: [0.19, 1, 0.22, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { motion } from "motion/react"
import { Play } from "lucide-react"

/**
 * Sticky bottom action bar of the recipe detail (mobile / tablet, < lg).
 * Replaces the bottom tab bar on this route (Navbar hides itself there), so
 * "Empezar a cocinar" is always one tap away whatever tab or scroll position.
 *
 * Portalled to <body>: the page lives inside PageTransition / SwipeNavigator
 * motion wrappers, and a transformed ancestor would turn `position: fixed`
 * into "fixed to the wrapper" while the entrance animation runs.
 *
 * Height is 84 px + the iOS home-indicator inset; the page reserves that
 * much room at the bottom so the last line of every tab clears it.
 */
export function RecipeActionBar({ cookHref }: { cookHref: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      transition={{ duration: 0.45, ease: [0.19, 1, 0.22, 1] }}
      data-testid="recipe-action-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E8E2D3] bg-[#FFFEFA] pb-[var(--safe-bottom)] md:left-[var(--sidebar-width)] lg:hidden"
    >
      <div className="mx-auto flex h-[84px] w-full max-w-[430px] items-center gap-2.5 px-5 pb-2.5 md:max-w-[640px]">
        <Link
          href={cookHref}
          className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-full bg-[#1A1612] text-[16px] font-semibold text-[#FAF6EE] transition-colors hover:bg-[#2D6A4F] active:scale-[0.98]"
        >
          <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden />
          Empezar a cocinar
        </Link>
      </div>
    </motion.div>,
    document.body,
  )
}

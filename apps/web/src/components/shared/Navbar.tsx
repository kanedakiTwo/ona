"use client"

import { usePathname } from "next/navigation"
import { motion } from "motion/react"
import { useAuth } from "@/lib/auth"
import { haptic } from "@/lib/pwa/haptics"
import { TransitionLink } from "@/components/pwa/TransitionLink"
import { CalendarDays, ShoppingCart, BookOpen, MessageCircle, User } from "lucide-react"

const NAV_ITEMS = [
  { href: "/menu", label: "Menu", icon: CalendarDays },
  { href: "/shopping", label: "Compra", icon: ShoppingCart },
  { href: "/recipes", label: "Recetas", icon: BookOpen },
  { href: "/advisor", label: "Asesor", icon: MessageCircle },
  { href: "/profile", label: "Perfil", icon: User },
]

export default function Navbar() {
  const { user } = useAuth()
  const pathname = usePathname()

  if (!user) return null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-[max(env(safe-area-inset-bottom),12px)]">
      <div className="mx-auto w-full max-w-[430px] px-3 pb-3">
        <div className="relative w-full rounded-full border border-[#DDD6C5] bg-[#FFFEFA]/95 px-2 py-1.5 shadow-[0_8px_32px_-8px_rgba(26,22,18,0.18)] backdrop-blur-md">
          {/* flex-1 + basis-0 on each item gives every nav button an equal
              slice of the pill regardless of icon size or transient motion
              measurements — fixes the "pill shrinks to the right, only 3
              items visible" bug Miguel hit intermittently. The previous
              `justify-around` left widths up to flexbox's intrinsic guess,
              and a shared-layout motion.div mid-transition could nudge
              measurements off. */}
          <div className="flex w-full items-center">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = pathname.startsWith(item.href)
              return (
                <TransitionLink
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    if (!isActive) haptic.light()
                  }}
                  className="relative flex h-12 flex-1 basis-0 items-center justify-center transition-colors active:scale-95"
                  aria-label={item.label}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-y-0 left-1/2 h-12 w-12 -translate-x-1/2 rounded-full bg-[#1A1612]"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <Icon
                    size={19}
                    strokeWidth={isActive ? 2 : 1.6}
                    className={`relative z-10 transition-colors ${
                      isActive ? "text-[#FAF6EE]" : "text-[#7A7066]"
                    }`}
                  />
                </TransitionLink>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}

"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { haptic } from "@/lib/pwa/haptics"
import { TransitionLink } from "@/components/pwa/TransitionLink"
import { CalendarDays, ShoppingCart, BookOpen, MessageCircle, User } from "lucide-react"

const NAV_ITEMS: { href: string; label: string; icon: typeof CalendarDays; also?: string[] }[] = [
  { href: "/menu", label: "Menú", icon: CalendarDays },
  { href: "/shopping", label: "Compra", icon: ShoppingCart, also: ["/compra"] },
  { href: "/recipes", label: "Recetas", icon: BookOpen },
  { href: "/advisor", label: "Asesor", icon: MessageCircle },
  { href: "/profile", label: "Perfil", icon: User },
]

/**
 * Routes where the bar is hidden (full-screen flows). One pattern per
 * route; add yours here.
 */
const HIDDEN_ON: RegExp[] = [
  /^\/recipes\/[^/]+\/cook(\/|$)/,
  /^\/recipes\/(?!new\/?$)[^/]+\/?$/, // recipe detail has its own sticky action bar
]

/**
 * Mobile bottom tab bar (< md): fixed, full width, paper with a top border,
 * five tabs with icon + visible label. The active tab is ink with a heavier
 * stroke. Its 60 px (+ safe-area inset) fit the `pb-20` + safe-area reserve
 * that the app `<main>` keeps (app/layout.tsx).
 */
export default function Navbar() {
  const { user } = useAuth()
  const pathname = usePathname()

  if (!user) return null
  if (HIDDEN_ON.some((re) => re.test(pathname ?? ""))) return null

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border-soft bg-paper pb-[var(--safe-bottom)] md:hidden"
    >
      <ul className="mx-auto grid h-[60px] max-w-[560px] grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = [item.href, ...(item.also ?? [])].some((p) => pathname?.startsWith(p))
          return (
            <li key={item.href} className="flex">
              <TransitionLink
                href={item.href}
                onClick={() => {
                  if (!isActive) haptic.light()
                }}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-1 flex-col items-center justify-center gap-[3px] text-[11px] leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink active:scale-95 ${
                  isActive ? "font-semibold text-ink" : "font-medium text-ink-muted hover:text-ink"
                }`}
              >
                <Icon aria-hidden="true" size={22} strokeWidth={isActive ? 2.2 : 1.6} />
                {item.label}
              </TransitionLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

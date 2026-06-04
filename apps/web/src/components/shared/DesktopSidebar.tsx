"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { haptic } from "@/lib/pwa/haptics"
import { TransitionLink } from "@/components/pwa/TransitionLink"
import { CalendarDays, ShoppingCart, BookOpen, MessageCircle, User } from "lucide-react"

const NAV_ITEMS = [
  { href: "/menu", label: "Menú", icon: CalendarDays },
  { href: "/shopping", label: "Compra", icon: ShoppingCart },
  { href: "/recipes", label: "Recetas", icon: BookOpen },
  { href: "/advisor", label: "Asesor", icon: MessageCircle },
  { href: "/profile", label: "Perfil", icon: User },
]

export default function DesktopSidebar() {
  const { user } = useAuth()
  const pathname = usePathname()

  if (!user) return null
  if (pathname?.includes("/cook")) return null

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] flex-col border-r border-[#DDD6C5] bg-[#FFFEFA]/95 px-3 py-6 backdrop-blur-md md:flex"
      aria-label="Navegación principal"
    >
      <div className="mb-8 px-3">
        <span
          className="font-[family-name:var(--font-italic)] text-[26px] italic leading-none text-[#1A1612]"
        >
          Ona
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = pathname?.startsWith(item.href) ?? false
          return (
            <TransitionLink
              key={item.href}
              href={item.href}
              onClick={() => { if (!isActive) haptic.light() }}
              className={`flex items-center gap-3 rounded-full px-3 py-2 text-[13px] transition-colors ${
                isActive
                  ? "bg-[#1A1612] text-[#FAF6EE]"
                  : "text-[#4A4239] hover:bg-[#F2EDE0]"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={16} strokeWidth={isActive ? 2 : 1.6} />
              <span>{item.label}</span>
            </TransitionLink>
          )
        })}
      </nav>
    </aside>
  )
}

"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { haptic } from "@/lib/pwa/haptics"
import { TransitionLink } from "@/components/pwa/TransitionLink"
import { CalendarDays, ShoppingCart, BookOpen, User, Database, Users, Ticket, ScrollText, Mic, MailPlus, MessageSquareHeart, ClipboardCheck, BarChart3, LogOut } from "lucide-react"
import { ADMIN_MENU, adminAreaFromPath, type AdminArea } from "@/lib/adminNav"
import { MimoiaLogo } from "@/components/brand/Mimoia"

const NAV_ITEMS = [
  { href: "/menu", label: "Menú", icon: CalendarDays },
  { href: "/shopping", label: "Compra", icon: ShoppingCart },
  { href: "/recipes", label: "Recetas", icon: BookOpen },
  { href: "/profile", label: "Perfil", icon: User },
]

const ADMIN_ICONS: Record<AdminArea, typeof User> = {
  catalogo: Database,
  recetas: ClipboardCheck,
  usuarios: Users,
  invitaciones: Ticket,
  "lista-espera": MailPlus,
  opiniones: MessageSquareHeart,
  funciones: BarChart3,
  auditoria: ScrollText,
  voz: Mic,
}

const itemClass = (isActive: boolean) =>
  `flex items-center gap-3 rounded-full px-3 py-2 text-[13px] transition-colors ${
    isActive ? "bg-[#1A1612] text-[#FAF6EE]" : "text-[#4A4239] hover:bg-[#F2EDE0]"
  }`

export default function DesktopSidebar() {
  const { user, logout } = useAuth()
  const pathname = usePathname()

  if (!user) return null
  if (pathname?.includes("/cook")) return null
  const adminArea = adminAreaFromPath(pathname)

  return (
    <aside
      data-app-shell
      className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] flex-col overflow-y-auto border-r border-[#DDD6C5] bg-[#FFFEFA]/95 px-3 py-6 backdrop-blur-md md:flex"
      aria-label="Navegación principal"
    >
      <div className="mb-8 px-3">
        <TransitionLink href="/menu" className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
          <MimoiaLogo size={22} testId="app-wordmark" />
        </TransitionLink>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = pathname?.startsWith(item.href) ?? false
          return (
            <TransitionLink
              key={item.href}
              href={item.href}
              data-first-steps={item.href === "/shopping" ? "shopping" : undefined}
              onClick={() => { if (!isActive) haptic.light() }}
              className={itemClass(isActive)}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={16} strokeWidth={isActive ? 2 : 1.6} />
              <span>{item.label}</span>
            </TransitionLink>
          )
        })}
      </nav>
      {user.role === "admin" && (
        <nav className="mt-6 flex flex-col gap-1 border-t border-[#DDD6C5] pt-5" aria-label="Admin">
          <span className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8A8174]">Admin</span>
          {ADMIN_MENU.map((item) => {
            const Icon = ADMIN_ICONS[item.area]
            const isActive = adminArea === item.area
            return (
              <TransitionLink
                key={item.href}
                href={item.href}
                onClick={() => { if (!isActive) haptic.light() }}
                className={itemClass(isActive)}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={16} strokeWidth={isActive ? 2 : 1.6} />
                <span>{item.label}</span>
              </TransitionLink>
            )
          })}
        </nav>
      )}
      {/* «Salir» at hand, bottom left (Miguel 2026-10-21: no hidden in Perfil). Perfil keeps its own for mobile. */}
      <div className="mt-auto border-t border-[#DDD6C5] pt-4">
        <button type="button" onClick={logout} className={`${itemClass(false)} w-full`} data-testid="sidebar-logout">
          <LogOut size={16} strokeWidth={1.6} aria-hidden="true" />
          <span>Salir</span>
        </button>
      </div>
    </aside>
  )
}

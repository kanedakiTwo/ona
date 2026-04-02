"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { CalendarDays, ShoppingCart, BookOpen, Activity, User, LogOut } from "lucide-react"

const NAV_ITEMS = [
  { href: "/menu", label: "Menu", icon: CalendarDays },
  { href: "/shopping", label: "Compra", icon: ShoppingCart },
  { href: "/recipes", label: "Recetas", icon: BookOpen },
  { href: "/advisor", label: "Asesor", icon: Activity },
  { href: "/profile", label: "Perfil", icon: User },
]

export default function Navbar() {
  const { user, logout } = useAuth()
  const pathname = usePathname()

  if (!user) return null

  return (
    <nav className="border-b border-[#EEEEEE] bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/menu" className="text-xl font-bold text-[#2D6A4F] font-[family-name:var(--font-display)]">
          ONA
        </Link>

        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[#D8F3DC] text-[#2D6A4F]"
                    : "text-[#444444] hover:text-[#1A1A1A]"
                )}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            )
          })}
          <button
            onClick={logout}
            className="ml-2 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[#777777] hover:text-[#444444]"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  )
}

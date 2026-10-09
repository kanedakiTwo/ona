"use client"

/**
 * /menu/history — past weeks ("D · Luz y foto", PRO-43). Each week is a
 * paper card (range title, creation date, up to four `RecipeCover`
 * thumbnails of what was planned) linking to `/menu?week=<weekStart>`.
 *
 * Thumbnails come from the same per-week menu query `/menu` uses
 * (`["menu", userId, weekStart]`), so opening a week afterwards is instant.
 */
import { useAuth } from "@/lib/auth"
import { useQueries, useQuery } from "@tanstack/react-query"
import { api, ApiError } from "@/lib/api"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import type { DayMenu } from "@ona/shared"
import { RecipeCover } from "@/components/menu/RecipeCover"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"
import { weekRangeLabel } from "@/lib/menuDay"
import { createdLabel, weekCovers } from "@/lib/menuHistory"

interface MenuSummary {
  id: string
  weekStart: string
  createdAt: string
}

interface WeekMenu {
  days: DayMenu[]
}

const THUMBS = 4

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[1180px] px-5 pt-4 pb-12 lg:px-12 lg:pt-8 lg:pb-10">{children}</div>
    </div>
  )
}

function WeekThumbs({ days, loading }: { days: DayMenu[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="mt-3 grid grid-cols-4 gap-2" aria-hidden="true">
        {Array.from({ length: THUMBS }).map((_, i) => (
          <div key={i} className="aspect-square rounded-[12px] bg-bone animate-pulse" />
        ))}
      </div>
    )
  }
  const { covers, total } = weekCovers(days, THUMBS)
  if (total === 0) {
    return days ? <p className="mt-3 text-[13px] text-ink-muted">Semana sin platos.</p> : null
  }
  // With more recipes than tiles, the last tile says "+N" instead of a photo.
  const overflow = total > THUMBS
  const shown = overflow ? covers.slice(0, THUMBS - 1) : covers
  return (
    <div className="mt-3 grid grid-cols-4 gap-2" aria-hidden="true">
      {shown.map((c) => (
        <RecipeCover
          key={c.recipeId}
          src={c.imageUrl}
          name={c.name}
          meal={c.meal}
          className="aspect-square h-full w-full rounded-[12px]"
        />
      ))}
      {overflow && (
        <div className="flex aspect-square items-center justify-center rounded-[12px] bg-cream-deep text-[14px] font-semibold text-ink-mid">
          +{total - (THUMBS - 1)}
        </div>
      )}
    </div>
  )
}

export default function MenuHistoryPage() {
  const { user, isLoading: authLoading } = useAuth()

  const {
    data: menus,
    isLoading,
    error,
  } = useQuery<MenuSummary[]>({
    queryKey: ["menu-history", user?.id],
    queryFn: () => api.get(`/menu/${user!.id}/history`),
    enabled: !!user,
  })

  const weeks = Array.from(new Set((menus ?? []).map((m) => m.weekStart)))
  const weekQueries = useQueries({
    queries: weeks.map((weekStart) => ({
      queryKey: ["menu", user?.id, weekStart],
      queryFn: async (): Promise<WeekMenu | null> => {
        try {
          return await api.get<WeekMenu>(`/menu/${user!.id}/${weekStart}`)
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
      enabled: !!user,
    })),
  })
  const weekData = new Map(weeks.map((w, i) => [w, weekQueries[i]]))

  if (authLoading || isLoading) {
    return (
      <Shell>
        <p className="mt-10 text-center text-eyebrow text-ink-muted" role="status">
          Cargando historial...
        </p>
      </Shell>
    )
  }

  if (!user) {
    return (
      <Shell>
        <p className="mt-10 text-center text-[15px] text-ink-muted">Inicia sesión para ver tu historial.</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="mb-6 flex items-center gap-3 lg:mb-8">
        <Link
          href="/menu"
          aria-label="Volver al menú"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <ChevronLeft size={20} strokeWidth={2} />
        </Link>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">Menú</p>
          <h1 className={`${DISPLAY_UI} text-[30px] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]`}>
            Historial de menús
          </h1>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-[22px] border border-border bg-paper px-6 py-8 text-center">
          <p className="font-serif-text font-[650] text-lg text-ink">Error al cargar el historial.</p>
          <p className="mt-1 text-[14px] text-ink-muted">Vuelve a intentarlo en un momento.</p>
        </div>
      )}

      {menus && menus.length === 0 && (
        <div className="rounded-[22px] border border-dashed border-border bg-paper px-6 py-12 text-center">
          <p className="font-serif-text font-[650] text-xl text-ink">No tienes menús anteriores.</p>
          <Link
            href="/menu"
            className="mt-5 inline-flex min-h-11 items-center rounded-full bg-ink px-6 text-[14px] font-semibold text-cream transition-colors hover:bg-ink-mid"
          >
            Ir al menú
          </Link>
        </div>
      )}

      {menus && menus.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-5">
          {menus.map((menu) => {
            const q = weekData.get(menu.weekStart)
            const created = createdLabel(menu.createdAt)
            return (
              <li key={menu.id}>
                <Link
                  href={`/menu?week=${menu.weekStart}`}
                  className="block h-full rounded-[20px] border border-border-soft bg-paper p-4 text-ink transition-colors hover:border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`${DISPLAY_UI} text-[18px] leading-[1.2]`}>{weekRangeLabel(menu.weekStart)}</p>
                      {created && <p className="mt-0.5 text-[13px] text-ink-muted">{created}</p>}
                    </div>
                    <ChevronRight size={18} className="mt-1 shrink-0 text-ink-light" aria-hidden="true" />
                  </div>
                  <WeekThumbs days={q?.data?.days} loading={!!q?.isLoading} />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Shell>
  )
}

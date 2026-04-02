"use client"

import { useAuth } from "@/lib/auth"
import { useMenu, useGenerateMenu } from "@/hooks/useMenu"
import { WeekCalendar } from "@/components/menu/WeekCalendar"
import { GenerateButton } from "@/components/menu/GenerateButton"
import { RefreshCw } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"

function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday is 1
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  const yyyy = monday.getFullYear()
  const mm = String(monday.getMonth() + 1).padStart(2, "0")
  const dd = String(monday.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export default function MenuPage() {
  const { user, isLoading: authLoading } = useAuth()
  const weekStart = useMemo(() => getWeekStart(), [])

  const {
    data: menu,
    isLoading: menuLoading,
    error: menuError,
  } = useMenu(user?.id, weekStart)

  const generateMenu = useGenerateMenu()

  function handleGenerate() {
    if (!user) return
    generateMenu.mutate({ userId: user.id, weekStart })
  }

  if (authLoading || menuLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-gray-500">Cargando menu...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-gray-500">
          Inicia sesion para ver tu menu.
        </p>
      </div>
    )
  }

  if (menuError) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="text-3xl font-bold">Menu semanal</h1>
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-600">
            Error al cargar el menu. Intenta de nuevo.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Menu semanal</h1>
          <p className="mt-1 text-sm text-gray-500">
            Semana del {weekStart}
          </p>
        </div>
        <Link
          href="/menu/history"
          className="text-sm text-gray-500 hover:text-black"
        >
          Ver historial
        </Link>
      </div>

      {!menu ? (
        <div className="mt-12 flex flex-col items-center gap-4 rounded-xl border border-dashed border-gray-300 py-16">
          <p className="text-gray-500">
            Aun no tienes un menu para esta semana.
          </p>
          <GenerateButton
            onGenerate={handleGenerate}
            isLoading={generateMenu.isPending}
          />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <WeekCalendar
              days={menu.days}
              locked={menu.locked}
              menuId={menu.id}
              onRegenerate={handleGenerate}
            />
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={generateMenu.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw
                size={16}
                className={generateMenu.isPending ? "animate-spin" : ""}
              />
              {generateMenu.isPending ? "Regenerando..." : "Regenerar menu"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

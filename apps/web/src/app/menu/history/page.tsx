"use client"

import { useAuth } from "@/lib/auth"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { ChevronLeft } from "lucide-react"
import Link from "next/link"

interface MenuSummary {
  id: string
  weekStart: string
  createdAt: string
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

  if (authLoading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-gray-500">Cargando historial...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-gray-500">Inicia sesion para ver tu historial.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <Link href="/menu" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-black">
          <ChevronLeft size={20} />
        </Link>
        <h1 className="text-3xl font-bold">Historial de menus</h1>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600">
          Error al cargar el historial.
        </div>
      )}

      {menus && menus.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500">No tienes menus anteriores.</p>
          <Link
            href="/menu"
            className="mt-4 inline-block rounded-lg bg-black px-6 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Ir al menu
          </Link>
        </div>
      )}

      {menus && menus.length > 0 && (
        <div className="space-y-3">
          {menus.map((menu) => (
            <Link
              key={menu.id}
              href={`/menu?week=${menu.weekStart}`}
              className="block rounded-xl border border-gray-200 p-4 transition-colors hover:border-gray-300 hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Semana del {menu.weekStart}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Creado el{" "}
                    {new Date(menu.createdAt).toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <ChevronLeft size={16} className="rotate-180 text-gray-400" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

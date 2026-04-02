'use client'

import { Activity } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useAdvisorSummary } from '@/hooks/useAdvisor'
import NutrientSummary from '@/components/advisor/NutrientSummary'
import AdvisorChat from '@/components/advisor/AdvisorChat'

export default function AdvisorPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { data: summary, isLoading: summaryLoading } = useAdvisorSummary(
    user?.id
  )

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">
          Inicia sesion para acceder al asesor nutricional
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-gray-700" />
          <h1 className="text-2xl font-bold">Asesor nutricional</h1>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Un espacio para reflexionar sobre tu alimentacion. Sin juicios, con
          datos.
        </p>
      </div>

      {/* Nutritional summary section */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">
          Tu resumen nutricional
        </h2>
        {summaryLoading ? (
          <div className="flex h-48 items-center justify-center rounded-xl border border-gray-200">
            <p className="text-sm text-gray-400">Analizando tus datos...</p>
          </div>
        ) : summary ? (
          <NutrientSummary summary={summary} />
        ) : (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 text-center">
            <p className="text-sm text-gray-500">
              Todavia no hay datos suficientes para generar un resumen.
            </p>
            <p className="text-xs text-gray-400">
              Genera tu primer menu semanal para empezar a ver resultados.
            </p>
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="mb-10 border-t border-gray-200" />

      {/* Chat section */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-800">
          Conversa con tu asesor
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          Pregunta lo que quieras sobre tu alimentacion. El asesor analiza tus
          menus y te da respuestas basadas en tus datos reales.
        </p>
        <AdvisorChat userId={user.id} />
      </section>
    </div>
  )
}

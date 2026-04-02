'use client'

import { TrendingUp, Activity } from 'lucide-react'
import MacroChart from '@/components/charts/MacroChart'

interface NutrientSummaryProps {
  summary: any
}

const TREND_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  improving: { label: 'Mejorando', color: 'text-green-600', bg: 'bg-green-50' },
  stable: { label: 'Estable', color: 'text-blue-600', bg: 'bg-blue-50' },
  declining: { label: 'A mejorar', color: 'text-amber-600', bg: 'bg-amber-50' },
}

export default function NutrientSummary({ summary }: NutrientSummaryProps) {
  if (!summary) return null

  const macros = summary.averageMacros ?? summary.macros
  const calories = summary.averageCalories ?? summary.avg_daily_calories ?? 0
  const weeksCount = summary.weeks?.length ?? summary.weeks_analyzed ?? 0
  const trend = summary.trend ? TREND_CONFIG[summary.trend] : null
  const insights = summary.insights ?? []
  const suggestions = summary.suggestions ?? []

  const hasMacroData = macros && (macros.protein > 0 || macros.carbohydrates > 0 || macros.fat > 0)

  if (weeksCount === 0 && !hasMacroData) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center">
        <Activity className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 text-gray-500">Aun no hay datos suficientes.</p>
        <p className="mt-1 text-sm text-gray-400">Genera y usa menus semanales para que el asesor tenga datos.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-sm text-gray-500">Calorias/dia</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {Math.round(calories) || '--'}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-sm text-gray-500">Semanas analizadas</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{weeksCount}</p>
          {trend && (
            <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${trend.bg} ${trend.color}`}>
              <TrendingUp className="h-3 w-3" />
              {trend.label}
            </span>
          )}
        </div>

        {hasMacroData && (
          <div className="col-span-2 rounded-xl border border-gray-200 p-4 sm:col-span-1">
            <p className="text-center text-sm text-gray-500">Macros promedio</p>
            <div className="mt-2 flex justify-center gap-4 text-xs text-gray-600">
              <span>P: {Math.round(macros.protein ?? 0)}g</span>
              <span>C: {Math.round(macros.carbohydrates ?? macros.carbs ?? 0)}g</span>
              <span>G: {Math.round(macros.fat ?? 0)}g</span>
            </div>
          </div>
        )}
      </div>

      {/* Macro chart */}
      {hasMacroData && (
        <div className="rounded-xl border border-gray-200 p-5">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Distribucion de macronutrientes</h3>
          <MacroChart
            protein={macros.protein ?? 0}
            carbs={macros.carbohydrates ?? macros.carbs ?? 0}
            fat={macros.fat ?? 0}
          />
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Activity className="h-4 w-4" />
            Observaciones
          </h3>
          <ul className="space-y-2">
            {insights.map((insight: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Sugerencias</h3>
          <ul className="space-y-2">
            {suggestions.map((s: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

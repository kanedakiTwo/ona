'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

interface TrendDataPoint {
  week: string
  protein: number
  carbs: number
  fat: number
}

interface NutrientTrendProps {
  data: TrendDataPoint[]
}

export default function NutrientTrend({ data }: NutrientTrendProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        Sin datos de tendencia todavia
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 12, fill: '#6b7280' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 12, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          unit="g"
        />
        <Tooltip
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            fontSize: '14px',
          }}
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              protein: 'Proteina',
              carbs: 'Carbohidratos',
              fat: 'Grasa',
            }
            return [`${value}g`, labels[name] ?? name]
          }}
        />
        <Legend
          formatter={(value: string) => {
            const labels: Record<string, string> = {
              protein: 'Proteina',
              carbs: 'Carbohidratos',
              fat: 'Grasa',
            }
            return labels[value] ?? value
          }}
        />
        <Line
          type="monotone"
          dataKey="protein"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ r: 4 }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="carbs"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 4 }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="fat"
          stroke="#ef4444"
          strokeWidth={2}
          dot={{ r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

'use client'

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts'

interface MacroChartProps {
  protein: number
  carbs: number
  fat: number
}

const COLORS = {
  protein: '#3b82f6', // blue-500
  carbs: '#f59e0b',   // amber-500
  fat: '#ef4444',     // red-500
}

const LABELS: Record<string, string> = {
  protein: 'Proteina',
  carbs: 'Carbohidratos',
  fat: 'Grasa',
}

export default function MacroChart({ protein, carbs, fat }: MacroChartProps) {
  const total = protein + carbs + fat

  if (total === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        Sin datos de macronutrientes
      </div>
    )
  }

  const data = [
    { name: 'protein', value: protein, label: LABELS.protein },
    { name: 'carbs', value: carbs, label: LABELS.carbs },
    { name: 'fat', value: fat, label: LABELS.fat },
  ]

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={3}
          dataKey="value"
          nameKey="label"
        >
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={COLORS[entry.name as keyof typeof COLORS]}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => {
            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0'
            return [`${value}g (${pct}%)`, name]
          }}
        />
        <Legend
          formatter={(value: string) => (
            <span className="text-sm text-gray-700">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

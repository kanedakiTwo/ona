'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { User, Settings, Activity, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PhysicalData {
  sex: 'male' | 'female' | ''
  age: number | ''
  weight: number | ''
  height: number | ''
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
}

interface Preferences {
  restrictions: string[]
  priority: 'balanced' | 'muscle' | 'weight_loss' | 'energy'
}

interface MealTemplate {
  [day: string]: string[] // e.g. { lunes: ['desayuno', 'almuerzo', 'cena'] }
}

const DAYS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
] as const

const MEALS = ['desayuno', 'almuerzo', 'merienda', 'cena'] as const

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: 'Sedentario (poco o nada)',
  light: 'Ligero (1-3 dias/sem)',
  moderate: 'Moderado (3-5 dias/sem)',
  active: 'Activo (6-7 dias/sem)',
  very_active: 'Muy activo (atleta)',
}

const PRIORITY_LABELS: Record<string, string> = {
  balanced: 'Equilibrado',
  muscle: 'Ganar musculo',
  weight_loss: 'Perder peso',
  energy: 'Mas energia',
}

const COMMON_RESTRICTIONS = [
  'sin gluten',
  'sin lactosa',
  'vegetariano',
  'vegano',
  'sin frutos secos',
  'sin mariscos',
  'sin huevo',
  'sin soja',
]

/* ------------------------------------------------------------------ */
/*  BMR / TDEE helpers                                                 */
/* ------------------------------------------------------------------ */

function calculateBMR(
  sex: string,
  weight: number,
  height: number,
  age: number
): number {
  // Mifflin-St Jeor
  if (sex === 'male') {
    return 10 * weight + 6.25 * height - 5 * age + 5
  }
  return 10 * weight + 6.25 * height - 5 * age - 161
}

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProfilePage() {
  const { user, isLoading: authLoading } = useAuth()

  const [physical, setPhysical] = useState<PhysicalData>({
    sex: '',
    age: '',
    weight: '',
    height: '',
    activity_level: 'moderate',
  })

  const [preferences, setPreferences] = useState<Preferences>({
    restrictions: [],
    priority: 'balanced',
  })

  const [mealTemplate, setMealTemplate] = useState<MealTemplate>(() => {
    const template: MealTemplate = {}
    for (const day of DAYS) {
      template[day] = ['desayuno', 'almuerzo', 'cena']
    }
    return template
  })

  const [restrictionInput, setRestrictionInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Load existing data
  useEffect(() => {
    if (!user) return

    api.get<{
      physical?: PhysicalData
      preferences?: Preferences
      meal_template?: MealTemplate
    }>(`/user/${user.id}/settings`).then((data) => {
      if (data.physical) setPhysical(data.physical)
      if (data.preferences) setPreferences(data.preferences)
      if (data.meal_template) setMealTemplate(data.meal_template)
    }).catch(() => {
      // Settings may not exist yet
    })
  }, [user])

  // Calculated values
  const bmr = useMemo(() => {
    if (!physical.sex || !physical.weight || !physical.height || !physical.age)
      return null
    return Math.round(
      calculateBMR(
        physical.sex,
        Number(physical.weight),
        Number(physical.height),
        Number(physical.age)
      )
    )
  }, [physical.sex, physical.weight, physical.height, physical.age])

  const tdee = useMemo(() => {
    if (!bmr) return null
    const mult = ACTIVITY_MULTIPLIERS[physical.activity_level] ?? 1.55
    return Math.round(bmr * mult)
  }, [bmr, physical.activity_level])

  // Handlers
  function addRestriction(value: string) {
    const trimmed = value.trim().toLowerCase()
    if (trimmed && !preferences.restrictions.includes(trimmed)) {
      setPreferences((prev) => ({
        ...prev,
        restrictions: [...prev.restrictions, trimmed],
      }))
    }
    setRestrictionInput('')
  }

  function removeRestriction(value: string) {
    setPreferences((prev) => ({
      ...prev,
      restrictions: prev.restrictions.filter((r) => r !== value),
    }))
  }

  function toggleMeal(day: string, meal: string) {
    setMealTemplate((prev) => {
      const dayMeals = prev[day] ?? []
      const next = dayMeals.includes(meal)
        ? dayMeals.filter((m) => m !== meal)
        : [...dayMeals, meal]
      return { ...prev, [day]: next }
    })
  }

  const handleSave = useCallback(async () => {
    if (!user) return
    setSaving(true)
    setSaved(false)

    try {
      await Promise.all([
        api.put(`/user/${user.id}`, {
          sex: physical.sex || undefined,
          age: physical.age || undefined,
          weight: physical.weight || undefined,
          height: physical.height || undefined,
          activity_level: physical.activity_level,
        }),
        api.put(`/user/${user.id}/settings`, {
          physical,
          preferences,
          meal_template: mealTemplate,
        }),
      ])
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Error saving profile:', err)
    } finally {
      setSaving(false)
    }
  }, [user, physical, preferences, mealTemplate])

  // Render guards
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
        <p className="text-gray-500">Inicia sesion para ver tu perfil</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <User className="h-6 w-6 text-gray-700" />
        <div>
          <h1 className="text-2xl font-bold">Perfil</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
      </div>

      {/* BMR / TDEE display */}
      {bmr && tdee && (
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-xs font-medium text-gray-400 uppercase">
              Metabolismo basal (BMR)
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {bmr}{' '}
              <span className="text-sm font-normal text-gray-400">kcal</span>
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-xs font-medium text-gray-400 uppercase">
              Gasto diario (TDEE)
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {tdee}{' '}
              <span className="text-sm font-normal text-gray-400">kcal</span>
            </p>
          </div>
        </div>
      )}

      {/* Physical data section */}
      <section className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-gray-600" />
          <h2 className="text-lg font-semibold">Datos fisicos</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sexo
            </label>
            <select
              value={physical.sex}
              onChange={(e) =>
                setPhysical((p) => ({
                  ...p,
                  sex: e.target.value as PhysicalData['sex'],
                }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
            >
              <option value="">Seleccionar</option>
              <option value="male">Masculino</option>
              <option value="female">Femenino</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Edad
            </label>
            <input
              type="number"
              min={1}
              max={120}
              value={physical.age}
              onChange={(e) =>
                setPhysical((p) => ({
                  ...p,
                  age: e.target.value ? Number(e.target.value) : '',
                }))
              }
              placeholder="30"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Peso (kg)
            </label>
            <input
              type="number"
              min={20}
              max={300}
              step={0.1}
              value={physical.weight}
              onChange={(e) =>
                setPhysical((p) => ({
                  ...p,
                  weight: e.target.value ? Number(e.target.value) : '',
                }))
              }
              placeholder="70"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Altura (cm)
            </label>
            <input
              type="number"
              min={100}
              max={250}
              value={physical.height}
              onChange={(e) =>
                setPhysical((p) => ({
                  ...p,
                  height: e.target.value ? Number(e.target.value) : '',
                }))
              }
              placeholder="175"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nivel de actividad
            </label>
            <select
              value={physical.activity_level}
              onChange={(e) =>
                setPhysical((p) => ({
                  ...p,
                  activity_level: e.target.value as PhysicalData['activity_level'],
                }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
            >
              {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Preferences section */}
      <section className="mt-10">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="h-5 w-5 text-gray-600" />
          <h2 className="text-lg font-semibold">Preferencias</h2>
        </div>

        {/* Priority */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Prioridad nutricional
          </label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <button
                key={value}
                onClick={() =>
                  setPreferences((p) => ({
                    ...p,
                    priority: value as Preferences['priority'],
                  }))
                }
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                  preferences.priority === value
                    ? 'border-black bg-black text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Restrictions */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Restricciones alimentarias
          </label>

          {/* Current tags */}
          <div className="flex flex-wrap gap-2 mb-3">
            {preferences.restrictions.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
              >
                {r}
                <button
                  onClick={() => removeRestriction(r)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-gray-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          {/* Common suggestions */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {COMMON_RESTRICTIONS.filter(
              (r) => !preferences.restrictions.includes(r)
            ).map((r) => (
              <button
                key={r}
                onClick={() => addRestriction(r)}
                className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-500 hover:border-gray-400 hover:text-gray-700"
              >
                + {r}
              </button>
            ))}
          </div>

          {/* Custom input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={restrictionInput}
              onChange={(e) => setRestrictionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addRestriction(restrictionInput)
                }
              }}
              placeholder="Agregar restriccion personalizada..."
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
            <button
              onClick={() => addRestriction(restrictionInput)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Agregar
            </button>
          </div>
        </div>
      </section>

      {/* Meal template section */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-2">Plantilla de comidas</h2>
        <p className="text-sm text-gray-500 mb-4">
          Configura que comidas incluir cada dia de la semana.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-2 pr-4 text-left font-medium text-gray-500">
                  Dia
                </th>
                {MEALS.map((meal) => (
                  <th
                    key={meal}
                    className="pb-2 px-2 text-center font-medium text-gray-500 capitalize"
                  >
                    {meal}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day) => (
                <tr key={day} className="border-b border-gray-100">
                  <td className="py-2.5 pr-4 font-medium text-gray-700 capitalize">
                    {day}
                  </td>
                  {MEALS.map((meal) => {
                    const active = (mealTemplate[day] ?? []).includes(meal)
                    return (
                      <td key={meal} className="py-2.5 px-2 text-center">
                        <button
                          onClick={() => toggleMeal(day, meal)}
                          className={`h-7 w-7 rounded-md border-2 transition-colors ${
                            active
                              ? 'border-black bg-black text-white'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                          aria-label={`${meal} el ${day}`}
                        >
                          {active && (
                            <svg
                              className="mx-auto h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Save button */}
      <div className="mt-10 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
        {saved && (
          <span className="text-sm text-green-600">
            Cambios guardados correctamente
          </span>
        )}
      </div>
    </div>
  )
}

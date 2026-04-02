"use client"

import { useState, type KeyboardEvent } from "react"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

const PRESET_RESTRICTIONS = [
  "sin gluten",
  "sin lacteos",
  "frutos secos",
  "marisco",
  "huevo",
  "soja",
  "vegetariano",
  "vegano",
]

interface OnboardingData {
  householdSize: string | null
  cookingFreq: string | null
  restrictions: string[]
  favoriteDishes: string[]
  priority: string | null
}

export default function OnboardingFlow() {
  const { user, updateUser } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  const [data, setData] = useState<OnboardingData>({
    householdSize: null,
    cookingFreq: null,
    restrictions: [],
    favoriteDishes: ["", "", ""],
    priority: null,
  })

  const [tagInput, setTagInput] = useState("")

  const totalSteps = 5

  function next() {
    if (step < totalSteps) setStep(step + 1)
  }

  function prev() {
    if (step > 1) setStep(step - 1)
  }

  function addRestriction(tag: string) {
    const trimmed = tag.trim().toLowerCase()
    if (trimmed && !data.restrictions.includes(trimmed)) {
      setData({ ...data, restrictions: [...data.restrictions, trimmed] })
    }
    setTagInput("")
  }

  function removeRestriction(tag: string) {
    setData({
      ...data,
      restrictions: data.restrictions.filter((r) => r !== tag),
    })
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addRestriction(tagInput)
    }
  }

  function setFavoriteDish(index: number, value: string) {
    const dishes = [...data.favoriteDishes]
    dishes[index] = value
    setData({ ...data, favoriteDishes: dishes })
  }

  async function handleComplete() {
    if (!user) return
    setIsSubmitting(true)
    setError("")

    try {
      const payload = {
        householdSize: data.householdSize,
        cookingFreq: data.cookingFreq,
        restrictions: data.restrictions,
        favoriteDishes: data.favoriteDishes.filter((d) => d.trim() !== ""),
        priority: data.priority,
      }
      const result = await api.post<any>(`/user/${user.id}/onboarding`, payload)

      // Update auth context + localStorage with the full server response
      updateUser(result)

      router.push("/menu")
    } catch (err: any) {
      setError(err.message || "Error al guardar")
    } finally {
      setIsSubmitting(false)
    }
  }

  const canAdvance = () => {
    switch (step) {
      case 1:
        return data.householdSize !== null
      case 2:
        return data.cookingFreq !== null
      case 3:
        return true
      case 4:
        return data.favoriteDishes.some((d) => d.trim() !== "")
      case 5:
        return data.priority !== null
      default:
        return false
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      {/* Progress */}
      <div className="mb-8 flex gap-2">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < step ? "bg-[#2D6A4F]" : "bg-[#EEEEEE]"
            )}
          />
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-[#FDEEE8] p-3 text-sm text-[#B5451B]">
          {error}
        </div>
      )}

      {/* Step 1: Household size */}
      {step === 1 && (
        <div>
          <h2 className="text-2xl font-bold">Para cuantos cocinas?</h2>
          <p className="mt-1 text-sm text-[#777777]">Asi ajustamos las cantidades</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {[
              { value: "solo", label: "Solo yo", desc: "1 persona" },
              { value: "couple", label: "En pareja", desc: "2 personas" },
              { value: "family_no_kids", label: "Familia sin ninos", desc: "3+ adultos" },
              { value: "family_with_kids", label: "Familia con ninos", desc: "Con peques" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setData({ ...data, householdSize: opt.value })}
                className={cn(
                  "rounded-xl border-2 p-4 text-left transition-colors",
                  data.householdSize === opt.value
                    ? "border-[#2D6A4F] bg-[#D8F3DC]"
                    : "border-[#DDDDDD] hover:border-[#95D5B2]"
                )}
              >
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-[#777777]">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Cooking frequency */}
      {step === 2 && (
        <div>
          <h2 className="text-2xl font-bold">Cuantas veces a la semana cocinas de verdad?</h2>
          <p className="mt-1 text-sm text-[#777777]">No cuenta calentar sobras</p>
          <div className="mt-6 space-y-3">
            {[
              { value: "rarely", label: "Poco", desc: "Prefiero recetas rapidas" },
              { value: "3_4_times", label: "3-4 veces", desc: "Lo normal" },
              { value: "daily", label: "Todos los dias", desc: "Me encanta cocinar" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setData({ ...data, cookingFreq: opt.value })}
                className={cn(
                  "w-full rounded-xl border-2 p-4 text-left transition-colors",
                  data.cookingFreq === opt.value
                    ? "border-[#2D6A4F] bg-[#D8F3DC]"
                    : "border-[#DDDDDD] hover:border-[#95D5B2]"
                )}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="ml-2 text-sm text-[#777777]">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Restrictions */}
      {step === 3 && (
        <div>
          <h2 className="text-2xl font-bold">Hay algo que no comas?</h2>
          <p className="mt-1 text-sm text-[#777777]">Alergias, intolerancias o preferencias</p>
          <div className="mt-6">
            <div className="flex flex-wrap gap-2">
              {PRESET_RESTRICTIONS.map((tag) => (
                <button
                  key={tag}
                  onClick={() =>
                    data.restrictions.includes(tag)
                      ? removeRestriction(tag)
                      : addRestriction(tag)
                  }
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    data.restrictions.includes(tag)
                      ? "border-[#2D6A4F] bg-[#2D6A4F] text-white"
                      : "border-[#DDDDDD] hover:border-[#95D5B2]"
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="Escribe y pulsa Enter para anadir..."
                className="input-ona w-full"
              />
            </div>
            {data.restrictions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.restrictions.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-[#D8F3DC] px-3 py-1 text-sm text-[#2D6A4F]"
                  >
                    {tag}
                    <button onClick={() => removeRestriction(tag)} className="ml-1 text-[#777777] hover:text-[#1A1A1A]">
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Favorite dishes */}
      {step === 4 && (
        <div>
          <h2 className="text-2xl font-bold">Dame 3 platos que te encanten</h2>
          <p className="mt-1 text-sm text-[#777777]">Para entender tus gustos</p>
          <div className="mt-6 space-y-3">
            {[0, 1, 2].map((i) => (
              <input
                key={i}
                type="text"
                value={data.favoriteDishes[i]}
                onChange={(e) => setFavoriteDish(i, e.target.value)}
                placeholder={`Plato ${i + 1}`}
                className="input-ona w-full"
              />
            ))}
          </div>
        </div>
      )}

      {/* Step 5: Priority */}
      {step === 5 && (
        <div>
          <h2 className="text-2xl font-bold">Que quieres que ONA priorice?</h2>
          <p className="mt-1 text-sm text-[#777777]">Elegimos el enfoque de tus menus</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {[
              { value: "healthy", label: "Salud", desc: "Equilibrio nutricional" },
              { value: "quick", label: "Rapidez", desc: "Recetas sencillas" },
              { value: "varied", label: "Variedad", desc: "Probar cosas nuevas" },
              { value: "cheap", label: "Ahorro", desc: "Maximo con poco" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setData({ ...data, priority: opt.value })}
                className={cn(
                  "rounded-xl border-2 p-4 text-left transition-colors",
                  data.priority === opt.value
                    ? "border-[#2D6A4F] bg-[#D8F3DC]"
                    : "border-[#DDDDDD] hover:border-[#95D5B2]"
                )}
              >
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-[#777777]">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex justify-between">
        <button
          onClick={prev}
          disabled={step === 1}
          className="rounded-lg px-4 py-2 text-sm font-medium text-[#777777] hover:text-[#1A1A1A] disabled:invisible"
        >
          Atras
        </button>

        {step < totalSteps ? (
          <button
            onClick={next}
            disabled={!canAdvance()}
            className="btn-primary btn-m"
          >
            Siguiente
          </button>
        ) : (
          <button
            onClick={handleComplete}
            disabled={!canAdvance() || isSubmitting}
            className="btn-primary btn-m"
          >
            {isSubmitting ? "Guardando..." : "Empezar"}
          </button>
        )}
      </div>
    </div>
  )
}

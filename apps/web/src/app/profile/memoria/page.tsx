"use client"

/**
 * /profile/memoria — Memory of the assistant.
 *
 * Read-only stub for PR 2. The assistant + the REST API can already read /
 * write here; this page lets the user *see* what's stored, grouped by
 * category, with a source badge per fact. The full inline-edit UX lands
 * in PR 4 (Memory Editor). Until then a "Borrar" button per row gives a
 * minimum-viable escape hatch, plus the user can edit via the assistant.
 */
import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, Pencil, Trash2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useUserMemory, useUpdateMemory, useDeleteMemoryFact } from "@/hooks/useUserMemory"
import { MemoryFactEditor } from "@/components/profile/MemoryFactEditor"
import type { MemoryKey, MemoryFact } from "@ona/shared"

interface Group {
  title: string
  keys: MemoryKey[]
}

const GROUPS: Group[] = [
  {
    title: "Perfil físico",
    keys: [
      "physical.sex",
      "physical.age",
      "physical.height_cm",
      "physical.weight_kg",
      "physical.activity_level",
    ],
  },
  {
    title: "Hogar",
    keys: ["household.adults", "household.kids_2_to_10"],
  },
  {
    title: "Restricciones y gustos",
    keys: ["restrictions", "dislikes"],
  },
  {
    title: "Cocina",
    keys: ["equipment", "cooking_skill", "weekly_budget_eur"],
  },
  {
    title: "Rutina",
    keys: ["time_available", "meal_times", "cuisine_bias"],
  },
  {
    title: "Creencias nutricionales propias",
    keys: ["nutrition_principles"],
  },
  {
    title: "Otras notas",
    keys: ["notes"],
  },
]

const LABELS: Partial<Record<MemoryKey, string>> = {
  "physical.sex": "Sexo",
  "physical.age": "Edad",
  "physical.height_cm": "Altura (cm)",
  "physical.weight_kg": "Peso (kg)",
  "physical.activity_level": "Actividad",
  "household.adults": "Adultos en casa",
  "household.kids_2_to_10": "Niños 2-10 años",
  restrictions: "Restricciones",
  dislikes: "Cosas que no le gustan",
  equipment: "Equipo de cocina",
  cooking_skill: "Nivel de cocinero",
  weekly_budget_eur: "Presupuesto semanal (€)",
  time_available: "Tiempo disponible por día",
  meal_times: "Horarios de comidas",
  cuisine_bias: "Preferencias de cocina",
  notes: "Notas del asistente",
  nutrition_principles: "Principios nutricionales",
}

const SOURCE_BADGES: Record<MemoryFact["source"], { label: string; color: string }> = {
  onboarding: { label: "Onboarding", color: "bg-[#F2EDE0] text-[#7A7066]" },
  manual: { label: "Tú", color: "bg-[#2D6A4F] text-[#FAF6EE]" },
  inferred: { label: "Asistente", color: "bg-[#C65D38]/80 text-[#FAF6EE]" },
}

function formatValue(key: MemoryKey, value: unknown): string {
  if (value == null) return "—"
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ")
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([_, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")
  }
  return String(value)
}

export default function MemoryPage() {
  const { user } = useAuth()
  const { data: memory, isLoading } = useUserMemory()
  const updateMemory = useUpdateMemory()
  const deleteFact = useDeleteMemoryFact()
  const [busyKey, setBusyKey] = useState<MemoryKey | null>(null)
  const [editingKey, setEditingKey] = useState<MemoryKey | null>(null)

  if (!user) {
    return (
      <div className="min-h-screen bg-[#FAF6EE] p-6">
        <p className="text-[#1A1612]">Necesitas iniciar sesión para ver tu memoria.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <div className="mx-auto max-w-[430px] px-5 pb-20 pt-8">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.15em] text-[#7A7066] hover:text-[#1A1612]"
        >
          <ChevronLeft size={14} />
          Volver al perfil
        </Link>
        <div className="mt-6">
          <div className="text-eyebrow text-[#C65D38]">Memoria del asistente</div>
          <h1 className="mt-2 font-display text-[2.2rem] leading-[1.02] tracking-tight text-[#1A1612]">
            Lo que <span className="font-italic italic text-[#C65D38]">recuerdo</span> de ti
          </h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[#7A7066]">
            Cada dato que el asistente conoce sobre ti vive aquí. Los que tú
            confirmaste tienen badge verde; los que el asistente dedujo en una
            conversación, terracota.
          </p>
        </div>

        {isLoading ? (
          <div className="mt-10 animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-[#F2EDE0]" />
            ))}
          </div>
        ) : (
          <div className="mt-10 space-y-8">
            {GROUPS.map((group) => {
              const facts = group.keys
                .map((k) => [k, memory?.[k]] as const)
                .filter(([_, f]) => f != null && f !== undefined)
              if (facts.length === 0) return null
              return (
                <section key={group.title}>
                  <div className="text-eyebrow text-[#7A7066]">{group.title}</div>
                  <ul className="mt-3 space-y-2">
                    {facts.map(([key, fact]) => {
                      const f = fact as MemoryFact
                      const k = key as MemoryKey
                      const badge = SOURCE_BADGES[f.source]
                      const isEditing = editingKey === k
                      return (
                        <li
                          key={key}
                          className="rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-medium text-[#1A1612]">
                                  {LABELS[k] ?? k}
                                </span>
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em] ${badge.color}`}
                                >
                                  {badge.label}
                                </span>
                              </div>
                              {!isEditing ? (
                                <div className="mt-1 text-[14px] text-[#1A1612]">
                                  {formatValue(k, f.value)}
                                </div>
                              ) : null}
                            </div>
                            {!isEditing ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingKey(k)}
                                  className="text-[#1A1612] transition-colors hover:text-[#2D6A4F]"
                                  aria-label={`Editar ${LABELS[k] ?? k}`}
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  disabled={busyKey === k}
                                  onClick={() => {
                                    if (
                                      typeof window === "undefined" ||
                                      window.confirm("¿Olvidar este dato?")
                                    ) {
                                      setBusyKey(k)
                                      deleteFact.mutate(
                                        { key: k },
                                        { onSettled: () => setBusyKey(null) },
                                      )
                                    }
                                  }}
                                  className="text-[#C65D38] transition-colors hover:text-[#1A1612] disabled:opacity-40"
                                  aria-label={`Olvidar ${LABELS[k] ?? k}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ) : null}
                          </div>

                          {isEditing ? (
                            <MemoryFactEditor
                              memoryKey={k}
                              initial={f.value}
                              disabled={busyKey === k}
                              onCancel={() => setEditingKey(null)}
                              onSave={(next) => {
                                setBusyKey(k)
                                updateMemory.mutate(
                                  { key: k, value: next },
                                  {
                                    onSettled: () => {
                                      setBusyKey(null)
                                      setEditingKey(null)
                                    },
                                  },
                                )
                              }}
                            />
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}

            {(!memory || Object.keys(memory).length === 0) && (
              <div className="mt-6 rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] p-6 text-center">
                <p className="font-italic italic text-[#7A7066]">
                  Todavía no recuerdo nada de ti.
                </p>
                <p className="mt-2 text-[12px] text-[#7A7066]">
                  Habla con el asistente — todo lo que le cuentes se guardará
                  aquí automáticamente.
                </p>
              </div>
            )}
          </div>
        )}

        <p className="mt-12 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
          Pulsa el lápiz para editar cualquier dato. También puedes pedírselo
          al asistente ("recuerda que…"); las dos vías escriben en la misma
          memoria.
        </p>
      </div>
    </div>
  )
}
